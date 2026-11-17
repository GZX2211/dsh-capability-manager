import { describe, expect, it } from 'vitest'
import {
  clampSplitRatio,
  countByPool,
  DEFAULT_SPLIT_RATIO,
  partitionByPool,
  sortPinnedFirst,
  sortResidentFirst,
  splitRatioAt,
} from '../../../src/client/lib/transfer.ts'
import type { CapabilityEntry } from '../../../src/shared/capability.ts'

function entry(name: string, kind: 'tool' | 'skill' = 'tool'): CapabilityEntry {
  return { id: `${kind}:${name}`, kind, name, summary: '', source: 'official', owned: false, available: true }
}

const BASH = entry('bash')
const EDIT = entry('edit')
const READ = entry('read')
const OFFICE = entry('office', 'skill')

describe('两侧分区', () => {
  it('把能力按 excluded 分成能力池与排出池', () => {
    const result = partitionByPool([BASH, EDIT, READ], ['tool:edit'])

    expect(result.pooled.map(item => item.name)).toEqual(['bash', 'read'])
    expect(result.excluded.map(item => item.name)).toEqual(['edit'])
  })

  it('保持筛选结果原有的顺序', () => {
    const result = partitionByPool([READ, BASH, EDIT], [])

    expect(result.pooled.map(item => item.name)).toEqual(['read', 'bash', 'edit'])
  })

  it('excluded 为空时所有能力都在能力池', () => {
    const result = partitionByPool([BASH, EDIT], [])

    expect(result.excluded).toEqual([])
    expect(result.pooled).toHaveLength(2)
  })

  it('excluded 里不认识的能力标识被忽略', () => {
    const result = partitionByPool([BASH], ['tool:ghost', 'skill:office'])

    expect(result.pooled.map(item => item.name)).toEqual(['bash'])
    expect(result.excluded).toEqual([])
  })

  it('空目录分区出两个空列表', () => {
    expect(partitionByPool([], ['tool:bash'])).toEqual({ pooled: [], excluded: [] })
  })

  it('不修改输入的目录与排除名单', () => {
    const entries = [BASH, EDIT]
    const excluded = ['tool:edit']

    partitionByPool(entries, excluded)

    expect(entries).toEqual([BASH, EDIT])
    expect(excluded).toEqual(['tool:edit'])
  })
})

describe('池内计数', () => {
  it('分别给出池内、池外与总数', () => {
    const counts = countByPool([BASH, EDIT, READ], ['tool:edit'])

    expect(counts).toEqual({ pooled: 2, excluded: 1, total: 3 })
  })

  it('未知标识只留在 excluded 名单里，不进任何计数', () => {
    const counts = countByPool([BASH], ['tool:ghost'])

    expect(counts).toEqual({ pooled: 1, excluded: 0, total: 1 })
  })

  it('池内与池外之和等于总数', () => {
    const counts = countByPool([BASH, EDIT, READ, OFFICE], ['tool:edit', 'skill:office'])

    expect(counts.pooled + counts.excluded).toBe(counts.total)
  })
})

describe('置顶', () => {
  it('把指定标识的行提到最前，其余保持相对顺序', () => {
    const result = sortPinnedFirst([BASH, EDIT, READ], ['tool:read'])

    expect(result.map(item => item.name)).toEqual(['read', 'bash', 'edit'])
  })

  it('多个置顶项保持它们在输入里的相对顺序', () => {
    const result = sortPinnedFirst([BASH, EDIT, READ], ['tool:read', 'tool:bash'])

    expect(result.map(item => item.name)).toEqual(['bash', 'read', 'edit'])
  })

  it('不在列表里的标识被忽略', () => {
    const result = sortPinnedFirst([BASH, EDIT], ['tool:missing'])

    expect(result.map(item => item.name)).toEqual(['bash', 'edit'])
  })

  it('空置顶表返回一份新数组，顺序不变', () => {
    const input = [BASH, EDIT]
    const result = sortPinnedFirst(input, [])

    expect(result.map(item => item.name)).toEqual(['bash', 'edit'])
    expect(result).not.toBe(input)
  })
})
describe('分栏比例', () => {
  it('把指针位置换算成左栏占总宽的比例', () => {
    expect(splitRatioAt(600, { left: 100, width: 1000 })).toBe(0.5)
  })

  it('指针拖到左栏最小宽度以内时落在下界', () => {
    expect(splitRatioAt(110, { left: 100, width: 1000 })).toBe(0.25)
  })

  it('指针拖到右栏最小宽度以内时落在上界', () => {
    expect(splitRatioAt(1080, { left: 100, width: 1000 })).toBe(0.75)
  })

  it('容器宽度为零时退回默认比例，避免除零', () => {
    expect(splitRatioAt(300, { left: 0, width: 0 })).toBe(DEFAULT_SPLIT_RATIO)
  })

  it('比例被夹在可用的上下界之间', () => {
    expect(clampSplitRatio(0.1)).toBe(0.25)
    expect(clampSplitRatio(0.9)).toBe(0.75)
    expect(clampSplitRatio(0.4)).toBe(0.4)
  })

  it('非有限比例退回默认比例', () => {
    expect(clampSplitRatio(Number.NaN)).toBe(DEFAULT_SPLIT_RATIO)
    expect(clampSplitRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SPLIT_RATIO)
  })
})

describe('常驻置顶', () => {
  it('常驻能力排到非常驻之前', () => {
    const result = sortResidentFirst([BASH, EDIT, READ], ['tool:read'])

    expect(result.map(item => item.name)).toEqual(['read', 'bash', 'edit'])
  })

  it('多个常驻之间保持原有顺序', () => {
    const result = sortResidentFirst([BASH, EDIT, READ], ['tool:read', 'tool:bash'])

    expect(result.map(item => item.name)).toEqual(['bash', 'read', 'edit'])
  })

  it('没有常驻时保持原有顺序', () => {
    const result = sortResidentFirst([BASH, EDIT, READ], [])

    expect(result.map(item => item.name)).toEqual(['bash', 'edit', 'read'])
  })

  it('常驻名单里不在本侧的标识被忽略', () => {
    const result = sortResidentFirst([BASH, EDIT], ['tool:ghost'])

    expect(result.map(item => item.name)).toEqual(['bash', 'edit'])
  })

  it('返回新数组且不修改输入', () => {
    const entries = [BASH, EDIT]

    const result = sortResidentFirst(entries, ['tool:edit'])

    expect(result).not.toBe(entries)
    expect(entries.map(item => item.name)).toEqual(['bash', 'edit'])
  })
})
