// src/host/prompt/index-section.ts
//
// 模式 A 的索引注入：把「有这个名字、大概干什么」告诉模型，但不给调用参数。
//
// 两侧范围刻意不对称（§6.6）：
//   · 工具索引只列**非常驻**——常驻工具的完整 schema 已经在 API tools 里
//   · Skill 索引列**全部**池内项——Skill 没有别的可见通道，不给名字就无从召回
//
// M1 只实现工具侧；Skill 侧的数据通道在 M2 接入，渲染与范围判定已经就位。

import type { CapabilityConfig, SessionRoleName } from '../../shared/config.ts'
import { META_SEARCH_TOOL_ID } from '../../shared/config.ts'
import { blacklistFor, toolNames } from '../policy/pool.ts'

/** 索引里的一行。 */
export interface IndexEntry {
  name: string
  summary: string
}

export interface SelectToolIndexInput {
  /** 候选工具：名称 → 摘要。调用方只给当前确实存在的那些。 */
  tools: ReadonlyMap<string, string>
  config: CapabilityConfig
  role: SessionRoleName | undefined
  /** 本会话已经以完整 schema 出现过的工具名。 */
  appeared: ReadonlySet<string>
}

/**
 * 判定是否注入索引。
 *
 * 两个条件缺一不可：索引的价值是「让模型知道有这个名字，然后去召回」，
 * 所以既不能在模式 B 下注入（那时靠语义召回，索引纯占上下文），
 * 也不能在 `meta_search` 不可用时注入（那时有名字也召不回来）。
 *
 * @param config - 当前配置。
 * @returns 需要注入时为 true。
 */
export function shouldInjectIndex(config: CapabilityConfig): boolean {
  // 向量检索开启即模式 B：不注入索引。
  if (config.embedding.enabled) return false
  // meta_search 必须既在池内又在常驻里，否则它自己都不可用。
  if (!config.resident.includes(META_SEARCH_TOOL_ID)) return false
  return !config.excluded.includes(META_SEARCH_TOOL_ID)
}

/**
 * 选出要进工具索引的项。
 *
 * @param input - 候选、配置、角色与会话已出现的工具名。
 * @returns 排好序的索引项；可能是空数组。
 */
export function selectToolIndex(input: SelectToolIndexInput): IndexEntry[] {
  const resident = toolNames(input.config.resident)
  const excluded = toolNames(input.config.excluded)
  const blacklisted = toolNames(blacklistFor(input.config, input.role))

  const entries: IndexEntry[] = []
  for (const [name, summary] of input.tools) {
    if (resident.has(name)) continue
    if (excluded.has(name)) continue
    if (blacklisted.has(name)) continue
    if (input.appeared.has(name)) continue
    entries.push({ name, summary })
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * 渲染索引段。
 *
 * @param input - 工具与 Skill 的索引项。
 * @returns 提示块；两段都为空时返回空串，不产生任何 token。
 */
export function renderIndex(input: { tools: readonly IndexEntry[]; skills: readonly IndexEntry[] }): string {
  if (input.tools.length === 0 && input.skills.length === 0) return ''

  const lines = ['<system-reminder>', '以下清单只列出名称与用途摘要，不含调用参数。']
  if (input.tools.length > 0) {
    lines.push('', '<available_tools>')
    for (const tool of input.tools) lines.push(renderEntry(tool))
    lines.push('</available_tools>', '要使用上述工具，调用 meta_search。')
  }
  if (input.skills.length > 0) {
    lines.push('', '<available_skills>')
    for (const skill of input.skills) lines.push(renderEntry(skill))
    lines.push('</available_skills>', 'Skill 的正文用 skill 工具按名称加载。')
  }
  lines.push('</system-reminder>')
  return lines.join('\n')
}

/** 摘要缺失时只写名称：冒号和空白会让人以为漏了内容。 */
function renderEntry(entry: IndexEntry): string {
  return entry.summary.length > 0 ? `- \`${entry.name}\`：${entry.summary}` : `- \`${entry.name}\``
}
