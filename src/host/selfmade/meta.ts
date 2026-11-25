// src/host/selfmade/meta.ts
//
// 自建工具 `meta.json` 的收窄：磁盘上的任意 JSON → 可注册的工具描述。
//
// 工具注册只接受一个受限的 JSON Schema 子集，用了别的关键字会直接抛错，而装配处
// 只记一条 warning——最终表现为工具静默消失。因此这里在进入注册表之前就把
// parameters / output 交给官方断言收窄，错误在加载期就带上路径级原因。
//
// 纯函数：不读盘、不看环境；调用方把目录名与 impl.mjs 是否存在一并传入。

import { assertObjectJsonSchema, assertSupportedJsonSchema, JsonSchemaError } from '@deepseek-ai/dsh-tools'

/** 四种执行形态：声明式 shell、声明式 http、Node 代码文件、Python 脚本。 */
export type SelfmadeToolKind = 'code' | 'shell' | 'http' | 'python'

export interface SelfmadeShellSpec {
  command: string
  args: string[]
  timeoutMs: number
}

/** 声明式 HTTP 方法；只允许这几种，避免把模型带进 TRACE 之类的边角语义。 */
export type SelfmadeHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface SelfmadeHttpSpec {
  url: string
  method: SelfmadeHttpMethod
  headers: Record<string, string>
  timeoutMs: number
}

/** Python 工具：入口文件名与执行预算。 */
export interface SelfmadePythonSpec {
  entry: string
  timeoutMs: number
}

/** 一份通过校验的自建工具描述。 */
export interface SelfmadeToolMeta {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown> }
  kind: SelfmadeToolKind
  shell?: SelfmadeShellSpec
  http?: SelfmadeHttpSpec
  python?: SelfmadePythonSpec
}

export type ToolMetaErrorCode =
  | 'bad-root'
  | 'bad-name'
  | 'bad-description'
  | 'bad-parameters'
  | 'bad-output'
  | 'bad-kind'
  | 'bad-executor'
  | 'bad-timeout'

export type ToolMetaResult =
  | { ok: true; meta: SelfmadeToolMeta }
  | { ok: false; code: ToolMetaErrorCode; message: string }

export interface ParseToolMetaContext {
  /** 工具目录名；必须与 meta.name 一致，否则「一个工具两个名字」。 */
  dirName: string
  /** 同目录是否存在 impl.mjs；缺省 kind 时据此判定形态。 */
  hasImpl: boolean
  /** 同目录是否存在 main.py；与 impl.mjs 同时存在时优先 Python。 */
  hasPython?: boolean
}

/** 工具名与 Skill 名不共享命名空间，但仍沿用同一套可读性约束。 */
const TOOL_NAME = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/
const MAX_NAME_LENGTH = 64

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 600_000

const METHODS: readonly SelfmadeHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const KINDS: readonly SelfmadeToolKind[] = ['code', 'shell', 'http', 'python']

/**
 * 收窄一份 meta.json。
 *
 * @param raw - 解析后的 JSON，任意形状。
 * @param context - 目录名与 impl.mjs 是否存在。
 * @returns 通过校验的描述，或可行动的错误（说明哪个字段、期望什么）。
 */
export function parseToolMeta(raw: unknown, context: ParseToolMetaContext): ToolMetaResult {
  if (!isRecord(raw)) return fail('bad-root', 'meta.json 必须是 JSON 对象')

  const name = raw.name
  if (typeof name !== 'string' || !TOOL_NAME.test(name) || name.length > MAX_NAME_LENGTH) {
    return fail('bad-name', `name 必须是 1–${MAX_NAME_LENGTH} 位的小写 kebab/snake 名，收到 ${JSON.stringify(name)}`)
  }
  if (name !== context.dirName) {
    return fail(
      'bad-name',
      `目录名 "${context.dirName}" 与 meta.name "${name}" 不一致；自建工具的目录名必须等于工具名`,
    )
  }

  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  if (description.length === 0) return fail('bad-description', 'description 必须是非空字符串')

  const parameters = narrowSchema(raw.parameters, 'parameters', true)
  if (!parameters.ok) return parameters

  const output = narrowOutput(raw.output)
  if (!output.ok) return output

  const kind = narrowKind(raw.kind, context)
  if (!kind.ok) return kind

  const base = { name, description, parameters: parameters.schema, output: output.value }
  if (kind.value === 'shell') {
    const shell = narrowShell(raw.shell)
    if (!shell.ok) return shell
    return { ok: true, meta: { ...base, kind: 'shell', shell: shell.value } }
  }
  if (kind.value === 'http') {
    const http = narrowHttp(raw.http)
    if (!http.ok) return http
    return { ok: true, meta: { ...base, kind: 'http', http: http.value } }
  }
  if (kind.value === 'python') {
    const python = narrowPython(raw.python)
    if (!python.ok) return python
    return { ok: true, meta: { ...base, kind: 'python', python: python.value } }
  }
  return { ok: true, meta: { ...base, kind: 'code' } }
}

/** 缺省 kind 的判定只看目录里有什么：main.py 在前，其次 impl.mjs。 */
function narrowKind(raw: unknown, context: ParseToolMetaContext): { ok: true; value: SelfmadeToolKind } | { ok: false; code: ToolMetaErrorCode; message: string } {
  if (raw === undefined) {
    if (context.hasPython === true) return { ok: true, value: 'python' }
    if (context.hasImpl) return { ok: true, value: 'code' }
    return fail(
      'bad-kind',
      '缺少 kind：声明式工具需要 kind 为 "shell" 或 "http"；代码工具需要在同目录提供 main.py（Python）或 impl.mjs（Node）',
    )
  }
  if (typeof raw !== 'string' || !KINDS.includes(raw as SelfmadeToolKind)) {
    return fail('bad-kind', `kind 只能是 code / shell / http / python，收到 ${JSON.stringify(raw)}`)
  }
  return { ok: true, value: raw as SelfmadeToolKind }
}

function narrowOutput(raw: unknown): { ok: true; value: { schema: Record<string, unknown> } } | { ok: false; code: ToolMetaErrorCode; message: string } {
  if (raw === undefined) return { ok: true, value: { schema: { type: 'object' } } }
  if (!isRecord(raw)) return fail('bad-output', 'output 必须是对象，形如 { "schema": { ... } }')
  const schema = narrowSchema(raw.schema, 'output.schema', false)
  if (!schema.ok) return schema
  return { ok: true, value: { schema: schema.schema } }
}

function narrowSchema(
  raw: unknown,
  field: string,
  objectRoot: boolean,
): { ok: true; schema: Record<string, unknown> } | { ok: false; code: ToolMetaErrorCode; message: string } {
  if (!isRecord(raw)) {
    return fail(
      field === 'parameters' ? 'bad-parameters' : 'bad-output',
      `${field} 必须是 JSON Schema 对象${objectRoot ? '，且根节点是 type: "object"' : ''}`,
    )
  }
  try {
    if (objectRoot) assertObjectJsonSchema(raw)
    else assertSupportedJsonSchema(raw)
  } catch (error) {
    return fail(
      field === 'parameters' ? 'bad-parameters' : 'bad-output',
      `${field} 不在工具支持的 JSON Schema 子集内：${describeSchemaError(error)}`,
    )
  }
  return { ok: true, schema: raw }
}

function narrowShell(raw: unknown): { ok: true; value: SelfmadeShellSpec } | { ok: false; code: ToolMetaErrorCode; message: string } {
  if (!isRecord(raw)) return fail('bad-executor', 'kind 为 shell 时必须提供 shell 对象，例如 { "command": "echo" }')
  const command = typeof raw.command === 'string' ? raw.command.trim() : ''
  if (command.length === 0) return fail('bad-executor', 'shell.command 必须是非空字符串')

  const args: string[] = []
  if (raw.args !== undefined) {
    if (!Array.isArray(raw.args)) return fail('bad-executor', 'shell.args 必须是字符串数组')
    for (const item of raw.args) {
      if (typeof item !== 'string') return fail('bad-executor', 'shell.args 必须是字符串数组')
      args.push(item)
    }
  }

  const timeout = narrowTimeout(raw.timeoutMs)
  if (!timeout.ok) return timeout
  return { ok: true, value: { command, args, timeoutMs: timeout.value } }
}

function narrowHttp(raw: unknown): { ok: true; value: SelfmadeHttpSpec } | { ok: false; code: ToolMetaErrorCode; message: string } {
  if (!isRecord(raw)) return fail('bad-executor', 'kind 为 http 时必须提供 http 对象，例如 { "url": "https://example.com" }')

  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (url.length === 0) return fail('bad-executor', 'http.url 必须是非空字符串')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return fail('bad-executor', `http.url 不是合法 URL：${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail('bad-executor', `http.url 只支持 http/https，收到 ${parsed.protocol}`)
  }

  let method: SelfmadeHttpMethod = 'GET'
  if (raw.method !== undefined) {
    if (typeof raw.method !== 'string' || !METHODS.includes(raw.method as SelfmadeHttpMethod)) {
      return fail('bad-executor', `http.method 只能是 ${METHODS.join(' / ')}，收到 ${JSON.stringify(raw.method)}`)
    }
    method = raw.method as SelfmadeHttpMethod
  }

  const headers: Record<string, string> = {}
  if (raw.headers !== undefined) {
    if (!isRecord(raw.headers)) return fail('bad-executor', 'http.headers 必须是字符串键值对象')
    for (const [key, value] of Object.entries(raw.headers)) {
      if (typeof value !== 'string') return fail('bad-executor', `http.headers 只接受字符串值，${key} 收到的不是字符串`)
      headers[key] = value
    }
  }

  const timeout = narrowTimeout(raw.timeoutMs)
  if (!timeout.ok) return timeout
  return { ok: true, value: { url, method, headers, timeoutMs: timeout.value } }
}

const PYTHON_ENTRY = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.py$/

/** Python 形态：入口必须是目录内的单个 .py 文件，不能借名字跳出去。 */
function narrowPython(raw: unknown): { ok: true; value: SelfmadePythonSpec } | { ok: false; code: ToolMetaErrorCode; message: string } {
  if (raw === undefined) return { ok: true, value: { entry: 'main.py', timeoutMs: DEFAULT_TIMEOUT_MS } }
  if (!isRecord(raw)) return fail('bad-executor', 'python 必须是对象，例如 { "entry": "main.py" }')

  const entry = raw.entry === undefined ? 'main.py' : typeof raw.entry === 'string' ? raw.entry.trim() : ''
  if (entry.length === 0 || !PYTHON_ENTRY.test(entry) || entry.includes('..')) {
    return fail('bad-executor', `python.entry 必须是工具目录内的 .py 文件名（如 main.py），收到 ${JSON.stringify(raw.entry)}`)
  }

  const timeout = narrowTimeout(raw.timeoutMs)
  if (!timeout.ok) return timeout
  return { ok: true, value: { entry, timeoutMs: timeout.value } }
}

/** 超时缺省 30s；越界与小数一律视为作者错误，而不是悄悄夹取。 */
function narrowTimeout(raw: unknown): { ok: true; value: number } | { ok: false; code: ToolMetaErrorCode; message: string } {
  if (raw === undefined) return { ok: true, value: DEFAULT_TIMEOUT_MS }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_TIMEOUT_MS) {
    return fail('bad-timeout', `timeoutMs 必须是 1–${MAX_TIMEOUT_MS} 的整数，收到 ${JSON.stringify(raw)}`)
  }
  return { ok: true, value: raw }
}

function fail(code: ToolMetaErrorCode, message: string): { ok: false; code: ToolMetaErrorCode; message: string } {
  return { ok: false, code, message }
}

function describeSchemaError(error: unknown): string {
  if (error instanceof JsonSchemaError) return error.violations.join('; ')
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
