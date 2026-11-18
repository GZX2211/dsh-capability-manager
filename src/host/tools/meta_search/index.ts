// src/host/tools/meta_search/index.ts
//
// `meta_search` 的工具定义：参数校验、调用检索编排、渲染模型可见文本。
// 检索逻辑全部在 `search/`，这里只做 Tool-facing 适配。

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { MetaSearchRequest, MetaSearchSources } from '../../search/index.ts'
import { runMetaSearch } from '../../search/index.ts'
import type { SkillPayloadSource, ToolPayloadSource } from '../../search/payload.ts'

export const META_SEARCH_TOOL_NAME = 'meta_search'

/**
 * 工具描述。
 *
 * 导出而不是内联在定义里：装配处也要用它登记「本插件自建了哪些工具」，
 * 两处各写一份迟早会漂移。
 */
export const META_SEARCH_DESCRIPTION = `召回当前会话可用的工具与 Skill。

何时调用：你不确定有哪些工具或 Skill 可用时；或已知能力名但当前看不到它的完整定义时。

参数：
- names：准确名称或名称组（支持正则片段，如 "read|write|edit"），按名称匹配，永远可用，支持批量。只召回工具；Skill 名称不在这个通道里。
- keywords：自然语言关键词，按语义相似度召回工具与 Skill，仅在开启向量检索时生效。

返回：tools 为可直接调用的完整 schema；skills 为索引条目（name + description），
正文需再调用 skill 工具加载。返回为空表示这些能力已在当前上下文中，或不在能力池内。

失败：正则非法时返回说明并保留其余结果；向量检索未开启时 keywords 通道被忽略并在 notes 中说明。`

/**
 * 参数 schema；与 {@link META_SEARCH_DESCRIPTION} 一起被装配处复用。
 *
 * 取值范围写进 description 而不是 `minimum`/`maximum`：工具注册只接受
 * type/oneOf/properties/required/additionalProperties/items/enum/const 这些关键字，
 * 用了别的会让 `tools.register()` 直接抛错、工具静默消失。
 */
export const META_SEARCH_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    names: { type: 'string', description: '名称组，支持 | 分隔的正则片段；只召回工具' },
    keywords: { type: 'string', description: '自然语言关键词；开启向量检索时召回工具与 Skill' },
    limit: { type: 'number', description: '最多返回条数，默认 20，上限 50' },
  },
} as const

/** 工具结果：工具给完整 schema，Skill 只给索引条目。 */
interface MetaSearchValue {
  tools: ToolPayloadSource[]
  skills: SkillPayloadSource[]
  notes: string[]
}

/** 一次召回需要调用方记账的载荷。 */
export interface MetaSearchRecord {
  toolNames: string[]
  toolPayloads: string[]
  skillPayloads: string[]
}

export interface MetaSearchDependencies {
  /**
   * 该 agent 此刻可召回的工具与 Skill，以及两类已见载荷、模式开关。
   *
   * 带上已解析的请求：语义通道要按 `keywords` 现算命中，而候选与命中都依赖
   * 当前 agent 的可见集，无法在工具定义外预先算好。
   */
  sources: (agent: unknown, signal: AbortSignal, request: MetaSearchRequest) => Promise<MetaSearchSources>
  /** 记录本次召回并重建可见集；只在真的返回了能力时调用。 */
  record: (sessionId: string, outcome: MetaSearchRecord) => void
}

/**
 * 收窄模型给出的参数。
 *
 * 参数校验是工具自己的职责（executor 只做无损快照），所以这里给出的是
 * 模型能据此改正的错误，而不是笼统的「参数不合法」。
 *
 * @param rawArgs - 模型给出的参数。
 * @returns 校验后的请求。
 */
export function parseMetaSearchArgs(rawArgs: unknown): MetaSearchRequest {
  if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
    throw new Error('参数必须是一个对象，可包含 names、keywords、limit')
  }
  const record = rawArgs as Record<string, unknown>
  const request: MetaSearchRequest = {}
  if (record.names !== undefined) {
    if (typeof record.names !== 'string') throw new Error('names 必须是字符串')
    request.names = record.names
  }
  if (record.keywords !== undefined) {
    if (typeof record.keywords !== 'string') throw new Error('keywords 必须是字符串')
    request.keywords = record.keywords
  }
  if (record.limit !== undefined) {
    if (typeof record.limit !== 'number' || !Number.isFinite(record.limit)) {
      throw new Error('limit 必须是数字')
    }
    request.limit = record.limit
  }
  return request
}

/**
 * 渲染成模型可读文本。
 *
 * 明确写出「从下一步开始可调用」：restriction 重建要等下一个 step 才生效，
 * 不说清楚模型会在同一 step 里调用刚召回的工具并拿到 UNKNOWN_TOOL。
 */
export function renderMetaSearch(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
  const { tools, skills, notes } = value as MetaSearchValue
  const lines: string[] = []

  if (tools.length > 0) {
    lines.push('## 可调用的工具')
    for (const tool of tools) {
      lines.push('', `### ${tool.name}`, tool.description ?? '', '```json', JSON.stringify(tool.parameters ?? {}, null, 2), '```')
      lines.push('', '（该工具从下一步开始可调用）')
    }
  }

  if (skills.length > 0) {
    lines.push('', '## Skill 索引', '用 `skill` 工具按名称加载正文。')
    for (const skill of skills) lines.push(`- \`${skill.name}\`：${skill.description}`)
  }

  if (tools.length === 0 && skills.length === 0) {
    lines.push('没有新的能力可返回。目标能力可能已在当前上下文中，或不在能力池内。')
  }

  for (const note of notes) lines.push('', `> ${note}`)

  return [{ type: 'text', text: lines.join('\n') }]
}

export function createMetaSearchTool(deps: MetaSearchDependencies): ToolDefinition {
  return {
    name: META_SEARCH_TOOL_NAME,
    description: META_SEARCH_DESCRIPTION,
    parameters: META_SEARCH_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['tools', 'skills', 'notes'],
        properties: {
          tools: { type: 'array', items: { type: 'object' } },
          skills: { type: 'array', items: { type: 'object' } },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
      render: renderMetaSearch,
    },
    async execute(rawArgs: unknown, exec: unknown): Promise<unknown> {
      const context = exec as { agent?: { session: { id: string } }; signal: AbortSignal }
      const agent = context.agent
      if (agent === undefined) {
        throw new Error('meta_search 只能在会话内调用：当前没有发起调用的 agent')
      }
      const session = agent.session
      const request = parseMetaSearchArgs(rawArgs)
      const outcome = runMetaSearch(await deps.sources(agent, context.signal, request), request)
      if (outcome.toolNames.length > 0 || outcome.skillPayloads.length > 0) {
        deps.record(session.id, {
          toolNames: outcome.toolNames,
          toolPayloads: outcome.toolPayloads,
          skillPayloads: outcome.skillPayloads,
        })
      }
      return { tools: outcome.tools, skills: outcome.skills, notes: outcome.notes }
    },
  }
}

