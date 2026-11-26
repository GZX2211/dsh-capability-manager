// src/host/skill-consumer/policy.ts
//
// Skill 侧的两类判定：能力本身是否在池内，以及入口工具 `skill` 此刻是否可用。
//
// `skill` 是 agent 层注册的 shadow 工具，绕过 `restrict`，因此它的池/黑名单/
// 常驻资格必须由调用方的 `when` 落实；这里的纯函数就是 `when` 与目录注入共用的
// 唯一判定来源。

import { parseId, type CapabilityId } from '../../shared/capability.ts'
import { META_SEARCH_TOOL_ID, SKILL_TOOL_ID, type CapabilityConfig, type SessionRoleName } from '../../shared/config.ts'
import { blacklistFor, isInPool, isToolUsable } from '../policy/pool.ts'

/** 目录注入范围：全量池内，或仅常驻。 */
export type CatalogScope = 'all' | 'resident'

/** 官方与 shadow 共用的工具名；同名是 shadow 生效的前提。 */
export const SKILL_TOOL_NAME = 'skill'

/** Skill 入口工具的可用性入参。 */
export interface SkillToolUsabilityInput {
  config: CapabilityConfig
  role: SessionRoleName | undefined
  /** 本会话已召回的工具名。 */
  recalled: ReadonlySet<string>
}

/**
 * `skill` 入口工具此刻是否可用。
 *
 * 与普通工具同一套规则：池内、非该角色黑名单、且常驻或本会话已召回。
 * 少了最后一条，取消常驻的 `skill` 仍会因为它是 agent 层注册而一直可见。
 *
 * @param input - 配置、角色与召回集合。
 * @returns 可用时为 true。
 */
export function isSkillToolUsable(input: SkillToolUsabilityInput): boolean {
  return isToolUsable({ id: SKILL_TOOL_ID, config: input.config, role: input.role, recalled: input.recalled })
}

export interface SkillEnabledInput {
  id: CapabilityId
  config: CapabilityConfig
  role: SessionRoleName | undefined
}

/**
 * 一个 Skill 能力是否在池内且未被该角色禁止。
 *
 * 不判常驻：常驻只决定 Skill 是否在启动时可直接加载，不决定它能否加载。
 * `modelInvocable` 由目录收集处判定，这里只回答配置问题。
 *
 * @param input - Skill 标识、配置与角色。
 * @returns 可被加载时为 true。
 */
export function isSkillEnabled(input: SkillEnabledInput): boolean {
  const parsed = parseId(input.id)
  if (parsed === undefined || parsed.kind !== 'skill') return false
  return isInPool(input.id, input.config) && !blacklistFor(input.config, input.role).has(input.id)
}

export interface CatalogInjectionInput {
  /** `meta_search` 此刻是否可用（池内、非黑名单、常驻或已召回）。 */
  metaSearchUsable: boolean
  /** 向量检索是否开启。 */
  embeddingEnabled: boolean
}

/**
 * Skill 目录是否注入。
 *
 * 任何情形都要注入：模式 A 注入全量池内 Skill；模式 B 注入常驻 Skill（非常驻
 * 靠关键词召回）。`meta_search` 不可用时同样注入全量，否则模型无从知道名称。
 * 目录始终是 name + description，不含正文——正文仍由 `skill` 工具按需加载。
 *
 * @returns 恒为 true；保留函数是为了让「是否注入」与「注入范围」各有单一判定处。
 */
export function isCatalogInjected(_input: CatalogInjectionInput): boolean {
  return true
}

/**
 * 目录注入范围。
 *
 * 模式 A 或没有召回通道时给全量；模式 B 且 `meta_search` 可用时只给常驻——
 * 非常驻 Skill 走 `meta_search` 的 keywords 语义召回。
 *
 * @param config - 当前配置（读 embedding 开关）。
 * @param metaSearchUsable - `meta_search` 此刻是否可用。
 * @returns 注入范围。
 */
export function catalogScopeOf(config: CapabilityConfig, metaSearchUsable: boolean): CatalogScope {
  if (!config.embedding.enabled) return 'all'
  if (!metaSearchUsable) return 'all'
  return 'resident'
}

/**
 * 当前会话此刻是否应注入 Skill 目录。
 *
 * 注入时机按会话判定：`skill` 入口工具必须可用（池内、非黑名单、常驻或已召回），
 * 否则模型看得到目录也没法加载正文。目录范围由 {@link catalogScopeOf} 另行决定。
 *
 * @param input - 配置、角色与召回集合。
 * @returns 应注入时为 true。
 */
export function shouldInjectSkillCatalog(input: SkillToolUsabilityInput): boolean {
  return isCatalogInjected({
    metaSearchUsable: isToolUsable({
      id: META_SEARCH_TOOL_ID,
      config: input.config,
      role: input.role,
      recalled: input.recalled,
    }),
    embeddingEnabled: input.config.embedding.enabled,
  })
}
