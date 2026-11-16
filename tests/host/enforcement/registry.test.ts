import { describe, expect, it, vi } from 'vitest'
import { EnforcementRegistry, type AgentScope } from '../../../src/host/enforcement/registry.ts'
import { RecalledStore, type SessionLike } from '../../../src/host/enforcement/recalled.ts'
import type { ToolSource } from '../../../src/host/catalog/collect.ts'
import { DEFAULT_CONFIG, type CapabilityConfig, type SessionRoleName } from '../../../src/shared/config.ts'

/** 最小宿主替身：模拟 tools 注册表、每个 agent 的限制，以及限制校验。 */interface Host {
  readonly registry: EnforcementRegistry
  readonly recalled: RecalledStore
  register(name: string): void
  unregister(name: string): void
  createAgent(id: string, additions?: readonly string[]): AgentScope
  /** 只跑宿主侧的 agent 清理，不通知 registry。 */
  runAgentCleanups(id: string): void
  disposeAgent(id: string): void
  /** 当前对该 agent 可见的工具名。 */
  visible(id: string): string[]
  setConfig(next: CapabilityConfig): void
  setRole(id: string, role: SessionRoleName | undefined): void
  /** 命中 `tools.change` 时由宿主调用。 */
  toolsChanged(): void
  restrictCalls(): number
}

function agentEffect(callback: () => () => void): () => void {
  const cleanup = callback()
  return () => cleanup()
}

function createHost(initial: CapabilityConfig = DEFAULT_CONFIG): Host {  const global = new Set<string>()
  /** agentId → 当前生效的 allow；不存在表示未受限。 */
  const restrictions = new Map<string, Set<string>>()
  const agents = new Map<string, AgentScope>()
  const agentCleanups = new Map<string, (() => void)[]>()
  const changes: (() => void)[] = []
  const roles = new Map<string, SessionRoleName | undefined>()
  let config = initial
  let calls = 0
  const log = vi.fn()

  const definitionsOf = (agentId: string): ToolSource[] => {
    const allow = restrictions.get(agentId)
    return [...global]
      .filter(name => allow === undefined || allow.has(name))
      .map(name => ({ name, description: `${name} 的说明`, parameters: {} }))
  }

  const recalled = new RecalledStore()
  const registry = new EnforcementRegistry({
    config: () => config,
    roleOf: sessionId => roles.get(sessionId),
    recalled,
    log,
  })

  function register(name: string): void {
    global.add(name)
    for (const notify of changes) notify()
  }

  function unregister(name: string): void {
    global.delete(name)
    for (const notify of changes) notify()
  }

  function session(id: string, additions: readonly string[]): SessionLike {
    return {
      id,
      toolHistory() {
        return { tools: [], updates: additions.map(name => ({ additions: [{ name }] })) }
      },
    }
  }

  function createAgent(id: string, additions: readonly string[] = []): AgentScope {
    /** agent 卸载时要跑的清理，模拟宿主对 agent.ctx.effect 的回收。 */
    const cleanups: (() => void)[] = []
    agentCleanups.set(id, cleanups)
    const agent: AgentScope = {
      id,
      session: session(id, additions),
      ctx: {
        tools: {
          definitions: () => definitionsOf(id),
          restrict: filter => {
            const allow = [...(filter.allow ?? [])]
            // 与真实 API 一致：空名单、未知名字都抛错。
            if (allow.length === 0) throw new Error('tools.restrict({ allow: [] }) is a no-op')
            for (const name of allow) {
              if (!global.has(name)) throw new Error(`tools.restrict() names unknown global tool "${name}"`)
            }
            calls += 1
            const previous = restrictions.get(id)
            restrictions.set(id, new Set(allow))
            for (const notify of changes) notify()
            return () => {
              if (previous === undefined) restrictions.delete(id)
              else restrictions.set(id, previous)
            }
          },
        },
        effect(callback) {
          const cleanup = callback()
          cleanups.push(cleanup)
          return () => {
            const index = cleanups.indexOf(cleanup)
            if (index >= 0) cleanups.splice(index, 1)
            cleanup()
          }
        },
      },
    }
    agents.set(id, agent)
    registry.onAgentCreated(agent)
    return agent
  }

  changes.push(() => {
    registry.onToolsChange()
  })

  return {
    registry,
    recalled,
    register,
    unregister,
    createAgent,
    runAgentCleanups(id) {
      for (const cleanup of agentCleanups.get(id) ?? []) cleanup()
    },
    disposeAgent(id) {
      agents.delete(id)
      // 宿主销毁 agent 时会跑 agent.ctx.effect 注册的清理。
      for (const cleanup of agentCleanups.get(id) ?? []) cleanup()
      agentCleanups.delete(id)
      registry.onAgentDisposed(id)
    },
    visible: id =>
      definitionsOf(id)
        .map(definition => definition.name)
        .sort(),
    setConfig(next) {
      config = next
    },
    setRole(id, role) {
      roles.set(id, role)
    },
    toolsChanged: () => registry.onToolsChange(),
    restrictCalls: () => calls,
  }
}

describe('每 agent 的可见工具', () => {
  it('创建后只剩常驻工具', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'read', 'write', 'meta_search']) host.register(name)

    host.createAgent('s1')

    expect(host.visible('s1')).toEqual(['meta_search'])
  })

  it('池外工具即使常驻也不可见', () => {
    const host = createHost({ ...DEFAULT_CONFIG, excluded: ['tool:read'], resident: ['tool:read', 'tool:write'] })
    for (const name of ['read', 'write']) host.register(name)

    host.createAgent('s1')

    expect(host.visible('s1')).toEqual(['write'])
  })

  it('黑名单排掉常驻工具', () => {
    const host = createHost({
      ...DEFAULT_CONFIG,
      resident: ['tool:read', 'tool:write'],
      blacklist: { router: ['tool:read'], worker: [] },
    })
    for (const name of ['read', 'write']) host.register(name)
    host.setRole('s1', 'router')

    host.createAgent('s1')

    expect(host.visible('s1')).toEqual(['write'])
  })

  it('常驻为空时不应用空名单，避免让 agent 全盲', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: [] })
    for (const name of ['bash', 'read']) host.register(name)

    host.createAgent('s1')

    expect(host.restrictCalls()).toBe(0)
  })
})

describe('召回后重建', () => {
  it('召回的工具在重建后可见', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'read', 'meta_search']) host.register(name)
    const agent = host.createAgent('s1')

    host.recalled.add('s1', ['read'])
    host.registry.rebuild()

    expect(host.visible('s1')).toEqual(['meta_search', 'read'])
    expect(agent.id).toBe('s1')
  })

  it('会话日志里记录过的召回在重建后可见：重启依赖这一条', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'read', 'meta_search']) host.register(name)

    host.createAgent('s1', ['read'])

    expect(host.visible('s1')).toEqual(['meta_search', 'read'])
  })

  it('池外工具被召回也不可见', () => {
    const host = createHost({ ...DEFAULT_CONFIG, excluded: ['tool:bash'], resident: ['tool:read'] })
    for (const name of ['bash', 'read']) host.register(name)
    host.createAgent('s1')

    host.recalled.add('s1', ['bash'])
    host.registry.rebuild()

    expect(host.visible('s1')).toEqual(['read'])
  })
})

describe('全集的维护', () => {
  it('吸收全集发生在应用限制之前：被掩掉的工具仍留在全集里', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'read', 'meta_search']) host.register(name)

    host.createAgent('s1')

    expect([...host.registry.universe].sort()).toEqual(['bash', 'meta_search', 'read'])
  })

  it('限制生效后再召回被掩掉的工具不会因未知名字抛错', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'read', 'meta_search']) host.register(name)
    host.createAgent('s1')

    host.recalled.add('s1', ['bash'])
    expect(() => host.registry.rebuild()).not.toThrow()
    expect(host.visible('s1')).toContain('bash')
  })

  it('工具消失后不再出现在名单里，且不抛错', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'meta_search']) host.register(name)
    host.createAgent('s1')
    host.recalled.add('s1', ['bash'])
    host.registry.rebuild()
    expect(host.visible('s1')).toEqual(['bash', 'meta_search'])

    host.unregister('bash')

    expect(host.visible('s1')).toEqual(['meta_search'])
  })

  it('本插件自己注册的工具无需经过吸收也留在全集里', () => {
    const host = createHost()
    host.registry.noteOwnTool('meta_search', { name: 'meta_search', description: '召回' })

    expect([...host.registry.universe]).toEqual(['meta_search'])
    expect(host.registry.schemasOf().get('meta_search')?.description).toBe('召回')
  })

  it('吸收时缓存完整 schema，供 meta_search 返回可直接调用的定义', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    host.register('meta_search')
    host.createAgent('s1')

    expect(host.registry.schemasOf().get('meta_search')).toEqual({
      name: 'meta_search',
      description: 'meta_search 的说明',
      parameters: {},
    })
  })

  it('被掩掉的工具 schema 仍然在缓存里：召回要能返回它', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'meta_search']) host.register(name)
    host.createAgent('s1')
    expect(host.visible('s1')).toEqual(['meta_search'])

    expect(host.registry.schemasOf().has('bash')).toBe(true)
  })

  it('presentOf 反映该 agent 当前存在的工具', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'meta_search']) host.register(name)
    host.createAgent('s1')

    expect([...host.registry.presentOf('s1')].sort()).toEqual(['bash', 'meta_search'])
    expect(host.registry.presentOf('unknown').size).toBe(0)
  })

  it('tools/change 后能发现新注册的工具', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    host.register('meta_search')
    host.createAgent('s1')
    expect(host.visible('s1')).toEqual(['meta_search'])

    host.register('late_tool')
    host.recalled.add('s1', ['late_tool'])
    host.registry.rebuild()

    expect(host.visible('s1')).toEqual(['late_tool', 'meta_search'])
  })
})

describe('重建的短路与递归防护', () => {
  it('名单没变时不重复应用限制', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'meta_search']) host.register(name)
    host.createAgent('s1')
    const afterCreate = host.restrictCalls()

    host.registry.rebuild()
    host.registry.rebuild()

    expect(host.restrictCalls()).toBe(afterCreate)
  })

  it('限制自身触发的 tools/change 不会引起递归重建', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'meta_search']) host.register(name)

    host.createAgent('s1')

    // 若自身 emit 触发递归，restrict 调用次数会远超一次。
    expect(host.restrictCalls()).toBe(1)
  })

  it('外部 tools/change 会重新吸收并重建', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    host.register('meta_search')
    host.createAgent('s1')

    host.recalled.add('s1', ['newcomer'])
    host.register('newcomer')

    expect(host.visible('s1')).toContain('newcomer')
  })
})

describe('生命周期', () => {
  it('多个 agent 各自受限，互不影响', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'read', 'meta_search']) host.register(name)
    host.createAgent('s1')
    host.createAgent('s2')

    host.recalled.add('s1', ['read'])
    host.registry.rebuild()

    expect(host.visible('s1')).toEqual(['meta_search', 'read'])
    expect(host.visible('s2')).toEqual(['meta_search'])
  })

  it('agent 销毁后解除限制', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'meta_search']) host.register(name)
    host.createAgent('s1')

    host.disposeAgent('s1')

    expect(host.visible('s1')).toEqual(['bash', 'meta_search'])
  })

  it('插件卸载时解除所有限制', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'meta_search']) host.register(name)
    host.createAgent('s1')
    host.createAgent('s2')

    host.registry.dispose()

    expect(host.visible('s1')).toEqual(['bash', 'meta_search'])
    expect(host.visible('s2')).toEqual(['bash', 'meta_search'])
  })

  it('销毁未知 agent 不抛错', () => {
    const host = createHost()

    expect(() => host.disposeAgent('never-existed')).not.toThrow()
  })

  it('宿主回收 agent 的 effect 就足以恢复可见性，不依赖插件自己的清理', () => {
    // 这是那次「插件卸载后限制仍在」事故的防线：兜底释放器挂在 agent 生命周期上，
    // 插件的卸载清理没能执行时，宿主销毁 agent 仍然会把限制解开。
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'meta_search']) host.register(name)
    host.createAgent('s1')
    expect(host.visible('s1')).toEqual(['meta_search'])

    // 只跑宿主侧的 agent 清理，不通知 registry。
    host.runAgentCleanups('s1')

    expect(host.visible('s1')).toEqual(['bash', 'meta_search'])
  })

  it('重复解除不会把后来的限制一起抹掉', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    for (const name of ['bash', 'meta_search', 'read']) host.register(name)
    host.createAgent('s1')
    host.recalled.add('s1', ['read'])
    host.registry.rebuild()
    expect(host.visible('s1')).toEqual(['meta_search', 'read'])

    // 再重建一次：旧释放器若被重复执行，就会把刚建立的新限制删掉。
    host.registry.rebuild()

    expect(host.visible('s1')).toEqual(['meta_search', 'read'])
  })
})

describe('agent 层工具不受管辖', () => {
  /**
   * 复刻真实语义：`agent.ctx.tools.register()` 注册的工具会出现在 definitions 里，
   * 却不在 restrict 可命名的范围内。Personal Agent 的会话就是这种部署。
   */
  function agentScopedHost() {
    const global = new Set(['meta_search', 'bash', 'read'])
    const agentScoped = new Set(['pa_task_route'])
    let allow: string[] = []
    let attempts = 0
    const recalled = new RecalledStore()
    const registry = new EnforcementRegistry({
      config: () => DEFAULT_CONFIG,
      roleOf: () => undefined,
      recalled,
    })
    const agent: AgentScope = {
      id: 's1',
      session: { id: 's1', toolHistory: () => ({ tools: [], updates: [] }) },
      ctx: {
        effect: agentEffect,
        tools: {
          definitions: () => [...global, ...agentScoped].map(name => ({ name })),
          restrict(filter) {
            attempts += 1
            const names = [...(filter.allow ?? [])]
            const unknown = names.filter(name => agentScoped.has(name))
            if (unknown.length > 0) {
              throw new Error(
                `tools.restrict() names unknown global tool${unknown.length > 1 ? 's' : ''} ${unknown
                  .map(name => `"${name}"`)
                  .join(', ')}; known global tools: ${[...global].sort().join(', ')}`,
              )
            }
            allow = names
            return () => {}
          },
        },
      },
    }
    return { registry, recalled, agent, allow: () => allow, attempts: () => attempts }
  }

  it('名单里混进 agent 层工具时剔除后重试，其余工具仍被限制', () => {
    const host = agentScopedHost()
    host.recalled.add('s1', ['pa_task_route'])

    host.registry.onAgentCreated(host.agent)

    expect(host.allow()).toEqual(['meta_search'])
    expect(host.attempts()).toBe(2)
  })

  it('全部候选都是 agent 层工具时放弃本次限制，保留上一次状态', () => {
    const host = agentScopedHost()
    host.recalled.add('s1', ['pa_task_route'])

    host.registry.onAgentCreated(host.agent)

    // 第二次尝试仍含 agent 层工具时不再无限重试。
    expect(host.attempts()).toBe(2)
    expect(host.allow()).not.toContain('pa_task_route')
  })

  it('错误形状不认识时放弃限制而不是抛给调用方', () => {
    const recalled = new RecalledStore()
    const registry = new EnforcementRegistry({ config: () => DEFAULT_CONFIG, roleOf: () => undefined, recalled })
    const agent: AgentScope = {
      id: 's1',
      session: { id: 's1', toolHistory: () => ({ tools: [], updates: [] }) },
      ctx: {
        effect: agentEffect,
        tools: {
          definitions: () => [{ name: 'meta_search' }],
          restrict() {
            throw new Error('some completely different failure')
          },
        },
      },
    }

    expect(() => registry.onAgentCreated(agent)).not.toThrow()
  })
})

describe('配置与角色变化', () => {
  it('常驻变少后可见工具跟着变少', () => {
    const host = createHost({ ...DEFAULT_CONFIG, resident: ['tool:meta_search', 'tool:read'] })
    for (const name of ['bash', 'meta_search', 'read']) host.register(name)
    host.createAgent('s1')
    expect(host.visible('s1')).toEqual(['meta_search', 'read'])

    host.setConfig({ ...DEFAULT_CONFIG, resident: ['tool:meta_search'] })
    host.registry.rebuild()

    expect(host.visible('s1')).toEqual(['meta_search'])
  })

  it('角色从未知变为 router 后黑名单才开始生效', () => {
    const host = createHost({
      ...DEFAULT_CONFIG,
      resident: ['tool:meta_search', 'tool:read'],
      blacklist: { router: ['tool:read'], worker: [] },
    })
    for (const name of ['meta_search', 'read']) host.register(name)
    host.createAgent('s1')
    expect(host.visible('s1')).toEqual(['meta_search', 'read'])

    host.setRole('s1', 'router')
    host.registry.rebuild()

    expect(host.visible('s1')).toEqual(['meta_search'])
  })

  it('把能力重新放回池里后不必等新会话', () => {
    const host = createHost({ ...DEFAULT_CONFIG, excluded: ['tool:read'], resident: ['tool:read'] })
    for (const name of ['meta_search', 'read']) host.register(name)
    host.createAgent('s1')
    // 算不出任何可用工具时不应用空名单，宁可保留现状也不让 agent 全盲。
    expect(host.restrictCalls()).toBe(0)

    host.setConfig({ ...DEFAULT_CONFIG, resident: ['tool:read'] })
    host.registry.rebuild()

    expect(host.visible('s1')).toEqual(['read'])
  })
})

describe('降级', () => {
  it('读不到工具定义时不抛错、不应用限制，等待下一次 tools/change', () => {
    const recalled = new RecalledStore()
    const registry = new EnforcementRegistry({
      config: () => DEFAULT_CONFIG,
      roleOf: () => undefined,
      recalled,
    })
    const restrict = vi.fn(() => () => {})
    const agent: AgentScope = {
      id: 's1',
      session: { id: 's1', toolHistory: () => ({ tools: [], updates: [] }) },
      ctx: {
        effect: agentEffect,
        tools: {
          definitions() {
            throw new Error('tool registry is gone')
          },
          restrict,
        },
      },
    }

    expect(() => registry.onAgentCreated(agent)).not.toThrow()
    expect(registry.universe.size).toBe(0)
    expect(restrict).not.toHaveBeenCalled()
  })

  it('释放限制失败时仍然继续重建', () => {
    const recalled = new RecalledStore()
    const registry = new EnforcementRegistry({
      config: () => DEFAULT_CONFIG,
      roleOf: () => undefined,
      recalled,
    })
    let allow: string[] = []
    const agent: AgentScope = {
      id: 's1',
      session: { id: 's1', toolHistory: () => ({ tools: [], updates: [] }) },
      ctx: {
        effect: agentEffect,
        tools: {
          definitions: () => ['meta_search', 'read'].map(name => ({ name })),
          restrict(filter) {
            allow = [...(filter.allow ?? [])]
            return () => {
              throw new Error('cannot release')
            }
          },
        },
      },
    }
    registry.onAgentCreated(agent)
    expect(allow).toEqual(['meta_search'])

    recalled.add('s1', ['read'])

    expect(() => registry.rebuild()).not.toThrow()
    expect(allow).toEqual(['meta_search', 'read'])
  })
})




