// src/host/catalog/candidates.ts
//
// 可召回工具的候选集：池内、该角色未被禁止、且此刻确实存在。
//
// 与「可见集」的区别：可见集还要限制在常驻与已召回之内，候选集则是全部
// 允许被召回的东西——`meta_search` 要能把尚未召回的工具交出来。

import type { CapabilityConfig, SessionRoleName } from '../../shared/config.ts'
import type { ToolPayloadSource } from '../search/payload.ts'
import { blacklistFor, toolNames } from '../policy/pool.ts'

export interface ToolCandidateInput {
  /** 已知的工具 schema；按名称索引。 */
  schemas: ReadonlyMap<string, ToolPayloadSource>
  /** 该 agent 此刻存在的工具名。 */
  present: ReadonlySet<string>
  config: CapabilityConfig
  role: SessionRoleName | undefined
}

/**
 * 选出可召回的工具。
 *
 * @param input - schema 缓存、存在集合、配置与角色。
 * @returns 名称 → schema；顺序按名称排序，便于复用与稳定输出。
 */
export function buildToolCandidates(input: ToolCandidateInput): ReadonlyMap<string, ToolPayloadSource> {
  const excluded = toolNames(input.config.excluded)
  const blacklisted = toolNames(blacklistFor(input.config, input.role))

  const candidates = new Map<string, ToolPayloadSource>()
  for (const [name, schema] of input.schemas) {
    if (!input.present.has(name)) continue
    if (excluded.has(name)) continue
    if (blacklisted.has(name)) continue
    candidates.set(name, schema)
  }
  return new Map([...candidates].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
