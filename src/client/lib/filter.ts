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
 * 搜索词是否命中能力。
 *
 * 对名称与摘要做大小写不敏感的子串匹配；首尾空白被忽略，空查询命中一切。
 * 黑名单列表与穿梭框共用同一条匹配规则，避免两个搜索框对同一份数据给出不同结果。
 *
 * @param entry - 能力条目。
 * @param query - 用户输入的搜索词。
 * @returns 命中时为 true。
 */
export function matchesQuery(entry: Pick<CapabilityEntry, 'name' | 'summary'>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return entry.name.toLowerCase().includes(needle) || entry.summary.toLowerCase().includes(needle)
}

/**
 * 按类型、来源与搜索词筛选能力。
 *
 * @param input - 全量能力、当前页面类型、来源筛选与搜索词。
 * @returns 按名称排序的结果；可能为空数组。
 */
export function filterCapabilities(input: FilterInput): CapabilityEntry[] {
  return input.capabilities
    .filter(entry => entry.kind === input.kind)
    .filter(entry => input.source === 'all' || entry.source === input.source)
    .filter(entry => matchesQuery(entry, input.query))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** 来源筛选的展示文案键。 */
export const SOURCE_FILTER_LABELS = {
  all: 'filterAll',
  official: 'filterOfficial',
  custom: 'filterCustom',
  mcp: 'filterMcp',
} as const
