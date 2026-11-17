import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  createShadowSkillTool,
  ShadowSkillRegistry,
  SKILL_TOOL_DESCRIPTION,
  whenSkillToolUsable,
  type LoadedSkill,
  type ShadowSkillDependencies,
} from '../../../src/host/skill-consumer/shadow.ts'
import { RecalledStore, type SessionLike } from '../../../src/host/enforcement/recalled.ts'
import { DEFAULT_CONFIG, type CapabilityConfig, type SessionRoleName } from '../../../src/shared/config.ts'

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

function session(id: string, additions: readonly string[] = []): SessionLike {
  return {
    id,
    toolHistory() {
      return { tools: [], updates: additions.map(name => ({ additions: [{ name }] })) }
    },
  }
}

function loaded(name: string, patch: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name,
    description: `${name} 的说明`,
    provider: 'filesystem',
    content: `# ${name}\n\n正文`,
    invocation: { modelInvocable: true },
    ...patch,
  }
}

interface Harness {
  readonly tool: ReturnType<typeof createShadowSkillTool>
  readonly deps: ShadowSkillDependencies
  readonly get: ReturnType<typeof vi.fn>
  readonly recalled: RecalledStore
  setConfig(next: CapabilityConfig): void
  setRole(role: SessionRoleName | undefined): void
  exec(agent: unknown): ToolRunContext
}

function harness(options: {
  config?: Partial<CapabilityConfig>
  role?: SessionRoleName
  skill?: LoadedSkill | undefined
  cwd?: string
} = {}): Harness {
  let current = config(options.config ?? {})
  let role = options.role
  const recalled = new RecalledStore()
  const defaultSkill = loaded('office-docx')
  const get = vi.fn(async (_name: string) => ('skill' in options ? options.skill : defaultSkill))
  const deps: ShadowSkillDependencies = {
    config: () => current,
    roleOf: () => role,
    recalled,
    skills: { get },
    cwdOf: async () => options.cwd ?? 'C:\\workspace',
  }
  return {
    tool: createShadowSkillTool(deps),
    deps,
    get,
    recalled,
    setConfig(next) {
      current = next
    },
    setRole(next) {
      role = next
    },
    exec(agent) {
      return { agent, signal: new AbortController().signal } as unknown as ToolRunContext
    },
  }
}

function agent(id = 'session-1', additions: readonly string[] = []) {
  return { id, session: session(id, additions) }
}

type When = (context: { agent: unknown }) => boolean

describe('shadow skill 工具定义', () => {
  it('与官方工具同名', () => {
    expect(harness().tool.name).toBe('skill')
  })

  it('描述说明按名称加载并提示校验范围', () => {
    expect(SKILL_TOOL_DESCRIPTION).toContain('Skill')
    expect(SKILL_TOOL_DESCRIPTION).toContain('名称')
  })

  it('name 参数是必填字符串', () => {
    const parameters = harness().tool.parameters as {
      type?: string
      required?: string[]
      properties?: Record<string, { type?: string }>
    }

    expect(parameters.type).toBe('object')
    expect(parameters.required).toContain('name')
    expect(parameters.properties?.name?.type).toBe('string')
  })

  it('输出渲染成官方 skill_content 块', () => {
    const value = { name: 'office-docx', provider: 'filesystem', content: '# 正文' }

    const blocks = harness().tool.output.render({ name: 'office-docx' }, value as never)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('text')
    expect((blocks[0] as { text: string }).text).toContain('<skill_content name="office-docx">')
  })
})

describe('when：入口工具可用性', () => {
  it('默认常驻时可用', () => {
    const h = harness()

    expect(whenOf(h)({ agent: agent() })).toBe(true)
  })

  it('排除出池后不可用', () => {
    const h = harness({ config: { excluded: ['tool:skill'] } })

    expect(whenOf(h)({ agent: agent() })).toBe(false)
  })

  it('该角色黑名单里不可用', () => {
    const h = harness({ config: { blacklist: { router: ['tool:skill'], worker: [] } }, role: 'router' })

    expect(whenOf(h)({ agent: agent() })).toBe(false)
  })

  it('取消常驻后不可用，召回后恢复', () => {
    const h = harness({ config: { resident: ['tool:meta_search'] } })
    const scope = agent()
    h.recalled.add(scope.session.id, ['skill'])

    expect(whenOf(h)({ agent: scope })).toBe(true)
  })

  it('取消常驻且未召回时不可用', () => {
    const h = harness({ config: { resident: ['tool:meta_search'] } })

    expect(whenOf(h)({ agent: agent() })).toBe(false)
  })
})

describe('加载校验', () => {
  it('按 agent 作用域与 cwd 读取 Skill，并返回可渲染的值', async () => {
    const h = harness({ cwd: 'C:\\project' })
    const scope = agent()
    h.get.mockResolvedValue(loaded('office-docx', { resourceBase: { kind: 'directory', path: 'C:\\skills\\office-docx' } }))

    const value = await h.tool.execute({ name: 'office-docx' }, h.exec(scope))

    expect(h.get).toHaveBeenCalledWith('office-docx', {
      cwd: 'C:\\project',
      signal: expect.any(AbortSignal),
      scope,
    })
    expect(value).toEqual({
      name: 'office-docx',
      provider: 'filesystem',
      resourceBase: { kind: 'directory', path: 'C:\\skills\\office-docx' },
      content: '# office-docx\n\n正文',
    })
  })

  it('没有资源基址时不输出 resourceBase 字段', async () => {
    const h = harness()

    const value = await h.tool.execute({ name: 'office-docx' }, h.exec(agent())) as Record<string, unknown>

    expect('resourceBase' in value).toBe(false)
  })

  it('工作目录解析失败时退化为不传 cwd，仍能加载 Skill', async () => {
    const h = harness()
    const log = vi.fn()
    const deps = {
      ...h.deps,
      log,
      cwdOf: async () => {
        throw new Error('working directory unavailable')
      },
    }
    const tool = createShadowSkillTool(deps)

    await tool.execute({ name: 'office-docx' }, h.exec(agent()))

    expect(h.get).toHaveBeenCalledWith('office-docx', expect.objectContaining({ cwd: undefined }))
    expect(log).toHaveBeenCalled()
  })

  it('未知 Skill 报 unknown', async () => {
    const h = harness({ skill: undefined })

    await expect(h.tool.execute({ name: 'missing-skill' }, h.exec(agent()))).rejects.toThrow('unknown or no longer available')
  })

  it('不可被模型调用的 Skill 拒绝加载', async () => {
    const h = harness({ skill: loaded('office-docx', { invocation: { modelInvocable: false } }) })

    await expect(h.tool.execute({ name: 'office-docx' }, h.exec(agent()))).rejects.toThrow('model invocation')
  })

  it('池外的 Skill 在读取正文前就被拒绝', async () => {
    const h = harness({ config: { excluded: ['skill:office-docx'] } })

    await expect(h.tool.execute({ name: 'office-docx' }, h.exec(agent()))).rejects.toThrow('not available')
    expect(h.get).not.toHaveBeenCalled()
  })

  it('该角色黑名单里的 Skill 在读取正文前就被拒绝', async () => {
    const h = harness({
      config: { blacklist: { router: ['skill:office-docx'], worker: [] } },
      role: 'router',
    })

    await expect(h.tool.execute({ name: 'office-docx' }, h.exec(agent()))).rejects.toThrow('not available')
    expect(h.get).not.toHaveBeenCalled()
  })

  it('入口工具本身不可用时拒绝加载', async () => {
    const h = harness({ config: { excluded: ['tool:skill'] } })

    await expect(h.tool.execute({ name: 'office-docx' }, h.exec(agent()))).rejects.toThrow('skill')
    expect(h.get).not.toHaveBeenCalled()
  })

  it('非法名称直接拒绝', async () => {
    const h = harness()

    await expect(h.tool.execute({ name: 'Not Kebab' }, h.exec(agent()))).rejects.toThrow('invalid skill name')
    expect(h.get).not.toHaveBeenCalled()
  })

  it('缺 name 参数时由参数校验拒绝', async () => {
    const h = harness()

    await expect(h.tool.execute({}, h.exec(agent()))).rejects.toThrow('name')
  })

  it('没有调用方 agent 时拒绝', async () => {
    const h = harness()

    await expect(h.tool.execute({ name: 'office-docx' }, h.exec(undefined))).rejects.toThrow('会话内')
  })
})

describe('每 agent 的注册生命周期', () => {
  function scope(
    id: string,
    register = vi.fn<(...args: unknown[]) => () => void>(() => () => {}),
  ) {
    return {
      id,
      session: session(id),
      ctx: { tools: { register } },
    }
  }

  it('为每个 agent 注册一次并带上 when', () => {
    const registry = new ShadowSkillRegistry(harness().deps)
    const fake = scope('a1')

    registry.onAgentCreated(fake)

    expect(fake.ctx.tools.register).toHaveBeenCalledTimes(1)
    const [definition, options] = fake.ctx.tools.register.mock.calls[0] as unknown as [unknown, { when?: When }]
    expect((definition as { name: string }).name).toBe('skill')
    expect(typeof options.when).toBe('function')
  })

  it('重复创建同一 agent 时先释放上一次注册', () => {
    const registry = new ShadowSkillRegistry(harness().deps)
    const firstRelease = vi.fn<() => void>()
    const secondRelease = vi.fn<() => void>()
    const first = vi.fn(() => firstRelease)
    const second = vi.fn(() => secondRelease)

    registry.onAgentCreated(scope('a1', first))
    registry.onAgentCreated(scope('a1', second))

    expect(firstRelease).toHaveBeenCalledTimes(1)
    expect(secondRelease).not.toHaveBeenCalled()
  })

  it('agent 销毁时释放注册', () => {
    const registry = new ShadowSkillRegistry(harness().deps)
    const release = vi.fn<() => void>()
    const register = vi.fn(() => release)

    registry.onAgentCreated(scope('a1', register))
    registry.onAgentDisposed('a1')

    expect(release).toHaveBeenCalledTimes(1)
  })

  it('插件卸载时释放全部注册', () => {
    const registry = new ShadowSkillRegistry(harness().deps)
    const releaseA = vi.fn<() => void>()
    const releaseB = vi.fn<() => void>()

    registry.onAgentCreated(scope('a1', vi.fn(() => releaseA)))
    registry.onAgentCreated(scope('a2', vi.fn(() => releaseB)))
    registry.dispose()

    expect(releaseA).toHaveBeenCalledTimes(1)
    expect(releaseB).toHaveBeenCalledTimes(1)
  })

  it('注册失败只记 warning，不抛出', () => {
    const log = vi.fn()
    const registry = new ShadowSkillRegistry({ ...harness().deps, log })
    const register = vi.fn(() => {
      throw new Error('duplicate tool')
    })

    expect(() => registry.onAgentCreated(scope('a1', register))).not.toThrow()
    expect(log).toHaveBeenCalled()
  })
})

/** 取 when 判定函数；测试只关心判定本身。 */
function whenOf(h: Harness): When {
  return whenSkillToolUsable(h.deps)
}
