// src/host/policy/visible.ts
//
// 单个 agent 的工具可见集计算：§1.5 的公式，唯一的实现处。
//
// 这里是整个插件最容易出事的一步——结果会直接喂给 tools.restrict()。
// 所以它严格只返回「确认存在 且 确认允许」的名字。

import type { CapabilityConfig, SessionRoleName } from '../../shared/config.ts'
import { blacklistFor, residentSet, toolNames } from './pool.ts'

export interface ComputeAllowInput {
  config: CapabilityConfig
  /** 会话角色；`undefined` 表示未知，不应用黑名单。 */
  role: SessionRoleName | undefined
  /**
   * 本部署中出现过的全部工具名。
   *
   * 不能用 `tools.definitions(agent)` 代替：那返回的是**已应用 restriction** 的可见集，
   * 一旦把非常驻工具掩掉就再也读不到它们。
   */
  universe: ReadonlySet<string>
  /**
   * 该 agent 此刻确实存在的工具名。
   *
   * `universe` 只增不减，必然包含已经消失的名字；而 `restrict` 命中未知名字会抛错。
   * 交集是「不抛错」这一硬性要求的来源。
   */
  present: ReadonlySet<string>
  /** 本会话历史上召回过的工具名。 */
  recalled: ReadonlySet<string>
}

/**
 * 计算一个 agent 的 `restrict({ allow })` 名单。
 *
 * ```
 * allow = universe ∩ present ∩ (常驻 ∪ 召回) ∩ (universe − 池外) − 该角色黑名单
 * ```
 *
 * 交集顺序不影响结果，但每一项都在防一类具体的错误：`universe` 防虚构、
 * `present` 防 `restrict` 抛错、`常驻 ∪ 召回` 是业务语义、`− 池外` 与 `− 黑名单` 是优先级。
 *
 * @param input - 配置、角色与三个名字集合。
 * @returns 排好序、去重的工具名数组；可能为空数组（调用方负责不应用空名单）。
 */
export function computeAllow(input: ComputeAllowInput): string[] {
  const resident = toolNames(residentSet(input.config))
  const excluded = toolNames(input.config.excluded)
  const blacklisted = toolNames(blacklistFor(input.config, input.role))

  const allow: string[] = []
  for (const name of input.present) {
    if (!input.universe.has(name)) continue
    if (excluded.has(name)) continue
    if (blacklisted.has(name)) continue
    if (!resident.has(name) && !input.recalled.has(name)) continue
    allow.push(name)
  }
  // 稳定顺序让「名单没变」可以直接按字符串比较，短路逻辑依赖这一点。
  return allow.sort(compareNames)
}

/** 与官方 prompt 排序一致：按码元比较，跨机器结果相同。 */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
