import { describe, expect, it } from 'vitest'
import { blacklistFor, isInPool, residentSet, toolNames } from '../../../src/host/policy/pool.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../../src/shared/config.ts'

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

describe('能力池判定', () => {
  it('默认全部能力在池内', () => {
    expect(isInPool('tool:bash', DEFAULT_CONFIG)).toBe(true)
    expect(isInPool('skill:office-docx', DEFAULT_CONFIG)).toBe(true)
  })

  it('被排除的能力在池外', () => {
    expect(isInPool('tool:bash', config({ excluded: ['tool:bash'] }))).toBe(false)
  })

  it('排除工具不影响同名 Skill：两者命名空间独立', () => {
    const current = config({ excluded: ['tool:office'] })

    expect(isInPool('tool:office', current)).toBe(false)
    expect(isInPool('skill:office', current)).toBe(true)
  })

  it('未登记的标识按池内处理：池外清单只表达「已排除」', () => {
    expect(isInPool('tool:never-seen', DEFAULT_CONFIG)).toBe(true)
  })
})

describe('常驻集合', () => {
  it('返回常驻标识的集合', () => {
    expect([...residentSet(DEFAULT_CONFIG)].sort()).toEqual(['tool:meta_search', 'tool:skill'])
  })

  it('常驻为空时是空集', () => {
    expect([...residentSet(config({ resident: [] }))]).toEqual([])
  })
})

describe('角色黑名单', () => {
  it('按角色取出黑名单', () => {
    const current = config({ blacklist: { router: ['tool:bash'], worker: ['skill:office'] } })

    expect([...blacklistFor(current, 'router')]).toEqual(['tool:bash'])
    expect([...blacklistFor(current, 'worker')]).toEqual(['skill:office'])
  })

  it('角色未知时不应用任何黑名单', () => {
    const current = config({ blacklist: { router: ['tool:bash'], worker: ['tool:read'] } })

    expect(blacklistFor(current, undefined).size).toBe(0)
  })

  it('两个角色互不影响', () => {
    const current = config({ blacklist: { router: ['tool:bash'], worker: [] } })

    expect(blacklistFor(current, 'worker').size).toBe(0)
  })
})

describe('标识到工具名的投影', () => {
  it('只保留工具名，Skill 标识被丢弃', () => {
    expect([...toolNames(['tool:read', 'skill:office', 'tool:write'])]).toEqual(['read', 'write'])
  })

  it('非法标识被丢弃而不是抛错', () => {
    expect([...toolNames(['read', 'tool:', 'Tool:x', ':y', 'tool:ok'])]).toEqual(['ok'])
  })

  it('同名工具与 Skill 不会互相覆盖', () => {
    expect([...toolNames(['tool:office', 'skill:office'])]).toEqual(['office'])
  })

  it('重复标识去重', () => {
    expect([...toolNames(['tool:read', 'tool:read'])]).toEqual(['read'])
  })
})
