// tests/host/search/embedding/store.test.ts
//
// 向量缓存：按「能力 id + 摘要哈希」命中，摘要变了就重算。
//
// 缓存文件是模型的邻居（`<modelDir>/vectors.json`），读坏了不能阻断检索——
// 最坏情况只是重新算一遍向量。

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VectorStore, summaryHash } from '../../../../src/host/search/embedding/store.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function storePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-vectors-'))
  tempDirs.push(dir)
  return join(dir, 'vectors.json')
}

function vector(...values: number[]): Float32Array {
  return Float32Array.from(values)
}

describe('摘要哈希', () => {
  it('相同摘要得到相同哈希', () => {
    expect(summaryHash('读取文本文件')).toBe(summaryHash('读取文本文件'))
  })

  it('摘要变化会改变哈希', () => {
    expect(summaryHash('读取文本文件')).not.toBe(summaryHash('读取文本'))
  })

  it('是 64 位小写十六进制', () => {
    expect(summaryHash('x')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('缓存读写', () => {
  it('没有缓存文件时是空表', () => {
    const store = new VectorStore({ path: storePath() })

    expect(store.size).toBe(0)
    expect(store.get('tool:read', '读取文本文件')).toBeUndefined()
  })

  it('写入后能读回同一个向量', () => {
    const store = new VectorStore({ path: storePath() })
    store.set('tool:read', '读取文本文件', vector(0.1, 0.2, 0.3))

    expect([...store.get('tool:read', '读取文本文件') ?? []]).toEqual([...vector(0.1, 0.2, 0.3)])
  })

  it('摘要变化时视为未命中', () => {
    const store = new VectorStore({ path: storePath() })
    store.set('tool:read', '读取文本文件', vector(1, 0))

    expect(store.get('tool:read', '读取文件')).toBeUndefined()
  })

  it('落盘后新实例能读到', () => {
    const path = storePath()
    const first = new VectorStore({ path })
    first.set('tool:read', '读取文本文件', vector(0.5, 0.5))
    first.flush()

    const second = new VectorStore({ path })

    expect([...second.get('tool:read', '读取文本文件') ?? []]).toEqual([0.5, 0.5])
  })

  it('同 id 再次写入会覆盖旧向量', () => {
    const store = new VectorStore({ path: storePath() })
    store.set('tool:read', '旧摘要', vector(1, 0))
    store.set('tool:read', '新摘要', vector(0, 1))

    expect(store.size).toBe(1)
    expect(store.get('tool:read', '旧摘要')).toBeUndefined()
    expect([...store.get('tool:read', '新摘要') ?? []]).toEqual([0, 1])
  })
})

describe('落盘', () => {
  it('没有变更时不写文件', () => {
    const path = storePath()
    const store = new VectorStore({ path })

    store.flush()

    expect(readdirSync(join(path, '..'))).toEqual([])
  })

  it('写入后落盘，文件结构与契约一致', () => {
    const path = storePath()
    const store = new VectorStore({ path })
    store.set('skill:office', '创建与编辑 Office 文档', vector(1, 2))

    store.flush()

    const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { hash: string; vector: number[] }>
    expect(Object.keys(data)).toEqual(['skill:office'])
    expect(data['skill:office']?.hash).toBe(summaryHash('创建与编辑 Office 文档'))
    expect(data['skill:office']?.vector).toEqual([1, 2])
  })

  it('落盘后没有临时文件残留', () => {
    const path = storePath()
    const store = new VectorStore({ path })
    store.set('tool:read', '摘要', vector(1))
    store.flush()

    expect(readdirSync(join(path, '..')).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('落盘后不再标记为脏', () => {
    const store = new VectorStore({ path: storePath() })
    store.set('tool:read', '摘要', vector(1))

    expect(store.dirty).toBe(true)
    store.flush()
    expect(store.dirty).toBe(false)
  })

  it('写盘失败不抛出，只记日志并保持脏标记', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-vectors-'))
    tempDirs.push(dir)
    // 路径指向一个已存在的目录：最终 rename 必然失败，用来验证降级方向。
    const path = join(dir, 'vectors.json')
    mkdirSync(path)
    const messages: string[] = []
    const store = new VectorStore({ path, log: message => messages.push(message) })
    store.set('tool:read', '摘要', vector(1))

    store.flush()

    // 读也会失败（路径是目录），所以按「写盘失败被记录」断言，而不是依赖日志条数。
    expect(messages.some(message => message.includes('persist'))).toBe(true)
    expect(store.dirty).toBe(true)
  })

  it('get 返回副本：外部修改不会污染缓存', () => {
    const store = new VectorStore({ path: storePath() })
    store.set('tool:read', '摘要', vector(1, 2))
    const first = store.get('tool:read', '摘要')
    first![0] = 99

    expect([...store.get('tool:read', '摘要') ?? []]).toEqual([1, 2])
  })
})

describe('损坏的缓存', () => {
  it('不是合法 JSON 时退化为空表并记日志', () => {
    const path = storePath()
    writeFileSync(path, 'not json', 'utf8')
    const messages: string[] = []

    const store = new VectorStore({ path, log: message => messages.push(message) })

    expect(store.size).toBe(0)
    expect(messages.length).toBe(1)
  })

  it('结构不对的条目被忽略，合法条目仍然可用', () => {
    const path = storePath()
    writeFileSync(
      path,
      JSON.stringify({
        'tool:bad': { hash: 42, vector: 'nope' },
        'tool:ok': { hash: summaryHash('摘要'), vector: [1, 0] },
      }),
      'utf8',
    )

    const store = new VectorStore({ path })

    expect(store.size).toBe(1)
    expect([...store.get('tool:ok', '摘要') ?? []]).toEqual([1, 0])
  })

  it('向量里的非数值被剔除', () => {
    const path = storePath()
    writeFileSync(path, JSON.stringify({ 'tool:x': { hash: summaryHash('s'), vector: [1, 'a', 2] } }), 'utf8')

    const store = new VectorStore({ path })

    expect([...store.get('tool:x', 's') ?? []]).toEqual([1, 2])
  })
})
