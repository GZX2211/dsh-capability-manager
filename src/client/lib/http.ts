// src/client/lib/http.ts
//
// 管理界面的唯一网络边界：路径、自定义头、错误码分派都在这里。
// 组件与 hook 不得自建第二条数据访问路径。
//
// 失败一律抛 ApiError，调用方按 `code` 分支；没有「静默重试」——
// 写操作失败必须让用户看见，否则界面会显示一个并不存在的状态。

import {
  ERROR_CODES,
  REQUEST_HEADER,
  REQUEST_HEADER_VALUE,
  ROUTES,
  type ConfigPatch,
  type ConfigWriteResponse,
  type CreateSkillResponse,
  type ErrorResponse,
  type RevealResponse,
  type SnapshotResponse,
} from '../../shared/api.ts'
/** 网络层失败的稳定码：不属于服务端错误码表。 */
const NETWORK_ERROR = 'network'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 读一次快照。 */
export async function fetchSnapshot(): Promise<SnapshotResponse> {
  return (await requestJson(ROUTES.snapshot)) as SnapshotResponse
}

/**
 * 提交一次配置改动。
 *
 * @param patch - 改动与读取时的 revision。
 * @returns 新的 revision。
 * @throws {ApiError} `revision-conflict` 时调用方应重新拉快照再提示。
 */
export async function writeConfig(patch: ConfigPatch): Promise<ConfigWriteResponse> {
  return (await requestJson(ROUTES.config, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })) as ConfigWriteResponse
}

/**
 * 手动创建一个自建 Skill。
 *
 * @param revision - 读取快照时的 revision；服务端据此判定并发冲突。
 * @returns 新 revision 与刚创建的能力条目。
 * @throws {ApiError} `revision-conflict`、`create-failed`。
 */
export async function createSkill(revision: number): Promise<CreateSkillResponse> {
  return (await requestJson(ROUTES.createSkill, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision }),
  })) as CreateSkillResponse
}

/**
 * 在系统文件管理器里打开一个自建能力的目录。
 *
 * @param id - `tool:<name>` 或 `skill:<name>`。
 * @throws {ApiError} `not-owned`、`reveal-failed`。
 */
export async function revealCapability(id: string): Promise<RevealResponse> {
  return (await requestJson(ROUTES.reveal, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })) as RevealResponse
}

/**
 * 开启向量检索。
 *
 * 同步等待模型下载与加载：首次开启可能持续几十秒，调用方应在请求期间显示进行中状态。
 *
 * @throws {ApiError} `embedding-download-failed`（模型源不可用）或 `embedding-unavailable`（本机无法加载运行时）。
 */
export async function enableEmbedding(): Promise<{ ok: true }> {
  return (await requestJson(ROUTES.embeddingEnable, { method: 'POST' })) as { ok: true }
}

/**
 * 关闭向量检索。
 *
 * @throws {ApiError} 写盘失败时抛出。
 */
export async function disableEmbedding(): Promise<{ ok: true }> {
  return (await requestJson(ROUTES.embeddingDisable, { method: 'POST' })) as { ok: true }
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    [REQUEST_HEADER]: REQUEST_HEADER_VALUE,
  }

  let response: Response
  try {
    response = await fetch(path, { ...init, headers })
  } catch (error) {
    throw new ApiError(NETWORK_ERROR, describe(error))
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    // 网关错误页、空响应都会走到这里：状态码仍然有信息量。
    throw new ApiError(ERROR_CODES.internal, `${path} returned a non-JSON response (status ${response.status})`)
  }

  if (!response.ok) {
    const failure = body as Partial<ErrorResponse> | null
    const code = typeof failure?.code === 'string' ? failure.code : ERROR_CODES.internal
    const message = typeof failure?.message === 'string' ? failure.message : `request failed with ${response.status}`
    throw new ApiError(code, message)
  }
  return body
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
