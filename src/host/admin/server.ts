// src/host/admin/server.ts
//
// 管理界面的 HTTP 路由器：一个 Node 请求进，一个 JSON 响应出。
// 只做协议层工作（路径分派、同源守卫、状态码），数据由注入的 target 提供。

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  API_PREFIX,
  ERROR_CODES,
  ROUTES,
  type ErrorResponse,
  type HealthResponse,
  type SnapshotResponse,
} from '../../shared/api.ts'
import { guardRequest } from './guard.ts'

/** 写操作的完整结果：状态码由配置存储判定，路由原样转成响应。 */
export interface ConfigOutcome {
  status: number
  body: unknown
}

export interface AdminTarget {
  plugin: string
  version: string
  origin: string
  stateDir: string
  /** 读一次快照；状态目录不可用时抛错，由路由转成 internal 而不是空快照。 */
  snapshot: () => Promise<SnapshotResponse> | SnapshotResponse
  /** 提交一次配置改动；请求体未经校验，由配置层收窄。 */
  writeConfig: (patch: unknown) => Promise<ConfigOutcome>
  /** 手动创建一个自建 Skill 的骨架。 */
  createSkill: (body: unknown) => Promise<ConfigOutcome> | ConfigOutcome
  /** 在系统文件管理器里打开一个自建能力的目录。 */
  reveal: (body: unknown) => Promise<ConfigOutcome> | ConfigOutcome
}

/**
 * 把 HTTP 面挂到 prefix 路由上的处理函数。
 *
 * @param target - 数据与写操作的提供方。
 * @returns Node 请求处理函数。
 */
export function createAdminHandler(
  target: AdminTarget,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    try {
      await dispatch(target, request, response)
    } catch (error) {
      sendJson(
        response,
        500,
        failure(ERROR_CODES.internal, error instanceof Error ? error.message : String(error)),
      )
    }
  }
}

async function dispatch(target: AdminTarget, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', target.origin).pathname
  const method = request.method ?? 'GET'

  // 健康检查刻意不校验来者：它只回答「插件活着、状态目录在哪」，不需要授权。
  // 状态类端点一律要求同源 + 自定义头。
  if (path === ROUTES.health) {
    if (method !== 'GET' && method !== 'HEAD') return sendMethodNotAllowed(response, 'GET, HEAD')
    const health: HealthResponse = {
      ok: true,
      plugin: target.plugin,
      version: target.version,
      stateDir: target.stateDir,
    }
    return sendJson(response, 200, health)
  }

  const verdict = guardRequest(target.origin, request)
  if (!verdict.ok) return sendJson(response, 403, failure(verdict.code, verdict.message))

  if (path === ROUTES.snapshot) {
    if (method !== 'GET') return sendMethodNotAllowed(response, 'GET')
    return sendJson(response, 200, await target.snapshot())
  }

  if (path === ROUTES.config) {
    if (method !== 'POST') return sendMethodNotAllowed(response, 'POST')
    return postJson(request, response, target.writeConfig)
  }

  if (path === ROUTES.createSkill) {
    if (method !== 'POST') return sendMethodNotAllowed(response, 'POST')
    return postJson(request, response, target.createSkill)
  }

  if (path === ROUTES.reveal) {
    if (method !== 'POST') return sendMethodNotAllowed(response, 'POST')
    return postJson(request, response, target.reveal)
  }

  return sendJson(response, 404, failure(ERROR_CODES.notFound, `no route for ${path}`))
}

/** 三个写端点共用的协议层：读 JSON → 交给动作 → 原样发回它的状态与响应体。 */
async function postJson(
  request: IncomingMessage,
  response: ServerResponse,
  action: (body: unknown) => Promise<ConfigOutcome> | ConfigOutcome,
): Promise<void> {
  let body: unknown
  try {
    body = await readJson(request)
  } catch (error) {
    return sendJson(
      response,
      400,
      failure(ERROR_CODES.badRequest, error instanceof Error ? error.message : String(error)),
    )
  }
  const outcome = await action(body)
  return sendJson(response, outcome.status, outcome.body)
}

function failure(code: ErrorResponse['code'], message: string): ErrorResponse {
  return { ok: false, code, message }
}

function sendMethodNotAllowed(response: ServerResponse, allow: string): void {
  response.setHeader('allow', allow)
  sendJson(response, 405, failure(ERROR_CODES.methodNotAllowed, `only ${allow} is allowed`))
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** 读取 JSON 请求体；只负责不撑爆内存，结构校验交给配置层。 */
async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > 64 * 1024) throw new Error('request body exceeds 64 KiB')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export { API_PREFIX }
