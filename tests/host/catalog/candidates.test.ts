import { describe, expect, it } from 'vitest'
import { buildToolCandidates } from '../../../src/host/catalog/candidates.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../../src/shared/config.ts'

function schema(name: string) {
  return { name, description: `${name} 的说明`, parameters: {} }
}

function schemas(...names: string[]): Map<string, ReturnType<typeof schema>> {
  return new Map(names.map(name => [name, schema(name)]))
}

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

const ALL = ['bash', 'read', 'write']

describe('可召回候选', () => {
  it('默认返回全部存在的工具', () => {
    const candidates = buildToolCandidates({
      schemas: schemas(...ALL),
      present: new Set(ALL),
      config: DEFAULT_CONFIG,
      role: undefined,
    })

    expect([...candidates.keys()]).toEqual(ALL)
  })

  it('不存在的工具不进候选：schema 缓存里有也不算', () => {
    const candidates = buildToolCandidates({
      schemas: schemas(...ALL),
      present: new Set(['read']),
      config: DEFAULT_CONFIG,
      role: undefined,
    })

    expect([...candidates.keys()]).toEqual(['read'])
  })

  it('池外工具不进候选', () => {
    const candidates = buildToolCandidates({
      schemas: schemas(...ALL),
      present: new Set(ALL),
      config: config({ excluded: ['tool:bash'] }),
      role: undefined,
    })

    expect([...candidates.keys()]).toEqual(['read', 'write'])
  })

  it('该角色黑名单里的工具不进候选', () => {
    const candidates = buildToolCandidates({
      schemas: schemas(...ALL),
      present: new Set(ALL),
      config: config({ blacklist: { router: ['tool:write'], worker: [] } }),
      role: 'router',
    })

    expect([...candidates.keys()]).toEqual(['bash', 'read'])
  })

  it('角色未知时不应用黑名单', () => {
    const candidates = buildToolCandidates({
      schemas: schemas(...ALL),
      present: new Set(ALL),
      config: config({ blacklist: { router: ['tool:write'], worker: [] } }),
      role: undefined,
    })

    expect([...candidates.keys()]).toEqual(ALL)
  })

  it('结果按名称排序', () => {
    const candidates = buildToolCandidates({
      schemas: schemas('write', 'bash', 'read'),
      present: new Set(ALL),
      config: DEFAULT_CONFIG,
      role: undefined,
    })

    expect([...candidates.keys()]).toEqual(['bash', 'read', 'write'])
  })

  it('没有候选时是空映射', () => {
    const candidates = buildToolCandidates({
      schemas: new Map(),
      present: new Set(),
      config: DEFAULT_CONFIG,
      role: undefined,
    })

    expect(candidates.size).toBe(0)
  })

  it('返回带 schema 的完整定义，模型可直接照着调用', () => {
    const candidates = buildToolCandidates({
      schemas: schemas('read'),
      present: new Set(['read']),
      config: DEFAULT_CONFIG,
      role: undefined,
    })

    expect(candidates.get('read')).toEqual(schema('read'))
  })
})
