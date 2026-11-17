import { describe, expect, it } from 'vitest'
import { RecalledStore, type SessionLike } from '../../../src/host/enforcement/recalled.ts'

interface FakeSession extends SessionLike {
  /** 模拟一次工具新增被记入会话日志。 */
  recordAddition(name: string): void
  historyReads: number
}

function fakeSession(id: string, additions: readonly string[] = []): FakeSession {
  const recorded = [...additions]
  let reads = 0
  return {
    id,
    get historyReads() {
      return reads
    },
    recordAddition(name: string) {
      recorded.push(name)
    },
    toolHistory() {
      reads += 1
      return {
        tools: [{ name: 'meta_search' }],
        updates: recorded.map(name => ({ additions: [{ name }] })),
      }
    },
  }
}

describe('召回集合：从会话日志重建', () => {
  it('没有历史新增时是空集合', () => {
    const store = new RecalledStore()

    expect(store.namesOf(fakeSession('s1'))).toEqual(new Set())
  })

  it('把会话日志里的每一次工具新增都算作召回', () => {
    const store = new RecalledStore()

    expect(store.namesOf(fakeSession('s1', ['read', 'grep']))).toEqual(new Set(['read', 'grep']))
  })

  it('同一工具被新增多次只记一次', () => {
    const store = new RecalledStore()

    expect(store.namesOf(fakeSession('s1', ['read', 'read']))).toEqual(new Set(['read']))
  })

  it('重建只在首次读取时进行，之后走缓存', () => {
    const store = new RecalledStore()
    const session = fakeSession('s1', ['read'])

    store.namesOf(session)
    store.namesOf(session)

    expect(session.historyReads).toBe(1)
  })

  it('不同会话各自独立', () => {
    const store = new RecalledStore()

    expect(store.namesOf(fakeSession('s1', ['read']))).toEqual(new Set(['read']))
    expect(store.namesOf(fakeSession('s2', ['grep']))).toEqual(new Set(['grep']))
  })
})

describe('召回集合：运行期累加', () => {
  it('加入的名字立刻可见', () => {
    const store = new RecalledStore()
    const session = fakeSession('s1')
    store.namesOf(session)

    store.add('s1', ['write'])

    expect(store.namesOf(session)).toEqual(new Set(['write']))
  })

  it('加入与重建结果取并集', () => {
    const store = new RecalledStore()
    const session = fakeSession('s1', ['read'])
    store.namesOf(session)

    store.add('s1', ['write'])

    expect(store.namesOf(session)).toEqual(new Set(['read', 'write']))
  })

  it('首次访问前加入的名字不会因重建而丢失', () => {
    const store = new RecalledStore()
    const session = fakeSession('s1', ['read'])

    store.add('s1', ['write'])

    expect(store.namesOf(session)).toEqual(new Set(['read', 'write']))
  })

  it('add 报告是否真的带来了新名字', () => {
    const store = new RecalledStore()

    expect(store.add('s1', ['read'])).toBe(true)
    expect(store.add('s1', ['read'])).toBe(false)
    expect(store.add('s1', [])).toBe(false)
  })

  it('forget 之后重新从会话日志重建', () => {
    const store = new RecalledStore()
    const session = fakeSession('s1', ['read'])
    store.add('s1', ['write'])
    store.namesOf(session)

    store.forget('s1')

    expect(store.namesOf(session)).toEqual(new Set(['read']))
  })

  it('会话日志读不出来时只保留运行期累加的结果', () => {
    const store = new RecalledStore()
    const broken: SessionLike = {
      id: 's1',
      toolHistory() {
        throw new Error('session log is gone')
      },
    }

    store.add('s1', ['write'])

    expect(store.namesOf(broken)).toEqual(new Set(['write']))
  })
})

describe('Skill 召回载荷', () => {
  it('初始为空集合', () => {
    const store = new RecalledStore()

    expect(store.skillPayloadsOf('s1')).toEqual(new Set())
  })

  it('加入的 Skill 载荷立刻可见', () => {
    const store = new RecalledStore()

    store.addSkills('s1', ['a\u0000说明'])

    expect(store.skillPayloadsOf('s1')).toEqual(new Set(['a\u0000说明']))
  })

  it('addSkills 报告是否真的带来了新载荷', () => {
    const store = new RecalledStore()

    expect(store.addSkills('s1', ['a\u0000说明'])).toBe(true)
    expect(store.addSkills('s1', ['a\u0000说明'])).toBe(false)
    expect(store.addSkills('s1', [])).toBe(false)
  })

  it('Skill 载荷与工具召回集合互不污染', () => {
    const store = new RecalledStore()

    store.add('s1', ['read'])
    store.addSkills('s1', ['a\u0000说明'])

    expect(store.namesOf(fakeSession('s1'))).toEqual(new Set(['read']))
    expect(store.skillPayloadsOf('s1')).toEqual(new Set(['a\u0000说明']))
  })

  it('forget 同时清空工具与 Skill 的召回记录', () => {
    const store = new RecalledStore()
    const session = fakeSession('s1', ['read'])
    store.addSkills('s1', ['a\u0000说明'])
    store.namesOf(session)

    store.forget('s1')

    expect(store.namesOf(session)).toEqual(new Set(['read']))
    expect(store.skillPayloadsOf('s1')).toEqual(new Set())
  })
})
