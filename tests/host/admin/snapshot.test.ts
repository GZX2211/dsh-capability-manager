import { describe, expect, it } from 'vitest'
import { buildSnapshot, computeWarnings } from '../../../src/host/admin/snapshot.ts'
import type { CapabilityEntry } from '../../../src/shared/capability.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../../src/shared/config.ts'

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

function capability(name: string, kind: 'tool' | 'skill' = 'tool'): CapabilityEntry {
  return {
    id: `${kind}:${name}`,
    kind,
    name,
    summary: '',
    source: 'official',
    owned: false,
    available: true,
  }
}

const POOL = [capability('bash'), capability('meta_search'), capability('read'), capability('skill')]

function codes(current: CapabilityConfig, entries: readonly CapabilityEntry[] = POOL): string[] {
  return computeWarnings(current, entries).map(warning => warning.code)
}

describe('风险提示', () => {
  it('默认形态没有任何提示', () => {
    expect(codes(DEFAULT_CONFIG)).toEqual([])
  })

  it('meta_search 不常驻但存在非常驻能力时提示无法召回', () => {
    expect(codes(config({ resident: ['tool:skill'] }))).toContain('meta-search-not-resident')
  })

  it('meta_search 被排除出池时提示完全无法召回', () => {
    expect(codes(config({ excluded: ['tool:meta_search'], resident: ['tool:skill'] }))).toContain(
      'meta-search-excluded',
    )
  })

  it('skill 被排除出池时提示所有 Skill 都不可加载', () => {
    expect(codes(config({ excluded: ['tool:skill'] }))).toContain('skill-excluded')
  })

  it('常驻为空时提示启动即无直接可用能力', () => {
    expect(codes(config({ resident: [] }))).toContain('resident-empty')
  })

  it('黑名单排除了常驻能力时提示该角色不可用，并给出能力标识', () => {
    const warnings = computeWarnings(
      config({ resident: ['tool:meta_search', 'tool:read'], blacklist: { router: ['tool:read'], worker: [] } }),
      POOL,
    )
    const warning = warnings.find(entry => entry.code === 'blacklist-excludes-resident')

    expect(warning?.capabilityIds).toEqual(['tool:read'])
    expect(warning?.roles).toEqual(['router'])
  })

  it('黑名单里只有池外能力时不提示：它本来就不可用', () => {
    const current = config({
      excluded: ['tool:bash'],
      resident: ['tool:meta_search'],
      blacklist: { router: ['tool:bash'], worker: [] },
    })

    expect(codes(current)).not.toContain('blacklist-excludes-resident')
  })

  it('meta_search 不常驻且池内全部常驻时不提示：没有会被漏掉的能力', () => {
    const current = config({ resident: ['tool:skill'], excluded: [] })

    expect(codes(current, [capability('skill'), capability('meta_search')])).not.toContain(
      'meta-search-not-resident',
    )
  })

  it('两个角色都排除同一常驻能力时各提示一条', () => {
    const warnings = computeWarnings(
      config({
        resident: ['tool:meta_search', 'tool:read'],
        blacklist: { router: ['tool:read'], worker: ['tool:read'] },
      }),
      POOL,
    )
    const hits = warnings.filter(warning => warning.code === 'blacklist-excludes-resident')

    expect(hits).toHaveLength(2)
    expect(hits.map(warning => warning.roles)).toEqual([['router'], ['worker']])
    expect(hits.every(warning => warning.capabilityIds?.includes('tool:read'))).toBe(true)
  })
})

describe('快照组装', () => {
  it('透传会话角色判定', () => {
    const snapshot = buildSnapshot({
      revision: 7,
      capabilities: POOL,
      config: DEFAULT_CONFIG,
      rolesAvailable: true,
      sessions: [{ id: 'session-1', role: 'router', roleSource: 'pa' }],
      embedding: { enabled: false, status: 'idle' },
    })

    expect(snapshot.sessions).toEqual([{ id: 'session-1', role: 'router', roleSource: 'pa' }])
    expect(snapshot.revision).toBe(7)
  })

  it('读不到活跃会话时不提供该字段，而不是给一个空数组', () => {
    const snapshot = buildSnapshot({
      revision: 1,
      capabilities: POOL,
      config: DEFAULT_CONFIG,
      rolesAvailable: false,
      embedding: { enabled: false, status: 'idle' },
    })

    expect('sessions' in snapshot).toBe(false)
  })
})
