import { describe, expect, it } from 'vitest'
import { classifySource } from '../../../src/host/catalog/source.ts'

describe('能力来源判定', () => {
  it('既不是自建也不属于任何 MCP 服务器时算官方', () => {
    expect(classifySource('read', { owned: new Set(), mcpServers: [] })).toBe('official')
  })

  it('本插件自建的工具算自建', () => {
    expect(classifySource('my_tool', { owned: new Set(['my_tool']), mcpServers: [] })).toBe('custom')
  })

  it('MCP 服务器命名空间下的工具算 MCP', () => {
    expect(classifySource('github__search', { owned: new Set(), mcpServers: ['github'] })).toBe('mcp')
  })

  it('多个 MCP 服务器按各自前缀判定', () => {
    const context = { owned: new Set<string>(), mcpServers: ['github', 'filesystem'] }

    expect(classifySource('filesystem__read', context)).toBe('mcp')
    expect(classifySource('github__issue', context)).toBe('mcp')
  })

  it('名字只是含服务器名但不在其命名空间下，仍算官方', () => {
    const context = { owned: new Set<string>(), mcpServers: ['github'] }

    expect(classifySource('github_search', context)).toBe('official')
    expect(classifySource('mygithub__search', context)).toBe('official')
  })

  it('服务器名前缀必须完整匹配，避免 github 吃掉 github_enterprise', () => {
    const context = { owned: new Set<string>(), mcpServers: ['github'] }

    expect(classifySource('github_enterprise__search', context)).toBe('official')
  })

  it('自建优先于 MCP：同名空间冲突时以自建为准', () => {
    const context = { owned: new Set(['github__search']), mcpServers: ['github'] }

    expect(classifySource('github__search', context)).toBe('custom')
  })

  it('空的服务器名不构成命名空间，不会吃掉所有双下划线开头的工具', () => {
    const context = { owned: new Set<string>(), mcpServers: [''] }

    expect(classifySource('__weird', context)).toBe('official')
  })

  it('官方公开名（mcp__<server>__<tool>）算 MCP', () => {
    const context = { owned: new Set<string>(), mcpServers: ['playwright'] }

    expect(classifySource('mcp__playwright__browser_click', context)).toBe('mcp')
  })

  it('官方前缀仍要求服务器名完整匹配', () => {
    const context = { owned: new Set<string>(), mcpServers: ['playwright'] }

    expect(classifySource('mcp__playwright_extra__browser_click', context)).toBe('official')
    expect(classifySource('mcp__other__browser_click', context)).toBe('official')
  })

  it('官方前缀下自建仍然优先', () => {
    const context = { owned: new Set(['mcp__playwright__browser_click']), mcpServers: ['playwright'] }

    expect(classifySource('mcp__playwright__browser_click', context)).toBe('custom')
  })
})
