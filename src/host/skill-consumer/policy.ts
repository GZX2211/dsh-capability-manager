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
 * 语义检索开启且 `meta_search` 可用时，Skill 与工具一样靠关键词召回，
 * 目录只会重复占用上下文；其余情形（含 `meta_search` 不可用）都必须注入，
 * 否则模型无从知道 Skill 名称，也无法用 `skill` 工具加载。
 *
 * @param input - `meta_search` 可用性与向量检索开关。
 * @returns 需要注入目录时为 true。
 */
export function isCatalogInjected(input: CatalogInjectionInput): boolean {
  return !(input.metaSearchUsable && input.embeddingEnabled)
}

/**
 * 当前会话此刻是否应注入 Skill 目录。
 *
 * 把「meta_search 是否可用」也收进来，是因为注入时机必须按会话判定而不能只看
 * 全局配置：`meta_search` 可能被池/黑名单/常驻排除，但 Skill 目录仍必须存在，
 * 否则模型既看不到名称、也没有入口召回。
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
