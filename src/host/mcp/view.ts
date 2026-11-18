// src/host/mcp/view.ts
//
// 官方管理器的事实合并：`list()` 给连接状态与「配置里是否还有这条」，
// `config.servers` 给传输方式与编辑回填字段。界面不自己推断任何一项。
//
// 三类条目在同一张列表里，但可编辑性不同：
//   · 配置条目（在 servers 里）—— 可编辑、可启停、可删除；
//   · 插件注册条目（list 里有、servers 里没有，configured 为真）—— 只读；
//   · 残留条目（configured 为假，清理未完成）—— 只读、按未连接展示。

import { targetOf, type McpServerView, type McpState } from '../../shared/mcp.ts'
import type { McpServersMap } from './actions.ts'

/** 官方 `list()` 的运行时形状：只取界面要用的字段，未知状态不抛错。 */
export interface ManagedServerStatus {
  state?: unknown
  toolCount?: unknown
  lastError?: unknown
  /** 官方状态联合里的其他成员（attempt、reason、connectedAt 等）不参与展示。 */
  [key: string]: unknown
}

/** `list()` 里的一行。 */
export interface ManagedServer {
  name: string
  configured: boolean
  status?: ManagedServerStatus
}

const KNOWN_STATES: readonly McpState[] = [
  'connected',
  'connecting',
  'reconnecting',
  'waiting-credentials',
  'failed',
  'closed',
  'disabled',
]

/**
 * 合并成界面列表。
 *
 * @param input.managed - 官方 `list()` 的顺序（配置 → 注册 → 残留）。
 * @param input.servers - 配置里的服务器映射。
 * @returns 与官方顺序一致的界面视图。
 */
export function buildMcpServerViews(input: {
  managed: readonly ManagedServer[]
  servers: McpServersMap
}): McpServerView[] {
  return input.managed.map(managed => viewOf(managed, input.servers))
}

function viewOf(managed: ManagedServer, servers: McpServersMap): McpServerView {
  const raw = Object.hasOwn(servers, managed.name) ? servers[managed.name] : undefined
  const normalized = raw === undefined ? undefined : entryInputOf(raw)
  const configured = managed.configured !== false
  const registered = configured && normalized === undefined
  const enabled = raw !== undefined ? raw.enabled !== false : registered
  const view: McpServerView = {
    name: managed.name,
    configured,
    registered,
    enabled,
    transport: normalized?.transport ?? 'stdio',
    target: normalized === undefined ? '' : targetOf(normalized),
    state: stateOf(managed.status),
  }
  const toolCount = managed.status?.toolCount
  if (typeof toolCount === 'number' && Number.isFinite(toolCount)) view.toolCount = toolCount
  const lastError = managed.status?.lastError
  if (typeof lastError === 'string' && lastError.length > 0) view.lastError = lastError
  if (normalized !== undefined) view.entry = normalized
  return view
}

/** 未知状态按未连接展示：宁可显示灰点，也不显示一个并不存在的连接。 */
function stateOf(status: ManagedServerStatus | undefined): McpState {
  const state = status?.state
  return typeof state === 'string' && (KNOWN_STATES as readonly string[]).includes(state)
    ? (state as McpState)
    : 'closed'
}

/** 只取表单需要的字段：条目里的预算与启用意图不进入编辑草稿。 */
function entryInputOf(entry: McpServersMap[string]): NonNullable<McpServerView['entry']> {
  if (entry.transport === 'streamable-http') {
    return { transport: 'streamable-http', url: String(entry.url ?? ''), headers: stringDict(entry.headers) }
  }
  return {
    transport: 'stdio',
    command: String(entry.command ?? ''),
    args: Array.isArray(entry.args) ? entry.args.map(String) : [],
    env: stringDict(entry.env),
  }
}

function stringDict(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item
  }
  return result
}
