// tests/host/selfmade/executors/http.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { runHttpTool, type FetchLike } from '../../../../src/host/selfmade/executors/http.ts'
import type { SelfmadeHttpSpec } from '../../../../src/host/selfmade/meta.ts'

const spec: SelfmadeHttpSpec = {
  url: 'https://api.example.com/v1/{{resource}}',
  method: 'GET',
  headers: { authorization: 'Bearer {{token}}' },
  timeoutMs: 5000,
}

interface Call {
  url: string
  init: RequestInit
}

function fetcher(response: () => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return response()
  }
  return { fetch: fetchLike, calls }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('http 执行', () => {
  it('展开 URL 占位符并做百分号编码', async () => {
    const fake = fetcher(() => new Response('{}', { status: 200 }))

    await runHttpTool(spec, { resource: 'a b/c', token: 't' }, { fetch: fake.fetch })

    expect(fake.calls[0]?.url).toBe('https://api.example.com/v1/a%20b%2Fc')
  })

  it('展开请求头占位符且不做编码', async () => {
    const fake = fetcher(() => new Response('{}', { status: 200 }))

    await runHttpTool(spec, { resource: 'r', token: 'a b' }, { fetch: fake.fetch })

    expect((fake.calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer a b')
  })

  it('GET 不带请求体', async () => {
    const fake = fetcher(() => new Response('{}', { status: 200 }))

    await runHttpTool(spec, { resource: 'r', token: 't' }, { fetch: fake.fetch })

    expect(fake.calls[0]?.init.method).toBe('GET')
    expect(fake.calls[0]?.init.body).toBeUndefined()
  })

  it('POST 把全部参数作为 JSON 体发送', async () => {
    const post: SelfmadeHttpSpec = { ...spec, method: 'POST' }
    const fake = fetcher(() => new Response('{"ok":true}', { status: 200 }))

    await runHttpTool(post, { resource: 'r', token: 't', extra: 1 }, { fetch: fake.fetch })

    expect(fake.calls[0]?.init.method).toBe('POST')
    expect(fake.calls[0]?.init.body).toBe(JSON.stringify({ resource: 'r', token: 't', extra: 1 }))
    expect((fake.calls[0]?.init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('解析 JSON 响应体', async () => {
    const fake = fetcher(() => new Response('{"ok":true}', { status: 200 }))

    await expect(runHttpTool(spec, { resource: 'r', token: 't' }, { fetch: fake.fetch })).resolves.toEqual({
      status: 200,
      body: { ok: true },
    })
  })

  it('非 JSON 响应体按文本返回', async () => {
    const fake = fetcher(() => new Response('not json', { status: 200 }))

    await expect(runHttpTool(spec, { resource: 'r', token: 't' }, { fetch: fake.fetch })).resolves.toEqual({
      status: 200,
      body: 'not json',
    })
  })

  it('4xx 不抛错，把状态码与错误体交给模型', async () => {
    const fake = fetcher(() => new Response('{"error":"nope"}', { status: 404 }))

    await expect(runHttpTool(spec, { resource: 'r', token: 't' }, { fetch: fake.fetch })).resolves.toEqual({
      status: 404,
      body: { error: 'nope' },
    })
  })

  it('网络失败时给出带 URL 的说明', async () => {
    const failing: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }

    await expect(runHttpTool(spec, { resource: 'r', token: 't' }, { fetch: failing })).rejects.toThrow(/api\.example\.com/)
  })

  it('调用方取消时原样传播取消原因', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const failing: FetchLike = async () => new Response('{}')

    await expect(
      runHttpTool(spec, { resource: 'r', token: 't' }, { fetch: failing, signal: controller.signal }),
    ).rejects.toThrow('cancelled')
  })

  it('三角测量：PATCH / DELETE 同样带 JSON 体', async () => {
    for (const method of ['PATCH', 'DELETE'] as const) {
      const fake = fetcher(() => new Response('{}', { status: 200 }))

      await runHttpTool({ ...spec, method }, { resource: 'r', token: 't' }, { fetch: fake.fetch })

      expect(fake.calls[0]?.init.method).toBe(method)
      expect(fake.calls[0]?.init.body).toBe(JSON.stringify({ resource: 'r', token: 't' }))
    }
  })

  it('三角测量：空响应体返回空串而不是解析失败', async () => {
    // 204 按规范不允许带响应体，这里用 null 构造才能进入「空文本」分支。
    const fake = fetcher(() => new Response(null, { status: 204 }))

    await expect(runHttpTool(spec, { resource: 'r', token: 't' }, { fetch: fake.fetch })).resolves.toEqual({
      status: 204,
      body: '',
    })
  })

  it('三角测量：模板里没有占位符时 URL 原样使用', async () => {
    const fake = fetcher(() => new Response('{}', { status: 200 }))

    await runHttpTool(
      { ...spec, url: 'https://api.example.com/health' },
      { resource: 'r', token: 't' },
      { fetch: fake.fetch },
    )

    expect(fake.calls[0]?.url).toBe('https://api.example.com/health')
  })
})
