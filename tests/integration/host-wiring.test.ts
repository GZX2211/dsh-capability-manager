// tests/integration/host-wiring.test.ts
//
// 用受控的宿主服务边界验证 apply() 的装配：Skill 目录是否真的在 pre-step 注入、
// meta_search 是否拿到 Skill 候选与目录已注入的说明。
//
// 这里只在服务边界用替身（tools / systemPrompt / webServer / agents / skills），
// 不 mock 被测模块本身；目录、shadow、检索编排都是真实实现。

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as hostPlugin from '../../src/host/index.ts'
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

function createHost(options: { config?: CapabilityConfig; skills?: readonly { name: string; description: string }[] } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'cm-wiring-'))
  tempDirs.push(stateDir)

  const listeners = new Map<string, ((...args: unknown[]) => unknown)[]>()
  const globalTools: ToolDefinition[] = []
  const shadowTools: ToolDefinition[] = []
  const agents: FakeAgent[] = []
  const warnings: string[] = []
  const sections: unknown[] = []
  const webServers: unknown[] = []
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
  const allTools = () => [toolSource('meta_search'), toolSource('skill'), toolSource('read')]

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
  }

  const ctx = {
    logger: { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) } },
    get: (name: string) => (name === 'paRoles' ? undefined : undefined),
    effect: (callback: () => () => void) => {
      const cleanup = callback()
      cleanups.push(cleanup)
      return cleanup
    },
    on: (name: string, listener: (...args: unknown[]) => unknown) => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    tools: {
      register: (definition: ToolDefinition) => {
        globalTools.push(definition)
        return () => {}
      },
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

  hostPlugin.apply(ctx, { stateDir })

  const emit = async (name: string, ...args: unknown[]): Promise<unknown> => {
    const list = listeners.get(name)
    if (list === undefined || list.length === 0) throw new Error(`no listener for ${name}`)
    // 事件在本插件里都是单监听者；按注册顺序调用，模拟 waterfall 的 next。
    const [listener] = list
    return listener?.(...args)
  }

  const snapshot = async (): Promise<{
    capabilities: { id: string; kind: string; name: string }[]
    diagnostics?: { agents: { presentCount: number; allowCount: number }[] }
  }> => {
    const server = webServers[0] as { handler: (req: unknown, res: unknown) => Promise<void> }
    const chunks: string[] = []
    const response = {
      setHeader: () => {},
      writeHead: () => {},
      end: (chunk: unknown) => { chunks.push(String(chunk)) },
    }
    const request = Object.assign((async function* empty() {})() as never, {
      url: '/capability-manager/api/snapshot',
      method: 'GET',
      headers: { 'x-capability-manager-request': '1' },
    })
    await server.handler(request, response)
    return JSON.parse(chunks.join('')) as never
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
    config: options.config ?? DEFAULT_CONFIG,
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
  }
}

describe('apply 装配', () => {
  it('注册 meta_search、索引 section、pre-step 目录监听与 HTTP 面', () => {
    const host = createHost()

    expect(host.globalTools.map(tool => tool.name)).toContain('meta_search')
    expect(host.sections).toHaveLength(1)
    expect(host.webServers).toHaveLength(1)
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
})
