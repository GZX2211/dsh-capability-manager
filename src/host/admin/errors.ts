// src/host/admin/errors.ts
//
// 管理面错误响应的统一形状：状态码与稳定错误码只在这里出现一次。
// 路由与业务动作都返回同一个 `{ status, body }`，由 server.ts 原样发出。

import { ERROR_CODES, type ErrorCode } from '../../shared/api.ts'
import type { ConfigOutcome } from './server.ts'

/**
 * 构造一次失败响应。
 *
 * @param status - HTTP 状态码。
 * @param code - 稳定错误码。
 * @param message - 可行动的原因，直接给界面显示。
 * @returns 路由可直接发出的结果。
 */
export function errorOutcome(status: number, code: ErrorCode, message: string): ConfigOutcome {
  return { status, body: { ok: false, code, message } }
}

/** 能力不是本插件自建的：它有归属，只是不归我们管。 */
export function notOwnedOutcome(id: string): ConfigOutcome {
  return errorOutcome(403, ERROR_CODES.notOwned, `能力 ${id} 不是本插件自建的，没有可打开的目录`)
}

/** 标识本身无法解析，或缺少 id 字段。 */
export function unknownCapabilityOutcome(id: unknown): ConfigOutcome {
  return errorOutcome(
    400,
    ERROR_CODES.unknownCapability,
    `id 必须是 tool:<name> 或 skill:<name>，收到 ${JSON.stringify(id)}`,
  )
}

/** 乐观并发冲突：带上服务端最新 revision，客户端据此重读。 */
export function conflictOutcome(revision: number): ConfigOutcome {
  return {
    status: 409,
    body: { ok: false, code: ERROR_CODES.revisionConflict, message: 'configuration changed elsewhere', revision },
  }
}
