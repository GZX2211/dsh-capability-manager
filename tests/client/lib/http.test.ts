import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createSkill,
  deleteMcpServer,
  fetchMcpServers,
  fetchSnapshot,
  importMcpServers,
  revealCapability,
  saveMcpServer,
  toggleMcpServer,
  writeConfig,
} from '../../../src/client/lib/http.ts'
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

describe('手动创建 Skill', () => {
  it('以 POST 提交 revision 并带自定义头', async () => {
    const calls = stubFetch(() => json({ ok: true, revision: 3, capability: { id: 'skill:my-skill' } }))

    await createSkill(2)

    expect(calls[0]?.path).toBe(ROUTES.createSkill)
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ revision: 2 }))
    expect((calls[0]?.init.headers as Record<string, string>)[REQUEST_HEADER]).toBe(REQUEST_HEADER_VALUE)
  })

  it('返回服务端给出的新 revision 与能力条目', async () => {
    stubFetch(() => json({ ok: true, revision: 3, capability: { id: 'skill:my-skill', name: 'my-skill' } }))

    await expect(createSkill(2)).resolves.toMatchObject({
      revision: 3,
      capability: { id: 'skill:my-skill' },
    })
  })

  it('冲突时抛出可识别错误码', async () => {
    stubFetch(() => json({ ok: false, code: 'revision-conflict', message: 'changed', revision: 9 }, 409))

    await expect(createSkill(2)).rejects.toMatchObject({ code: 'revision-conflict' })
  })
})

describe('打开自建目录', () => {
  it('以 POST 提交能力标识', async () => {
    const calls = stubFetch(() => json({ ok: true }))

    await revealCapability('skill:my-skill')

    expect(calls[0]?.path).toBe(ROUTES.reveal)
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ id: 'skill:my-skill' }))
  })

  it('非自建能力时把 not-owned 交给调用方', async () => {
    stubFetch(() => json({ ok: false, code: 'not-owned', message: '不属于本插件' }, 403))

    await expect(revealCapability('tool:read')).rejects.toMatchObject({ code: 'not-owned' })
  })
})

describe('MCP 连接管理', () => {
  const list = { available: true, writable: true, servers: [] }

  it('读取列表走 MCP 端点并带上自定义头', async () => {
    const calls = stubFetch(() => json(list))

    await expect(fetchMcpServers()).resolves.toEqual(list)
    expect(calls[0]?.path).toBe(ROUTES.mcp)
    expect((calls[0]?.init.headers as Record<string, string>)[REQUEST_HEADER]).toBe(REQUEST_HEADER_VALUE)
  })

  it('保存以 save 动作提交表单', async () => {
    const calls = stubFetch(() => json({ ok: true, servers: [] }))
    const form = { name: 'files', transport: 'stdio' as const, commandLine: 'npx -y pkg', env: '', url: '', headers: '' }

    await saveMcpServer(form)

    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ op: 'save', form }))
  })

  it('启停、删除与导入各有动作体', async () => {
    const calls = stubFetch(() => json({ ok: true, servers: [] }))

    await toggleMcpServer('kino', false)
    await deleteMcpServer('kino')
    await importMcpServers('{"mcpServers":{}}')

    expect(calls.map(call => JSON.parse(String(call.init.body)))).toEqual([
      { op: 'toggle', name: 'kino', enabled: false },
      { op: 'delete', name: 'kino' },
      { op: 'import', json: '{"mcpServers":{}}' },
    ])
  })

  it('不可用与写入失败的错误码原样交给调用方', async () => {
    stubFetch(() => json({ ok: false, code: 'mcp-unavailable', message: 'no manager' }, 503))

    await expect(fetchMcpServers()).rejects.toMatchObject({ code: 'mcp-unavailable' })
  })

  it('表单问题码随错误体带出', async () => {
    stubFetch(() => json({ ok: false, code: 'mcp-invalid-entry', message: 'bad', issues: ['name-invalid'] }, 400))

    await expect(saveMcpServer({ name: 'a.b', transport: 'stdio', commandLine: '', env: '', url: '', headers: '' }))
      .rejects.toMatchObject({ code: 'mcp-invalid-entry', issues: ['name-invalid'] })
  })
})
