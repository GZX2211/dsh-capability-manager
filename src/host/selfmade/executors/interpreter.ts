// src/host/selfmade/executors/interpreter.ts
//
// Python 解释器的定位：显式配置 → DSH 自带运行时 → python3 → python → Windows 的 py -3。
//
// 顺序与 `dsh-run-python` 保持一致，用户不必在两处重复理解「机器上的 Python 在哪」。
// 解析结果按配置值缓存：一次探测要起几次子进程，不能每次工具调用都重来。

import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 最低可用版本；3.10 及以下缺少下游脚本常用的语法与标准库行为。 */
const MIN_MAJOR = 3
const MIN_MINOR = 11

/** 解析结果：可执行文件、固定参数与版本串。 */
export interface ResolvedPython {
  command: string
  args: string[]
  version: string
}

/** 外部探测点；测试注入以隔离文件系统与子进程。 */
export interface PythonProbe {
  platform: NodeJS.Platform
  /** DSH 自带运行时里的候选解释器路径。 */
  dshCandidates(): string[]
  /** 读版本号；命令不可用时返回 undefined。 */
  versionOf(command: string, args: readonly string[]): string | undefined
  isFile(path: string): boolean
}

/** 生产探测：按平台拼 DSH 运行时路径，用 `--version` 只读探测。 */
export function defaultPythonProbe(): PythonProbe {
  const platform = process.platform
  return {
    platform,
    dshCandidates(): string[] {
      const base = join(homedir(), '.dsh', 'dsh-runtimes')
      const suffix = platform === 'win32'
        ? join('dependencies', 'python', 'python.exe')
        : join('dependencies', 'python', 'bin', 'python3')
      let versions: string[]
      try {
        versions = readdirSync(base).sort()
      } catch {
        return []
      }
      return versions.map(version => join(base, version, suffix))
    },
    versionOf(command, args): string | undefined {
      try {
        return execFileSync(command, [...args, '--version'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10_000,
          windowsHide: true,
        }).trim()
      } catch {
        return undefined
      }
    },
    isFile(path): boolean {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    },
  }
}

export interface ResolvePythonOptions {
  /** 显式指定的解释器路径；优先于一切探测。 */
  pythonPath?: string | undefined
  probe?: PythonProbe
}

/** 已解析的解释器，按 `pythonPath` 缓存。 */
const cache = new Map<string, ResolvedPython>()

/** 清空缓存；测试或用户改配置后需要重新探测。 */
export function forgetPython(): void {
  cache.clear()
}

/**
 * 解析一个满足版本要求的解释器。
 *
 * @param options - 显式路径与探测点。
 * @returns 可执行文件、固定参数与版本。
 * @throws 全部候选都不可用时，报错里列出检查过的路径与补救办法。
 */
export function resolvePython(options: ResolvePythonOptions = {}): ResolvedPython {
  const key = options.pythonPath?.trim() ?? ''
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const probe = options.probe ?? defaultPythonProbe()
  const candidates: { command: string; args: string[] }[] = []
  if (key.length > 0) candidates.push({ command: key, args: [] })
  for (const path of probe.dshCandidates()) {
    if (probe.isFile(path)) candidates.push({ command: path, args: [] })
  }
  candidates.push({ command: 'python3', args: [] })
  candidates.push({ command: 'python', args: [] })
  if (probe.platform === 'win32') candidates.push({ command: 'py', args: ['-3'] })

  const checked: string[] = []
  for (const candidate of candidates) {
    checked.push([candidate.command, ...candidate.args].join(' '))
    const version = parseVersion(probe.versionOf(candidate.command, candidate.args))
    if (version === undefined) continue
    if (version.major > MIN_MAJOR || (version.major === MIN_MAJOR && version.minor >= MIN_MINOR)) {
      const resolved: ResolvedPython = { command: candidate.command, args: candidate.args, version: version.raw }
      cache.set(key, resolved)
      return resolved
    }
  }

  throw new Error(
    `找不到可用的 Python（需要 ${String(MIN_MAJOR)}.${String(MIN_MINOR)} 及以上）。` +
    `已检查：${checked.join('、')}。` +
    '请安装 Python，或在能力管理插件配置里用 pythonPath 指定解释器绝对路径；' +
    '也可以改用 Node 形式的代码工具（impl.mjs）或声明式工具。',
  )
}

/** 从 "Python 3.12.4" 里取版本；解析不出时为 undefined。 */
function parseVersion(text: string | undefined): { major: number; minor: number; raw: string } | undefined {
  if (text === undefined) return undefined
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text)
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    raw: `${match[1] ?? '0'}.${match[2] ?? '0'}.${match[3] ?? '0'}`,
  }
}
