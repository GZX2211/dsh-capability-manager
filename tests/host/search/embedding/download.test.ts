// tests/host/search/embedding/download.test.ts
//
// 模型下载：多源回退、size + sha256 校验、原子落盘、失败清理。
//
// 用本地 HTTP 服务代替外网：断言的是一组规则（先主源、失败换镜像、校验不过就删掉重下），
// 不需要真的下载 24MB 模型。

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureModel, type ModelFile } from '../../../../src/host/search/embedding/download.ts'
import { MODEL_REPO, MODEL_REVISION } from '../../../../src/host/search/embedding/model.ts'

const cleanups: (() => void)[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-embedding-'))
  tempDirs.push(dir)
  return dir
}

/** 内容 → 清单项：sha256 与 size 都由真实内容算出，测试即校验基准。 */
function file(path: string, content: string, fileName = path.split('/').pop() ?? path): ModelFile {
  return {
    path,
    fileName,
    size: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}

interface Served {
  /** 命中该前缀的请求一律 404，用来模拟主源不可用。 */
  failPrefixes: string[]
  /** 路径 → 内容。 */
  contents: Map<string, string>
}

/** 起一个本地源服务，返回 origin 与命中计数。 */
async function serve(served: Served): Promise<{ origin: string; requests: string[] }> {
  const requests: string[] = []
  const server: Server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    requests.push(pathname)
    if (served.failPrefixes.some(prefix => pathname.startsWith(prefix))) {
      response.writeHead(404).end()
      return
    }
    const key = [...served.contents.keys()].find(path => pathname.endsWith(`/${path}`))
    if (key === undefined) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    response.end(served.contents.get(key))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => server.close())
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind a port')
  return { origin: `http://127.0.0.1:${String(address.port)}`, requests }
}

/** 固定两项的清单：索引访问因此有确定的类型。 */
function files(): [ModelFile, ModelFile] {
  return [file('weights.bin', 'weights-content'), file('sub/tokenizer.json', 'tokenizer-content')]
}

describe('下载与校验', () => {
  it('缺失文件时从主源下载并落盘', async () => {
    const modelDir = tempDir()
    const listed = files()
    const { origin } = await serve({ failPrefixes: [], contents: new Map(listed.map(item => [item.path, contentsOf(item)])) })

    const result = await ensureModel(modelDir, listed, { origins: [origin] })

    expect(result).toEqual({ ok: true })
    expect(readFileSync(join(modelDir, 'weights.bin'), 'utf8')).toBe('weights-content')
    expect(readFileSync(join(modelDir, 'tokenizer.json'), 'utf8')).toBe('tokenizer-content')
  })

  it('写入 manifest：repo、revision 与文件清单', async () => {
    const modelDir = tempDir()
    const listed = files()
    const { origin } = await serve({ failPrefixes: [], contents: new Map(listed.map(item => [item.path, contentsOf(item)])) })

    await ensureModel(modelDir, listed, { origins: [origin] })

    const manifest = JSON.parse(readFileSync(join(modelDir, 'manifest.json'), 'utf8')) as {
      repo: string
      revision: string
      files: { fileName: string; sha256: string }[]
    }
    expect(manifest.repo).toBe(MODEL_REPO)
    expect(manifest.revision).toBe(MODEL_REVISION)
    expect(manifest.files.map(item => item.fileName).sort()).toEqual(['tokenizer.json', 'weights.bin'])
  })

  it('已存在且校验通过时完全不发请求', async () => {
    const modelDir = tempDir()
    const listed = files()
    for (const item of listed) writeFileSync(join(modelDir, item.fileName), contentsOf(item))
    const { origin, requests } = await serve({ failPrefixes: [], contents: new Map() })

    const result = await ensureModel(modelDir, listed, { origins: [origin] })

    expect(result).toEqual({ ok: true })
    expect(requests).toEqual([])
  })

  it('只重下损坏的那个文件', async () => {
    const modelDir = tempDir()
    const listed = files()
    writeFileSync(join(modelDir, 'weights.bin'), 'corrupted')
    writeFileSync(join(modelDir, 'tokenizer.json'), contentsOf(listed[1]))
    const { origin, requests } = await serve({
      failPrefixes: [],
      contents: new Map(listed.map(item => [item.path, contentsOf(item)])),
    })

    await ensureModel(modelDir, listed, { origins: [origin] })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain('weights.bin')
    expect(readFileSync(join(modelDir, 'weights.bin'), 'utf8')).toBe('weights-content')
  })

  it('主源失败时回落到镜像', async () => {
    const modelDir = tempDir()
    const listed = files()
    const primary = await serve({ failPrefixes: ['/'], contents: new Map() })
    const mirror = await serve({
      failPrefixes: [],
      contents: new Map(listed.map(item => [item.path, contentsOf(item)])),
    })

    const result = await ensureModel(modelDir, listed, { origins: [primary.origin, mirror.origin] })

    expect(result).toEqual({ ok: true })
    expect(primary.requests.length).toBeGreaterThan(0)
    expect(mirror.requests.length).toBeGreaterThan(0)
  })

  it('两个源都不可用时失败，且不留下半截文件', async () => {
    const modelDir = tempDir()
    const listed = files()
    const source = await serve({ failPrefixes: ['/'], contents: new Map() })

    const result = await ensureModel(modelDir, listed, { origins: [source.origin, source.origin] })

    expect(result.ok).toBe(false)
    expect(readdirSync(modelDir).filter(name => name.endsWith('.part'))).toEqual([])
    expect(readdirSync(modelDir)).toEqual([])
  })

  it('内容与 sha256 不符时失败，并删掉临时文件', async () => {
    const modelDir = tempDir()
    const listed = files()
    const tampered = new Map(listed.map(item => [item.path, 'tampered-content']))
    const source = await serve({ failPrefixes: [], contents: tampered })

    const result = await ensureModel(modelDir, listed, { origins: [source.origin] })

    expect(result.ok).toBe(false)
    expect(readdirSync(modelDir).filter(name => name.endsWith('.part'))).toEqual([])
    expect(readdirSync(modelDir)).toEqual([])
  })

  it('清单大小与内容不符时失败', async () => {
    const modelDir = tempDir()
    const listed = files()
    const wrongSize: ModelFile[] = [{ ...listed[0], size: listed[0].size + 1 }]
    const source = await serve({ failPrefixes: [], contents: new Map([['weights.bin', 'weights-content']]) })

    const result = await ensureModel(modelDir, wrongSize, { origins: [source.origin] })

    expect(result.ok).toBe(false)
  })

  it('按需报告下载与校验阶段', async () => {
    const modelDir = tempDir()
    const listed = files()
    const source = await serve({
      failPrefixes: [],
      contents: new Map(listed.map(item => [item.path, contentsOf(item)])),
    })
    const phases: string[] = []

    await ensureModel(modelDir, listed, { origins: [source.origin], onPhase: phase => phases.push(phase) })

    expect(phases).toContain('downloading')
    expect(phases.at(-1)).toBe('ready')
  })

  it('模型目录不存在时自动创建', async () => {
    const modelDir = join(tempDir(), 'nested', 'models')
    const listed = files()
    const source = await serve({
      failPrefixes: [],
      contents: new Map(listed.map(item => [item.path, contentsOf(item)])),
    })

    const result = await ensureModel(modelDir, listed, { origins: [source.origin] })

    expect(result).toEqual({ ok: true })
    expect(statSync(modelDir).isDirectory()).toBe(true)
  })

  it('第一个文件失败时立即中止，不继续请求后面的文件', async () => {
    const modelDir = tempDir()
    const listed = files()
    const source = await serve({ failPrefixes: [], contents: new Map() })

    const result = await ensureModel(modelDir, listed, { origins: [source.origin] })

    expect(result.ok).toBe(false)
    expect(readdirSync(modelDir)).toEqual([])
    // 每个请求的最后一段就是被下载的文件名：只应有第一个文件的那一次请求。
    expect(source.requests.map(path => path.split('/').pop())).toEqual(['weights.bin'])
  })

  it('第二个文件失败时保留第一个已完成的文件', async () => {
    const modelDir = tempDir()
    const listed = [files()[0], file('later.json', 'later-content')]
    // 清单里没有 later.json，服务对它返回 404。
    const source = await serve({
      failPrefixes: [],
      contents: new Map([['weights.bin', 'weights-content']]),
    })

    const result = await ensureModel(modelDir, listed, { origins: [source.origin] })

    expect(result.ok).toBe(false)
    expect(readdirSync(modelDir)).toEqual(['weights.bin'])
    expect(readFileSync(join(modelDir, 'weights.bin'), 'utf8')).toBe('weights-content')
  })

  it('请求超时按失败处理', async () => {
    const modelDir = tempDir()
    const listed = [files()[0]]
    // 永不响应的服务：只验证超时会被打断，不会一直挂着。
    const server = createServer(() => {})
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind a port')
    const origin = `http://127.0.0.1:${String(address.port)}`

    const result = await ensureModel(modelDir, listed, { origins: [origin], timeoutMs: 50 })

    expect(result.ok).toBe(false)
    expect(readdirSync(modelDir)).toEqual([])
  })

  it('文件已就绪时仍写 manifest：revision 升级的痕迹必须留下', async () => {
    const modelDir = tempDir()
    const listed = files()
    for (const item of listed) writeFileSync(join(modelDir, item.fileName), contentsOf(item))
    const source = await serve({ failPrefixes: [], contents: new Map() })

    await ensureModel(modelDir, listed, { origins: [source.origin] })

    expect(readFileSync(join(modelDir, 'manifest.json'), 'utf8')).toContain(MODEL_REVISION)
  })
})

/** 清单项对应的内容：测试里内容与文件名一一对应，便于断言。 */
function contentsOf(item: ModelFile): string {
  return item.path === 'weights.bin' ? 'weights-content' : 'tokenizer-content'
}
