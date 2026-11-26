import { describe, expect, it } from 'vitest'
import { runMetaSearch, type MetaSearchSources } from '../../../src/host/search/index.ts'
import { skillPayload, toolPayload } from '../../../src/host/search/payload.ts'

function schema(name: string, description = `${name} 的说明`) {
  return { name, description, parameters: { type: 'object', properties: { p: { type: 'string' } } } }
}

function skillEntry(name: string, description = `${name} 的说明`) {
  return { name, description }
}

interface SourcesOptions {
  tools?: readonly string[]
  skills?: readonly string[]
  seenTools?: readonly string[]
  seenSkills?: readonly string[]
  embeddingEnabled?: boolean
  skillCatalogResident?: boolean
  keywordHits?: { tools: readonly string[]; skills: readonly string[] }
}

function sources(options: SourcesOptions = {}): MetaSearchSources {
  return {
    tools: new Map((options.tools ?? ['read', 'write']).map(name => [name, schema(name)])),
    skills: new Map((options.skills ?? []).map(name => [name, skillEntry(name)])),
    seenTools: new Set(options.seenTools ?? []),
    seenSkills: new Set(options.seenSkills ?? []),
    embeddingEnabled: options.embeddingEnabled ?? false,
    skillCatalogResident: options.skillCatalogResident ?? false,
    ...options.keywordHits === undefined ? {} : { keywordHits: options.keywordHits },
  }
}

describe('名称通道', () => {
  it('命中时返回完整 schema', () => {
    const outcome = runMetaSearch(sources(), { names: 'read' })

    expect(outcome.tools).toEqual([schema('read')])
    expect(outcome.toolNames).toEqual(['read'])
  })

  it('名称组一次召回多个', () => {
    const outcome = runMetaSearch(sources(), { names: 'read|write' })

    expect(outcome.toolNames).toEqual(['read', 'write'])
  })

  it('未命中时返回空且不加说明', () => {
    const outcome = runMetaSearch(sources(), { names: 'nothere' })

    expect(outcome.tools).toEqual([])
    expect(outcome.notes).toEqual([])
  })

  it('非法正则只让这条通道失效，并给出说明', () => {
    const outcome = runMetaSearch(sources(), { names: '[a' })

    expect(outcome.tools).toEqual([])
    expect(outcome.notes).toHaveLength(1)
    expect(outcome.notes[0]).toContain('正则')
  })

  it('保持候选顺序', () => {
    const outcome = runMetaSearch(sources({ tools: ['write', 'read', 'glob'] }), {
      names: 'read|write|glob',
    })

    expect(outcome.toolNames).toEqual(['write', 'read', 'glob'])
  })

  it('只召回工具：同名 Skill 不会被名称通道返回', () => {
    const outcome = runMetaSearch(sources({ tools: ['read'], skills: ['read'] }), { names: 'read' })

    expect(outcome.toolNames).toEqual(['read'])
    expect(outcome.skills).toEqual([])
  })

  it('名称只命中 Skill 时说明 Skill 不走名称通道', () => {
    const outcome = runMetaSearch(
      sources({ tools: [], skills: ['office-docx'], skillCatalogResident: false }),
      { names: 'office-docx' },
    )

    expect(outcome.tools).toEqual([])
    expect(outcome.skills).toEqual([])
    expect(outcome.notes.some(note => note.includes('names 通道只召回工具'))).toBe(true)
  })

  it('目录已注入时说明无需召回，直接用 skill 工具加载', () => {
    const outcome = runMetaSearch(
      sources({ tools: [], skills: ['office-docx'], skillCatalogResident: true }),
      { names: 'office-docx' },
    )

    expect(outcome.notes.some(note => note.includes('已在当前上下文中完整可见'))).toBe(true)
  })
})

describe('关键词通道', () => {
  it('向量检索未开启时被忽略并给出说明', () => {
    const outcome = runMetaSearch(sources(), { keywords: '读取文件' })

    expect(outcome.tools).toEqual([])
    expect(outcome.notes.some(note => note.includes('向量检索'))).toBe(true)
  })

  it('向量检索开启但语义通道未就绪时给出说明', () => {
    const outcome = runMetaSearch(sources({ embeddingEnabled: true }), { keywords: '读取文件' })

    expect(outcome.notes.some(note => note.includes('语义检索暂不可用'))).toBe(true)
  })

  it('语义命中同时返回工具与 Skill', () => {
    const outcome = runMetaSearch(
      sources({
        embeddingEnabled: true,
        tools: ['read'],
        skills: ['office-docx'],
        keywordHits: { tools: ['read'], skills: ['office-docx'] },
      }),
      { keywords: '读取 Word' },
    )

    expect(outcome.toolNames).toEqual(['read'])
    expect(outcome.skills).toEqual([skillEntry('office-docx')])
    expect(outcome.skillPayloads).toEqual([skillPayload(skillEntry('office-docx'))])
  })

  it('语义命中按给定顺序返回，未知名称被忽略', () => {
    const outcome = runMetaSearch(
      sources({
        embeddingEnabled: true,
        tools: ['write', 'read'],
        skills: ['alpha', 'beta'],
        keywordHits: { tools: ['read', 'missing', 'write'], skills: ['beta', 'missing', 'alpha'] },
      }),
      { keywords: '写入' },
    )

    expect(outcome.toolNames).toEqual(['read', 'write'])
    expect(outcome.skills.map(skill => skill.name)).toEqual(['beta', 'alpha'])
  })

  it('重复的语义命中只返回一次', () => {
    const outcome = runMetaSearch(
      sources({
        embeddingEnabled: true,
        tools: ['read'],
        keywordHits: { tools: ['read', 'read'], skills: [] },
      }),
      { keywords: '读取' },
    )

    expect(outcome.toolNames).toEqual(['read'])
  })

  it('名称命中排在语义命中之前，且不重复', () => {
    const outcome = runMetaSearch(
      sources({
        embeddingEnabled: true,
        tools: ['write', 'read'],
        keywordHits: { tools: ['read', 'write'], skills: [] },
      }),
      { names: 'write', keywords: '读取' },
    )

    expect(outcome.toolNames).toEqual(['write', 'read'])
  })
})

describe('载荷级去重', () => {
  it('已出现过的工具被剔除', () => {
    const outcome = runMetaSearch(sources({ seenTools: [toolPayload(schema('read'))] }), { names: 'read' })

    expect(outcome.tools).toEqual([])
    expect(outcome.toolNames).toEqual([])
  })

  it('剔除后其余项照常返回', () => {
    const outcome = runMetaSearch(
      sources({ tools: ['read', 'write'], seenTools: [toolPayload(schema('read'))] }),
      { names: 'read|write' },
    )

    expect(outcome.toolNames).toEqual(['write'])
  })

  it('同名但描述变化的工具算新载荷，会再次出现', () => {
    const stale = toolPayload({ ...schema('read'), description: '旧描述' })
    const outcome = runMetaSearch(sources({ tools: ['read'], seenTools: [stale] }), { names: 'read' })

    expect(outcome.toolNames).toEqual(['read'])
  })

  it('已出现过的 Skill 载荷被剔除', () => {
    const seen = skillPayload(skillEntry('office-docx'))
    const outcome = runMetaSearch(
      sources({
        embeddingEnabled: true,
        skills: ['office-docx'],
        seenSkills: [seen],
        keywordHits: { tools: [], skills: ['office-docx'] },
      }),
      { keywords: 'Word' },
    )

    expect(outcome.skills).toEqual([])
  })

  it('工具载荷与 Skill 载荷不互相判重', () => {
    const outcome = runMetaSearch(
      sources({
        embeddingEnabled: true,
        tools: ['office-docx'],
        skills: ['office-docx'],
        seenTools: [toolPayload(schema('office-docx'))],
        seenSkills: [skillPayload(skillEntry('office-docx'))],
        keywordHits: { tools: ['office-docx'], skills: ['office-docx'] },
      }),
      { keywords: '办公' },
    )

    expect(outcome.tools).toEqual([])
    expect(outcome.skills).toEqual([])
  })
})

describe('工具与 Skill 分池', () => {
  it('两池的语义命中互不占用额度', () => {
    const tools = Array.from({ length: 8 }, (_, index) => `tool${index}`)
    const skills = Array.from({ length: 8 }, (_, index) => `skill${index}`)
    const outcome = runMetaSearch(
      sources({
        embeddingEnabled: true,
        tools,
        skills,
        keywordHits: { tools, skills },
      }),
      { keywords: '查询' },
    )

    expect(outcome.toolNames).toHaveLength(8)
    expect(outcome.skills).toHaveLength(8)
  })

  it('载荷与名称一一对应，长度一致', () => {
    const names = Array.from({ length: 5 }, (_, index) => `tool${String(index)}`)
    const outcome = runMetaSearch(sources({ tools: names }), { names: 'tool' })

    expect(outcome.toolNames).toHaveLength(5)
    expect(outcome.toolPayloads).toHaveLength(5)
    expect(outcome.tools).toHaveLength(5)
  })
})

describe('没有检索条件', () => {
  it('什么都不给时返回空并说明没有执行召回', () => {
    const outcome = runMetaSearch(sources(), {})

    expect(outcome.tools).toEqual([])
    expect(outcome.notes).toHaveLength(1)
    expect(outcome.notes[0]).toContain('names')
  })

  it('空白字符串等同于没给', () => {
    const outcome = runMetaSearch(sources(), { names: '   ', keywords: '  ' })

    expect(outcome.tools).toEqual([])
    expect(outcome.notes).toHaveLength(1)
  })
})
