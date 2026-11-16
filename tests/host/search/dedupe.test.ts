import { describe, expect, it } from 'vitest'
import { dedupeByPayload } from '../../../src/host/search/dedupe.ts'

interface Item {
  id: string
}

/** 载荷就是 id，便于直接读出去重结果。 */
function payloadOf(item: Item): string {
  return item.id
}

describe('载荷级去重', () => {
  it('已见为空时全部保留', () => {
    const items = [{ id: 'a' }, { id: 'b' }]

    expect(dedupeByPayload(items, payloadOf, new Set())).toEqual({ kept: items, payloads: ['a', 'b'] })
  })

  it('已在上下文中出现过的载荷被剔除', () => {
    const items = [{ id: 'a' }, { id: 'b' }]

    expect(dedupeByPayload(items, payloadOf, new Set(['a']))).toEqual({ kept: [{ id: 'b' }], payloads: ['b'] })
  })

  it('全部已见时结果为空', () => {
    expect(dedupeByPayload([{ id: 'a' }], payloadOf, new Set(['a']))).toEqual({ kept: [], payloads: [] })
  })

  it('本批内部重复也只保留首个', () => {
    const items = [{ id: 'a' }, { id: 'a' }, { id: 'b' }]

    expect(dedupeByPayload(items, payloadOf, new Set())).toEqual({ kept: [{ id: 'a' }, { id: 'b' }], payloads: ['a', 'b'] })
  })

  it('保留输入顺序', () => {
    const items = [{ id: 'c' }, { id: 'a' }, { id: 'b' }]

    expect(dedupeByPayload(items, payloadOf, new Set(['a'])).kept).toEqual([{ id: 'c' }, { id: 'b' }])
  })

  it('不修改已见集合', () => {
    const seen = new Set(['a'])
    dedupeByPayload([{ id: 'a' }, { id: 'b' }], payloadOf, seen)

    expect([...seen]).toEqual(['a'])
  })

  it('空输入得到空结果', () => {
    expect(dedupeByPayload([], payloadOf, new Set(['a']))).toEqual({ kept: [], payloads: [] })
  })

  it('payloads 与 kept 一一对应，供调用方并入已见集合', () => {
    const outcome = dedupeByPayload([{ id: 'x' }, { id: 'y' }], payloadOf, new Set())

    expect(outcome.payloads.length).toBe(outcome.kept.length)
    expect(outcome.payloads[1]).toBe(outcome.kept[1]?.id)
  })
})
