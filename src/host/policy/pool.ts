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
  const names = new Set<string>()
  for (const id of ids) {
    const parsed = parseId(id)
    if (parsed !== undefined && parsed.kind === 'tool') names.add(parsed.name)
  }
  return names
}
