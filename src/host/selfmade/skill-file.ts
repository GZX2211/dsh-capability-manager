// src/host/selfmade/skill-file.ts
//
// SKILL.md 的解析：frontmatter 只接受 `key: value` 标量键。
//
// 不支持 YAML 的块标量、锚点与嵌套结构——自建 Skill 的骨架由本插件生成，
// 支持面越窄，「照着骨架填」就越不会踩到边角语义。解析失败一律给出可行动原因。

import { isSkillName } from '@deepseek-ai/dsh-skill'

/** 解析结果中的 Skill 内容。 */
export interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  /** frontmatter 之后的正文，已去掉首尾空行。 */
  content: string
}

export type SkillFileResult =
  | { ok: true; skill: ParsedSkill }
  | { ok: false; reason: string }

/** 官方字段名；旧式别名会被明确拒绝，而不是静默失效。 */
const LEGACY_KEYS: Record<string, string> = {
  disableModelInvocation: 'disable-model-invocation',
  modelInvocable: 'disable-model-invocation',
  userInvocable: 'user-invocable',
}

/**
 * 解析一份 SKILL.md。
 *
 * @param text - 文件全文。
 * @returns 解析结果；失败时 `reason` 说明哪个字段不符合要求。
 */
export function parseSkillFile(text: string): SkillFileResult {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  if (lines[0]?.trim() !== '---') {
    return { ok: false, reason: 'SKILL.md 必须以 --- 开头的 frontmatter 开始' }
  }

  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      closing = index
      break
    }
  }
  if (closing < 0) return { ok: false, reason: 'frontmatter 缺少结束的 ---' }

  const data: Record<string, string> = {}
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator <= 0) {
      return { ok: false, reason: `frontmatter 第 ${String(index + 1)} 行不是 key: value 形式` }
    }
    const key = line.slice(0, separator).trim()
    data[key] = unquote(line.slice(separator + 1).trim())
  }

  for (const [legacy, canonical] of Object.entries(LEGACY_KEYS)) {
    if (data[legacy] !== undefined) {
      return { ok: false, reason: `frontmatter 字段 "${legacy}" 已废弃，请改用 "${canonical}"` }
    }
  }

  const name = data.name ?? ''
  if (name.length === 0) return { ok: false, reason: 'frontmatter 缺少 name' }
  if (!isSkillName(name)) {
    return { ok: false, reason: `name "${name}" 不是合法的 kebab-case Skill 名` }
  }
  const description = data.description ?? ''
  if (description.length === 0) return { ok: false, reason: 'frontmatter 缺少 description' }

  const modelInvocable = booleanField(data, 'disable-model-invocation')
  if (modelInvocable === 'invalid') {
    return { ok: false, reason: 'frontmatter 字段 "disable-model-invocation" 必须是布尔值' }
  }
  const userInvocable = booleanField(data, 'user-invocable')
  if (userInvocable === 'invalid') {
    return { ok: false, reason: 'frontmatter 字段 "user-invocable" 必须是布尔值' }
  }

  const whenToUse = data.whenToUse
  return {
    ok: true,
    skill: {
      name,
      description,
      ...whenToUse === undefined || whenToUse.length === 0 ? {} : { whenToUse },
      // 缺省是「都可调用」：显式关闭才排除，与官方 frontmatter 语义一致。
      invocation: {
        modelInvocable: modelInvocable !== true,
        userInvocable: userInvocable !== false,
      },
      content: lines.slice(closing + 1).join('\n').trim(),
    },
  }
}

/**
 * 读一个布尔字段。
 *
 * @returns 未出现时 undefined；出现且合法时布尔值；无法解释时为 'invalid'。
 */
function booleanField(data: Record<string, string>, key: string): boolean | undefined | 'invalid' {
  const raw = data[key]
  if (raw === undefined) return undefined
  switch (raw.toLowerCase()) {
    case 'true':
    case 'yes':
    case 'on':
    case '1':
      return true
    case 'false':
    case 'no':
    case 'off':
    case '0':
      return false
    default:
      return 'invalid'
  }
}

/** 双引号按 JSON 语义去引号，单引号只处理最常见的转义。 */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("\\'", "'")
  }
  return value
}
