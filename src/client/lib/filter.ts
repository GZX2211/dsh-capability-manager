// src/client/lib/filter.ts
//
// 列表筛选：类型分组、来源筛选、搜索词匹配。全部是纯函数，输入即全部事实。
//
// 搜索对名称与摘要做大小写不敏感的子串匹配，输入即筛、不需要回车；
// 这里不做模糊匹配与排序打分——列表本身是按名称排好的，换顺序反而找不到。

import type { CapabilityEntry, CapabilityKind, CapabilitySource } from '../../shared/capability.ts'

/** `all` 表示不按来源筛选。 */
export type SourceFilterValue = 'all' | CapabilitySource

const TOOL_SOURCES: readonly SourceFilterValue[] = ['all', 'official', 'custom', 'mcp']
const SKILL_SOURCES: readonly SourceFilterValue[] = ['all', 'official', 'custom']

/**
 * 某个类型页面上出现的来源筛选。
 *
 * Skill 页没有 MCP：MCP 服务器只提供工具，给一个恒空的筛选只会让人以为加载失败。
 *
 * @param kind - 当前页面的能力类型。
 * @returns 该页面可选的来源筛选，顺序即界面顺序。
 */
export function availableSources(kind: CapabilityKind): readonly SourceFilterValue[] {
  return kind === 'skill' ? SKILL_SOURCES : TOOL_SOURCES
}

export interface FilterInput {
  capabilities: readonly CapabilityEntry[]
  kind: CapabilityKind
  source: SourceFilterValue
  query: string
}

/**
 * 按类型、来源与搜索词筛选能力。
 *
 * @param input - 全量能力、当前页面类型、来源筛选与搜索词。
 * @returns 按名称排序的结果；可能为空数组。
 */
export function filterCapabilities(input: FilterInput): CapabilityEntry[] {
  const query = input.query.trim().toLowerCase()
  return input.capabilities
    .filter(entry => entry.kind === input.kind)
    .filter(entry => input.source === 'all' || entry.source === input.source)
    .filter(
      entry =>
        query.length === 0 ||
        entry.name.toLowerCase().includes(query) ||
        entry.summary.toLowerCase().includes(query),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** 来源筛选的展示文案键。 */
export const SOURCE_FILTER_LABELS = {
  all: 'filterAll',
  official: 'filterOfficial',
  custom: 'filterCustom',
  mcp: 'filterMcp',
} as const
