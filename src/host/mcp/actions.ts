// src/host/mcp/actions.ts
//
// 一次界面动作对「配置里的服务器映射」做的纯变换。
//
// 输入是配置原文（可能带官方新增的预算字段），输出是完整的新映射：
// 不修改入参、保留未展示字段、只在传输方式切换时清掉另一侧的字段。
// 真正的落盘与热对账由 bridge 经 configEditor 完成。

import {
  joinCommandLine,
  parseMcpJson,
  type McpFormIssue,
  type McpForm,
} from '../../shared/mcp.ts'
import { entryFromForm } from './entry.ts'

/** 磁盘上的一条 MCP 服务器配置：官方字段 + 官方将来可能新增的字段。 */
export type McpRawEntry = Record<string, unknown> & {
  transport?: string
  command?: string
  args?: unknown
  env?: unknown
  cwd?: string
  url?: string
  headers?: unknown
  enabled?: boolean
}

/** `servers` 映射的原文。 */
export type McpServersMap = Record<string, McpRawEntry>

/** 变换结果：失败时给出稳定码与可行动的细节。 */
export type McpActionOutcome =
  | { ok: true; servers: McpServersMap; changed: string[] }
  | {
    ok: false
    code: 'bad-request' | 'unknown-server'
    /** 诊断文本（不面向用户展示的兜底）。 */
    message: string
    /** 表单问题码：界面按码给出本地化文案。 */
    issues?: McpFormIssue[]
    /** 导入失败原因码。 */
    reason?: string
  }

/**
 * 应用一次 MCP 动作。
 *
 * @param servers - 当前配置里的服务器映射（不被修改）。
 * @param action - 未经校验的请求体。
 * @param platform - 启动命令的目标平台；默认当前进程平台。
 * @returns 新的完整映射，或稳定错误。
 */
export function applyMcpAction(
  servers: McpServersMap,
  action: unknown,
  platform: string = process.platform,
): McpActionOutcome {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) {
    return rejected('bad-request', 'action must be an object')
  }
  const record = action as Record<string, unknown>
  switch (record.op) {
    case 'save':
      return save(servers, record.form, platform)
    case 'toggle':
      return toggle(servers, record.name, record.enabled)
    case 'delete':
      return remove(servers, record.name)
    case 'import':
      return importAll(servers, record.json, platform)
    default:
      return rejected('bad-request', `unknown op: ${String(record.op)}`)
  }
}

function save(servers: McpServersMap, form: unknown, platform: string): McpActionOutcome {
  if (!isForm(form)) return rejected('bad-request', 'form must carry name and transport')
  const result = entryFromForm(form, platform)
  if (!result.ok) {
    return { ok: false, code: 'bad-request', message: `invalid form: ${result.issues.join(', ')}`, issues: result.issues }
  }
  return { ok: true, servers: { ...servers, [result.name]: merged(servers[result.name], result.entry) }, changed: [result.name] }
}

function toggle(servers: McpServersMap, name: unknown, enabled: unknown): McpActionOutcome {
  const key = nameOf(servers, name)
  if (key === undefined) return rejected('unknown-server', `unknown server: ${String(name)}`)
  if (typeof enabled !== 'boolean') return rejected('bad-request', 'enabled must be a boolean')
  return { ok: true, servers: { ...servers, [key]: { ...servers[key], enabled } }, changed: [key] }
}

function remove(servers: McpServersMap, name: unknown): McpActionOutcome {
  const key = nameOf(servers, name)
  if (key === undefined) return rejected('unknown-server', `unknown server: ${String(name)}`)
  const next = { ...servers }
  delete next[key]
  return { ok: true, servers: next, changed: [key] }
}

function importAll(servers: McpServersMap, json: unknown, platform: string): McpActionOutcome {
  if (typeof json !== 'string') return rejected('bad-request', 'json must be a string')
  const parsed = parseMcpJson(json)
  if (!parsed.ok) {
    return { ok: false, code: 'bad-request', message: `cannot import: ${parsed.reason}`, reason: parsed.reason }
  }
  const next: McpServersMap = { ...servers }
  const changed: string[] = []
  for (const item of parsed.entries) {
    // 导入的启动命令同样要过平台展开：用户粘贴的是「一条命令」，不是可执行体。
    const result = entryFromForm(formOf(item.name, item.entry), platform)
    if (!result.ok) {
      return {
        ok: false,
        code: 'bad-request',
        message: `cannot import ${item.name}: ${result.issues.join(', ')}`,
        issues: result.issues,
      }
    }
    next[item.name] = merged(next[item.name], result.entry)
    changed.push(item.name)
  }
  return { ok: true, servers: next, changed }
}

/**
 * 合并新条目与既有条目。
 *
 * 保留 `enabled` 与官方未展示字段（预算、重连策略），并清掉不属于新传输方式的字段：
 * 官方 manager 会拒绝带跨传输字段的条目，残留一个 `url` 就能让整份写入失败。
 */
function merged(previous: McpRawEntry | undefined, entry: Record<string, unknown>): McpRawEntry {
  const next: McpRawEntry = { ...previous, ...entry }
  if (entry.transport === 'streamable-http') {
    delete next.command
    delete next.args
    delete next.env
    delete next.cwd
  } else {
    delete next.url
    delete next.headers
  }
  next.enabled = previous?.enabled ?? true
  return next
}

/** 条目 → 表单：导入的条目也要走同一条写路径，因此把字段翻回草稿。 */
function formOf(
  name: string,
  entry: { transport: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> },
): McpForm {
  if (entry.transport === 'streamable-http') {
    return {
      name,
      transport: 'streamable-http',
      commandLine: '',
      env: '',
      url: entry.url ?? '',
      headers: entry.headers === undefined ? '' : JSON.stringify(entry.headers),
    }
  }
  return {
    name,
    transport: 'stdio',
    commandLine: joinCommandLine(entry.command ?? '', entry.args ?? []),
    env: entry.env === undefined ? '' : JSON.stringify(entry.env),
    url: '',
    headers: '',
  }
}

function nameOf(servers: McpServersMap, name: unknown): string | undefined {
  return typeof name === 'string' && Object.hasOwn(servers, name) ? name : undefined
}

function rejected(code: 'bad-request' | 'unknown-server', message: string): McpActionOutcome {
  return { ok: false, code, message }
}

/** 请求体收窄：只判形状，名称与字段规则由 shared 的校验给出。 */
function isForm(value: unknown): value is McpForm {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string'
    && (record.transport === 'stdio' || record.transport === 'streamable-http')
    && typeof record.commandLine === 'string'
    && typeof record.env === 'string'
    && typeof record.url === 'string'
    && typeof record.headers === 'string'
}
