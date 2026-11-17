// src/host/selfmade/executors/shell.ts
//
// 声明式 shell 工具：参数按 argv 数组传递，绝不拼成 shell 字符串。
//
// 不经过 shell 是有意的：拼字符串意味着模型给的参数能注入分号、管道与重定向。
// argv 数组下这些字符只是普通文本，命令本身由 meta.json 的作者固定。

import { execFile } from 'node:child_process'
import type { SelfmadeShellSpec } from '../meta.ts'
import { fillTemplate } from './template.ts'

/** 一次命令执行的可观察结果；非零退出码也是结果，不是异常。 */
export interface ShellRunResult {
  /** 进程退出码；只有被信号终止时才为 null。 */
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface ExecFileOptions {
  signal?: AbortSignal | undefined
  timeoutMs: number
}

/** 可注入的命令执行器；默认实现直接用 `child_process.execFile`。 */
export type ExecFileRunner = (
  command: string,
  args: string[],
  options: ExecFileOptions,
) => Promise<ShellRunResult>

/**
 * 执行一次声明式 shell 工具。
 *
 * @param spec - 命令、参数模板与超时。
 * @param args - 模型给出的调用参数。
 * @param run - 命令执行器；测试注入替身。
 * @param signal - 调用方取消信号。
 * @returns 退出码与两路输出。
 * @throws 启动失败、超时或调用方取消；非零退出码不抛错。
 */
export async function runShellTool(
  spec: SelfmadeShellSpec,
  args: Record<string, unknown>,
  run: ExecFileRunner = nodeExecFile,
  signal?: AbortSignal,
): Promise<ShellRunResult> {
  if (signal?.aborted) throw signal.reason
  const argv = spec.args.map(item => fillTemplate(item, args))
  try {
    return await run(spec.command, argv, { signal, timeoutMs: spec.timeoutMs })
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    const code = (error as { code?: unknown }).code
    if (code === 'ENOENT') {
      throw new Error(`找不到可执行文件 "${spec.command}"：请确认它在 PATH 中，或在 meta.json 里写绝对路径`)
    }
    if ((error as { killed?: unknown }).killed === true) {
      throw new Error(`命令 "${spec.command}" 超时（${spec.timeoutMs}ms）并被终止`)
    }
    throw new Error(`命令 "${spec.command}" 执行失败：${describe(error)}`)
  }
}

/** 默认执行器：回调式 `execFile` 收成 Promise，并把「非零退出」变成结果。 */
const nodeExecFile: ExecFileRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        ...options.signal === undefined ? {} : { signal: options.signal },
        timeout: options.timeoutMs,
        // 固定编码与窗口隐藏：输出直接进模型上下文，不能带上平台默认编码的乱码。
        encoding: 'utf8',
        windowsHide: true,
        // 一次工具调用的输出上限；超出时 Node 会以 maxBuffer 错误终止命令。
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr })
          return
        }
        const code = (error as { code?: unknown }).code
        if (typeof code === 'number') {
          resolve({ exitCode: code, stdout, stderr })
          return
        }
        reject(error)
      },
    )
  })

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
