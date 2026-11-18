// tests/host/search/embedding/index.test.ts
//
// 向量检索服务：状态机、开启/关闭、按需下载加载、语义检索与缓存复用。
//
// 模型下载与推理都注入替身：这里验证的是编排与降级规则，不是 ORT 与网络。

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_THRESHOLD,
  DEFAULT_TOP_K,
  EmbeddingService,
  selectTopK,
  type EmbeddingCandidate,
} from '../../../../src/host/search/embedding/index.ts'
import type { Embedder } from '../../../../src/host/search/embedding/runtime.ts'
import { DEFAULT_CONFIG, type CapabilityConfig, type EmbeddingConfig } from '../../../../src/shared/config.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-embedding-service-'))
  tempDirs.push(dir)
  return dir
}

function config(embedding: EmbeddingConfig = { enabled: false }): CapabilityConfig {
  return { ...DEFAULT_CONFIG, embedding }
}

/** 按文本查表的假嵌入器：向量由测试直接给出（已归一化）。 */
function fakeEmbedder(table: Record<string, number[]>, calls: string[] = []): Embedder {
  return {
    async embed(texts) {
      calls.push(...texts)
      return texts.map(text => Float32Array.from(table[text] ?? [0, 1]))
    },
    async dispose() {},
  }
}

interface Harness {
  service: EmbeddingService
  saved: { enabled: boolean; modelDir?: string; revision?: string }[]
  calls: string[]
  counters: { ensureCalls: number }
  vectorPath: string
}

function harness(options: {
  initial?: CapabilityConfig
  ensure?: () => Promise<{ ok: true } | { ok: false; message: string }>
  load?: () => Promise<Embedder>
  table?: Record<string, number[]>
  modelPresent?: boolean
  topK?: number
  log?: (message: string) => void
} = {}): Harness {
  const saved: Harness['saved'] = []
  const calls: string[] = []
  const counters = { ensureCalls: 0 }
  const vectorsPath = join(tempDir(), 'vectors.json')
  let current = options.initial ?? config()

  const service = new EmbeddingService({
    modelDir: tempDir(),
    config: () => current,
    saveEmbedding: embedding => {
      saved.push(embedding)
      current = { ...current, embedding: { ...current.embedding, ...embedding } }
    },
    ensureModel: async () => {
      counters.ensureCalls += 1
      return options.ensure === undefined ? { ok: true } : options.ensure()
    },
    loadEmbedder: options.load ?? (async () => fakeEmbedder(options.table ?? {}, calls)),
    vectorPath: vectorsPath,
    modelPresent: () => options.modelPresent ?? true,
    topK: options.topK,
    log: options.log,
  })

  return { service, saved, calls, counters, vectorPath: vectorsPath }
}

describe('状态机', () => {
  it('默认关闭时状态是 idle', () => {
    const { service } = harness()

    expect(service.status()).toEqual({ enabled: false, status: 'idle' })
  })

  it('开启成功后状态是 ready 并写回配置', async () => {
    const { service, saved } = harness()

    const result = await service.enable()

    expect(result).toEqual({ ok: true })
    expect(service.status()).toMatchObject({ enabled: true, status: 'ready' })
    expect(saved).toEqual([
      { enabled: true, modelDir: 'bge-small-zh-v1.5', revision: expect.stringMatching(/^[0-9a-f]{40}$/) as unknown as string },
    ])
  })

  it('下载失败时保持关闭并给出原因', async () => {
    const { service, saved } = harness({ ensure: async () => ({ ok: false, message: 'network down' }) })

    const result = await service.enable()

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: 'embedding-download-failed' })
    expect(service.status()).toMatchObject({ enabled: false, status: 'failed' })
    expect(service.status().message).toContain('network down')
    expect(saved).toEqual([])
  })

  it('运行时加载失败时保持关闭并给出可行动的原因', async () => {
    const { service, saved } = harness({
      load: async () => {
        throw new Error('onnxruntime-node cannot be loaded')
      },
    })

    const result = await service.enable()

    expect(result).toMatchObject({ ok: false, code: 'embedding-unavailable' })
    expect(service.status()).toMatchObject({ enabled: false, status: 'failed' })
    expect(service.status().message).toContain('onnxruntime-node')
    expect(saved).toEqual([])
  })

  it('关闭时释放会话并写回配置', async () => {
    let released = 0
    const { service, saved } = harness({
      load: async () => ({
        async embed(texts) {
          return texts.map(() => new Float32Array([1, 0]))
        },
        async dispose() {
          released += 1
        },
      }),
    })
    await service.enable()

    await service.disable()

    expect(released).toBe(1)
    expect(service.status()).toEqual({ enabled: false, status: 'idle' })
    expect(saved.at(-1)).toEqual({ enabled: false })
  })

  it('重复开启复用进行中的加载，不会重复下载', async () => {
    const { service, counters } = harness()

    await Promise.all([service.enable(), service.enable()])

    expect(counters.ensureCalls).toBe(1)
  })

  it('下载器抛异常时按下载失败处理', async () => {
    const { service } = harness({
      ensure: async () => {
        throw new Error('socket hang up')
      },
    })

    const result = await service.enable()

    expect(result).toMatchObject({ ok: false, code: 'embedding-download-failed' })
    expect(service.status()).toMatchObject({ enabled: false, status: 'failed' })
  })

  it('关闭时等仍在进行的加载结束，并只释放一次会话', async () => {
    let released = 0
    let resolveLoad: ((embedder: Embedder) => void) | undefined
    const pending = new Promise<Embedder>(resolve => {
      resolveLoad = resolve
    })
    const { service } = harness({ load: () => pending })

    const enabling = service.enable()
    // 让 enable 走到「等模型加载」这一步，再发起关闭。
    await new Promise(resolve => setTimeout(resolve, 0))
    const disabling = service.disable()
    resolveLoad?.({
      async embed(texts) {
        return texts.map(() => new Float32Array([1, 0]))
      },
      async dispose() {
        released += 1
      },
    })
    await Promise.all([enabling, disabling])

    expect(released).toBe(1)
    expect(service.status()).toEqual({ enabled: false, status: 'idle' })
  })

  it('卸载后不再开启也不再检索', async () => {
    const { service } = harness()

    await service.dispose()

    expect(await service.enable()).toMatchObject({ ok: false, code: 'embedding-unavailable' })
    expect(await service.search('读取文件', [])).toBeUndefined()
  })

  it('启动自愈：配置开启但模型不在时关闭并记日志', () => {
    const saved: { enabled: boolean }[] = []
    const messages: string[] = []
    const service = new EmbeddingService({
      modelDir: tempDir(),
      config: () => config({ enabled: true }),
      saveEmbedding: embedding => {
        saved.push(embedding)
      },
      ensureModel: async () => ({ ok: true }),
      loadEmbedder: async () => fakeEmbedder({}),
      vectorPath: join(tempDir(), 'vectors.json'),
      modelPresent: () => false,
      log: message => messages.push(message),
    })

    service.start()

    expect(saved).toEqual([{ enabled: false }])
    expect(messages.some(message => message.includes('模型'))).toBe(true)
  })

  it('启动加载失败时自愈为关闭，避免模式 B 空转', async () => {
    const saved: { enabled: boolean }[] = []
    const service = new EmbeddingService({
      modelDir: tempDir(),
      config: () => config({ enabled: true }),
      saveEmbedding: embedding => {
        saved.push(embedding)
      },
      ensureModel: async () => ({ ok: true }),
      loadEmbedder: async () => {
        throw new Error('boom')
      },
      vectorPath: join(tempDir(), 'vectors.json'),
      modelPresent: () => true,
    })

    service.start()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(saved).toEqual([{ enabled: false }])
    expect(service.status().status).toBe('failed')
  })

  it('启动时配置开启且模型就绪会后台加载', async () => {
    const service = new EmbeddingService({
      modelDir: tempDir(),
      config: () => config({ enabled: true }),
      saveEmbedding: () => {},
      ensureModel: async () => ({ ok: true }),
      loadEmbedder: async () => fakeEmbedder({}),
      vectorPath: join(tempDir(), 'vectors.json'),
      modelPresent: () => true,
    })

    service.start()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(service.status()).toMatchObject({ enabled: true, status: 'ready' })
  })
})

describe('语义检索', () => {
  const candidates: EmbeddingCandidate[] = [
    { id: 'tool:read', summary: '读取文本文件' },
    { id: 'skill:office', summary: '创建与编辑 Office 文档' },
    { id: 'tool:bash', summary: '执行命令' },
  ]

  const table: Record<string, number[]> = {
    读取文件: [1, 0],
    读取文本文件: [0.9, 0.4358898943540674],
    '创建与编辑 Office 文档': [0.8, 0.6],
    执行命令: [0, 1],
  }

  it('未开启时返回 undefined，由调用方给出说明', async () => {
    const { service } = harness()

    expect(await service.search('读取文件', candidates)).toBeUndefined()
  })

  it('按相似度降序返回，阈值以下的被剔除', async () => {
    const { service } = harness({ table })
    await service.enable()

    const hits = await service.search('读取文件', candidates)

    expect(hits?.map(hit => hit.id)).toEqual(['tool:read', 'skill:office'])
    expect(hits?.[0]?.score).toBeCloseTo(0.9, 6)
  })

  it('分数低于阈值的能力不返回', async () => {
    const { service } = harness({ table })
    await service.enable()

    expect(await service.search('读取文件', [{ id: 'tool:bash', summary: '执行命令' }])).toEqual([])
  })

  it('topK 截断结果', async () => {
    const { service } = harness({ table, topK: 1 })
    await service.enable()

    expect((await service.search('读取文件', candidates))?.map(hit => hit.id)).toEqual(['tool:read'])
  })

  it('第二次检索复用向量缓存，不重复编码候选', async () => {
    const { service, calls } = harness({ table })
    await service.enable()
    await service.search('读取文件', candidates)
    calls.length = 0

    await service.search('读取文件', candidates)

    expect(calls).toEqual(['读取文件'])
  })

  it('摘要变化时只重算那一个能力', async () => {
    const { service, calls } = harness({ table })
    await service.enable()
    await service.search('读取文件', candidates)
    calls.length = 0

    await service.search('读取文件', [{ id: 'tool:read', summary: '读取文本文件' }, { id: 'tool:bash', summary: '执行 shell 命令' }])

    expect(calls).toEqual(['读取文件', '执行 shell 命令'])
  })

  it('推理失败时降级为 undefined 而不是抛给工具层', async () => {
    const { service } = harness({
      load: async () => ({
        async embed() {
          throw new Error('session exploded')
        },
        async dispose() {},
      }),
    })
    await service.enable()

    expect(await service.search('读取文件', candidates)).toBeUndefined()
  })

  it('检索后把新算出的向量写进缓存文件', async () => {
    const harnessed = harness({ table })
    await harnessed.service.enable()

    await harnessed.service.search('读取文件', [{ id: 'tool:read', summary: '读取文本文件' }])

    expect(existsSync(harnessed.vectorPath)).toBe(true)
  })
})

describe('topK 选择', () => {
  const hits = [
    { id: 'a', score: 0.9 },
    { id: 'b', score: 0.5 },
    { id: 'c', score: 0.2 },
    { id: 'd', score: 0.8 },
  ]

  it('默认阈值与条数来自常量', () => {
    expect(DEFAULT_TOP_K).toBe(10)
    expect(DEFAULT_THRESHOLD).toBe(0.35)
  })

  it('过滤、排序、截断一次完成', () => {
    expect(selectTopK(hits, 2, 0.35).map(hit => hit.id)).toEqual(['a', 'd'])
  })

  it('分数相同按 id 稳定排序', () => {
    const same = [
      { id: 'b', score: 0.5 },
      { id: 'a', score: 0.5 },
    ]

    expect(selectTopK(same, 10, 0).map(hit => hit.id)).toEqual(['a', 'b'])
  })

  it('空输入返回空数组', () => {
    expect(selectTopK([], 10, 0.35)).toEqual([])
  })
})
