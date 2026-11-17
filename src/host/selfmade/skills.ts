// src/host/selfmade/skills.ts
//
// `<state>/skills` 的 Skill provider：目录即 Skill 包（`<name>/SKILL.md` + `references/`）。
//
// 为什么自建 provider 而不是复用官方文件系统 provider：官方那套读取的是
// project / user / bundled 根，不包含插件私有状态目录；而自建能力的归属、
// 热更新与界面标签都由本插件负责，来源判定必须是它自己知道的事实。
//
// 排名取官方的 custom 档（300）：project 层仍然优先，同层内自定义能力应当
// 压过 user / bundled 的同名 Skill。

import { mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider } from '@deepseek-ai/dsh-skill'
import { parseSkillFile, type ParsedSkill } from './skill-file.ts'

/** provider 名称；`ctx.skills` 里的唯一身份。 */
export const SELFMADE_SKILL_PROVIDER = 'capability-manager'

/** 与官方 `CUSTOM_RANK` 对齐：自定义能力压过 user / bundled，低于 project。 */
const CUSTOM_RANK = 300

/** provider 条目在模型侧显示的来源。 */
const SKILL_SOURCE = 'custom'

const SKILL_FILE = 'SKILL.md'
const DEFAULT_DEBOUNCE_MS = 120

/** 一条发现结果。 */
export interface SelfmadeSkillEntry {
  name: string
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  /** Skill 包目录；打开文件夹与资源解析都用它。 */
  dir: string
  /** SKILL.md 绝对路径。 */
  path: string
  content: string
}

/**
 * 枚举状态目录里的自建 Skill。
 *
 * 单个条目失败只跳过它自己；同名取目录名靠前的那个，与 provider 的合并语义一致。
 *
 * @param stateDir - 插件状态目录。
 * @param log - 非致命问题；缺省时静默。
 * @returns 通过校验的条目，按目录名排序。
 */
export function scanSelfmadeSkills(stateDir: string, log?: (message: string) => void): SelfmadeSkillEntry[] {
  const root = join(stateDir, 'skills')
  let dirents
  try {
    dirents = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    if (!isMissing(error)) log?.(`自建 Skill 目录不可读（${root}）：${describe(error)}`)
    return []
  }

  const seen = new Set<string>()
  const skills: SelfmadeSkillEntry[] = []
  for (const dirent of [...dirents].sort((a, b) => compareNames(a.name, b.name))) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue
    const dir = join(root, dirent.name)
    const path = join(dir, SKILL_FILE)
    const text = readText(path)
    if (text === undefined) {
      log?.(`自建 Skill "${dirent.name}" 已跳过：缺少 ${SKILL_FILE}`)
      continue
    }
    const parsed = parseSkillFile(text)
    if (!parsed.ok) {
      log?.(`自建 Skill "${dirent.name}" 已跳过：${parsed.reason}`)
      continue
    }
    if (seen.has(parsed.skill.name)) {
      log?.(`自建 Skill "${dirent.name}" 已跳过：名称 "${parsed.skill.name}" 与另一个自建 Skill 重复`)
      continue
    }
    seen.add(parsed.skill.name)
    skills.push(toEntry(parsed.skill, dir, path))
  }
  return skills
}

export interface SelfmadeSkillsOptions {
  stateDir: string
  log?: (message: string) => void
  /** 是否监听文件变化；缺省为开启。 */
  watch?: boolean
  debounceMs?: number
}

/**
 * 自建 Skill 的目录、监听与 provider。
 *
 * 变更通知只做一件事：让 `ctx.skills` 丢掉缓存。列表与正文每次请求都重新读盘，
 * 因此「改完文件不重启」不需要额外的一致性机制。
 */
export class SelfmadeSkills {
  private readonly listeners = new Set<() => void>()
  private readonly warned = new Set<string>()
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout
  private closed = false

  constructor(private readonly options: SelfmadeSkillsOptions) {}

  /** 创建目录并按需开始监听；失败只记录，不让插件加载失败。 */
  start(): void {
    try {
      mkdirSync(join(this.options.stateDir, 'skills'), { recursive: true })
    } catch (error) {
      this.warn(`无法创建自建 Skill 目录：${describe(error)}`)
    }
    if (this.options.watch !== false) this.startWatching()
  }

  /**
   * 订阅目录变化。
   *
   * @param listener - 去抖后调用一次。
   * @returns 取消订阅。
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 当前发现结果；每次调用都重新读盘。 */
  entries(): SelfmadeSkillEntry[] {
    return scanSelfmadeSkills(this.options.stateDir, message => this.warnOnce(message))
  }

  /** 当前自建 Skill 名；供目录来源判定使用。 */
  names(): ReadonlySet<string> {
    return new Set(this.entries().map(entry => entry.name))
  }

  /** 交给 `ctx.skills.registerProvider` 的 provider。 */
  provider(): SkillProvider {
    return {
      name: SELFMADE_SKILL_PROVIDER,
      list: async (options: SkillLookupOptions): Promise<readonly SkillCandidate[]> => {
        options.signal?.throwIfAborted()
        return this.entries().map(toCandidate)
      },
      get: async (candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> => {
        options.signal?.throwIfAborted()
        const dir = locatorDir(candidate)
        if (dir === undefined) return undefined
        const path = join(dir, SKILL_FILE)
        const text = readText(path)
        if (text === undefined) return undefined
        const parsed = parseSkillFile(text)
        if (!parsed.ok) {
          this.warnOnce(`自建 Skill "${candidate.name}" 已无法解析：${parsed.reason}`)
          return undefined
        }
        // 候选是发现时刻的快照；文件已被改名时不能把新正文挂到旧名字上。
        if (parsed.skill.name !== candidate.name) return undefined
        return { ...toSummary(parsed.skill, dir, path), content: parsed.skill.content }
      },
    }
  }

  /** 插件卸载：停止监听并丢掉订阅者。 */
  dispose(): void {
    this.closed = true
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const watcher = this.watcher
    this.watcher = undefined
    if (watcher !== undefined) {
      try {
        watcher.close()
      } catch {
        // 监听已失效；没有可补救的动作。
      }
    }
    this.listeners.clear()
  }

  private startWatching(): void {
    const root = join(this.options.stateDir, 'skills')
    try {
      this.watcher = watch(root, { recursive: true }, () => this.schedule())
      this.watcher.on('error', error => {
        this.warn(`自建 Skill 目录监听失败，列表将只在下次读取时更新：${describe(error)}`)
        this.stopWatcher()
      })
    } catch (error) {
      this.warn(`无法监听自建 Skill 目录，列表将只在下次读取时更新：${describe(error)}`)
    }
  }

  private schedule(): void {
    if (this.closed || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.closed) return
      for (const listener of [...this.listeners]) {
        try {
          listener()
        } catch (error) {
          this.warn(`自建 Skill 变更通知失败：${describe(error)}`)
        }
      }
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
    this.timer.unref?.()
  }

  private stopWatcher(): void {
    const watcher = this.watcher
    this.watcher = undefined
    if (watcher === undefined) return
    try {
      watcher.close()
    } catch {
      // 同上。
    }
  }

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return
    this.warned.add(message)
    this.warn(message)
  }

  private warn(message: string): void {
    this.options.log?.(message)
  }
}

function toEntry(skill: ParsedSkill, dir: string, path: string): SelfmadeSkillEntry {
  return { ...toSummary(skill, dir, path), dir, content: skill.content }
}

function toSummary(skill: ParsedSkill, dir: string, path: string) {
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
    invocation: skill.invocation,
    source: SKILL_SOURCE,
    provider: SELFMADE_SKILL_PROVIDER,
    resourceBase: { kind: 'directory' as const, path: dir },
    path,
  }
}

function toCandidate(entry: SelfmadeSkillEntry): SkillCandidate {
  return {
    ...toSummary(entry, entry.dir, entry.path),
    rank: CUSTOM_RANK,
    locator: { dir: entry.dir },
  }
}

function locatorDir(candidate: SkillCandidate): string | undefined {
  const locator = candidate.locator as { dir?: unknown } | null
  return typeof locator?.dir === 'string' ? locator.dir : undefined
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
