// src/host/selfmade/create.ts
//
// 手动创建自建 Skill：先分配一个未被占用的名称，再写一份能直接填写的骨架。
//
// 名称分配是「探测 + 独占创建」而不是「先查后建」：mkdirSync 不带 recursive 时
// 已存在会抛 EEXIST，正好用它当唯一的仲裁点，两次点击不会撞进同一个目录。

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSkillName } from '@deepseek-ai/dsh-skill'

/** 名称冲突时最多尝试的序号；正常使用不会接近这个上限。 */
const MAX_ATTEMPTS = 100

/** 骨架里 references 目录的说明文件。 */
const REFERENCES_README = [
  '# references',
  '',
  '把这个 Skill 的补充资料放在这里，并在 SKILL.md 里按相对路径引用。',
  '',
].join('\n')

export interface CreateSkillOptions {
  stateDir: string
  /** 基名；冲突时依次尝试 `${base}-2`、`${base}-3`… */
  baseName: string
  /** 骨架里的初始描述；用户之后自己改。 */
  description: string
}

export interface CreatedSkill {
  name: string
  /** Skill 包目录（含 SKILL.md 与 references/）。 */
  dir: string
  /** SKILL.md 绝对路径。 */
  path: string
}

/**
 * 分配一个未被占用的 Skill 名。
 *
 * @param stateDir - 插件状态目录。
 * @param baseName - 基名，必须是合法 kebab-case。
 * @param isTaken - 名称是否已被占用；缺省按目录是否存在判断。
 * @returns 第一个未被占用的名称。
 * @throws 基名不合法，或连续尝试都失败。
 */
export function nextAvailableSkillName(
  stateDir: string,
  baseName: string,
  isTaken: (name: string) => boolean = name => directoryTaken(stateDir, name),
): string {
  if (!isSkillName(baseName)) {
    throw new Error(`Skill 名必须是 kebab-case（如 my-skill），收到 ${JSON.stringify(baseName)}`)
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? baseName : `${baseName}-${String(attempt)}`
    // 加序号后仍可能不是合法名字（极长的基名被截断），直接换下一个。
    if (!isSkillName(candidate)) continue
    if (!isTaken(candidate)) return candidate
  }
  throw new Error(`无法为 "${baseName}" 分配可用名称：连续 ${String(MAX_ATTEMPTS)} 个候选都已被占用`)
}

/**
 * 创建一个自建 Skill 的骨架目录。
 *
 * @param options - 状态目录、基名与初始描述。
 * @returns 实际使用的名称与路径。
 * @throws 名称不合法、目录不可写或连续冲突。
 */
export function createSelfmadeSkill(options: CreateSkillOptions): CreatedSkill {
  const root = join(options.stateDir, 'skills')
  mkdirSync(root, { recursive: true })

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const name = nextAvailableSkillName(options.stateDir, options.baseName)
    const dir = join(root, name)
    try {
      mkdirSync(dir)
    } catch (error) {
      // 另一个窗口刚好抢先建了同名目录：换下一个序号重试。
      if (isExists(error)) continue
      throw error
    }

    const path = join(dir, 'SKILL.md')
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(path, renderSkeleton(name, options.description), 'utf8')
    writeFileSync(join(dir, 'references', 'README.md'), REFERENCES_README, 'utf8')
    return { name, dir, path }
  }

  throw new Error(`无法为 "${options.baseName}" 创建目录：目录持续被占用`)
}

/**
 * 生成 SKILL.md 骨架。
 *
 * 正文同时给出中英提示：这份文件既可能被中文用户填写，也可能被英文会话里的
 * Agent 读取；骨架只解释「该填什么」，不预设用户语言。
 *
 * @param name - Skill 名。
 * @param description - 初始描述。
 * @returns 完整文件内容。
 */
export function renderSkeleton(name: string, description: string): string {
  return [
    '---',
    `name: ${frontmatterValue(name)}`,
    `description: ${frontmatterValue(description)}`,
    '---',
    '',
    `# ${name}`,
    '',
    '<!-- 用一两句话说明这个 Skill 什么时候该被使用，然后补充步骤。 -->',
    '',
    '## 何时使用',
    '',
    '## 步骤',
    '',
    '## 参考',
    '',
    '把补充资料放进 `references/`，然后在正文里按相对路径引用。',
    '',
  ].join('\n')
}

/** frontmatter 用标量键；值里出现 YAML 特殊字符时退回 JSON 字符串形式。 */
function frontmatterValue(value: string): string {
  return /[:#'"\\]/.test(value) || value.trim() !== value ? JSON.stringify(value) : value
}

function directoryTaken(stateDir: string, name: string): boolean {
  return existsSync(join(stateDir, 'skills', name))
}

function isExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EEXIST'
}
