// src/host/policy/pool.ts
//
// 能力池、常驻与角色黑名单的判定。全部是纯函数：配置与角色就是全部事实。
//
// 优先级固定为 黑名单 > 池 > 常驻：黑名单能排除池内能力，也能排掉常驻能力。

import { parseId, type CapabilityId } from '../../shared/capability.ts'
import type { CapabilityConfig, SessionRoleName } from '../../shared/config.ts'

/**
 * 能力是否在池内。
 *
 * 池的补集只由 `excluded` 表达，所以未登记的能力按「在池内」处理——
 * 能力可能只是当前未加载，不能因为没见过就判定它被排除。
 *
 * @param id - 能力标识。
 * @param config - 当前配置。
 * @returns 在池内为 true。
 */
export function isInPool(id: CapabilityId, config: CapabilityConfig): boolean {
  return !config.excluded.includes(id)
}

/** 常驻能力的标识集合；是否真的存在由调用方结合全量目录判定。 */
export function residentSet(config: CapabilityConfig): Set<CapabilityId> {
  return new Set(config.resident)
}

/**
 * 某个角色被禁止使用的能力标识集合。
 *
 * 角色未知（`ctx.paRoles` 未安装或账本未就绪）或 `undefined` 时不应用任何黑名单，
 * 这是刻意的降级方向：宁可多给能力，也不能凭猜测禁用。
 *
 * @param config - 当前配置。
 * @param role - 会话角色。
 * @returns 黑名单标识集合。
 */
export function blacklistFor(config: CapabilityConfig, role: SessionRoleName | undefined): Set<CapabilityId> {
  if (role === undefined) return new Set()
  return new Set(config.blacklist[role])
}

/**
 * 从标识集合里取出工具名。
 *
 * 工具名与 Skill 名不共享命名空间，因此按名称判定工具可见性的每一处都必须
 * 先过掉 `skill:` 前缀；漏掉一步就会把同名 Skill 当成工具。
 *
 * @param ids - 能力标识。
 * @returns 工具名集合；非工具标识被丢弃。
 */
export function toolNames(ids: Iterable<CapabilityId>): Set<string> {
  return namesOfKind(ids, 'tool')
}

/**
 * 从标识集合里取出 Skill 名。
 *
 * 与 {@link toolNames} 对称：判定 Skill 是否可加载时不能把同名工具算进来。
 *
 * @param ids - 能力标识。
 * @returns Skill 名集合；非 Skill 标识被丢弃。
 */
export function skillNames(ids: Iterable<CapabilityId>): Set<string> {
  return namesOfKind(ids, 'skill')
}

function namesOfKind(ids: Iterable<CapabilityId>, kind: 'tool' | 'skill'): Set<string> {
  const names = new Set<string>()
  for (const id of ids) {
    const parsed = parseId(id)
    if (parsed !== undefined && parsed.kind === kind) names.add(parsed.name)
  }
  return names
}

export interface ToolUsabilityInput {
  /** 工具标识；非工具标识一律不可用。 */
  id: CapabilityId
  config: CapabilityConfig
  /** 会话角色；`undefined` 表示未知，不应用黑名单。 */
  role: SessionRoleName | undefined
  /** 本会话已召回的工具名。 */
  recalled: ReadonlySet<string>
}

/**
 * 工具此刻是否对某个会话可用（§1.4 第 1–3 步）。
 *
 * 这是 `restrict` 名单与 agent 层 shadow 工具共用的判定：agent 层注册的工具
 * 不受 `restrict` 约束，只有自己的 `when` 能落实池、黑名单与常驻资格。
 *
 * @param input - 工具标识、配置、角色与召回集合。
 * @returns 可用时为 true。
 */
export function isToolUsable(input: ToolUsabilityInput): boolean {
  const parsed = parseId(input.id)
  if (parsed === undefined || parsed.kind !== 'tool') return false
  if (!isInPool(input.id, input.config)) return false
  if (blacklistFor(input.config, input.role).has(input.id)) return false
  return residentSet(input.config).has(input.id) || input.recalled.has(parsed.name)
}
