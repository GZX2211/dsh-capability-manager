import { describe, expect, it, vi } from 'vitest'
import {
  createMetaSearchTool,
  parseMetaSearchArgs,
  renderMetaSearch,
  type MetaSearchDependencies,
  type MetaSearchRecord,
} from '../../../src/host/tools/meta_search/index.ts'
import { skillPayload } from '../../../src/host/search/payload.ts'
import type { MetaSearchSources } from '../../../src/host/search/index.ts'

const readSchema = {
  name: 'read',
  description: '读取文本文件',
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
}

const officeSkill = { name: 'office-docx', description: '创建与编辑 Word 文档' }

function sources(patch: Partial<MetaSearchSources> = {}): MetaSearchSources {
  return {
    tools: new Map([['read', readSchema]]),
    skills: new Map([[officeSkill.name, officeSkill]]),
    seenTools: new Set(),
    seenSkills: new Set(),
    embeddingEnabled: false,
    skillCatalogResident: false,
    ...patch,
  }
}

function dependencies(overrides: Partial<MetaSearchDependencies> = {}): MetaSearchDependencies {
  return {
    sources: async () => sources(),
    record: () => {},
    ...overrides,
  }
}

/** 最小执行上下文：工具只会用到 agent.session。 */
function exec(agent: unknown): { agent: unknown; signal: AbortSignal } {
  return { agent, signal: new AbortController().signal }
}

function fakeAgent(id: string) {
  return { id, session: { id, toolHistory: () => ({ tools: [], updates: [] }) } }
}

describe('参数校验', () => {
  it('接受空对象', () => {
    expect(parseMetaSearchArgs({})).toEqual({})
  })

  it('接受三个字段的合法组合', () => {
    expect(parseMetaSearchArgs({ names: 'read', keywords: '读取', limit: 5 })).toEqual({
      names: 'read',
      keywords: '读取',
      limit: 5,
    })
  })

  it('非对象参数给出可行动的错误', () => {
    expect(() => parseMetaSearchArgs('read')).toThrow(/对象/)
    expect(() => parseMetaSearchArgs(null)).toThrow(/对象/)
    expect(() => parseMetaSearchArgs([])).toThrow(/对象/)
  })

  it('names 必须是字符串', () => {
    expect(() => parseMetaSearchArgs({ names: 1 })).toThrow(/names/)
  })

  it('keywords 必须是字符串', () => {
    expect(() => parseMetaSearchArgs({ keywords: true })).toThrow(/keywords/)
  })

  it('limit 必须是数字', () => {
    expect(() => parseMetaSearchArgs({ limit: '5' })).toThrow(/limit/)
  })

  it('limit 非有限数时拒绝', () => {
    expect(() => parseMetaSearchArgs({ limit: Number.NaN })).toThrow(/limit/)
    expect(() => parseMetaSearchArgs({ limit: Number.POSITIVE_INFINITY })).toThrow(/limit/)
  })

  it('忽略不认识的字段', () => {
    expect(parseMetaSearchArgs({ names: 'read', unexpected: true })).toEqual({ names: 'read' })
  })
})

describe('执行', () => {
  it('没有 agent 时拒绝执行', async () => {
    const tool = createMetaSearchTool(dependencies())

    await expect(tool.execute({ names: 'read' }, exec(undefined) as never)).rejects.toThrow(/会话/)
  })

  it('命中时返回完整 schema', async () => {
    const tool = createMetaSearchTool(dependencies())

    const value = (await tool.execute({ names: 'read' }, exec(fakeAgent('s1')) as never)) as {
      tools: unknown[]
      skills: unknown[]
      notes: string[]
    }

    expect(value.tools).toEqual([readSchema])
    expect(value.skills).toEqual([])
  })

  it('语义通道返回 Skill 索引条目', async () => {
    const tool = createMetaSearchTool(
      dependencies({
        sources: async () =>
          sources({
            embeddingEnabled: true,
            keywordHits: { tools: [], skills: [officeSkill.name] },
          }),
      }),
    )

    const value = (await tool.execute({ keywords: 'Word' }, exec(fakeAgent('s1')) as never)) as {
      tools: unknown[]
      skills: unknown[]
    }

    expect(value.tools).toEqual([])
    expect(value.skills).toEqual([officeSkill])
  })

  it('有结果时记录召回', async () => {
    const record = vi.fn()
    const tool = createMetaSearchTool(dependencies({ record }))

    await tool.execute({ names: 'read' }, exec(fakeAgent('s1')) as never)

    expect(record).toHaveBeenCalledTimes(1)
    const [sessionId, outcome] = record.mock.calls[0] as [string, MetaSearchRecord]
    expect(sessionId).toBe('s1')
    expect(outcome.toolNames).toEqual(['read'])
    expect(outcome.toolPayloads).toHaveLength(1)
    expect(outcome.skillPayloads).toEqual([])
  })

  it('只返回 Skill 时也记录 Skill 载荷', async () => {
    const record = vi.fn()
    const tool = createMetaSearchTool(
      dependencies({
        record,
        sources: async () =>
          sources({
            embeddingEnabled: true,
            keywordHits: { tools: [], skills: [officeSkill.name] },
          }),
      }),
    )

    await tool.execute({ keywords: 'Word' }, exec(fakeAgent('s1')) as never)

    const [, outcome] = record.mock.calls[0] as [string, MetaSearchRecord]
    expect(outcome.toolNames).toEqual([])
    expect(outcome.skillPayloads).toEqual([skillPayload(officeSkill)])
  })

  it('没有结果时不记录', async () => {
    const record = vi.fn()
    const tool = createMetaSearchTool(dependencies({ record }))

    await tool.execute({ names: 'nothing' }, exec(fakeAgent('s1')) as never)

    expect(record).not.toHaveBeenCalled()
  })

  it('上下文里只剩常驻工具时，被收走的工具仍能被召回', async () => {
    // 事故回归：去重基准若用「会话历史里出现过的工具」，这里 pwsh 会被判成
    // 已经在上下文里而剔除——会话的工具已被收走，却永远召不回来。
    const tool = createMetaSearchTool(
      dependencies({
        sources: async () =>
          sources({
            tools: new Map([['pwsh', readSchema]]),
            // 当前可见的只有常驻的 meta_search 自己。
            seenTools: new Set(['{"name":"meta_search","description":"召回","parameters":{}}']),
          }),
      }),
    )

    const value = (await tool.execute({ names: 'pwsh' }, exec(fakeAgent('s1')) as never)) as {
      tools: unknown[]
    }

    expect(value.tools).toEqual([readSchema])
  })
})

describe('渲染', () => {
  it('工具段给出名称、说明与参数 schema', () => {
    const blocks = renderMetaSearch(undefined, { tools: [readSchema], skills: [], notes: [] })
    const text = blocks.map(block => block.text).join('\n')

    expect(text).toContain('### read')
    expect(text).toContain('读取文本文件')
    expect(text).toContain('"path"')
    expect(text).toContain('下一步')
  })

  it('Skill 段给出索引条目并指向 skill 工具', () => {
    const blocks = renderMetaSearch(undefined, { tools: [], skills: [officeSkill], notes: [] })
    const text = blocks.map(block => block.text).join('\n')

    expect(text).toContain('Skill 索引')
    expect(text).toContain('- `office-docx`：创建与编辑 Word 文档')
    expect(text).toContain('skill')
  })

  it('没有结果时说明可能的原因', () => {
    const blocks = renderMetaSearch(undefined, { tools: [], skills: [], notes: [] })
    const text = blocks.map(block => block.text).join('\n')

    expect(text).toContain('没有新的能力')
  })

  it('说明以引用块呈现', () => {
    const blocks = renderMetaSearch(undefined, { tools: [], skills: [], notes: ['向量检索未开启'] })
    const text = blocks.map(block => block.text).join('\n')

    expect(text).toContain('> 向量检索未开启')
  })

  it('只有说明、没有工具时也给出无结果的解释', () => {
    const blocks = renderMetaSearch(undefined, { tools: [], skills: [], notes: ['names 非法'] })
    const text = blocks.map(block => block.text).join('\n')

    expect(text).toContain('没有新的能力')
    expect(text).toContain('names 非法')
  })
})
