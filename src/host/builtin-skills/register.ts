// src/host/builtin-skills/register.ts
//
// 随包发布的内置 Skill 的发现与注册。
//
// 它们是随包发布的文件（不是写入状态目录的自建 Skill）：用户升级插件时应当随之
// 更新，也不该出现在「排出池」里任人删除。扫描的是 `skills/` 下的每个子目录，
// 因此新增一个内置 Skill 只需要加目录，不需要改代码。

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import { parseSkillFile } from '../selfmade/skill-file.ts'

/**
 * 随包 `skills/` 目录的候选路径。
 *
 * 同一份代码会在两种位置执行：源码直跑（`src/host/builtin-skills/`）与打包产物
 * （`lib/index.js`），相对包根的层级不同，因此按深度逐个探测。
 */
export const BUNDLED_SKILLS_CANDIDATES: readonly URL[] = [1, 2, 3, 4].map(
  depth => new URL(`${'../'.repeat(depth)}skills`, import.meta.url),
)

/** 正文里的状态目录占位符。 */
const STATE_DIR_PLACEHOLDER = '{{STATE_DIR}}'

/** 已加载的内置 Skill。 */
export interface BundledSkill {
  name: string
  description: string
  content: string
  resourceBase: { kind: 'directory'; path: string }
}

export interface LoadBundledSkillsOptions {
  /** 候选根目录；缺省 {@link BUNDLED_SKILLS_CANDIDATES}。 */
  candidates?: readonly URL[]
  exists?: (path: string) => boolean
  readdir?: (path: string) => readonly string[]
  readFile?: (path: string) => string
  /** 单个条目被跳过时的说明。 */
  log?: (message: string) => void
}

/**
 * 找第一个存在的候选根目录。
 *
 * @param candidates - 候选目录 URL。
 * @param exists - 存在性判断；测试可替换。
 * @returns 目录绝对路径；都不存在时为 undefined。
 */
export function findBundledSkillsRoot(
  candidates: readonly URL[],
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  for (const candidate of candidates) {
    try {
      const dir = fileURLToPath(candidate)
      if (exists(dir)) return dir
    } catch {
      // 非法 URL 只说明这个候选不可用，继续看下一个。
    }
  }
  return undefined
}

/**
 * 读取并准备全部内置 Skill。
 *
 * 单个条目的问题只跳过它自己：一个写坏的文件不该让另一份说明书也消失。
 * 没有 SKILL.md 的子目录是正常形态（例如占位目录），不计入问题。
 *
 * @param stateDir - 插件状态目录；用于替换正文里的 `{{STATE_DIR}}`。
 * @param options - 根目录候选与 IO 替身。
 * @returns 可直接交给 `ctx.skills.register` 的内容。
 */
export function loadBundledSkills(stateDir: string, options: LoadBundledSkillsOptions = {}): BundledSkill[] {
  const root = findBundledSkillsRoot(options.candidates ?? BUNDLED_SKILLS_CANDIDATES, options.exists)
  if (root === undefined) return []

  const exists = options.exists ?? existsSync
  const readdir = options.readdir ?? (path => readdirSync(path, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name))
  const readFile = options.readFile ?? (path => readFileSync(path, 'utf8'))

  let names: readonly string[]
  try {
    names = readdir(root)
  } catch {
    return []
  }

  const skills: BundledSkill[] = []
  for (const entry of [...names].sort(compareNames)) {
    if (entry.startsWith('.')) continue
    const dir = join(root, entry)
    const path = join(dir, 'SKILL.md')
    if (!exists(path)) continue

    let text: string
    try {
      text = readFile(path)
    } catch {
      continue
    }

    const parsed = parseSkillFile(text)
    if (!parsed.ok) {
      options.log?.(`内置 Skill "${entry}" 已跳过：${parsed.reason}`)
      continue
    }
    skills.push({
      name: parsed.skill.name,
      description: parsed.skill.description,
      content: parsed.skill.content.replaceAll(STATE_DIR_PLACEHOLDER, stateDir),
      resourceBase: { kind: 'directory', path: dir },
    })
  }
  return skills
}

/** 注册面；只依赖 `ctx.skills.register`，便于单测注入。 */
export interface BundledSkillContext {
  skills: {
    register(skill: SkillRegistration): () => void
  }
}

export interface RegisterBundledSkillsOptions extends LoadBundledSkillsOptions {
  log?: (message: string) => void
}
/**
 * 注册全部内置 Skill。
 *
 * 找不到文件不是致命错误：插件其余部分照常工作，只是 Agent 失去了对应的
 * 说明书，因此只记 warning。
 *
 * @param ctx - 需要 `skills.register` 的上下文。
 * @param stateDir - 插件状态目录。
 * @param options - 根目录候选与日志。
 * @returns 注销函数；一个都没注册时为 undefined。
 */
export function registerBundledSkills(
  ctx: BundledSkillContext,
  stateDir: string,
  options: RegisterBundledSkillsOptions = {},
): (() => void) | undefined {
  const skills = loadBundledSkills(stateDir, options)
  if (skills.length === 0) {
    options.log?.('未找到内置 Skill：创建能力将缺少说明书')
    return undefined
  }

  const releases: (() => void)[] = []
  for (const skill of skills) {
    try {
      releases.push(ctx.skills.register({
        ...skill,
        // 它是本插件随包提供的能力，来源归入自定义面，但不属于用户的自建目录。
        source: 'custom',
        invocation: { modelInvocable: true, userInvocable: true },
      }))
    } catch (error) {
      options.log?.(`内置 Skill "${skill.name}" 注册失败：${describe(error)}`)
    }
  }
  if (releases.length === 0) return undefined
  return () => {
    for (const release of releases.splice(0)) {
      try {
        release()
      } catch {
        // 回收失败没有可补救的动作：注册表随插件一起销毁。
      }
    }
  }
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
