import { describe, expect, it } from 'vitest'
import {
  renderIndex,
  selectToolIndex,
  shouldInjectIndex,
} from '../../../src/host/prompt/index-section.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../../src/shared/config.ts'

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

function candidates(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries))
}

describe('注入时机', () => {
  it('模式 A 且 meta_search 常驻时注入', () => {
    expect(shouldInjectIndex(config({ resident: ['tool:meta_search'] }))).toBe(true)
  })

  it('向量检索开启后不注入：模式 B 靠语义召回，索引只占上下文', () => {
    expect(
      shouldInjectIndex(config({ resident: ['tool:meta_search'], embedding: { enabled: true } })),
    ).toBe(false)
  })

  it('meta_search 不常驻时不注入：索引在但召回不了，纯占上下文', () => {
    expect(shouldInjectIndex(config({ resident: [] }))).toBe(false)
  })

  it('meta_search 常驻但池外时不注入：它自己也用不了', () => {
    expect(shouldInjectIndex(config({ excluded: ['tool:meta_search'], resident: ['tool:meta_search'] }))).toBe(false)
  })
})

describe('索引范围', () => {
  const tools = candidates({ bash: '执行命令', glob: '找文件', meta_search: '召回', read: '读文件' })

  it('只列非常驻工具：常驻的完整 schema 已经在工具列表里', () => {
    const entries = selectToolIndex({
      tools,
      config: config({ resident: ['tool:meta_search'] }),
      role: undefined,
      appeared: new Set(),
    })

    expect(entries.map(entry => entry.name)).toEqual(['bash', 'glob', 'read'])
  })

  it('池外工具不进索引', () => {
    const entries = selectToolIndex({
      tools,
      config: config({ excluded: ['tool:bash'], resident: ['tool:meta_search'] }),
      role: undefined,
      appeared: new Set(),
    })

    expect(entries.map(entry => entry.name)).not.toContain('bash')
  })

  it('该角色黑名单里的工具不进索引', () => {
    const entries = selectToolIndex({
      tools,
      config: config({ blacklist: { router: ['tool:glob'], worker: [] }, resident: ['tool:meta_search'] }),
      role: 'router',
      appeared: new Set(),
    })

    expect(entries.map(entry => entry.name)).not.toContain('glob')
  })

  it('角色未知时不应用黑名单', () => {
    const entries = selectToolIndex({
      tools,
      config: config({ blacklist: { router: ['tool:glob'], worker: [] }, resident: ['tool:meta_search'] }),
      role: undefined,
      appeared: new Set(),
    })

    expect(entries.map(entry => entry.name)).toContain('glob')
  })

  it('已经以完整 schema 出现过的工具不进索引：模型已经看得到它', () => {
    const entries = selectToolIndex({
      tools,
      config: config({ resident: ['tool:meta_search'] }),
      role: undefined,
      appeared: new Set(['glob']),
    })

    expect(entries.map(entry => entry.name)).not.toContain('glob')
  })

  it('按名称排序', () => {
    const entries = selectToolIndex({
      tools: candidates({ write: 'w', bash: 'b', read: 'r' }),
      config: config({ resident: [] }),
      role: undefined,
      appeared: new Set(),
    })

    expect(entries.map(entry => entry.name)).toEqual(['bash', 'read', 'write'])
  })

  it('什么都不剩时是空数组', () => {
    const entries = selectToolIndex({
      tools: candidates({ meta_search: '召回' }),
      config: config({ resident: ['tool:meta_search'] }),
      role: undefined,
      appeared: new Set(),
    })

    expect(entries).toEqual([])
  })

  it('没有候选时是空数组', () => {
    expect(
      selectToolIndex({ tools: new Map(), config: config({ resident: [] }), role: undefined, appeared: new Set() }),
    ).toEqual([])
  })
})

describe('索引渲染', () => {
  it('只有工具时省略 Skill 段', () => {
    const text = renderIndex({ tools: [{ name: 'bash', summary: '执行命令' }], skills: [] })

    expect(text).toContain('<available_tools>')
    expect(text).toContain('- `bash`：执行命令')
    expect(text).not.toContain('<available_skills>')
  })

  it('两段都有时都渲染', () => {
    const text = renderIndex({
      tools: [{ name: 'bash', summary: '执行命令' }],
      skills: [{ name: 'office', summary: '办公文档' }],
    })

    expect(text).toContain('<available_tools>')
    expect(text).toContain('<available_skills>')
    expect(text).toContain('- `office`：办公文档')
  })

  it('两段都为空时不产生任何内容', () => {
    expect(renderIndex({ tools: [], skills: [] })).toBe('')
  })

  it('说明索引不含调用参数，并指出用 meta_search 取', () => {
    const text = renderIndex({ tools: [{ name: 'bash', summary: '执行命令' }], skills: [] })

    expect(text).toContain('不含调用参数')
    expect(text).toContain('meta_search')
    expect(text).toContain('system-reminder')
  })

  it('摘要为空时仍给出可读的一行', () => {
    const text = renderIndex({ tools: [{ name: 'mystery', summary: '' }], skills: [] })

    expect(text).toContain('- `mystery`')
  })

  it('只有 Skill 时省略工具段', () => {
    const text = renderIndex({ tools: [], skills: [{ name: 'office', summary: '办公文档' }] })

    expect(text).toContain('<available_skills>')
    expect(text).not.toContain('<available_tools>')
  })

  it('整个提示块被 system-reminder 完整包裹', () => {
    const lines = renderIndex({ tools: [{ name: 'bash', summary: '执行命令' }], skills: [] }).split('\n')

    expect(lines[0]).toBe('<system-reminder>')
    expect(lines.at(-1)).toBe('</system-reminder>')
  })
})
