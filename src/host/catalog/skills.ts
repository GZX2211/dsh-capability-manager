// src/host/catalog/skills.ts
//
// 把 Skill 注册表的摘要收敛成界面与目录共用的 CapabilityEntry。
//
// 与工具侧的分工相同：这里只保留 modelInvocable 的 Skill（官方目录与官方
// `skill` 工具的可加载范围），摘要与目录行共用同一份归一结果，避免同一项在
// 界面、索引与召回载荷里出现三种写法。

import { skillId, type CapabilityEntry, type CapabilitySource } from '../../shared/capability.ts'
import { summarize } from './collect.ts'

/** `ctx.skills` 摘要的结构子集；只描述这里需要的字段，不 import 官方类型。 */
export interface SkillSource {
  readonly name: string
  readonly description: string
  readonly invocation?: { readonly modelInvocable: boolean } | undefined
}

export interface CollectSkillsInput {
  skills: readonly SkillSource[]
  /** 来源判定；由调用点注入，便于按部署给出自建名单。 */
  classify: (name: string) => CapabilitySource
  /**
   * 该 Skill 此刻是否可加载。
   *
   * 缺省为「是」：是否可加载还取决于入口工具、池与角色，由调用点的判定给出。
   */
  isAvailable?: (skill: SkillSource) => boolean
}

/**
 * 收集 Skill 条目。
 *
 * @param input - Skill 摘要、来源判定与可用性判定。
 * @returns 按名称排序的条目；`modelInvocable: false` 的 Skill 被丢弃。
 */
export function collectSkills(input: CollectSkillsInput): CapabilityEntry[] {
  const isAvailable = input.isAvailable ?? (() => true)
  return input.skills
    .filter(isModelInvocable)
    .map(skill => {
      const source = input.classify(skill.name)
      return {
        id: skillId(skill.name),
        kind: 'skill' as const,
        name: skill.name,
        summary: describeSkill(skill),
        source,
        owned: source === 'custom',
        available: isAvailable(skill),
      }
    })
    .sort((a, b) => compareNames(a.name, b.name))
}

/**
 * 目录、索引与召回载荷共用的单行描述。
 *
 * @param skill - 至少带描述；目录不渲染正文，也不渲染绝对路径。
 * @returns 首行、去两端空白、至多 200 个码点。
 */
export function describeSkill(skill: Pick<SkillSource, 'description'>): string {
  return summarize(skill.description)
}

/**
 * 官方目录与 `skill` 工具是否允许模型调用这个 Skill。
 *
 * 官方形状里 `invocation` 是必填的；缺省按「不可调用」处理，宁可少列也不把
 * 用户 `disable-model-invocation` 的 Skill 塞回目录。
 *
 * @param skill - Skill 摘要。
 * @returns 可被模型调用时为 true。
 */
export function isModelInvocable(skill: SkillSource): boolean {
  return skill.invocation?.modelInvocable === true
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
