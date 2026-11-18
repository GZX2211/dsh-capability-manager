// tests/client/lib/capability-text.test.ts
//
// 官方能力摘要的展示本地化：只覆盖官方条目，自建与 MCP 保持用户原文。

import { describe, expect, it } from 'vitest'
import type { CapabilityEntry } from '../../../src/shared/capability.ts'
import {
  localizeCapabilities,
  OFFICIAL_SKILL_SUMMARIES,
  OFFICIAL_TOOL_SUMMARIES,
} from '../../../src/client/lib/capability-text.ts'

function entry(overrides: Partial<CapabilityEntry> & Pick<CapabilityEntry, 'id' | 'name'>): CapabilityEntry {
  return {
    id: overrides.id,
    name: overrides.name,
    kind: overrides.kind ?? 'tool',
    summary: overrides.summary ?? 'original english summary',
    source: overrides.source ?? 'official',
    owned: overrides.owned ?? false,
    available: overrides.available ?? true,
  }
}

describe('官方能力摘要本地化', () => {
  it('中文界面用中文词条替换官方工具的英文摘要', () => {
    const [localized] = localizeCapabilities([entry({ id: 'tool:edit', name: 'edit' })], 'zh')

    expect(localized?.summary).toBe(OFFICIAL_TOOL_SUMMARIES.edit?.zh)
  })

  it('中文界面同样替换官方 Skill 的摘要', () => {
    const [localized] = localizeCapabilities(
      [entry({ id: 'skill:office-docx', name: 'office-docx', kind: 'skill' })],
      'zh-CN',
    )

    expect(localized?.summary).toBe(OFFICIAL_SKILL_SUMMARIES['office-docx']?.zh)
  })

  it('英文界面保留英文原文', () => {
    const [localized] = localizeCapabilities(
      [entry({ id: 'tool:edit', name: 'edit', summary: 'Edit an existing UTF-8 text file.' })],
      'en',
    )

    expect(localized?.summary).toBe('Edit an existing UTF-8 text file.')
  })

  it('原文不是英文的条目在英文界面使用给出的英文词条', () => {
    const [localized] = localizeCapabilities(
      [entry({ id: 'tool:meta_search', name: 'meta_search', summary: '召回当前会话可用的工具与 Skill。' })],
      'en-US',
    )

    expect(localized?.summary).toBe(OFFICIAL_TOOL_SUMMARIES.meta_search?.en)
  })

  it('自建能力即使命中词条名也不覆盖', () => {
    const custom = entry({ id: 'tool:edit', name: 'edit', source: 'custom', owned: true, summary: '我的自定义说明' })

    const [localized] = localizeCapabilities([custom], 'zh')

    expect(localized?.summary).toBe('我的自定义说明')
  })

  it('MCP 能力不覆盖', () => {
    const mcp = entry({ id: 'tool:server__edit', name: 'server__edit', source: 'mcp', summary: 'MCP tool copy' })

    const [localized] = localizeCapabilities([mcp], 'zh')

    expect(localized?.summary).toBe('MCP tool copy')
  })

  it('没有收录的官方能力回退原文', () => {
    const unknown = entry({ id: 'tool:some_new_tool', name: 'some_new_tool', summary: 'A newly shipped tool.' })

    const [localized] = localizeCapabilities([unknown], 'zh')

    expect(localized?.summary).toBe('A newly shipped tool.')
  })

  it('只替换摘要，其它字段保持原样', () => {
    const original = entry({ id: 'tool:read', name: 'read', available: false })

    const [localized] = localizeCapabilities([original], 'zh')

    expect(localized).toMatchObject({
      id: 'tool:read',
      name: 'read',
      kind: 'tool',
      source: 'official',
      owned: false,
      available: false,
    })
  })

  it('未命中的条目保持原引用，避免无谓重渲染', () => {
    const original = entry({ id: 'tool:some_new_tool', name: 'some_new_tool' })

    const [localized] = localizeCapabilities([original], 'zh')

    expect(localized).toBe(original)
  })
})
