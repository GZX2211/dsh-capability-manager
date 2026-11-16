import { describe, expect, it } from 'vitest'
import { runMetaSearch, type MetaSearchSources } from '../../../src/host/search/index.ts'
import { toolPayload } from '../../../src/host/search/payload.ts'

function schema(name: string, description = `${name} 的说明`) {
  return { name, description, parameters: { type: 'object', properties: { p: { type: 'string' } } } }
}

function sources(names: readonly string[], seen: readonly string[] = []): MetaSearchSources {
  return {
    candidates: new Map(names.map(name => [name, schema(name)])),
    seen: new Set(seen),
  }
}

describe('名称通道', () => {
  it('命中时返回完整 schema', () => {
    const outcome = runMetaSearch(sources(['read', 'write']), { names: 'read' })

    expect(outcome.tools).toEqual([schema('read')])
    expect(outcome.names).toEqual(['read'])
  })

  it('名称组一次召回多个', () => {
    const outcome = runMetaSearch(sources(['read', 'write', 'edit']), { names: 'read|write' })

    expect(outcome.names).toEqual(['read', 'write'])
  })

  it('未命中时返回空且不加说明', () => {
    const outcome = runMetaSearch(sources(['read']), { names: 'nothere' })

    expect(outcome.tools).toEqual([])
    expect(outcome.notes).toEqual([])
  })

  it('非法正则只让这条通道失效，并给出说明', () => {
    const outcome = runMetaSearch(sources(['read']), { names: '[a' })

    expect(outcome.tools).toEqual([])
    expect(outcome.notes).toHaveLength(1)
    expect(outcome.notes[0]).toContain('正则')
  })

  it('保持候选顺序', () => {
    const outcome = runMetaSearch(sources(['write', 'read', 'glob']), { names: 'read|write|glob' })

    expect(outcome.names).toEqual(['write', 'read', 'glob'])
  })
})

describe('关键词通道', () => {
  it('向量检索未开启时被忽略并给出说明', () => {
    const outcome = runMetaSearch(sources(['read']), { keywords: '读取文件' })

    expect(outcome.tools).toEqual([])
    expect(outcome.notes.some(note => note.includes('向量检索'))).toBe(true)
  })

  it('同时给出 names 时 names 通道照常工作', () => {
    const outcome = runMetaSearch(sources(['read']), { names: 'read', keywords: '读取文件' })

    expect(outcome.names).toEqual(['read'])
    expect(outcome.notes.some(note => note.includes('向量检索'))).toBe(true)
  })
})

describe('载荷级去重', () => {
  it('已出现过的工具被剔除', () => {
    const outcome = runMetaSearch(sources(['read'], [toolPayload(schema('read'))]), { names: 'read' })

    expect(outcome.tools).toEqual([])
    expect(outcome.names).toEqual([])
  })

  it('剔除后其余项照常返回', () => {
    const outcome = runMetaSearch(sources(['read', 'write'], [toolPayload(schema('read'))]), {
      names: 'read|write',
    })

    expect(outcome.names).toEqual(['write'])
  })

  it('同名但描述变化的工具算新载荷，会再次出现', () => {
    const stale = toolPayload({ ...schema('read'), description: '旧描述' })
    const outcome = runMetaSearch(sources(['read'], [stale]), { names: 'read' })

    expect(outcome.names).toEqual(['read'])
  })
})

describe('条数上限', () => {
  it('默认最多 20 条', () => {
    const names = Array.from({ length: 30 }, (_, index) => `tool${String(index).padStart(2, '0')}`)
    const outcome = runMetaSearch(sources(names), { names: 'tool' })

    expect(outcome.tools).toHaveLength(20)
  })

  it('上限是 50 条', () => {
    const names = Array.from({ length: 80 }, (_, index) => `tool${String(index).padStart(2, '0')}`)
    const outcome = runMetaSearch(sources(names), { names: 'tool', limit: 999 })

    expect(outcome.tools).toHaveLength(50)
  })

  it('请求更少条数时按请求截断', () => {
    const outcome = runMetaSearch(sources(['read', 'write', 'edit']), { names: 'read|write|edit', limit: 2 })

    expect(outcome.names).toEqual(['read', 'write'])
  })

  it('非正数与非法数字回落到默认值', () => {
    const names = Array.from({ length: 25 }, (_, index) => `tool${String(index).padStart(2, '0')}`)

    expect(runMetaSearch(sources(names), { names: 'tool', limit: 0 }).tools).toHaveLength(20)
    expect(runMetaSearch(sources(names), { names: 'tool', limit: Number.NaN }).tools).toHaveLength(20)
  })

  it('载荷与名称同步截断，长度一致', () => {
    const names = Array.from({ length: 5 }, (_, index) => `tool${String(index)}`)
    const outcome = runMetaSearch(sources(names), { names: 'tool', limit: 3 })

    expect(outcome.names).toHaveLength(3)
    expect(outcome.payloads).toHaveLength(3)
    expect(outcome.tools).toHaveLength(3)
  })
})

describe('没有检索条件', () => {
  it('什么都不给时返回空并说明没有执行召回', () => {
    const outcome = runMetaSearch(sources(['read']), {})

    expect(outcome.tools).toEqual([])
    expect(outcome.notes).toHaveLength(1)
    expect(outcome.notes[0]).toContain('names')
  })

  it('空白字符串等同于没给', () => {
    const outcome = runMetaSearch(sources(['read']), { names: '   ', keywords: '  ' })

    expect(outcome.tools).toEqual([])
    expect(outcome.notes).toHaveLength(1)
  })
})

describe('Skill 通道', () => {
  it('M1 阶段恒返回空列表', () => {
    const outcome = runMetaSearch(sources(['read']), { names: 'read' })

    expect(outcome.skills).toEqual([])
  })
})
