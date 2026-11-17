// src/host/selfmade/reveal.ts
//
// 在系统文件管理器里打开一个自建能力的目录。
//
// 没有可用的宿主「打开目录」服务（`directoryPicker` 是选择目录、不是展示目录），
// 因此直接调用平台命令：win32 用 explorer.exe，macOS 用 open，其余用 xdg-open。
// 子进程 detach + unref：文件管理器是用户的，不是宿主的子任务，不能拖住进程退出。

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/** 只用到 unref；默认实现传入的是真实 ChildProcess。 */
export interface RevealChild {
  unref?: () => void
}

export interface RevealDeps {
  /** 平台标识；缺省取 `process.platform`。 */
  platform?: string
  /** 启动器；缺省用 `child_process.spawn`，测试注入替身。 */
  spawn?: (command: string, args: string[]) => RevealChild
  /** 路径存在性判断；缺省用 `fs.existsSync`。 */
  exists?: (path: string) => boolean
}

/**
 * 判定某个平台用哪条命令打开目录。
 *
 * @param platform - `process.platform` 的取值（或测试给的字符串）。
 * @param path - 要打开的目录。
 * @returns 命令与参数。
 */
export function openerFor(platform: string, path: string): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'explorer.exe', args: [path] }
  if (platform === 'darwin') return { command: 'open', args: [path] }
  return { command: 'xdg-open', args: [path] }
}

/**
 * 打开目录。
 *
 * @param path - 已解析出的自建能力目录。
 * @param deps - 平台、启动器与存在性判断，供测试替换。
 * @throws 目录不存在，或启动器失败。
 */
export function revealInFileManager(path: string, deps: RevealDeps = {}): void {
  const exists = deps.exists ?? existsSync
  if (!exists(path)) throw new Error(`目录不存在，无法打开：${path}`)

  const { command, args } = openerFor(deps.platform ?? process.platform, path)
  const launch = deps.spawn ?? ((program: string, argv: string[]) => spawn(program, argv, { detached: true, stdio: 'ignore' }))
  try {
    launch(command, args).unref?.()
  } catch (error) {
    throw new Error(`打开目录失败（${command}）：${describe(error)}`)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
