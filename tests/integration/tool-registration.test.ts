// tests/integration/tool-registration.test.ts
//
// 用真实的 ToolsService 与 SystemPrompt 注册本插件的工具。
//
// 这里验证的是「注册不抛错」这件具体的事：工具注册接受的是受限的 JSON Schema
// 子集，用了不支持的关键字会直接抛错，而抛错在装配处只记一条 warning——
// 表现为工具静默消失、模型什么都看不见。单元测试覆盖不到这一层。

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolsService from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createMetaSearchTool,
  META_SEARCH_TOOL_NAME,
} from '../../src/host/tools/meta_search/index.ts'

const contexts: Context[] = []

async function toolsContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolsService)
  contexts.push(ctx)
  return ctx
}

/** 模拟宿主 preset 层注册的工具。 */
function defineTool(name: string) {
  return {
    name,
    description: `${name} 的说明`,
    parameters: { type: 'object' as const, additionalProperties: false, properties: {} },
    output: { schema: { type: 'object' as const, properties: {} }, render: () => [] },
    execute: async () => ({}),
  }
}

function metaSearch() {
  return createMetaSearchTool({
    candidates: () => new Map(),
    seen: () => new Set(),
    record: () => {},
  })
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('工具注册', () => {
  it('meta_search 能被真实 ToolsService 接受', async () => {
    const ctx = await toolsContext()

    const dispose = ctx.tools.register(metaSearch())

    expect(ctx.tools.definitions().map(definition => definition.name)).toContain(META_SEARCH_TOOL_NAME)
    dispose()
  })

  it('参数与输出 schema 都在支持的子集内', async () => {
    const ctx = await toolsContext()

    expect(() => ctx.tools.register(metaSearch())).not.toThrow()
  })

  it('注销后工具从注册表消失', async () => {
    const ctx = await toolsContext()

    const dispose = ctx.tools.register(metaSearch())
    dispose()

    expect(ctx.tools.definitions().map(definition => definition.name)).not.toContain(META_SEARCH_TOOL_NAME)
  })

  it('schemas() 给出含名称与参数的完整定义，可被 meta_search 原样返回', async () => {
    const ctx = await toolsContext()
    ctx.tools.register(defineTool('read'))
    ctx.tools.register(metaSearch())

    const schema = ctx.tools.schemas().find(candidate => candidate.name === META_SEARCH_TOOL_NAME)

    expect(schema?.description).toContain('names')
    expect(Object.keys(schema?.parameters ?? {})).toContain('properties')
  })
})
