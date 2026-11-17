// tests/integration/skill-shadow.test.ts
//
// 用真实的 ToolsService 与 dsh-scope 验证 shadow 语义：
// agent scope 注册的同名工具必须遮蔽全局工具，并且 when=false 时整个工具消失
// （而不是回退到全局的那一个）——否则官方目录会重新注入。

import { Context } from '@deepseek-ai/cordis'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolsService, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { RecalledStore, type SessionLike } from '../../src/host/enforcement/recalled.ts'
import {
  createShadowSkillTool,
  whenSkillToolUsable,
  type LoadedSkill,
  type ShadowSkillDependencies,
} from '../../src/host/skill-consumer/shadow.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../src/shared/config.ts'

const contexts: Context[] = []
const scopes: Scope[] = []

afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function toolsContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolsService)
  contexts.push(ctx)
  return ctx
}

/** 模拟 agent-loop 的注入上下文：createScope 的可达服务来自铸造它的插件。 */
class LoopContext {
  static inject = ['tools'] as const
}

async function scopedFrom(ctx: Context): Promise<Context> {
  const fiber = await ctx.plugin(LoopContext)
  return fiber.ctx
}

function fakeTool(name: string, description = `${name} 的说明`): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    execute: async () => ({}),
  }
}

function session(id: string): SessionLike {
  return { id, toolHistory: () => ({ tools: [], updates: [] }) }
}

function skillDependencies(config: () => CapabilityConfig) {
  const loaded: LoadedSkill = {
    name: 'office-docx',
    description: '创建与编辑 Word 文档',
    provider: 'filesystem',
    content: '# 正文',
    invocation: { modelInvocable: true },
  }
  const deps: ShadowSkillDependencies = {
    config,
    roleOf: () => undefined,
    recalled: new RecalledStore(),
    skills: { get: async () => loaded },
  }
  return deps
}

describe('shadow skill 与真实工具注册表', () => {
  it('agent scope 的同名注册遮蔽全局 skill', async () => {
    const ctx = await toolsContext()
    const agent = { id: 's1', session: session('s1') }
    const globalSkill = fakeTool('skill', '官方 skill')
    ctx.tools.register(globalSkill)
    const scope = createScope(await scopedFrom(ctx), agent)
    scopes.push(scope)

    let current = DEFAULT_CONFIG
    const deps = skillDependencies(() => current)
    const shadow = createShadowSkillTool(deps)
    scope.ctx.tools.register(shadow, { when: whenSkillToolUsable(deps) })

    expect(ctx.tools.get('skill', agent)).toBe(shadow)
    expect(ctx.tools.get('skill')).toBe(globalSkill)

    const toolSet = await ctx.tools.resolve({
      agent: agent as never,
      modelSelection: { provider: 'p', model: 'm' },
      signal: new AbortController().signal,
    })
    expect(toolSet.view(agent as never).has('skill')).toBe(true)
    toolSet.dispose()

    current = { ...DEFAULT_CONFIG, excluded: ['tool:skill'] }
    const hidden = await ctx.tools.resolve({
      agent: agent as never,
      modelSelection: { provider: 'p', model: 'm' },
      signal: new AbortController().signal,
    })
    // 不回退到全局工具：否则官方 consumer 会重新认为 skill 可见并注入完整目录。
    expect(hidden.view(agent as never).has('skill')).toBe(false)
    hidden.dispose()
  })

  it('非常驻且未召回时 when=false，召回后恢复', async () => {
    const ctx = await toolsContext()
    const agent = { id: 's2', session: session('s2') }
    const scope = createScope(await scopedFrom(ctx), agent)
    scopes.push(scope)

    const current: CapabilityConfig = { ...DEFAULT_CONFIG, resident: ['tool:meta_search'] }
    const deps = skillDependencies(() => current)
    const shadow = createShadowSkillTool(deps)
    scope.ctx.tools.register(shadow, { when: whenSkillToolUsable(deps) })

    const resolve = () =>
      ctx.tools.resolve({
        agent: agent as never,
        modelSelection: { provider: 'p', model: 'm' },
        signal: new AbortController().signal,
      })

    const before = await resolve()
    expect(before.view(agent as never).has('skill')).toBe(false)
    before.dispose()

    deps.recalled.add(agent.session.id, ['skill'])
    const after = await resolve()
    expect(after.view(agent as never).has('skill')).toBe(true)
    after.dispose()
  })
})
