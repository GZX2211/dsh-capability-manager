// src/host/mcp/spawn.ts
//
// 启动命令的平台解析：官方 stdio 传输直接用子进程 spawn（不经 shell），
// Windows 下 npx / npm / 任意全局 bin 是 .cmd 包装，不展开就 ENOENT。
//
// 与界面无关的纯函数：平台从参数传入，测试可确定分支。

import { basename } from 'node:path'
import { splitCommandLine } from '../../shared/mcp.ts'

/** 交给官方 mcp-client 的启动描述。 */
export interface SpawnCommandLine {
  command: string
  args: string[]
}

/**
 * 该可执行名在目标平台是否需要 shell 包装。
 *
 * 规则来自官方传输的实现边界：`spawn` 只认真正的可执行体，
 * `.cmd` / `.bat` / `.ps1` 与没有扩展名的 launcher 都需要一层壳。
 */
function needsShellWrap(executable: string, platform: string): boolean {
  if (platform !== 'win32') return false
  const lower = executable.toLowerCase()
  if (lower.endsWith('.ps1')) return true
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) return true
  if (lower.endsWith('.exe')) return false
  const base = basename(lower)
  return base !== 'node' && base !== 'node.exe'
}

/**
 * 把一行可粘贴的命令解析成官方可 spawn 的形态。
 *
 * @param commandLine - 用户输入的一整行命令。
 * @param platform - 目标平台；默认当前进程平台，测试可注入。
 * @returns 可执行名与参数；空输入得到空结果。
 */
export function resolveSpawnCommandLine(commandLine: string, platform: string = process.platform): SpawnCommandLine {
  const tokens = splitCommandLine(commandLine)
  const [executable, ...rest] = tokens
  if (executable === undefined || executable === '') return { command: '', args: [] }
  if (!needsShellWrap(executable, platform)) return { command: executable, args: rest }
  if (executable.toLowerCase().endsWith('.ps1')) {
    return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...rest] }
  }
  return { command: 'cmd.exe', args: ['/d', '/c', executable, ...rest] }
}
