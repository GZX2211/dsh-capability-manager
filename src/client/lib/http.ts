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
  type ErrorResponse,
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
