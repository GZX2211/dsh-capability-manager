// tests/integration/host-wiring.test.ts
//
// 用受控的宿主服务边界验证 apply() 的装配：Skill 目录是否真的在 pre-step 注入、
// meta_search 是否拿到 Skill 候选与目录已注入的说明。
//
// 这里只在服务边界用替身（tools / systemPrompt / webServer / agents / skills），
// 不 mock 被测模块本身；目录、shadow、检索编排都是真实实现。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as hostPlugin from '../../src/host/index.ts'
import type { EmbeddingOverrides } from '../../src/host/index.ts'
import type { HostContext } from '../../src/host/context.ts'
import { CATALOG_SOURCE_KIND } from '../../src/host/skill-consumer/catalog.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../src/shared/config.ts'

const tempDirs: string[] = []
const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface FakeAgent {
  id: string
  session: {
    id: string
    toolHistory(): { tools: { name: string }[]; updates: [] }
    deriveMessages(): unknown[]
  }
  ctx: {
    tools: {
      definitions(scope: unknown): readonly { name: string; description?: string; parameters?: unknown }[]
      restrict(filter: { allow?: readonly string[] }): () => void
      register(definition: ToolDefinition, options?: unknown): () => void
    }
    effect(callback: () => () => void): () => void
  }
}

function toolSource(name: string) {
  return { name, description: `${name} 的说明`, parameters: { type: 'object', properties: {} } }
}

function createHost(options: {
  config?: CapabilityConfig
  skills?: readonly { name: string; description: string }[]
  /** 额外注册的全局工具名，用来模拟 preset 层与 MCP 工具。 */
  extraTools?: readonly string[]
  /** 已连接的 MCP 服务器名。 */
  mcpServers?: readonly string[]
  /** 模拟 Personal Agent 的角色服务；缺省表示没有 `ctx.paRoles`。 */
  roles?: (sessionId: string) => 'router' | 'worker' | undefined
  /** 向量基础设施注入：测试用假嵌入器代替原生运行时与 24MB 模型。 */
  embedding?: EmbeddingOverrides
} = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'cm-wiring-'))
  tempDirs.push(stateDir)
  // 配置是磁盘事实：宿主只从状态目录读，不看调用方的入参。
  if (options.config !== undefined) {
    writeFileSync(join(stateDir, 'config.json'), JSON.stringify(options.config), 'utf8')
  }

  const listeners = new Map<string, ((...args: unknown[]) => unknown)[]>()
  const onOptions: (unknown | undefined)[] = []
  const globalTools: ToolDefinition[] = []
  const shadowTools: ToolDefinition[] = []
  const agents: FakeAgent[] = []
  const warnings: string[] = []
  const sections: unknown[] = []
  const webServers: unknown[] = []
  const providers: unknown[] = []
  const registeredSkills: { name: string; content: string; source: string }[] = []
  const skillList = options.skills ?? [{ name: 'alpha-skill', description: 'Alpha 的说明' }]
  const skillSummaries = skillList.map(skill => ({
    ...skill,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'user-dsh',
    provider: 'filesystem',
  }))

  const history: unknown[] = []
  // definitions() 必须反映当前生效的 restriction：enforcement 会先解除自己的限制
  // 再吸收，而 seenTools 读的是限制生效后的可见集。
  let allowed: Set<string> | undefined
  // 工具全集包含运行时注册进来的工具：真实宿主里 definitions() 同样能看到它们。
  const allTools = () => {
    const base = [
      toolSource('meta_search'),
      toolSource('skill'),
      toolSource('read'),
      ...(options.extraTools ?? []).map(toolSource),
    ]
    const names = new Set(base.map(source => source.name))
    for (const definition of globalTools) {
      if (names.has(definition.name)) continue
      names.add(definition.name)
      base.push(toolSource(definition.name))
    }
    return base
  }

  const agent: FakeAgent = {
    id: 'session-1',
    session: {
      id: 'session-1',
      toolHistory: () => ({ tools: [{ name: 'meta_search' }], updates: [] }),
      deriveMessages: () => history,
    },
    ctx: {
      tools: {
        definitions: () => (allowed === undefined ? allTools() : allTools().filter(source => allowed?.has(source.name))),
        restrict: filter => {
          for (const name of filter.allow ?? []) {
            if (!allTools().some(source => source.name === name)) {
              throw new Error(`tools.restrict() names unknown global tool "${name}"`)
            }
          }
          const previous = allowed
          allowed = new Set(filter.allow)
          return () => {
            allowed = previous
          }
        },
        register: (definition) => {
          shadowTools.push(definition)
          return () => {}
        },
      },
      effect(callback: () => () => void) {
        const cleanup = callback()
        return () => cleanup()
      },
    },
  }
  agents.push(agent)

  const fakeSkills = {
    async snapshot(request: { scope?: unknown }) {
      if (request.scope === undefined) return { skills: skillSummaries, complete: true }
      return { skills: skillSummaries, complete: true }
    },
    async get() {
      return undefined
    },
    registerProvider(create: (control: { invalidate: () => void }) => unknown) {
      providers.push(create({ invalidate: () => {} }))
      return () => {}
    },
    register(skill: { name: string; content: string; source: string }) {
      registeredSkills.push(skill)
      return () => {}
    },
  }

  const ctx = {
    logger: { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) } },
    get: (name: string) => {
      if (name === 'mcpManager' && options.mcpServers !== undefined) {
        return { list: () => options.mcpServers?.map(server => ({ name: server })) }
      }
      if (name === 'paRoles' && options.roles !== undefined) {
        return { roleOf: (sessionId: string) => options.roles?.(sessionId) }
      }
      return undefined
    },
    effect: (callback: () => () => void) => {
      const cleanup = callback()
      cleanups.push(cleanup)
      return cleanup
    },
    on: (name: string, listener: (...args: unknown[]) => unknown, options?: unknown) => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      if (name === 'agent/pre-step') onOptions.push(options)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    tools: {
      register: (definition: ToolDefinition) => {
        globalTools.push(definition)
        // 真实宿主在注册后同步发出 tools/change；这里照做，让吸收路径真的跑起来。
        for (const listener of listeners.get('tools/change') ?? []) listener()
        return () => {
          const index = globalTools.indexOf(definition)
          if (index >= 0) globalTools.splice(index, 1)
        }
      },
      get: () => undefined,
    },
    systemPrompt: {
      section: (input: unknown) => {
        sections.push(input)
        return () => {}
      },
    },
    webServer: {
      getOrigin: () => 'http://127.0.0.1:1234',
      register: (input: unknown) => {
        webServers.push(input)
        return () => {}
      },
    },
    agents: { list: () => agents },
    skills: fakeSkills,
  } as unknown as HostContext

  hostPlugin.apply(ctx, { stateDir, embedding: options.embedding })

  const emit = async (name: string, ...args: unknown[]): Promise<unknown> => {
    const list = listeners.get(name)
    if (list === undefined || list.length === 0) throw new Error(`no listener for ${name}`)
    // 事件在本插件里都是单监听者；按注册顺序调用，模拟 waterfall 的 next。
    const [listener] = list
    return listener?.(...args)
  }

  /** 发一次 HTTP 请求；返回状态码与解析后的响应体。 */
  const request = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }> => {
    const server = webServers[0] as { handler: (req: unknown, res: unknown) => Promise<void> }
    const chunks: string[] = []
    const statuses: number[] = []
    const response = {
      setHeader: () => {},
      writeHead: (status: number) => {
        statuses.push(status)
      },
      end: (chunk: unknown) => {
        chunks.push(String(chunk))
      },
    }
    const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body))
    const incoming = Object.assign(
      (async function* empty() {
        yield payload
      })() as never,
      {
        url: path,
        method,
        headers: { 'x-capability-manager-request': '1' },
      },
    )
    await server.handler(incoming, response)
    return {
      status: statuses[0] ?? 0,
      body: chunks.length === 0 ? undefined : JSON.parse(chunks.join('')),
    }
  }

  const snapshot = async (): Promise<{
    capabilities: { id: string; kind: string; name: string; source?: string; owned?: boolean }[]
    rolesAvailable: boolean
    sessions?: { id: string; role?: string; roleSource: string }[]
    embedding: { enabled: boolean; status: string; message?: string }
    warnings: { code: string }[]
    diagnostics?: { agents: { presentCount: number; allowCount: number }[] }
  }> => {
    const result = await request('GET', '/capability-manager/api/snapshot')
    return result.body as never
  }

  return {
    agent,
    history,
    globalTools,
    shadowTools,
    warnings,
    sections,
    webServers,
    snapshot,
    request,
    stateDir,
    providers,
    registeredSkills,
    onOptions,
    config: options.config ?? DEFAULT_CONFIG,
    /** 该 agent 此刻可见的工具名：restriction 生效后的真实结果。 */
    visible(): string[] {
      return agent.ctx.tools.definitions(agent).map(source => source.name).sort()
    },
    createAgent() {
      return emit('agent/created', { agent })
    },
    preStep(next = async () => ({ kind: 'enter' as const, messages: [] })) {
      return emit('agent/pre-step', {
        agent,
        messages: [],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      }, next)
    },
    /** 索引 section 在当前配置下的渲染结果。 */
    indexText(): string {
      const section = sections[0] as { text: (context: { agent?: unknown }) => string }
      return section.text({ agent })
    },
  }
}

describe('apply 装配', () => {
  it('注册 meta_search、索引 section、pre-step 目录监听与 HTTP 面', () => {
    const host = createHost()

    expect(host.globalTools.map(tool => tool.name)).toContain('meta_search')
    expect(host.sections).toHaveLength(1)
    expect(host.webServers).toHaveLength(1)
    // 目录 listener 必须在最外层，才能在官方 consumer 的退役消息之后追加。
    expect(host.onOptions).toEqual([{ prepend: true }])
  })

  it('agent 创建时注册 shadow skill', () => {
    const host = createHost()

    void host.createAgent()

    expect(host.shadowTools.map(tool => tool.name)).toContain('skill')
  })

  it('默认形态在 pre-step 注入 Skill 目录', async () => {
    const host = createHost()
    await host.createAgent()

    const decision = await host.preStep() as { kind: string; messages: { source: { kind: string }; content: { text: string }[] }[] }

    expect(decision.kind).toBe('enter')
    const catalog = decision.messages.find(message => message.source.kind === CATALOG_SOURCE_KIND)
    expect(catalog).toBeDefined()
    expect(catalog?.content[0]?.text).toContain('- `alpha-skill`：Alpha 的说明')
  })

  it('目录已注入后同一份内容不再重复', async () => {
    const host = createHost()
    await host.createAgent()
    const first = await host.preStep() as { messages: unknown[] }
    for (const message of first.messages) host.history.push(message)

    const second = await host.preStep() as { messages: unknown[] }

    expect(second.messages.filter(message => (message as { source?: { kind?: string } }).source?.kind === CATALOG_SOURCE_KIND)).toHaveLength(0)
  })

  it('meta_search 拿到 Skill 候选，并在目录已注入时说明无需召回', async () => {
    const host = createHost()
    await host.createAgent()
    const metaSearch = host.globalTools.find(tool => tool.name === 'meta_search')
    if (metaSearch === undefined) throw new Error('meta_search not registered')

    const value = await metaSearch.execute(
      { names: 'alpha-skill' },
      { agent: host.agent as never, signal: new AbortController().signal } as never,
    ) as { tools: unknown[]; skills: unknown[]; notes: string[] }

    expect(value.tools).toEqual([])
    expect(value.skills).toEqual([])
    expect(value.notes.some(note => note.includes('已在当前上下文中完整可见'))).toBe(true)
  })

  it('meta_search 仍能按名称召回当前不可见的工具', async () => {
    const host = createHost()
    await host.createAgent()
    const metaSearch = host.globalTools.find(tool => tool.name === 'meta_search')
    if (metaSearch === undefined) throw new Error('meta_search not registered')

    const value = await metaSearch.execute(
      { names: 'read' },
      { agent: host.agent as never, signal: new AbortController().signal } as never,
    ) as { tools: { name: string }[] }

    expect(value.tools.map(tool => tool.name)).toEqual(['read'])
  })

  it('快照同时包含工具与 Skill 能力', async () => {
    const host = createHost()
    await host.createAgent()

    const snapshot = await host.snapshot()

    expect(snapshot.capabilities.map(capability => capability.id)).toEqual([
      'tool:meta_search',
      'tool:read',
      'tool:skill',
      'skill:alpha-skill',
    ])
  })

  it('自建工具在还没有会话吸收前就出现在快照里，并标为自建', async () => {
    const host = createHost()
    writeSelfmadeTool(host.stateDir, 'greet', { name: 'greet', description: '打招呼' })

    const snapshot = await host.snapshot()

    expect(snapshot.capabilities.find(capability => capability.id === 'tool:greet')).toMatchObject({
      source: 'custom',
      owned: true,
    })
  })

  it('自建工具会被真的注册到工具表里', async () => {
    const host = createHost()
    writeSelfmadeTool(host.stateDir, 'greet', { name: 'greet', description: '打招呼' })

    await host.snapshot()

    expect(host.globalTools.map(tool => tool.name)).toContain('greet')
  })

  it('MCP 命名空间下的工具标为 mcp 来源', async () => {
    const host = createHost({ extraTools: ['github__issue'], mcpServers: ['github'] })

    const snapshot = await host.snapshot()

    expect(snapshot.capabilities.find(capability => capability.id === 'tool:github__issue')).toMatchObject({
      source: 'mcp',
      owned: false,
    })
  })

  it('自建 Skill 被标为自建并接进 provider', async () => {
    const host = createHost({ skills: [{ name: 'mine', description: '我的 Skill' }] })
    writeSelfmadeSkill(host.stateDir, 'mine')

    const snapshot = await host.snapshot()

    expect(snapshot.capabilities.find(capability => capability.id === 'skill:mine')).toMatchObject({
      source: 'custom',
      owned: true,
    })
    expect(host.providers).toHaveLength(1)
  })

  it('自建 Skill provider 列出状态目录里的 Skill', async () => {
    const host = createHost()
    writeSelfmadeSkill(host.stateDir, 'mine')
    const provider = host.providers[0] as {
      list(options: unknown): Promise<readonly { name: string; source: string }[]>
    }

    const listed = await provider.list({})

    expect(listed).toEqual([expect.objectContaining({ name: 'mine', source: 'custom' })])
  })

  it('三角测量：工具与 Skill 的归属互不串味', async () => {
    const host = createHost({ extraTools: ['greet'], skills: [{ name: 'greet', description: '同名 Skill' }] })
    writeSelfmadeSkill(host.stateDir, 'greet')

    const snapshot = await host.snapshot()

    expect(snapshot.capabilities.find(capability => capability.id === 'tool:greet')).toMatchObject({ source: 'official' })
    expect(snapshot.capabilities.find(capability => capability.id === 'skill:greet')).toMatchObject({ source: 'custom' })
  })

  it('注册内置 capability-creator，正文带上真实状态目录', () => {
    const host = createHost()

    const creator = host.registeredSkills.find(skill => skill.name === 'capability-creator')

    expect(creator).toBeDefined()
    expect(creator?.content).toContain(host.stateDir)
    expect(creator?.content).not.toContain('{{STATE_DIR}}')
  })

  it('验收：声明式工具写入后无需重启即可被 meta_search 召回并调用', async () => {
    const host = createHost()
    await host.createAgent()
    writeSelfmadeTool(
      host.stateDir,
      'greet',
      { name: 'greet', description: '打招呼' },
      { command: process.execPath, args: ['-e', 'process.stdout.write("pong")'] },
    )

    // 读一次快照等价于「监听之外的那次兜底扫描」：注册 → tools/change → 吸收。
    await host.snapshot()

    const metaSearch = host.globalTools.find(tool => tool.name === 'meta_search')
    if (metaSearch === undefined) throw new Error('meta_search not registered')
    const recalled = await metaSearch.execute(
      { names: 'greet' },
      { agent: host.agent as never, signal: new AbortController().signal } as never,
    ) as { tools: { name: string }[] }

    expect(recalled.tools.map(tool => tool.name)).toEqual(['greet'])

    const greet = host.globalTools.find(tool => tool.name === 'greet')
    if (greet === undefined) throw new Error('greet not registered')
    const value = await greet.execute(
      {},
      { agent: host.agent as never, signal: new AbortController().signal } as never,
    )

    expect(value).toEqual({ exitCode: 0, stdout: 'pong', stderr: '' })
  })
})

/** 让 `read` 直接可用：黑名单要能被观察到，能力本身必须先有资格出现。 */
const READ_RESIDENT: CapabilityConfig = {
  ...DEFAULT_CONFIG,
  resident: ['tool:meta_search', 'tool:skill', 'tool:read'],
}

/** 同一份配置：Router 禁用 `read`，Worker 不受影响。 */
const ROUTER_DENIES_READ: CapabilityConfig = {
  ...READ_RESIDENT,
  blacklist: { router: ['tool:read'], worker: [] },
}

/**
 * 召回场景的同一份配置：`read` 非常驻。
 *
 * 常驻工具本来就在上下文里，会被载荷级去重剔除；要观察「黑名单是否影响召回」，
 * 目标能力必须先处于非常驻状态。
 */
const ROUTER_RECALL_DENIES_READ: CapabilityConfig = {
  ...DEFAULT_CONFIG,
  blacklist: { router: ['tool:read'], worker: [] },
}

describe('角色黑名单', () => {
  it('Router 黑名单里的工具对 Router 会话不可见', async () => {
    const host = createHost({ config: ROUTER_DENIES_READ, roles: () => 'router' })
    await host.createAgent()

    expect(host.visible()).not.toContain('read')
  })

  it('同一份配置对 Worker 会话无影响', async () => {
    const host = createHost({ config: ROUTER_DENIES_READ, roles: () => 'worker' })
    await host.createAgent()

    expect(host.visible()).toContain('read')
  })

  it('未知角色不应用任何黑名单：PA 缺省且没有手动绑定', async () => {
    const host = createHost({ config: ROUTER_DENIES_READ })
    await host.createAgent()

    expect(host.visible()).toContain('read')
  })

  it('手动绑定补足 PA 没有答案的会话', async () => {
    const host = createHost({
      config: { ...ROUTER_DENIES_READ, roleBindings: { 'session-1': 'router' } },
      roles: () => undefined,
    })
    await host.createAgent()

    expect(host.visible()).not.toContain('read')
  })

  it('PA 判定的角色优先于手动绑定', async () => {
    const host = createHost({
      config: { ...ROUTER_DENIES_READ, roleBindings: { 'session-1': 'router' } },
      roles: () => 'worker',
    })
    await host.createAgent()

    expect(host.visible()).toContain('read')
  })

  it('Router 黑名单里的 Skill 不出现在 Router 的目录里', async () => {
    const host = createHost({
      config: { ...DEFAULT_CONFIG, blacklist: { router: ['skill:alpha-skill'], worker: [] } },
      roles: () => 'router',
    })
    await host.createAgent()

    const decision = await host.preStep() as { messages: { content: { text: string }[] }[] }

    expect(decision.messages.flatMap(message => message.content.map(part => part.text)).join('\n')).not.toContain(
      'alpha-skill',
    )
  })

  it('Worker 的目录仍包含被 Router 禁用的 Skill', async () => {
    const host = createHost({
      config: { ...DEFAULT_CONFIG, blacklist: { router: ['skill:alpha-skill'], worker: [] } },
      roles: () => 'worker',
    })
    await host.createAgent()

    const decision = await host.preStep() as { messages: { content: { text: string }[] }[] }

    expect(decision.messages.flatMap(message => message.content.map(part => part.text)).join('\n')).toContain(
      'alpha-skill',
    )
  })

  it('meta_search 不为 Router 召回被该角色禁用的工具', async () => {
    const host = createHost({ config: ROUTER_RECALL_DENIES_READ, roles: () => 'router' })
    await host.createAgent()
    const metaSearch = host.globalTools.find(tool => tool.name === 'meta_search')
    if (metaSearch === undefined) throw new Error('meta_search not registered')

    const value = await metaSearch.execute(
      { names: 'read' },
      { agent: host.agent as never, signal: new AbortController().signal } as never,
    ) as { tools: { name: string }[] }

    expect(value.tools).toEqual([])
  })

  it('meta_search 对 Worker 仍能召回同一工具', async () => {
    const host = createHost({ config: ROUTER_RECALL_DENIES_READ, roles: () => 'worker' })
    await host.createAgent()
    const metaSearch = host.globalTools.find(tool => tool.name === 'meta_search')
    if (metaSearch === undefined) throw new Error('meta_search not registered')

    const value = await metaSearch.execute(
      { names: 'read' },
      { agent: host.agent as never, signal: new AbortController().signal } as never,
    ) as { tools: { name: string }[] }

    expect(value.tools.map(tool => tool.name)).toEqual(['read'])
  })

  it('快照暴露会话角色与来源', async () => {
    const host = createHost({ roles: () => 'router' })
    await host.createAgent()

    const snapshot = await host.snapshot()

    expect(snapshot.rolesAvailable).toBe(true)
    expect(snapshot.sessions).toEqual([{ id: 'session-1', role: 'router', roleSource: 'pa' }])
  })

  it('没有 PA 时快照仍给出绑定来源的角色', async () => {
    const host = createHost({ config: { ...DEFAULT_CONFIG, roleBindings: { 'session-1': 'worker' } } })
    await host.createAgent()

    const snapshot = await host.snapshot()

    expect(snapshot.rolesAvailable).toBe(false)
    expect(snapshot.sessions).toEqual([{ id: 'session-1', role: 'worker', roleSource: 'binding' }])
  })

  it('未知角色的会话在快照里只带来源，不带角色', async () => {
    const host = createHost()
    await host.createAgent()

    const snapshot = await host.snapshot()

    expect(snapshot.sessions).toEqual([{ id: 'session-1', roleSource: 'unknown' }])
  })
})

/** 假向量基础设施：按「文本里是否含关键词」给两维向量，足以观察召回与模式切换。 */
function fakeEmbedding(keyword: string, options: { fail?: boolean } = {}): EmbeddingOverrides {
  return {
    ensureModel: async () =>
      options.fail === true ? { ok: false, message: 'no network' } : { ok: true },
    loadEmbedder: async () => ({
      async embed(texts: readonly string[]) {
        return texts.map(text =>
          text.toLowerCase().includes(keyword.toLowerCase())
            ? Float32Array.from([1, 0])
            : Float32Array.from([0, 1]),
        )
      },
      async dispose() {},
    }),
    modelPresent: () => true,
  }
}

const ENABLE_EMBEDDING = '/capability-manager/api/embedding/enable'
const DISABLE_EMBEDDING = '/capability-manager/api/embedding/disable'

describe('向量检索', () => {
  it('开启端点返回 200，快照变为 ready 并写回配置', async () => {
    const host = createHost({ embedding: fakeEmbedding('alpha') })

    const response = await host.request('POST', ENABLE_EMBEDDING)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
    const snapshot = await host.snapshot()
    expect(snapshot.embedding).toMatchObject({ enabled: true, status: 'ready' })
  })

  it('开启后进入模式 B：目录不注入、索引为空', async () => {
    const host = createHost({ embedding: fakeEmbedding('alpha') })
    await host.createAgent()
    await host.request('POST', ENABLE_EMBEDDING)

    const decision = await host.preStep() as { messages: { source?: { kind?: string } }[] }

    expect(decision.messages.filter(message => message.source?.kind === CATALOG_SOURCE_KIND)).toHaveLength(0)
    expect(host.indexText()).toBe('')
  })

  it('模式 B 下 keywords 召回 Skill 索引条目', async () => {
    const host = createHost({
      skills: [{ name: 'alpha-skill', description: 'Alpha 的说明' }],
      embedding: fakeEmbedding('alpha'),
    })
    await host.createAgent()
    await host.request('POST', ENABLE_EMBEDDING)
    const metaSearch = host.globalTools.find(tool => tool.name === 'meta_search')
    if (metaSearch === undefined) throw new Error('meta_search not registered')

    const value = await metaSearch.execute(
      { keywords: 'alpha' },
      { agent: host.agent as never, signal: new AbortController().signal } as never,
    ) as { skills: { name: string }[]; notes: string[] }

    expect(value.skills.map(skill => skill.name)).toEqual(['alpha-skill'])
  })

  it('模式 B 下 keywords 也能召回工具', async () => {
    const host = createHost({ embedding: fakeEmbedding('read') })
    await host.createAgent()
    await host.request('POST', ENABLE_EMBEDDING)
    const metaSearch = host.globalTools.find(tool => tool.name === 'meta_search')
    if (metaSearch === undefined) throw new Error('meta_search not registered')

    const value = await metaSearch.execute(
      { keywords: 'read file' },
      { agent: host.agent as never, signal: new AbortController().signal } as never,
    ) as { tools: { name: string }[] }

    expect(value.tools.map(tool => tool.name)).toEqual(['read'])
  })

  it('模式 A 下 keywords 被忽略并给出说明', async () => {
    const host = createHost()
    await host.createAgent()
    const metaSearch = host.globalTools.find(tool => tool.name === 'meta_search')
    if (metaSearch === undefined) throw new Error('meta_search not registered')

    const value = await metaSearch.execute(
      { keywords: 'alpha' },
      { agent: host.agent as never, signal: new AbortController().signal } as never,
    ) as { tools: unknown[]; skills: unknown[]; notes: string[] }

    expect(value.tools).toEqual([])
    expect(value.skills).toEqual([])
    expect(value.notes.some(note => note.includes('未开启'))).toBe(true)
  })

  it('关闭端点恢复模式 A：索引重新注入', async () => {
    const host = createHost({ embedding: fakeEmbedding('alpha') })
    await host.createAgent()
    await host.request('POST', ENABLE_EMBEDDING)

    const response = await host.request('POST', DISABLE_EMBEDDING)

    expect(response.status).toBe(200)
    expect((await host.snapshot()).embedding).toMatchObject({ enabled: false, status: 'idle' })
    expect(host.indexText()).toContain('<available_tools>')
  })

  it('下载失败返回 502，并保持关闭', async () => {
    const host = createHost({ embedding: fakeEmbedding('alpha', { fail: true }) })

    const response = await host.request('POST', ENABLE_EMBEDDING)

    expect(response.status).toBe(502)
    expect(response.body).toMatchObject({ ok: false, code: 'embedding-download-failed' })
    expect((await host.snapshot()).embedding).toMatchObject({ enabled: false, status: 'failed' })
  })
})

/** 在状态目录里放一个声明式自建工具，走真实的扫描与注册路径。 */
function writeSelfmadeTool(
  stateDir: string,
  name: string,
  meta: { name: string; description: string },
  shell: { command: string; args?: string[] } = { command: 'echo' },
): void {
  const dir = join(stateDir, 'tools', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      ...meta,
      parameters: { type: 'object', properties: {} },
      kind: 'shell',
      shell,
    }),
    'utf8',
  )
}

/** 在状态目录里放一个自建 Skill 包。 */
function writeSelfmadeSkill(stateDir: string, name: string): void {
  const dir = join(stateDir, 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${name} 的说明`, '---', '', '# 正文'].join('\n'),
    'utf8',
  )
}
