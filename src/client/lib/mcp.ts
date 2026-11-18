// src/client/lib/mcp.ts
//
// MCP 分区的纯逻辑：筛选、状态点、编辑草稿、导入预览与文案键。
//
// 组件只负责渲染与交互，所有「看到什么」的判定在这里；因此这些行为可以
// 脱离 React 验证，也不需要浏览器环境。

import {
  formFromEntry,
  parseMcpJson,
  targetOf,
  type McpForm,
  type McpFormIssue,
  type McpServerView,
  type McpState,
  type McpTransport,
} from '../../shared/mcp.ts'
import type { Dict } from '../i18n.ts'

/** 分区顶部的筛选胶囊：全部 / 已连接 / 未连接。 */
export type McpFilterValue = 'all' | 'connected' | 'disconnected'

export const MCP_FILTERS: readonly McpFilterValue[] = ['all', 'connected', 'disconnected']

/** 筛选文案键，顺序即界面顺序。 */
export const MCP_FILTER_LABELS: Record<McpFilterValue, 'mcpFilterAll' | 'mcpFilterConnected' | 'mcpFilterDisconnected'> = {
  all: 'mcpFilterAll',
  connected: 'mcpFilterConnected',
  disconnected: 'mcpFilterDisconnected',
}

/**
 * 按筛选与搜索词过滤服务器。
 *
 * 「已连接」只认 `connected`：连接中、重连、停用与失败都属于未连接，
 * 因为用户问的是「现在能不能用」。
 *
 * @param servers - 全量视图。
 * @param filter - 当前筛选。
 * @param query - 搜索词；命中名称与连接目标。
 * @returns 按名称排序的结果。
 */
export function filterMcpServers(
  servers: readonly McpServerView[],
  filter: McpFilterValue,
  query: string,
): McpServerView[] {
  const needle = query.trim().toLowerCase()
  return servers
    .filter(server => filter === 'all' || (server.state === 'connected') === (filter === 'connected'))
    .filter(server => needle.length === 0
      || server.name.toLowerCase().includes(needle)
      || server.target.toLowerCase().includes(needle))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** 状态点语义；与 `StateDot` 的取值同名，组件直接使用。 */
export type McpDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

/**
 * 连接状态对应的状态点。
 *
 * 绿点只代表「已连接」：把连接中画成绿色会让用户以为工具已经可用。
 */
export function mcpStateDot(state: McpState): McpDotState {
  switch (state) {
    case 'connected':
      return 'done'
    case 'connecting':
    case 'reconnecting':
      return 'ongoing'
    case 'waiting-credentials':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'idle'
  }
}

/** 连接状态的文案键。 */
export function mcpStateLabelKey(state: McpState): keyof Dict {
  switch (state) {
    case 'connected':
      return 'mcpStateConnected'
    case 'connecting':
      return 'mcpStateConnecting'
    case 'reconnecting':
      return 'mcpStateReconnecting'
    case 'waiting-credentials':
      return 'mcpStateWaitingCredentials'
    case 'failed':
      return 'mcpStateFailed'
    case 'closed':
      return 'mcpStateClosed'
    default:
      return 'mcpStateDisabled'
  }
}

/** 新建草稿：默认 stdio，字段全空。 */
export function emptyMcpForm(name = '', transport: McpTransport = 'stdio'): McpForm {
  return { name, transport, commandLine: '', env: '', url: '', headers: '' }
}

/**
 * 列表行 → 编辑草稿。
 *
 * 注册条目与残留条目没有可编辑字段：回填成空表单但保留名称，
 * 弹窗据此把名称设为只读。
 *
 * @param view - 列表行。
 * @returns 编辑草稿。
 */
export function formOfView(view: McpServerView): McpForm {
  return view.entry === undefined ? emptyMcpForm(view.name, view.transport) : formFromEntry(view.name, view.entry)
}

/** 表单问题码 → 文案键。 */
export function issueLabelKey(issue: McpFormIssue): keyof Dict {
  switch (issue) {
    case 'name-empty':
      return 'mcpIssueNameEmpty'
    case 'name-invalid':
      return 'mcpIssueNameInvalid'
    case 'command-missing':
      return 'mcpIssueCommandMissing'
    case 'url-missing':
      return 'mcpIssueUrlMissing'
    case 'url-invalid':
      return 'mcpIssueUrlInvalid'
    case 'env-invalid':
      return 'mcpIssueEnvInvalid'
    default:
      return 'mcpIssueHeadersInvalid'
  }
}

/** 导入预览里的一行。 */
export interface McpImportRow {
  name: string
  transport: McpTransport
  target: string
}

/** 导入失败原因码。 */
export type McpImportReason =
  | 'empty'
  | 'invalid-json'
  | 'no-servers'
  | 'unsupported-transport'
  | 'no-endpoint'
  | 'invalid-name'

/** 导入预览：成功给出将写入的服务器，失败给出原因码与可选细节。 */
export type McpImportPreview =
  | { ok: true; rows: McpImportRow[] }
  | { ok: false; reason: McpImportReason; detail?: string }

/**
 * 预览一次 `mcp.json` 导入。
 *
 * 与 Host 使用同一份解析（`shared/mcp`），所以预览通过而提交失败只可能来自
 * 磁盘上的并发变化，不会因为两套解析口径不同而互相打脸。
 *
 * @param text - 粘贴的 JSON 文本。
 * @returns 可写入的服务器预览，或失败原因。
 */
export function importPreview(text: string): McpImportPreview {
  const parsed = parseMcpJson(text)
  if (!parsed.ok) return parsed
  return {
    ok: true,
    rows: parsed.entries.map(item => ({ name: item.name, transport: item.entry.transport, target: targetOf(item.entry) })),
  }
}

/** 导入失败原因 → 文案键。 */
export function importReasonKey(reason: McpImportReason): keyof Dict {
  switch (reason) {
    case 'empty':
      return 'mcpImportEmpty'
    case 'invalid-json':
      return 'mcpImportInvalidJson'
    case 'no-servers':
      return 'mcpImportNoServers'
    case 'unsupported-transport':
      return 'mcpImportUnsupportedTransport'
    case 'no-endpoint':
      return 'mcpImportNoEndpoint'
    default:
      return 'mcpImportInvalidName'
  }
}

/** 列表顶部的计数文案数据。 */
export interface McpCounts {
  total: number
  connected: number
}

/**
 * 列表计数：总数与已连接数。
 *
 * @param servers - 全量视图。
 * @returns 计数。
 */
export function countMcpServers(servers: readonly McpServerView[]): McpCounts {
  return {
    total: servers.length,
    connected: servers.filter(server => server.state === 'connected').length,
  }
}
