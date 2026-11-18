// src/shared/mcp.ts
//
// MCP 连接管理的共享契约：只有类型与纯函数，不得引入运行时依赖。
//
// 这份文件是「同一条配置在弹窗里与磁盘上被判成一样」的唯一依据：
// Host 写前校验与 Client 表单预校验调用同一批函数。

/** MCP 服务器只支持这两种传输方式；官方 mcp-client 的 sse 已不在配置面内。 */
export type McpTransport = 'stdio' | 'streamable-http'

export const MCP_TRANSPORTS: readonly McpTransport[] = ['stdio', 'streamable-http']

/**
 * 服务器名称的官方口径。
 *
 * 名称同时是工具命名空间（`<server>__<tool>`）的一部分，因此不是「随便填」的展示名：
 * 越界会让官方管理器在写入处拒绝整条配置。
 */
export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * 名称是否合法。
 *
 * @param name - 待判定的名称。
 * @returns 符合官方口径时为 true。
 */
export function isValidServerName(name: string): boolean {
  return MCP_SERVER_NAME_PATTERN.test(name)
}

/**
 * 把用户输入的名称收敛成合法名称。
 *
 * 非法字符替换为连字符并截断到 32 位；结果不含合法字符时退化为 `mcp`，
 * 因为空名称在官方 schema 上无法表达。
 *
 * @param name - 用户输入的名称。
 * @returns 非空且合法的名称。
 */
export function normalizeServerName(name: string): string {
  const normalized = String(name ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32)
  return /[A-Za-z0-9_]/.test(normalized) ? normalized : 'mcp'
}

/** 写入配置的条目形状：只带该传输方式真实使用的字段。 */
export type McpEntryInput =
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { transport: 'streamable-http'; url: string; headers: Record<string, string> }

/** 读回条目时可能出现的全部字段（旧配置可能缺少后加的键）。 */
export interface McpEntryFields {
  transport?: string
  command?: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  cwd?: string
  url?: string
  headers?: Readonly<Record<string, string>>
}

/**
 * 列表里一行显示的连接目标。
 *
 * @param entry - 条目字段。
 * @returns stdio 的整行命令，或 streamable-http 的 URL。
 */
export function targetOf(entry: McpEntryFields): string {
  const transport = entry.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  if (transport === 'streamable-http') return String(entry.url ?? '')
  return joinCommandLine(String(entry.command ?? ''), entry.args ?? [])
}

/** 编辑表单的草稿：JSON 字段保持文本，用户没保存前不解析。 */
export interface McpForm {
  name: string
  transport: McpTransport
  /** stdio 的整行命令（如 `npx -y <包名>`）。 */
  commandLine: string
  /** 环境变量；空文本表示不设置。 */
  env: string
  /** streamable-http 的端点。 */
  url: string
  /** 请求头；空文本表示不设置。 */
  headers: string
}

/**
 * 把配置条目回填成编辑表单。
 *
 * Host 的编辑入口与界面的编辑弹窗共用这一份回填，避免两处对同一份条目
 * 给出不同的命令行拼法。
 *
 * @param name - 条目键（服务器名称）。
 * @param entry - 磁盘上的条目字段。
 * @returns 可直接渲染的草稿；缺少的字段回填空文本。
 */
export function formFromEntry(name: string, entry: McpEntryFields): McpForm {
  const transport = entry.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  return {
    name,
    transport,
    commandLine: transport === 'stdio' ? joinCommandLine(String(entry.command ?? ''), entry.args ?? []) : '',
    env: transport === 'stdio' ? jsonText(entry.env) : '',
    url: transport === 'streamable-http' ? String(entry.url ?? '') : '',
    headers: transport === 'streamable-http' ? jsonText(entry.headers) : '',
  }
}

/** 空对象回填空文本，避免表单里出现一对 `{}` 噪声。 */
function jsonText(value: Readonly<Record<string, string>> | undefined): string {
  if (value === undefined) return ''
  return Object.keys(value).length === 0 ? '' : JSON.stringify(value)
}

/** 表单校验的稳定问题码；文案由界面词典给出。 */
export type McpFormIssue =
  | 'name-empty'
  | 'name-invalid'
  | 'command-missing'
  | 'url-missing'
  | 'url-invalid'
  | 'env-invalid'
  | 'headers-invalid'

/**
 * 校验一份表单草稿。
 *
 * @param form - 表单草稿。
 * @returns 问题码列表；空数组表示可以提交。
 */
export function validateMcpForm(form: McpForm): McpFormIssue[] {
  const issues: McpFormIssue[] = []
  const name = String(form.name ?? '').trim()
  if (name.length === 0) issues.push('name-empty')
  else if (!isValidServerName(name)) issues.push('name-invalid')

  if (form.transport === 'streamable-http') {
    const url = String(form.url ?? '').trim()
    if (url.length === 0) issues.push('url-missing')
    else if (!isHttpUrl(url)) issues.push('url-invalid')
    if (String(form.headers ?? '').trim().length > 0 && !parseJsonObject(form.headers).ok) issues.push('headers-invalid')
  } else {
    if (String(form.commandLine ?? '').trim().length === 0) issues.push('command-missing')
    if (String(form.env ?? '').trim().length > 0 && !parseJsonObject(form.env).ok) issues.push('env-invalid')
  }
  return issues
}

/** 只接受绝对 http(s) 地址：官方传输只实现了这两种。 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** env / headers 文本的解析结果。 */
export type JsonObjectResult = { ok: true; value: Record<string, string> } | { ok: false }

/**
 * 把一段 JSON 文本解析成字符串字典。
 *
 * 空文本表示「没有」；数组、非字符串值、非法 JSON 一律失败，
 * 因为官方 schema 的 `dict(String)` 不接受它们。
 *
 * @param text - 用户输入。
 * @returns 解析结果。
 */
export function parseJsonObject(text: string): JsonObjectResult {
  const value = String(text ?? '').trim()
  if (value.length === 0) return { ok: true, value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return { ok: false }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false }
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(parsed)) {
    if (key.length === 0) return { ok: false }
    if (typeof item !== 'string') return { ok: false }
    result[key] = item
  }
  return { ok: true, value: result }
}

/**
 * 按空白切分命令行，引号内的空白属于同一个 token。
 *
 * 官方 stdio 传输直接把它拆成可执行名与参数（不经 shell），所以引号只影响切分，
 * 不保留在 token 里。
 *
 * @param line - 一整行命令。
 * @returns token 列表；空行返回空数组。
 */
export function splitCommandLine(line: string): string[] {
  const source = String(line ?? '')
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const char of source) {
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
      started = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}

/**
 * 把可执行名与参数拼回一整行，含空格的 token 加引号。
 *
 * 与 {@link splitCommandLine} 互为逆运算：界面回填后再保存，参数不会被拆错。
 *
 * @param command - 可执行名。
 * @param args - 参数列表。
 * @returns 可直接粘贴、也可被再次切分的一行命令。
 */
export function joinCommandLine(command: string, args: readonly string[]): string {
  return [String(command ?? ''), ...args.map(String)]
    .filter(token => token !== '')
    .map(quoteToken)
    .join(' ')
}

/** 无空格与引号的安全 token 原样输出（反斜杠在 Windows 路径里是字面量）。 */
function quoteToken(token: string): string {
  if (/^[A-Za-z0-9_./\\:=@%+,[\]{}#-]+$/.test(token) && !/["']/.test(token)) return token
  if (!token.includes('"')) return `"${token}"`
  if (!token.includes("'")) return `'${token}'`
  return `"${token.replace(/"/g, '\\"')}"`
}

/** 一条被导入的服务器。 */
export interface McpImportedEntry {
  name: string
  entry: McpEntryInput
}

/** 导入失败原因；文案由界面词典给出。 */
export type McpImportFailure =
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'invalid-json'; detail?: string }
  | { ok: false; reason: 'no-servers' }
  | { ok: false; reason: 'unsupported-transport'; detail: string }
  | { ok: false; reason: 'no-endpoint'; detail: string }
  | { ok: false; reason: 'invalid-name'; detail: string }

export type McpImportResult = { ok: true; entries: McpImportedEntry[] } | McpImportFailure

/**
 * 把一段 `mcp.json` 文本投影成可写入的条目。
 *
 * 兼容三种来源形状：`{ mcpServers: { … } }`（Claude Desktop / 旧项目）、
 * `{ servers: { … } }`（VS Code）、以及单个服务器对象或 `name → 条目` 映射。
 * 任何一条无法执行的条目都让整次导入失败：半套导入会让用户以为全部生效。
 *
 * @param text - 粘贴的 JSON 文本。
 * @returns 全部条目，或第一个失败原因。
 */
export function parseMcpJson(text: string): McpImportResult {
  const source = String(text ?? '').trim()
  if (source.length === 0) return { ok: false, reason: 'empty' }

  let data: unknown
  try {
    data = JSON.parse(source)
  } catch (error) {
    return { ok: false, reason: 'invalid-json', detail: error instanceof Error ? error.message : String(error) }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'invalid-json', detail: 'top level must be an object' }
  }
  const record = data as Record<string, unknown>

  const collection = collectionOf(record)
  if (collection !== undefined) {
    const names = Object.keys(collection)
    if (names.length === 0) return { ok: false, reason: 'no-servers' }
    return project(names.map(name => ({ name, raw: collection[name] })))
  }

  // 单个服务器对象：`command` / `url` 是它的判别键。
  if (typeof record.command === 'string' || typeof record.url === 'string') {
    const name = typeof record.serverName === 'string' ? record.serverName : typeof record.name === 'string' ? record.name : 'mcp'
    return project([{ name, raw: record }])
  }

  const values = Object.values(record)
  if (values.length > 0 && values.every(value => typeof value === 'object' && value !== null && !Array.isArray(value))) {
    return project(Object.entries(record).map(([name, raw]) => ({ name, raw })))
  }
  return { ok: false, reason: 'no-servers' }
}

/** 常见两种外层容器；`servers` 只在它确实是对象映射时才采用。 */
function collectionOf(record: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const key of ['mcpServers', 'servers'] as const) {
    const value = record[key]
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  }
  return undefined
}

/** 逐条投影并在第一个失败处停下。 */
function project(rows: readonly { name: string; raw: unknown }[]): McpImportResult {
  const entries: McpImportedEntry[] = []
  for (const row of rows) {
    const projected = entryOf(row.name, row.raw)
    if (!projected.ok) return projected
    entries.push({ name: row.name, entry: projected.entry })
  }
  if (entries.length === 0) return { ok: false, reason: 'no-servers' }
  return { ok: true, entries }
}

/** 单条投影：按 `type`/`transport` 或字段组合判定传输方式。 */
function entryOf(name: string, raw: unknown): { ok: true; entry: McpEntryInput } | McpImportFailure {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'no-endpoint', detail: name }
  }
  if (!isValidServerName(name)) return { ok: false, reason: 'invalid-name', detail: name }
  const record = raw as Record<string, unknown>
  const declared = typeof record.type === 'string' ? record.type : typeof record.transport === 'string' ? record.transport : ''
  if (declared === 'sse') return { ok: false, reason: 'unsupported-transport', detail: name }
  const http = declared === 'http' || declared === 'streamable-http' || declared === 'streamableHttp'
    || (declared === '' && typeof record.url === 'string' && typeof record.command !== 'string')

  if (http) {
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (url.length === 0) return { ok: false, reason: 'no-endpoint', detail: name }
    return {
      ok: true,
      entry: { transport: 'streamable-http', url, headers: stringDictOf(record.headers) },
    }
  }
  const command = typeof record.command === 'string' ? record.command.trim() : ''
  if (command.length === 0) return { ok: false, reason: 'no-endpoint', detail: name }
  return {
    ok: true,
    entry: {
      transport: 'stdio',
      command,
      args: Array.isArray(record.args) ? record.args.map(item => String(item)) : [],
      env: stringDictOf(record.env),
    },
  }
}

/** 只保留字符串值：非字符串条目在官方 schema 上会被拒绝，这里先收敛。 */
function stringDictOf(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue
    result[key] = String(item)
  }
  return result
}

/** 运行期连接状态（官方管理器给出的联合，收窄掉只用于类型的细节）。 */
export type McpState =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'waiting-credentials'
  | 'failed'
  | 'closed'
  | 'disabled'

/** 列表里的一台受管服务器。 */
export interface McpServerView {
  /** 配置键，同时是工具命名空间。 */
  name: string
  /** 配置里是否仍有这条；false 表示已删除但清理未完成。 */
  configured: boolean
  /** 是否由插件注册（只读：界面不得编辑或删除）。 */
  registered: boolean
  /** 持久意图：关闭后条目保留、实例卸载。 */
  enabled: boolean
  transport: McpTransport
  /** 单行摘要：整行命令或 URL。 */
  target: string
  state: McpState
  /** 当前一代已注册的工具数量（仅 connected 时有意义）。 */
  toolCount?: number
  /** 失败原因原文（诊断文本，不翻译）。 */
  lastError?: string
  /** 编辑回填用；注册条目与残留条目没有这个字段。 */
  entry?: McpEntryInput
}

/** `GET /mcp` 的响应。 */
export interface McpServersResponse {
  /** 官方 MCP 管理器是否挂载。 */
  available: boolean
  /** 写配置是否可用；false 时界面只读。 */
  writable: boolean
  servers: McpServerView[]
  /** 不可用的稳定原因码，文案由界面词典给出。 */
  unavailableReason?: 'manager-absent' | 'editor-absent'
}

/** 一次 MCP 写操作。 */
export type McpAction =
  | { op: 'save'; form: McpForm }
  | { op: 'toggle'; name: string; enabled: boolean }
  | { op: 'delete'; name: string }
  | { op: 'import'; json: string }

/** 写成功后的响应：带上最新视图，界面不必再多一次往返。 */
export interface McpWriteResponse {
  ok: true
  servers: McpServerView[]
}
