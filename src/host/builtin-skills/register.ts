// src/host/builtin-skills/register.ts
//
// 内置 `capability-creator` 的发现与注册。
//
// 它是随包发布的文件（不是写入状态目录的自建 Skill）：用户升级插件时应当随之
// 更新，也不该出现在「排出池」里任人删除。正文在注册时替换状态目录占位符，
// 让 Agent 拿到的是可以直接照着写入的绝对路径。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import { parseSkillFile } from '../selfmade/skill-file.ts'

/** 内置创建器 Skill 的名称。 */
export const CREATOR_SKILL_NAME = 'capability-creator'

/**
 * 随包目录的候选路径。
 *
 * 同一份代码会在两种位置执行：源码直跑（`src/host/builtin-skills/`）与打包产物
 * （`lib/index.js`），相对包根的层级不同，因此按深度逐个探测。
 */
export const CREATOR_SKILL_CANDIDATES: readonly URL[] = [1, 2, 3, 4].map(
  depth => new URL(`${'../'.repeat(depth)}skills/${CREATOR_SKILL_NAME}`, import.meta.url),
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

export interface LoadBundledSkillOptions {
  /** 候选目录；缺省 {@link CREATOR_SKILL_CANDIDATES}。 */
  candidates?: readonly URL[]
  exists?: (path: string) => boolean
}

/**
 * 在候选位置里找第一个含 SKILL.md 的目录。
 *
 * @param candidates - 候选目录 URL。
 * @param exists - 存在性判断；测试可替换。
 * @returns 目录绝对路径；都不存在时为 undefined。
 */
export function findBundledSkillDir(
  candidates: readonly URL[],
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  for (const candidate of candidates) {
    try {
      const dir = fileURLToPath(candidate)
      if (exists(join(dir, 'SKILL.md'))) return dir
    } catch {
      // 非法 URL 只说明这个候选不可用，继续看下一个。
    }
  }
  return undefined
}

/**
 * 读取并准备内置 Skill。
 *
 * @param stateDir - 插件状态目录；用于替换正文里的 `{{STATE_DIR}}`。
 * @param options - 候选目录与存在性判断。
 * @returns 可直接交给 `ctx.skills.register` 的内容；找不到或解析失败时为 undefined。
 */
export function loadBundledSkill(stateDir: string, options: LoadBundledSkillOptions = {}): BundledSkill | undefined {
  const dir = findBundledSkillDir(options.candidates ?? CREATOR_SKILL_CANDIDATES, options.exists)
  if (dir === undefined) return undefined

  let text: string
  try {
    text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return undefined
  }

  const parsed = parseSkillFile(text)
  if (!parsed.ok) return undefined

  return {
    name: parsed.skill.name,
    description: parsed.skill.description,
    content: parsed.skill.content.replaceAll(STATE_DIR_PLACEHOLDER, stateDir),
    resourceBase: { kind: 'directory', path: dir },
  }
}

/** 注册面；只依赖 `ctx.skills.register`，便于单测注入。 */
export interface CreatorSkillContext {
  skills: {
    register(skill: SkillRegistration): () => void
  }
}

export interface RegisterCreatorOptions extends LoadBundledSkillOptions {
  log?: (message: string) => void
}

/**
 * 注册内置创建器 Skill。
 *
 * 找不到文件不是致命错误：插件其余部分照常工作，只是 Agent 失去了创建能力的
 * 说明书，因此只记 warning。
 *
 * @param ctx - 需要 `skills.register` 的上下文。
 * @param stateDir - 插件状态目录。
 * @param options - 候选目录与日志。
 * @returns 注销函数；未注册时为 undefined。
 */
export function registerCreatorSkill(
  ctx: CreatorSkillContext,
  stateDir: string,
  options: RegisterCreatorOptions = {},
): (() => void) | undefined {
  const skill = loadBundledSkill(stateDir, options)
  if (skill === undefined) {
    options.log?.(`内置 Skill "${CREATOR_SKILL_NAME}" 未找到或无法解析：创建能力将缺少说明书`)
    return undefined
  }
  return ctx.skills.register({
    ...skill,
    // 它是本插件随包提供的能力，来源归入自定义面，但不属于用户的自建目录。
    source: 'custom',
    invocation: { modelInvocable: true, userInvocable: true },
  })
}
