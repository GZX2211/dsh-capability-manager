import { describe, expect, it } from 'vitest'
import {
  catalogScopeOf,
  isCatalogInjected,
  isSkillEnabled,
  isSkillToolUsable,
  shouldInjectSkillCatalog,
  SKILL_TOOL_NAME,
} from '../../../src/host/skill-consumer/policy.ts'
import { DEFAULT_CONFIG, type CapabilityConfig, type SessionRoleName } from '../../../src/shared/config.ts'

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

describe('skill 工具名', () => {
  it('与官方 skill 工具同名，才能 shadow 掉它', () => {
    expect(SKILL_TOOL_NAME).toBe('skill')
  })
})

describe('skill 工具可用性', () => {
  function usable(patch: Partial<CapabilityConfig>, recalled: readonly string[] = []) {
    return isSkillToolUsable({ config: config(patch), role: undefined, recalled: new Set(recalled) })
  }

  it('默认常驻，可用', () => {
    expect(usable({})).toBe(true)
  })

  it('排除出池后不可用', () => {
    expect(usable({ excluded: ['tool:skill'] })).toBe(false)
  })

  it('该角色黑名单里时不可用', () => {
    const current = config({ blacklist: { router: ['tool:skill'], worker: [] } })

    expect(isSkillToolUsable({ config: current, role: 'router', recalled: new Set() })).toBe(false)
  })

  it('取消常驻后不可用', () => {
    expect(usable({ resident: ['tool:meta_search'] })).toBe(false)
  })

  it('取消常驻但本会话已召回后可用', () => {
    expect(usable({ resident: ['tool:meta_search'] }, ['skill'])).toBe(true)
  })
})

describe('Skill 能力池归属', () => {
  it('池内且不在该角色黑名单里可用', () => {
    expect(isSkillEnabled({ id: 'skill:office', config: DEFAULT_CONFIG, role: undefined })).toBe(true)
  })

  it('池外不可用', () => {
    expect(isSkillEnabled({ id: 'skill:office', config: config({ excluded: ['skill:office'] }), role: undefined })).toBe(false)
  })

  it('该角色黑名单里不可用', () => {
    const current = config({ blacklist: { router: ['skill:office'], worker: [] } })

    expect(isSkillEnabled({ id: 'skill:office', config: current, role: 'router' })).toBe(false)
  })

  it('同名工具被排除不影响 Skill', () => {
    expect(
      isSkillEnabled({ id: 'skill:office', config: config({ excluded: ['tool:office'] }), role: undefined }),
    ).toBe(true)
  })

  it('工具标识不是 Skill，永远不可用', () => {
    expect(isSkillEnabled({ id: 'tool:office', config: DEFAULT_CONFIG, role: undefined })).toBe(false)
  })

  it('非法标识永远不可用', () => {
    expect(isSkillEnabled({ id: 'office', config: DEFAULT_CONFIG, role: undefined })).toBe(false)
  })
})

describe('Skill 目录注入时机', () => {
  it('任何组合都注入目录：模式 A 全量、模式 B 常驻、降级全量', () => {
    expect(isCatalogInjected({ metaSearchUsable: true, embeddingEnabled: true })).toBe(true)
    expect(isCatalogInjected({ metaSearchUsable: true, embeddingEnabled: false })).toBe(true)
    expect(isCatalogInjected({ metaSearchUsable: false, embeddingEnabled: false })).toBe(true)
    expect(isCatalogInjected({ metaSearchUsable: false, embeddingEnabled: true })).toBe(true)
  })
})

describe('Skill 目录注入范围', () => {
  it('模式 A 注入全量池内 Skill', () => {
    expect(catalogScopeOf(config({}), true)).toBe('all')
    expect(catalogScopeOf(config({}), false)).toBe('all')
  })

  it('模式 B 且 meta_search 可用时只注入常驻', () => {
    expect(catalogScopeOf(config({ embedding: { enabled: true } }), true)).toBe('resident')
  })

  it('模式 B 但 meta_search 不可用时降级为全量', () => {
    expect(catalogScopeOf(config({ embedding: { enabled: true } }), false)).toBe('all')
  })
})

describe('按会话判定目录注入', () => {
  function inject(
    patch: Partial<CapabilityConfig>,
    recalled: readonly string[] = [],
    role: SessionRoleName | undefined = undefined,
  ) {
    return shouldInjectSkillCatalog({
      config: config(patch),
      role,
      recalled: new Set(recalled),
    })
  }

  it('默认形态注入', () => {
    expect(inject({})).toBe(true)
  })

  it('语义检索开启且 meta_search 常驻时仍注入（目录只含常驻 Skill）', () => {
    expect(inject({ resident: ['tool:meta_search', 'tool:skill'], embedding: { enabled: true } })).toBe(true)
  })

  it('meta_search 被排除出池时仍注入', () => {
    expect(
      inject({ excluded: ['tool:meta_search'], embedding: { enabled: true } }),
    ).toBe(true)
  })

  it('meta_search 被该角色拉黑时仍注入', () => {
    expect(
      inject(
        { blacklist: { router: ['tool:meta_search'], worker: [] }, embedding: { enabled: true } },
        [],
        'router',
      ),
    ).toBe(true)
  })

  it('meta_search 非常驻且未召回时仍注入', () => {
    expect(
      inject({ resident: ['tool:skill'], embedding: { enabled: true } }),
    ).toBe(true)
  })
})
