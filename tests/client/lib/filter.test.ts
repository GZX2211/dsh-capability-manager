import { describe, expect, it } from 'vitest'
import { availableSources, filterCapabilities } from '../../../src/client/lib/filter.ts'
import type { CapabilityEntry, CapabilitySource } from '../../../src/shared/capability.ts'

function entry(
  name: string,
  kind: 'tool' | 'skill' = 'tool',
  source: CapabilitySource = 'official',
  summary = '',
): CapabilityEntry {
  return { id: `${kind}:${name}`, kind, name, summary, source, owned: source === 'custom', available: true }
}

const CAPABILITIES = [
  entry('bash', 'tool', 'official', '在 shell 中执行命令'),
  entry('read', 'tool', 'official', '读取文本文件'),
  entry('my_tool', 'tool', 'custom', '我的工具'),
  entry('github__search', 'tool', 'mcp', '搜索仓库'),
  entry('office', 'skill', 'official', '办公文档'),
]

describe('来源筛选', () => {
  it('工具页有全部四种筛选', () => {
    expect(availableSources('tool')).toEqual(['all', 'official', 'custom', 'mcp'])
  })

  it('Skill 页没有 MCP：MCP 只提供工具', () => {
    expect(availableSources('skill')).toEqual(['all', 'official', 'custom'])
  })
})

describe('能力筛选', () => {
  it('按类型分组：工具与 Skill 不会混在一起', () => {
    const tools = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'all', query: '' })
    const skills = filterCapabilities({ capabilities: CAPABILITIES, kind: 'skill', source: 'all', query: '' })

    expect(tools.map(item => item.name)).toEqual(['bash', 'github__search', 'my_tool', 'read'])
    expect(skills.map(item => item.name)).toEqual(['office'])
  })

  it('按来源筛选', () => {
    const official = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'official', query: '' })

    expect(official.map(item => item.name)).toEqual(['bash', 'read'])
  })

  it('MCP 来源只给出 MCP 工具', () => {
    const mcp = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'mcp', query: '' })

    expect(mcp.map(item => item.name)).toEqual(['github__search'])
  })

  it('结果按名称排序', () => {
    const custom = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'custom', query: '' })

    expect(custom.map(item => item.name)).toEqual(['my_tool'])
  })

  it('空查询返回该类型全部', () => {
    expect(filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'all', query: '' })).toHaveLength(4)
  })

  it('查询匹配名称', () => {
    const result = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'all', query: 'rea' })

    expect(result.map(item => item.name)).toEqual(['read'])
  })

  it('查询匹配摘要', () => {
    const result = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'all', query: '文本' })

    expect(result.map(item => item.name)).toEqual(['read'])
  })

  it('查询大小写不敏感', () => {
    const result = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'all', query: 'BASH' })

    expect(result.map(item => item.name)).toEqual(['bash'])
  })

  it('查询两端的空白被忽略', () => {
    const result = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'all', query: '  read  ' })

    expect(result.map(item => item.name)).toEqual(['read'])
  })

  it('纯空白查询等同于空查询', () => {
    expect(filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'all', query: '   ' })).toHaveLength(4)
  })

  it('没有命中时是空数组', () => {
    expect(filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'all', query: 'zzz' })).toEqual([])
  })

  it('来源与查询同时生效', () => {
    const result = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'official', query: 'read' })

    expect(result.map(item => item.name)).toEqual(['read'])
  })

  it('来源与查询互斥时返回空', () => {
    const result = filterCapabilities({ capabilities: CAPABILITIES, kind: 'tool', source: 'mcp', query: 'bash' })

    expect(result).toEqual([])
  })
})
