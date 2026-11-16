import { describe, expect, it } from 'vitest'
import { computeAllow } from '../../../src/host/policy/visible.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../../src/shared/config.ts'

/** 一个「全部工具都在」的部署：universe 与 present 相同。 */
const ALL = ['bash', 'edit', 'glob', 'grep', 'meta_search', 'read', 'skill', 'write']

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

function allow(input: {
  config?: CapabilityConfig
  role?: 'router' | 'worker' | undefined
  universe?: readonly string[]
  present?: readonly string[]
  recalled?: readonly string[]
}): string[] {
  const universe = new Set(input.universe ?? ALL)
  return computeAllow({
    config: input.config ?? config({ resident: ['tool:read'] }),
    role: input.role,
    universe,
    present: new Set(input.present ?? [...universe]),
    recalled: new Set(input.recalled ?? []),
  })
}

describe('可见集：四个判定的组合', () => {
  it('只有常驻工具可见', () => {
    expect(allow({})).toEqual(['read'])
  })

  it('常驻与召回取并集', () => {
    expect(allow({ recalled: ['grep'] })).toEqual(['grep', 'read'])
  })

  it('池外工具即使常驻也不可见', () => {
    expect(allow({ config: config({ resident: ['tool:read'], excluded: ['tool:read'] }) })).toEqual([])
  })

  it('池外工具即使被召回也不可见', () => {
    expect(allow({ config: config({ resident: [], excluded: ['tool:grep'] }), recalled: ['grep'] })).toEqual([])
  })

  it('黑名单优先于常驻', () => {
    const current = config({ resident: ['tool:read'], blacklist: { router: ['tool:read'], worker: [] } })

    expect(allow({ config: current, role: 'router' })).toEqual([])
    expect(allow({ config: current, role: 'worker' })).toEqual(['read'])
  })

  it('角色未知时不应用黑名单', () => {
    const current = config({ resident: ['tool:read'], blacklist: { router: ['tool:read'], worker: ['tool:read'] } })

    expect(allow({ config: current })).toEqual(['read'])
  })

  it('召回集合里没有的工具不凭空出现', () => {
    expect(allow({ recalled: ['ghost'] })).toEqual(['read'])
  })
})

describe('可见集：全集与现存集合', () => {
  it('不在全集里的名字被丢弃', () => {
    expect(allow({ recalled: ['grep'], universe: ['read', 'meta_search'] })).toEqual(['read'])
  })

  it('不在现存集合里的名字被丢弃：这是 restrict 不抛错的关键', () => {
    // universe 记得 grep，但它此刻已经消失（MCP 断开、插件卸载）。
    expect(allow({ recalled: ['grep'], present: ['read', 'meta_search'] })).toEqual(['read'])
  })

  it('常驻工具当前不存在时同样被丢弃', () => {
    expect(allow({ present: ['grep'] })).toEqual([])
  })
})

describe('可见集：Skill 不参与', () => {
  it('常驻里的 Skill 标识不影响工具名单', () => {
    expect(allow({ config: config({ resident: ['tool:read', 'skill:office'] }) })).toEqual(['read'])
  })

  it('黑名单里的 Skill 标识不影响工具名单', () => {
    const current = config({ resident: ['tool:read'], blacklist: { router: ['skill:office'], worker: [] } })

    expect(allow({ config: current, role: 'router' })).toEqual(['read'])
  })
})

describe('可见集：形状', () => {
  it('结果为空时是空数组', () => {
    expect(allow({ config: config({ resident: [] }) })).toEqual([])
  })

  it('结果按名称稳定排序，便于短路比较', () => {
    expect(allow({ recalled: ['write', 'bash', 'grep'] })).toEqual(['bash', 'grep', 'read', 'write'])
  })

  it('重复输入不产生重复项', () => {
    expect(allow({ recalled: ['grep', 'grep'] })).toEqual(['grep', 'read'])
  })

  it('两个集合都为空时结果为空', () => {
    expect(allow({ universe: [], present: [] })).toEqual([])
  })

  it('排序按码元而非语言学规则：下划线在字母前、大写在小写前', () => {
    const names = ['a_tool', 'atool', 'Tool', 'tool']
    expect(allow({ universe: names, recalled: names, config: config({ resident: [] }) })).toEqual([
      'Tool',
      'a_tool',
      'atool',
      'tool',
    ])
  })

  it('不修改调用方传入的集合', () => {
    const recalled = new Set(['write', 'bash'])
    computeAllow({
      config: config({ resident: [] }),
      role: undefined,
      universe: new Set(ALL),
      present: new Set(ALL),
      recalled,
    })

    expect([...recalled]).toEqual(['write', 'bash'])
  })
})
