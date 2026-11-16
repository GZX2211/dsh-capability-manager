import { describe, expect, it } from 'vitest'
import { appearedToolNames, seenToolPayloads } from '../../../src/host/search/seen.ts'
import type { SessionLike } from '../../../src/host/enforcement/recalled.ts'

function session(
  baseline: readonly { name: string; description?: string }[],
  additions: readonly { name: string; description?: string }[] = [],
): SessionLike {
  return {
    id: 's1',
    toolHistory: () => ({ tools: baseline, updates: additions.map(tool => ({ additions: [tool] })) }),
  }
}

describe('已出现过的工具', () => {
  it('把基线与历次新增都算进去', () => {
    const current = session([{ name: 'meta_search' }], [{ name: 'read' }, { name: 'grep' }])

    expect([...appearedToolNames(current)].sort()).toEqual(['grep', 'meta_search', 'read'])
  })

  it('同一工具多次出现只记一次', () => {
    expect([...appearedToolNames(session([], [{ name: 'read' }, { name: 'read' }]))]).toEqual(['read'])
  })

  it('日志为空时是空集合', () => {
    expect(appearedToolNames(session([])).size).toBe(0)
  })

  it('日志读不出来时返回空集合而不是抛错', () => {
    const broken: SessionLike = {
      id: 's1',
      toolHistory() {
        throw new Error('session log is gone')
      },
    }

    expect(appearedToolNames(broken).size).toBe(0)
    expect(seenToolPayloads(broken).size).toBe(0)
  })
})

describe('已出现过的载荷', () => {
  it('描述不同即载荷不同', () => {
    const payloads = seenToolPayloads(session([{ name: 'read', description: '旧' }], [{ name: 'read', description: '新' }]))

    expect(payloads.size).toBe(2)
  })

  it('同一份 schema 只产生一个载荷', () => {
    const payloads = seenToolPayloads(
      session([{ name: 'read', description: '同一个' }], [{ name: 'read', description: '同一个' }]),
    )

    expect(payloads.size).toBe(1)
  })
})
