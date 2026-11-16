import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchSnapshot, writeConfig } from '../../../src/client/lib/http.ts'
import { REQUEST_HEADER, REQUEST_HEADER_VALUE, ROUTES } from '../../../src/shared/api.ts'

const snapshot = {
  revision: 2,
  capabilities: [],
  config: {
    version: 1 as const,
    excluded: [],
    resident: [],
    blacklist: { router: [], worker: [] },
    embedding: { enabled: false },
    roleBindings: {},
  },
  rolesAvailable: false,
  embedding: { enabled: false as const, status: 'idle' as const },
  warnings: [],
}

interface Call {
  path: string
  init: RequestInit
}

function stubFetch(responder: (call: Call) => Promise<Response> | Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const call = { path, init }
    calls.push(call)
    return responder(call)
  })
  return calls
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('读取快照', () => {
  it('请求快照端点并带上自定义头', async () => {
    const calls = stubFetch(() => json(snapshot))

    await fetchSnapshot()

    expect(calls[0]?.path).toBe(ROUTES.snapshot)
    expect((calls[0]?.init.headers as Record<string, string>)[REQUEST_HEADER]).toBe(REQUEST_HEADER_VALUE)
  })

  it('返回服务端快照', async () => {
    stubFetch(() => json(snapshot))

    await expect(fetchSnapshot()).resolves.toEqual(snapshot)
  })

  it('服务端拒绝时抛出带稳定错误码的异常', async () => {
    stubFetch(() => json({ ok: false, code: 'wrong-origin', message: 'Origin mismatch' }, 403))

    await expect(fetchSnapshot()).rejects.toMatchObject({ name: 'ApiError', code: 'wrong-origin' })
  })

  it('网络层失败时给出 network 码', async () => {
    stubFetch(() => Promise.reject(new Error('connection reset')))

    await expect(fetchSnapshot()).rejects.toMatchObject({ code: 'network' })
  })

  it('响应不是 JSON 时给出 internal 码而不是崩溃', async () => {
    stubFetch(() => new Response('<html>gateway timeout</html>', { status: 504 }))

    await expect(fetchSnapshot()).rejects.toMatchObject({ code: 'internal' })
  })

  it('错误体缺少错误码时回落 internal', async () => {
    stubFetch(() => json({ unexpected: true }, 500))

    await expect(fetchSnapshot()).rejects.toMatchObject({ code: 'internal' })
  })
})

describe('写入配置', () => {
  const patch = { op: 'set-resident' as const, id: 'tool:read', value: true, revision: 2 }

  it('以 POST 提交补丁并带上自定义头与 JSON 内容类型', async () => {
    const calls = stubFetch(() => json({ ok: true, revision: 3 }))

    await writeConfig(patch)

    expect(calls[0]?.path).toBe(ROUTES.config)
    expect(calls[0]?.init.method).toBe('POST')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers[REQUEST_HEADER]).toBe(REQUEST_HEADER_VALUE)
    expect(headers['content-type']).toBe('application/json')
    expect(calls[0]?.init.body).toBe(JSON.stringify(patch))
  })

  it('返回新的 revision', async () => {
    stubFetch(() => json({ ok: true, revision: 3 }))

    await expect(writeConfig(patch)).resolves.toEqual({ ok: true, revision: 3 })
  })

  it('revision 冲突时抛出可识别的错误码，供调用方重新拉快照', async () => {
    stubFetch(() => json({ ok: false, code: 'revision-conflict', message: 'changed elsewhere', revision: 9 }, 409))

    await expect(writeConfig(patch)).rejects.toMatchObject({ code: 'revision-conflict' })
  })

  it('业务拒绝时抛出对应的错误码', async () => {
    stubFetch(() => json({ ok: false, code: 'bad-request', message: '不能设为常驻' }, 400))

    await expect(writeConfig(patch)).rejects.toMatchObject({ code: 'bad-request' })
  })

  it('抛出的是 ApiError，调用方按码分支', async () => {
    stubFetch(() => json({ ok: false, code: 'bad-request', message: 'x' }, 400))

    await expect(writeConfig(patch)).rejects.toBeInstanceOf(ApiError)
  })
})
