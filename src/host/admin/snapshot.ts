// src/host/admin/snapshot.ts
//
// 快照组装：把当前事实收成一份界面可直接渲染的响应。
//
// 风险提示在这里算，而不是让界面自己推断：同一套判定如果两端各写一遍，
// 迟早会出现「界面提示了但实际没生效」这类不一致。

import type { CapabilityEntry } from '../../shared/capability.ts'
import { META_SEARCH_TOOL_ID, SKILL_TOOL_ID, type CapabilityConfig } from '../../shared/config.ts'
import type { EmbeddingStatus, SnapshotResponse, SnapshotWarning } from '../../shared/api.ts'

/**
 * 计算界面必须显示的风险提示。
 *
 * 每条提示都对应一种「用户可能没意识到自己关掉了什么」的情形；
 * 没有命中的场景不出现提示，避免把提示栏变成噪音。
 *
 * @param config - 当前配置。
 * @param capabilities - 全量能力目录。
 * @returns 命中的提示；默认形态下为空数组。
 */
export function computeWarnings(
  config: CapabilityConfig,
  capabilities: readonly CapabilityEntry[],
): SnapshotWarning[] {
  const warnings: SnapshotWarning[] = []
  const resident = new Set(config.resident)
  const pool = capabilities.filter(entry => !config.excluded.includes(entry.id))

  if (config.excluded.includes(META_SEARCH_TOOL_ID)) {
    warnings.push({ code: 'meta-search-excluded', capabilityIds: [META_SEARCH_TOOL_ID] })
  }

  if (config.excluded.includes(SKILL_TOOL_ID)) {
    warnings.push({ code: 'skill-excluded', capabilityIds: [SKILL_TOOL_ID] })
  }

  if (config.resident.length === 0) warnings.push({ code: 'resident-empty' })

  // `meta_search` 本身不常驻时，池里那些非常驻能力就没人能召回了。
  // 判断「有没有会被漏掉的能力」要排除 meta_search 自己——它不是被召回的对象。
  if (!config.excluded.includes(META_SEARCH_TOOL_ID) && !resident.has(META_SEARCH_TOOL_ID)) {
    const unreachable = pool.filter(entry => entry.id !== META_SEARCH_TOOL_ID && !resident.has(entry.id))
    if (unreachable.length > 0) {
      warnings.push({ code: 'meta-search-not-resident', capabilityIds: unreachable.map(entry => entry.id) })
    }
  }

  for (const role of ['router', 'worker'] as const) {
    const blacklisted = new Set(config.blacklist[role])
    const hit = pool.filter(entry => resident.has(entry.id) && blacklisted.has(entry.id))
    if (hit.length > 0) {
      warnings.push({
        code: 'blacklist-excludes-resident',
        capabilityIds: hit.map(entry => entry.id),
        roles: [role],
      })
    }
  }

  return warnings
}

export interface SnapshotInput {
  revision: number
  capabilities: readonly CapabilityEntry[]
  config: CapabilityConfig
  rolesAvailable: boolean
  /** 活跃会话的角色判定；读不到活跃会话时缺省。 */
  sessions?: SnapshotResponse['sessions']
  embedding: EmbeddingStatus
  diagnostics?: SnapshotResponse['diagnostics']
}

/**
 * 组装一份快照；提示由配置与目录推导，不由调用方传入。
 *
 * @param input - 当前事实。
 * @returns 界面可直接渲染的响应。
 */
export function buildSnapshot(input: SnapshotInput): SnapshotResponse {
  return {
    revision: input.revision,
    capabilities: [...input.capabilities],
    config: input.config,
    rolesAvailable: input.rolesAvailable,
    ...input.sessions === undefined ? {} : { sessions: [...input.sessions] },
    embedding: input.embedding,
    warnings: computeWarnings(input.config, input.capabilities),
    ...input.diagnostics === undefined ? {} : { diagnostics: input.diagnostics },
  }
}
