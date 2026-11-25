// src/shared/api.ts
//
// 管理界面的 HTTP 契约：路径前缀、自定义请求头、快照与写操作的形状。
// Host 与 Client 共用，调用点不得硬编码这些字面量。

import type { CapabilityEntry, CapabilityId } from './capability.ts'
import type { CapabilityConfig, RoleSource, SessionRoleName } from './config.ts'

/** 插件 HTTP 面挂载前缀；Host 以 prefix 路由注册，Client 以此为唯一网络入口。 */
export const API_PREFIX = '/capability-manager/api'

/**
 * 强制显式调用的自定义头。
 *
 * 浏览器对同源请求不加 CORS 预检，所以这个头不是安全边界，而是把「本插件的脚本」
 * 与「普通表单式跨站请求」分开的第一道可见约定；真正的边界是下面的同源校验。
 */
export const REQUEST_HEADER = 'x-capability-manager-request'
export const REQUEST_HEADER_VALUE = '1'

/** 各端点的绝对路径（含前缀）。 */
export const ROUTES = {
  health: `${API_PREFIX}/health`,
  snapshot: `${API_PREFIX}/snapshot`,
  config: `${API_PREFIX}/config`,
  /** 手动创建一个自建 Skill 的骨架。 */
  createSkill: `${API_PREFIX}/skills`,
  /** 在系统文件管理器里打开某个自建能力的目录。 */
  reveal: `${API_PREFIX}/reveal`,
  /**
   * 开启向量检索：同步等待模型下载、校验与加载完成。
   *
   * 首次开启要下载 24MB 模型，因此这个请求可能持续几十秒；界面只需在请求期间转圈。
   */
  embeddingEnable: `${API_PREFIX}/embedding/enable`,
  /** 关闭向量检索：释放会话并写回配置。 */
  embeddingDisable: `${API_PREFIX}/embedding/disable`,
  /** MCP 连接管理：读列表（含连接状态）与提交一次写操作。 */
  mcp: `${API_PREFIX}/mcp`,
} as const

/** 稳定错误码：客户端按码分支，不吞错。 */
export const ERROR_CODES = {
  notFound: 'not-found',
  methodNotAllowed: 'method-not-allowed',
  wrongOrigin: 'wrong-origin',
  missingRequestHeader: 'missing-request-header',
  badRequest: 'bad-request',
  revisionConflict: 'revision-conflict',
  unknownCapability: 'unknown-capability',
  /** 目标能力不是本插件自建的，没有可打开的目录。 */
  notOwned: 'not-owned',
  /** 创建骨架失败：目录不可写、名称无法分配等。 */
  createFailed: 'create-failed',
  /** 调起系统文件管理器失败。 */
  revealFailed: 'reveal-failed',
  embeddingUnavailable: 'embedding-unavailable',
  embeddingDownloadFailed: 'embedding-download-failed',
  /** 官方 MCP 管理器或配置编辑器未挂载：该环境没有可配置的 MCP 面。 */
  mcpUnavailable: 'mcp-unavailable',
  /** 表单本身不合法；`issues` 带出问题码。 */
  mcpInvalidEntry: 'mcp-invalid-entry',
  /** 导入的 mcp.json 无法执行；`reason` 带出导入原因码。 */
  mcpImportInvalid: 'mcp-import-invalid',
  /** 写入 profile 配置失败（Loader 校验或落盘）。 */
  mcpWriteFailed: 'mcp-write-failed',
  /** 目标服务器不在配置里。 */
  mcpUnknownServer: 'mcp-unknown-server',
  internal: 'internal',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export interface ErrorResponse {
  ok: false
  code: ErrorCode
  message: string
}

export interface HealthResponse {
  ok: true
  plugin: string
  version: string
  stateDir: string
}

/** 界面必须显示的风险提示；按码给出文案，不传自然语言。 */
export type WarningCode =
  | 'meta-search-not-resident'
  | 'meta-search-excluded'
  | 'skill-excluded'
  | 'resident-empty'
  | 'blacklist-excludes-resident'

export interface SnapshotWarning {
  code: WarningCode
  /** 与该提示相关的能力，便于界面高亮。 */
  capabilityIds?: CapabilityId[]
  /**
   * 该提示由哪个角色的黑名单造成。
   *
   * 两个角色各排除一批能力时是两条独立提示，所以角色是提示自身的属性，
   * 而不是挂在能力上的。
   */
  roles?: SessionRoleName[]
}

/** 一个活跃会话的角色判定结果；界面据此渲染「会话角色」区。 */
export interface SessionRoleSnapshot {
  /** 会话身份（宿主里 Agent.id 即 SessionId）。 */
  id: string
  /** 生效角色；`undefined` 表示未知，不应用黑名单。 */
  role?: SessionRoleName
  /** 角色来自 `ctx.paRoles`、手动绑定，还是无从判定。 */
  roleSource: RoleSource
}

/** 向量检索子系统的运行状态；M1 恒为 idle。 */
export interface EmbeddingStatus {
  enabled: boolean
  status: 'idle' | 'downloading' | 'verifying' | 'ready' | 'failed'
  progress?: { received: number; total?: number }
  message?: string
}

/** 一次刷新所需的全部派生状态。 */
export interface SnapshotResponse {
  revision: number
  capabilities: CapabilityEntry[]
  config: CapabilityConfig
  /** 是否检测到 `ctx.paRoles`；为 false 时界面不显示角色黑名单区。 */
  rolesAvailable: boolean
  /**
   * 活跃会话的角色判定结果。
   *
   * 可选：宿主读不到活跃会话时不提供，界面按空列表处理。手动绑定只补
   * `paRoles` 没有答案的会话，来源字段让用户看到某条绑定是否真的在生效。
   */
  sessions?: SessionRoleSnapshot[]
  embedding: EmbeddingStatus
  warnings: SnapshotWarning[]
  /**
   * 运行期诊断：每个受限 agent 看到了什么。
   *
   * 排查「插件看起来已启用、但某个会话没被收紧」时，这是唯一能区分
   * 「没有绑定」「绑定了但名单很大」的地方。
   */
  diagnostics?: {
    knownToolCount: number
    schemaCount: number
    agents: Array<{ id: string; presentCount: number; allowCount: number; restricted: boolean }>
  }
}

/**
 * 一次配置改动的内容，不含 revision。
 *
 * 单独定义成联合类型而不是 `Omit<ConfigPatch, 'revision'>`：`Omit` 作用在联合上
 * 会合并所有成员的可选字段，调用方写出 `{ op: 'set-excluded', id, value }` 时
 * 反而通不过检查。
 */
export type ConfigPatchInput =
  | { op: 'set-excluded'; id: CapabilityId; value: boolean }
  | { op: 'set-resident'; id: CapabilityId; value: boolean }
  /**
   * 批量移入 / 移出：筛选后的整体操作要一次落盘。
   *
   * 逐条提交会让一次点击产生 N 次写入与 N 次刷新，中途失败还会留下半套状态；
   * 批量语义让 revision 只前进一次。
   */
  | { op: 'set-excluded-many'; ids: CapabilityId[]; value: boolean }
  /** 批量常驻；`value: false` 是批量取消常驻。 */
  | { op: 'set-resident-many'; ids: CapabilityId[]; value: boolean }
  | { op: 'set-blacklist'; role: SessionRoleName; id: CapabilityId; value: boolean }
  | { op: 'clear-blacklist'; role: SessionRoleName }
  /**
   * 手动角色绑定：`role: null` 表示解除绑定。
   *
   * 绑定只补 `ctx.paRoles` 没有答案的会话（PA 判定优先）；`sessionId` 就是
   * Agent 身份（宿主里 `Agent.id` 即 `SessionId`）。
   */
  | { op: 'set-role-binding'; sessionId: string; role: SessionRoleName | null }

/**
 * 一次配置改动。
 *
 * `revision` 是写操作的乐观并发依据：服务端不匹配时返回 `revision-conflict`
 * 与最新 revision，客户端重新拉快照后重试。
 */
export type ConfigPatch = ConfigPatchInput & { revision: number }

export interface ConfigWriteResponse {
  ok: true
  revision: number
}

/**
 * 手动创建 Skill 的请求。
 *
 * `revision` 与配置写入同源：创建会同时把新 Skill 记进「排出池」，因此仍是一次
 * 配置变更，必须让并发窗口里的另一个写入先失败。
 */
export interface CreateSkillRequest {
  revision: number
}

/** 创建成功后的结果：带上新能力的完整条目，界面无需再查一次也能定位它。 */
export interface CreateSkillResponse {
  ok: true
  revision: number
  capability: CapabilityEntry
}

/** 打开某个自建能力目录的请求。 */
export interface RevealRequest {
  id: CapabilityId
}

export interface RevealResponse {
  ok: true
}
