// src/host/mcp/bridge.ts
//
// 本插件与官方 MCP 面之间的唯一桥：读 `ctx.mcpManager` 的事实，写 `ctx.configEditor`
// 的 `mcp-manager` 条目。
//
// 为什么不自写 profile patch：官方 Settings 与 Agent 改的是同一条 Loader 配置，
// 只有经 ConfigEditor 写入才会被 Loader 热对账（新增 / 重建 / 卸载实例）。
// 两个服务都是可选的：缺席时给出稳定原因码，面板据此说明不可用，而不是显示空列表。

import { ERROR_CODES } from '../../shared/api.ts'
import type { McpServersResponse, McpServerView } from '../../shared/mcp.ts'
import { applyMcpAction, type McpActionOutcome, type McpServersMap } from './actions.ts'
import { buildMcpServerViews, type ManagedServer } from './view.ts'

/** 官方管理器在 profile 组合里的 Loader 条目 id。 */
export const MCP_MANAGER_ENTRY_ID = 'mcp-manager'

/** 只需要按名字取服务的宿主上下文（Cordis Context 的子集）。 */
export interface BridgeContext {
  get(name: string): unknown
}

/** 官方 `ctx.mcpManager` 的只读面。 */
interface ManagerLike {
  list(): unknown
  config?: { servers?: { get?(): unknown } }
}

/** 官方 `ctx.configEditor` 的写入面。 */
interface EditorLike {
  entries(): unknown
  edit(
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/** HTTP 层的写结果：状态码由这里的错误分类决定。 */
export interface McpWriteOutcome {
  status: number
  body: unknown
}

/**
 * 读一次 MCP 列表。
 *
 * 管理器缺席是可预期的环境差异（返回 `available: false`）；管理器的 `list()`
 * 自己抛错则是真实故障，向上抛出，由路由变成 500——把故障显示成「没有服务器」
 * 会让用户去改一份其实完好的配置。
 *
 * @param context - 宿主上下文。
 * @returns 可用性、可写性与服务器视图。
 * @throws 官方 `list()` 抛出的任何错误。
 */
export async function readMcpServers(context: BridgeContext): Promise<McpServersResponse> {
  const manager = managerOf(context)
  if (manager === undefined) {
    return { available: false, writable: false, servers: [], unavailableReason: 'manager-absent' }
  }
  const writable = editorOf(context) !== undefined
  const servers = buildMcpServerViews({ managed: managedOf(manager), servers: serversOf(manager) })
  return writable
    ? { available: true, writable, servers }
    : { available: true, writable, servers, unavailableReason: 'editor-absent' }
}

/**
 * 提交一次 MCP 写操作。
 *
 * @param context - 宿主上下文。
 * @param action - 未经校验的请求体（`McpAction`）。
 * @param platform - 启动命令的目标平台；默认当前进程平台。
 * @returns 状态码与响应体。
 */
export async function writeMcpServers(
  context: BridgeContext,
  action: unknown,
  platform: string = process.platform,
): Promise<McpWriteOutcome> {
  const editor = editorOf(context)
  if (editor === undefined) {
    return failure(503, ERROR_CODES.mcpUnavailable, 'the configuration editor is not mounted; MCP servers are read-only here')
  }
  const entry = entryOf(editor)
  if (entry === undefined) {
    return failure(
      503,
      ERROR_CODES.mcpUnavailable,
      'the profile has no mounted "@deepseek-ai/dsh-mcp-manager" entry to configure',
    )
  }

  let rejected: RejectedOutcome | undefined
  let applied = false
  try {
    await editor.edit(entry, (current) => {
      applied = true
      const outcome = applyMcpAction(serversIn(current.servers), action, platform)
      if (!outcome.ok) {
        rejected = outcome
        // 抛出即可让 ConfigEditor 放弃写入：文件与 Loader 都不会被改动。
        throw new RejectedAction()
      }
      return { ...current, servers: outcome.servers }
    })
  } catch (error) {
    if (error instanceof RejectedAction && rejected !== undefined) return classify(rejected)
    return failure(
      502,
      ERROR_CODES.mcpWriteFailed,
      error instanceof Error ? error.message : String(error),
    )
  }

  if (!applied) {
    // 当前官方编辑器一定请求内容；没被请求说明这座桥与它不匹配。
    // 先用管理器快照判一次动作，让「非法请求」得到真实的 4xx，而不是假成功。
    const manager = managerOf(context)
    const outcome = applyMcpAction(manager === undefined ? {} : serversOf(manager), action, platform)
    if (!outcome.ok) return classify(outcome)
    return failure(502, ERROR_CODES.mcpWriteFailed, 'the configuration editor did not apply the change')
  }

  // 写成功后重新读一次：启用意图已落盘，连接状态由管理器异步推进，界面随即轮询。
  const response = await readMcpServers(context)
  return { status: 200, body: { ok: true, servers: response.servers } satisfies { ok: true; servers: McpServerView[] } }
}

/** 放弃写入的哨兵：内容问题与落盘失败要分成两种响应。 */
class RejectedAction extends Error {}

/** 动作被拒绝的那一支：只有它才有稳定码与细节。 */
type RejectedOutcome = Exclude<McpActionOutcome, { ok: true }>

function classify(outcome: RejectedOutcome): McpWriteOutcome {
  if (outcome.code === 'unknown-server') {
    return failure(404, ERROR_CODES.mcpUnknownServer, outcome.message)
  }
  if (outcome.issues !== undefined) {
    return {
      status: 400,
      body: { ok: false, code: ERROR_CODES.mcpInvalidEntry, message: outcome.message, issues: outcome.issues },
    }
  }
  if (outcome.reason !== undefined) {
    return {
      status: 400,
      body: { ok: false, code: ERROR_CODES.mcpImportInvalid, message: outcome.message, reason: outcome.reason },
    }
  }
  return failure(400, ERROR_CODES.badRequest, outcome.message)
}

function failure(status: number, code: string, message: string): McpWriteOutcome {
  return { status, body: { ok: false, code, message } }
}

function managerOf(context: BridgeContext): ManagerLike | undefined {
  const manager = context.get('mcpManager')
  if (typeof manager !== 'object' || manager === null) return undefined
  const candidate = manager as { list?: unknown; config?: unknown }
  return typeof candidate.list === 'function' ? (manager as ManagerLike) : undefined
}

function editorOf(context: BridgeContext): EditorLike | undefined {
  const editor = context.get('configEditor')
  if (typeof editor !== 'object' || editor === null) return undefined
  const candidate = editor as { entries?: unknown; edit?: unknown }
  return typeof candidate.entries === 'function' && typeof candidate.edit === 'function'
    ? (editor as EditorLike)
    : undefined
}

/** 按 Loader 条目 id 找官方的管理器条目；找不到就说明这个 profile 没有它。 */
function entryOf(editor: EditorLike): unknown | undefined {
  const entries = editor.entries()
  if (!Array.isArray(entries)) return undefined
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const options = (entry as { options?: { id?: unknown } }).options
    if (options?.id === MCP_MANAGER_ENTRY_ID) return entry
  }
  return undefined
}

/** `list()` 的运行时收窄：未知字段不影响展示，缺失名称的行被跳过。 */
function managedOf(manager: ManagerLike): ManagedServer[] {
  const list = manager.list()
  if (!Array.isArray(list)) return []
  const result: ManagedServer[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.name !== 'string' || record.name.length === 0) continue
    result.push({
      name: record.name,
      configured: record.configured !== false,
      status: statusOf(record.status),
    })
  }
  return result
}

function statusOf(value: unknown): ManagedServer['status'] {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  return {
    state: record.state,
    toolCount: record.toolCount,
    lastError: record.lastError,
  }
}

/**
 * 配置里的服务器映射。
 *
 * 读失败按空映射降级：这只影响「能否编辑与摘要」，连接状态与列表本身仍可用。
 */
function serversOf(manager: ManagerLike): McpServersMap {
  try {
    return serversIn(manager.config?.servers?.get?.() as Record<string, unknown> | undefined)
  } catch {
    return {}
  }
}

/** 把任意形状的 servers 值收窄成条目映射。 */
function serversIn(value: unknown): McpServersMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: McpServersMap = {}
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      result[name] = entry as McpServersMap[string]
    }
  }
  return result
}
