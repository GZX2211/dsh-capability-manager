import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createAdminHandler, type AdminTarget } from '../../../src/host/admin/server.ts'
import { API_PREFIX, REQUEST_HEADER, REQUEST_HEADER_VALUE } from '../../../src/shared/api.ts'

const ORIGIN = 'http://127.0.0.1:59215'

interface Captured {
  status: number
  headers: Record<string, unknown>
  body: string
}

function makeTarget(overrides: Partial<AdminTarget> = {}): AdminTarget {
  return {
    plugin: 'dsh-capability-manager',
    version: '0.1.0',
    origin: ORIGIN,
    stateDir: 'C:\\state\\capability-manager',
    snapshot: () => ({
      revision: 0,
      capabilities: [],
      config: { version: 1, excluded: [], resident: [], blacklist: { router: [], worker: [] }, embedding: { enabled: false }, roleBindings: {} },
      rolesAvailable: false,
      embedding: { enabled: false, status: 'idle' },
      warnings: [],
    }),
    writeConfig: async () => ({ status: 200, body: { ok: true, revision: 1 } }),
    createSkill: async () => ({ status: 200, body: { ok: true, revision: 1 } }),
    reveal: async () => ({ status: 200, body: { ok: true } }),
    ...overrides,
  }
}

function makeRequest(options: {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: unknown
  raw?: string
}): IncomingMessage {
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  )
  const payload =
    options.raw !== undefined
      ? Buffer.from(options.raw, 'utf8')
      : options.body === undefined
        ? undefined
        : Buffer.from(JSON.stringify(options.body), 'utf8')
  return {
    method: options.method ?? 'GET',
    url: options.path,
    headers,
    async *[Symbol.asyncIterator]() {
      if (payload !== undefined) yield payload
    },
  } as unknown as IncomingMessage
}

function makeResponse(): { response: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, headers: {}, body: '' }
  const response = {
    setHeader: (name: string, value: unknown) => {
      captured.headers[name.toLowerCase()] = value
    },
    writeHead: (status: number, headers: Record<string, unknown>) => {
      captured.status = status
      Object.assign(captured.headers, headers)
    },
    end: (body?: unknown) => {
      captured.body = body === undefined ? '' : String(body)
    },
  } as unknown as ServerResponse
  return { response, captured }
}

async function call(
  target: AdminTarget,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: unknown; raw?: string },
): Promise<{ captured: Captured; json: unknown }> {
  const { response, captured } = makeResponse()
  await createAdminHandler(target)(makeRequest(options), response)
  return { captured, json: captured.body.length === 0 ? undefined : JSON.parse(captured.body) }
}

const sameOrigin = { [REQUEST_HEADER]: REQUEST_HEADER_VALUE, origin: ORIGIN }

describe('健康检查', () => {
  it('不需要任何头就能访问', async () => {
    const { captured, json } = await call(makeTarget(), { path: `${API_PREFIX}/health` })

    expect(captured.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      plugin: 'dsh-capability-manager',
      version: '0.1.0',
      stateDir: 'C:\\state\\capability-manager',
    })
  })

  it('只接受 GET 与 HEAD', async () => {
    const { captured, json } = await call(makeTarget(), { method: 'POST', path: `${API_PREFIX}/health` })

    expect(captured.status).toBe(405)
    expect(captured.headers.allow).toBe('GET, HEAD')
    expect(json).toMatchObject({ ok: false, code: 'method-not-allowed' })
  })
})

describe('快照', () => {
  it('缺少自定义头时拒绝，且完全不读取快照', async () => {
    const snapshot = vi.fn(makeTarget().snapshot)

    const { captured, json } = await call(makeTarget({ snapshot }), { path: `${API_PREFIX}/snapshot` })

    expect(captured.status).toBe(403)
    expect(json).toMatchObject({ ok: false, code: 'missing-request-header' })
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('异源请求拒绝', async () => {
    const { captured } = await call(makeTarget(), {
      path: `${API_PREFIX}/snapshot`,
      headers: { [REQUEST_HEADER]: REQUEST_HEADER_VALUE, origin: 'http://evil.example' },
    })

    expect(captured.status).toBe(403)
  })

  it('同源请求返回快照，并禁止缓存', async () => {
    const target = makeTarget()

    const { captured, json } = await call(target, { path: `${API_PREFIX}/snapshot`, headers: sameOrigin })

    expect(captured.status).toBe(200)
    expect(captured.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(captured.headers['cache-control']).toBe('no-store')
    expect(json).toEqual(target.snapshot())
  })

  it('只接受 GET', async () => {
    const { captured } = await call(makeTarget(), {
      method: 'POST',
      path: `${API_PREFIX}/snapshot`,
      headers: sameOrigin,
    })

    expect(captured.status).toBe(405)
    expect(captured.headers.allow).toBe('GET')
  })

  it('快照读取失败时报 internal，而不是返回空快照', async () => {
    const target = makeTarget({ snapshot: () => Promise.reject(new Error('state directory is gone')) })

    const { captured, json } = await call(target, { path: `${API_PREFIX}/snapshot`, headers: sameOrigin })

    expect(captured.status).toBe(500)
    expect(json).toEqual({ ok: false, code: 'internal', message: 'state directory is gone' })
  })
})

describe('配置写入', () => {
  it('把请求体原样交给写操作，并透传其状态码与响应体', async () => {
    const writeConfig = vi.fn(async () => ({ status: 200, body: { ok: true as const, revision: 3 } }))
    const patch = { op: 'set-excluded', id: 'tool:read', value: true, revision: 2 }

    const { captured, json } = await call(makeTarget({ writeConfig }), {
      method: 'POST',
      path: `${API_PREFIX}/config`,
      headers: sameOrigin,
      body: patch,
    })

    expect(captured.status).toBe(200)
    expect(json).toEqual({ ok: true, revision: 3 })
    expect(writeConfig).toHaveBeenCalledWith(patch)
  })

  it('revision 冲突的状态码与错误码原样透传', async () => {
    const target = makeTarget({
      writeConfig: async () => ({
        status: 409,
        body: { ok: false, code: 'revision-conflict', message: '配置已被修改', revision: 4 },
      }),
    })

    const { captured, json } = await call(target, {
      method: 'POST',
      path: `${API_PREFIX}/config`,
      headers: sameOrigin,
      body: { op: 'clear-blacklist', role: 'router', revision: 1 },
    })

    expect(captured.status).toBe(409)
    expect(json).toMatchObject({ ok: false, code: 'revision-conflict', revision: 4 })
  })

  it('只接受 POST', async () => {
    const writeConfig = vi.fn()
    const { captured } = await call(makeTarget({ writeConfig }), {
      path: `${API_PREFIX}/config`,
      headers: sameOrigin,
    })

    expect(captured.status).toBe(405)
    expect(captured.headers.allow).toBe('POST')
    expect(writeConfig).not.toHaveBeenCalled()
  })

  it('同样受同源守卫保护', async () => {
    const writeConfig = vi.fn()
    const { captured } = await call(makeTarget({ writeConfig }), {
      method: 'POST',
      path: `${API_PREFIX}/config`,
      body: { op: 'clear-blacklist', role: 'router', revision: 0 },
    })

    expect(captured.status).toBe(403)
    expect(writeConfig).not.toHaveBeenCalled()
  })

  it('请求体不是合法 JSON 时在调用写操作前就拒绝', async () => {
    const writeConfig = vi.fn()

    const { captured } = await call(makeTarget({ writeConfig }), {
      method: 'POST',
      path: `${API_PREFIX}/config`,
      headers: sameOrigin,
      raw: '{not json',
    })

    expect(captured.status).toBe(400)
    expect(writeConfig).not.toHaveBeenCalled()
  })

  it('请求体超过 64 KiB 时拒绝', async () => {
    const writeConfig = vi.fn()
    const { response, captured } = makeResponse()
    const request = makeRequest({ method: 'POST', path: `${API_PREFIX}/config`, headers: sameOrigin })
    ;(request as unknown as { [Symbol.asyncIterator]: () => AsyncGenerator<Buffer> })[Symbol.asyncIterator] =
      async function* () {
        yield Buffer.alloc(64 * 1024 + 1, 0x20)
      }

    await createAdminHandler(makeTarget({ writeConfig }))(request, response)

    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body)).toMatchObject({ ok: false, code: 'bad-request' })
    expect(writeConfig).not.toHaveBeenCalled()
  })
})

describe('手动创建 Skill 端点', () => {
  it('把请求体原样交给创建动作', async () => {
    const createSkill = vi.fn(async () => ({ status: 200, body: { ok: true, revision: 1 } }))

    const { captured, json } = await call(makeTarget({ createSkill }), {
      method: 'POST',
      path: `${API_PREFIX}/skills`,
      headers: sameOrigin,
      body: { revision: 0 },
    })

    expect(captured.status).toBe(200)
    expect(json).toMatchObject({ ok: true })
    expect(createSkill).toHaveBeenCalledWith({ revision: 0 })
  })

  it('只接受 POST', async () => {
    const createSkill = vi.fn()

    const { captured } = await call(makeTarget({ createSkill }), { path: `${API_PREFIX}/skills`, headers: sameOrigin })

    expect(captured.status).toBe(405)
    expect(createSkill).not.toHaveBeenCalled()
  })

  it('受同源守卫保护', async () => {
    const createSkill = vi.fn()

    const { captured } = await call(makeTarget({ createSkill }), {
      method: 'POST',
      path: `${API_PREFIX}/skills`,
      body: { revision: 0 },
    })

    expect(captured.status).toBe(403)
    expect(createSkill).not.toHaveBeenCalled()
  })
})

describe('打开目录端点', () => {
  it('把请求体原样交给打开动作', async () => {
    const reveal = vi.fn(async () => ({ status: 200, body: { ok: true } }))

    const { captured } = await call(makeTarget({ reveal }), {
      method: 'POST',
      path: `${API_PREFIX}/reveal`,
      headers: sameOrigin,
      body: { id: 'skill:my-skill' },
    })

    expect(captured.status).toBe(200)
    expect(reveal).toHaveBeenCalledWith({ id: 'skill:my-skill' })
  })

  it('只接受 POST 且受同源守卫保护', async () => {
    const reveal = vi.fn()

    const wrongMethod = await call(makeTarget({ reveal }), { path: `${API_PREFIX}/reveal`, headers: sameOrigin })
    const wrongOrigin = await call(makeTarget({ reveal }), {
      method: 'POST',
      path: `${API_PREFIX}/reveal`,
      body: { id: 'skill:x' },
    })

    expect(wrongMethod.captured.status).toBe(405)
    expect(wrongOrigin.captured.status).toBe(403)
    expect(reveal).not.toHaveBeenCalled()
  })
})
describe('未知路径', () => {
  it('返回稳定的 not-found 错误码', async () => {
    const { captured, json } = await call(makeTarget(), {
      path: `${API_PREFIX}/nope`,
      headers: sameOrigin,
    })

    expect(captured.status).toBe(404)
    expect(json).toMatchObject({ ok: false, code: 'not-found' })
  })
})
