// src/host/selfmade/executors/code.ts
//
// 代码工具：动态加载同目录的 impl.mjs 并调用默认导出。
//
// 每次调用都按文件的修改时间与大小换一个 import URL：Node 的模块缓存按 URL 身份
// 生效，不改 URL 的话用户改完 impl.mjs 必须重启宿主才能看到效果——而本插件的
// 卖点正是「写入后无需重启」。

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** impl.mjs 收到的上下文。 */
export interface CodeToolContext {
  signal: AbortSignal
  /** 插件状态目录；工具可以据此读写自己的缓存。 */
  stateDir?: string
  /** 该会话的工作目录；解析失败时为 undefined。 */
  workspace?: string
}

export interface RunCodeOptions {
  signal?: AbortSignal | undefined
  stateDir?: string | undefined
  workspace?: string | undefined
}

/** 代码工具源文件的固定文件名。 */
export const CODE_ENTRY_FILE = 'impl.mjs'

/**
 * 执行一次代码工具。
 *
 * @param dir - 工具目录。
 * @param args - 模型给出的调用参数。
 * @param options - 取消信号与上下文。
 * @returns 默认导出的返回值；必须是 JSON 值。
 * @throws 文件缺失、加载失败、契约不符或返回值不可序列化。
 */
export async function runCodeTool(dir: string, args: unknown, options: RunCodeOptions = {}): Promise<unknown> {
  const entry = join(dir, CODE_ENTRY_FILE)
  const version = sourceVersion(entry)
  const module = await loadModule(entry, version)
  const exported = (module as { default?: unknown }).default
  if (typeof exported !== 'function') {
    throw new Error(`${entry} 必须默认导出一个函数：export default async function (args, ctx) { ... }`)
  }

  const signal = options.signal ?? new AbortController().signal
  const result: unknown = await (exported as (args: unknown, context: CodeToolContext) => unknown)(args, {
    signal,
    ...options.stateDir === undefined ? {} : { stateDir: options.stateDir },
    ...options.workspace === undefined ? {} : { workspace: options.workspace },
  })

  assertJsonValue(result, entry)
  return result
}

/** 读不到文件时给出可行动的说明（而不是让 import 的报错孤零零地出现）。 */
function sourceVersion(entry: string): string {
  try {
    const info = statSync(entry)
    return `${String(info.mtimeMs)}-${String(info.size)}`
  } catch (error) {
    throw new Error(`找不到代码工具入口 ${entry}：${describe(error)}`)
  }
}

async function loadModule(entry: string, version: string): Promise<unknown> {
  try {
    // 版本参数只用于打破模块缓存，不影响文件解析。
    return await import(`${pathToFileURL(entry).href}?v=${version}`)
  } catch (error) {
    throw new Error(`无法加载 ${entry}：${describe(error)}`)
  }
}

/** 输出 schema 是 JSON Schema，返回值不能是 BigInt、函数或循环结构。 */
function assertJsonValue(value: unknown, entry: string): void {
  if (value === undefined) {
    throw new Error(`${entry} 的返回值必须是 JSON 值，不能是 undefined`)
  }
  try {
    JSON.stringify(value)
  } catch (error) {
    throw new Error(`${entry} 的返回值必须是 JSON 值：${describe(error)}`)
  }
}

/** 静态检查用：读源码；文件不存在时返回 undefined。 */
export function readCodeSource(dir: string): string | undefined {
  try {
    return readFileSync(join(dir, CODE_ENTRY_FILE), 'utf8')
  } catch {
    return undefined
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
