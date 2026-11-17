import { describe, expect, it } from 'vitest'
import {
  catalogDigest,
  catalogEntries,
  CATALOG_SOURCE_KIND,
  findPublishedCatalog,
  hasCatalogHistory,
  readCatalogEntries,
  renderCatalog,
  type CatalogEntry,
} from '../../../src/host/skill-consumer/catalog.ts'
import type { SkillSource } from '../../../src/host/catalog/skills.ts'

function skill(name: string, description = `${name} 的说明`, modelInvocable = true): SkillSource {
  return { name, description, invocation: { modelInvocable } }
}

function entry(name: string, description = `${name} 的说明`): CatalogEntry {
  return { name, description }
}

describe('目录条目', () => {
  it('只保留 modelInvocable 的 Skill，并按名称排序', () => {
    const entries = catalogEntries([skill('write'), skill('beta', '说明', false), skill('alpha')])

    expect(entries.map(item => item.name)).toEqual(['alpha', 'write'])
  })

  it('描述与目录行共用同一份归一结果', () => {
    expect(catalogEntries([skill('alpha', '第一行\n第二行')])[0]?.description).toBe('第一行')
  })

  it('同名条目去重，先出现的获胜', () => {
    const entries = catalogEntries([skill('alpha', '旧'), skill('alpha', '新')])

    expect(entries).toEqual([entry('alpha', '旧')])
  })

  it('没有 Skill 时是空数组', () => {
    expect(catalogEntries([])).toEqual([])
  })
})

describe('目录 digest', () => {
  it('同一组条目稳定', () => {
    expect(catalogDigest([entry('a'), entry('b')])).toBe(catalogDigest([entry('a'), entry('b')]))
  })

  it('条目顺序不影响 digest：目录语义是集合', () => {
    expect(catalogDigest([entry('b'), entry('a')])).toBe(catalogDigest([entry('a'), entry('b')]))
  })

  it('描述变化会改变 digest，触发替换', () => {
    expect(catalogDigest([entry('a', '旧')])).not.toBe(catalogDigest([entry('a', '新')]))
  })

  it('条目增删会改变 digest', () => {
    expect(catalogDigest([entry('a')])).not.toBe(catalogDigest([entry('a'), entry('b')]))
  })

  it('空目录也有稳定的 digest', () => {
    expect(catalogDigest([])).toBe(catalogDigest([]))
  })
})

describe('目录渲染', () => {
  it('首版包含 available_skills、条目行与加载指引', () => {
    const text = renderCatalog([entry('alpha', '第一行'), entry('beta')], 'initial')

    expect(text).toContain('<system-reminder>')
    expect(text).toContain('<available_skills>')
    expect(text).toContain('- `alpha`：第一行')
    expect(text).toContain('- `beta`：beta 的说明')
    expect(text).toContain('skill')
    expect(text).toContain('不要按摘要推断')
    expect(text.endsWith('</system-reminder>')).toBe(true)
  })

  it('替换版明确声明替换此前每一次清单', () => {
    const text = renderCatalog([entry('alpha')], 'update')

    expect(text).toContain('替换')
    expect(text).toContain('之前的')
    expect(text).toContain('- `alpha`：alpha 的说明')
  })

  it('空目录明确退役旧名称', () => {
    for (const mode of ['initial', 'update'] as const) {
      const text = renderCatalog([], mode)

      expect(text).toContain('没有可用')
      expect(text).toContain('更早')
      expect(text).not.toContain('- `')
    }
  })

  it('描述里的标记字符被转义，不能提前闭合框架', () => {
    const text = renderCatalog([entry('alpha', '<b>&')], 'initial')

    expect(text).toContain('&lt;b&gt;&amp;')
    expect(text).not.toContain('<b>')
  })
})

describe('目录来源读取', () => {
  it('读出我们自己的目录来源', () => {
    expect(readCatalogEntries({ kind: CATALOG_SOURCE_KIND, entries: [entry('a')] })).toEqual([entry('a')])
  })

  it('空目录是合法来源', () => {
    expect(readCatalogEntries({ kind: CATALOG_SOURCE_KIND, entries: [] })).toEqual([])
  })

  it('别的来源（官方 skill-catalog）不认', () => {
    expect(readCatalogEntries({ kind: 'skill-catalog', entries: [entry('a')] })).toBeUndefined()
  })

  it('结构损坏时不抛错', () => {
    expect(readCatalogEntries(undefined)).toBeUndefined()
    expect(readCatalogEntries({ kind: CATALOG_SOURCE_KIND })).toBeUndefined()
    expect(readCatalogEntries({ kind: CATALOG_SOURCE_KIND, entries: [{ name: 'a' }] })).toBeUndefined()
    expect(readCatalogEntries({ kind: CATALOG_SOURCE_KIND, entries: [null] })).toBeUndefined()
  })

  it('从消息历史里取最新一条可读目录', () => {
    const messages = [
      { source: { kind: CATALOG_SOURCE_KIND, entries: [entry('old')] } },
      { source: { kind: 'skill-catalog', entries: [entry('official')] } },
      { source: { kind: CATALOG_SOURCE_KIND, entries: [entry('new')] } },
    ]

    expect(findPublishedCatalog(messages)).toEqual([entry('new')])
  })

  it('没有目录消息时返回 undefined', () => {
    expect(findPublishedCatalog([{ source: { kind: 'user' } }])).toBeUndefined()
    expect(findPublishedCatalog([])).toBeUndefined()
  })

  it('最新一条结构损坏时跳过它，继续找更早的可读目录', () => {
    const messages = [
      { source: { kind: CATALOG_SOURCE_KIND, entries: [entry('old')] } },
      { source: { kind: CATALOG_SOURCE_KIND, entries: [{ name: 'broken' }] } },
    ]

    expect(findPublishedCatalog(messages)).toEqual([entry('old')])
  })

  it('识别官方 skill-catalog 的存在，即使我们读不懂它的条目', () => {
    expect(hasCatalogHistory([{ source: { kind: 'skill-catalog', entries: [] } }])).toBe(true)
    expect(hasCatalogHistory([{ source: { kind: CATALOG_SOURCE_KIND, entries: [entry('a')] } }])).toBe(true)
    expect(hasCatalogHistory([{ source: { kind: 'user' } }])).toBe(false)
    expect(hasCatalogHistory([])).toBe(false)
  })
})
