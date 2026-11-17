// src/host/selfmade/executors/http.ts
//
// 声明式 http 工具：URL 与请求头支持占位符，非 GET 方法把全部参数作为 JSON 体。
//
// 非 2xx 不抛错：HTTP 错误体（限流说明、字段校验原因）通常正是模型需要的下一步
// 输入；把 404 变成异常会让它误以为工具坏了。

import type { SelfmadeHttpSpec } from '../meta.ts'
import { fillTemplate } from './template.ts'

/** 一次请求的可观察结果。 */
export interface HttpRunResult {
  status: number
  /** JSON 响应解析后的值；不是 JSON 时是原始文本。 */
  body: unknown
}

/** 可注入的 fetch；默认用全局 fetch。 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface HttpRunOptions {
  signal?: AbortSignal | undefined
  fetch?: FetchLike
}

/**
 * 执行一次声明式 http 工具。
 *
 * @param spec - URL、方法、请求头与超时。
 * @param args - 模型给出的调用参数；非 GET 时整体作为 JSON 体。
 * @param options - 取消信号与 fetch 替身。
 * @returns 状态码与响应体。
 * @throws 网络失败、超时或调用方取消。
 */
export async function runHttpTool(
  spec: SelfmadeHttpSpec,
  args: Record<string, unknown>,
  options: HttpRunOptions = {},
): Promise<HttpRunResult> {
  if (options.signal?.aborted) throw options.signal.reason
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init))

  const url = fillTemplate(spec.url, args, encodeURIComponent)
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(spec.headers)) headers[name] = fillTemplate(value, args)

  const init: RequestInit = { method: spec.method, headers }
  if (spec.method !== 'GET') {
    // 只有非 GET 才带体：GET + body 会被 fetch 直接拒绝。
    headers['content-type'] ??= 'application/json'
    init.body = JSON.stringify(args)
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`请求 ${url} 超时（${spec.timeoutMs}ms）`)),
    spec.timeoutMs,
  )
  const onAbort = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  init.signal = controller.signal

  try {
    const response = await doFetch(url, init)
    const text = await response.text()
    return { status: response.status, body: parseBody(text) }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    if (controller.signal.aborted) throw controller.signal.reason
    throw new Error(`请求 ${url} 失败：${describe(error)}`)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/** 空响应体保持空串；能解析成 JSON 就给出结构，否则原样给文本。 */
function parseBody(text: string): unknown {
  if (text.length === 0) return ''
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
