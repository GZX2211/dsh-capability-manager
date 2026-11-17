// src/host/search/index.ts
//
// `meta_search` 的检索编排：名称通道 → 语义通道的预计算命中 → 载荷级去重 → 截断。
//
// 两条通道的范围刻意不同（用户确认的口径）：
//   · names 只召回工具：Skill 名称不在精确名称通道里，避免与「目录已全量列出」
//     或「Skill 用语义召回」两种模式互相打架
//   · keywords 只在向量检索开启时生效，可以同时召回工具与 Skill
//
// 这里只做编排与纯计算：候选与语义命中都由调用方注入，因此本模块可以在没有
// Host 的情况下完整单测。语义命中的计算（异步）留在调用方，本模块保持同步。

import { dedupeByPayload } from './dedupe.ts'
import { compileNamePattern, matchNames } from './lexical.ts'
import { skillPayload, toolPayload, type SkillPayloadSource, type ToolPayloadSource } from './payload.ts'

/** 默认返回条数。 */
const DEFAULT_LIMIT = 20
/** 返回条数上限：一次召回太多会挤掉真正的工作上下文。 */
const MAX_LIMIT = 50

/** 语义通道的预计算命中；M5 接入向量检索后由调用方给出。 */
export interface KeywordHits {
  readonly tools: readonly string[]
  readonly skills: readonly string[]
}

export interface MetaSearchSources {
  /** 可召回的工具：名称 → 完整 schema。调用方负责按池、黑名单与存在性过滤。 */
  tools: ReadonlyMap<string, ToolPayloadSource>
  /** 可召回的 Skill：名称 → 目录条目。调用方负责按池与黑名单过滤。 */
  skills: ReadonlyMap<string, SkillPayloadSource>
  /** 当前已以完整 schema 出现在上下文里的工具载荷。 */
  seenTools: ReadonlySet<string>
  /** 当前已在目录里出现过的 Skill 载荷。 */
  seenSkills: ReadonlySet<string>
  /** 向量检索是否开启。 */
  embeddingEnabled: boolean
  /** Skill 目录是否已全量注入（模式 A）。用于给出准确的「无需召回」说明。 */
  skillCatalogResident: boolean
  /** 语义通道的预计算命中；缺省表示语义检索尚未就绪。 */
  keywordHits?: KeywordHits | undefined
}

export interface MetaSearchRequest {
  /** 名称或名称组；按正则片段解释。 */
  names?: string | undefined
  /** 自然语言关键词；仅在向量检索开启时生效。 */
  keywords?: string | undefined
  /** 最多返回条数。 */
  limit?: number | undefined
}

export interface MetaSearchOutcome {
  /** 可直接调用的完整 schema。 */
  tools: ToolPayloadSource[]
  /** Skill 目录条目；正文由 `skill` 工具加载。 */
  skills: SkillPayloadSource[]
  /** 给模型的说明：被忽略的通道、非法参数等。 */
  notes: string[]
  /** 返回的工具名；调用方据此记录召回集合。 */
  toolNames: string[]
  /** 返回工具的载荷；调用方据此并入已见集合。 */
  toolPayloads: string[]
  /** 返回 Skill 的载荷；调用方据此并入已见集合。 */
  skillPayloads: string[]
}

/**
 * 执行一次召回。
 *
 * 名称通道永远可用；关键词通道依赖向量检索，未开启或尚未就绪时只给说明不报错——
 * 让模型知道「换个方式再来」比直接失败更有用。
 *
 * @param sources - 候选工具与 Skill、两类已见载荷、模式开关与语义命中。
 * @param request - 模型给出的参数。
 * @returns 工具、Skill、说明与供调用方记账的名字/载荷。
 */
export function runMetaSearch(sources: MetaSearchSources, request: MetaSearchRequest): MetaSearchOutcome {
  const notes: string[] = []
  const limit = clampLimit(request.limit)
  const names = request.names?.trim() ?? ''
  const keywords = request.keywords?.trim() ?? ''

  if (names === '' && keywords === '') {
    notes.push('未提供 names 或 keywords，没有执行任何召回。请用 names 给出准确名称或名称组。')
  }

  const pattern = names === '' ? undefined : compileNamePattern(names)
  if (names !== '' && pattern === undefined) {
    notes.push(`names 不是合法的正则片段：${names}。名称通道已跳过，其他通道不受影响。`)
  }

  const nameMatchedTools: ToolPayloadSource[] = []
  let skillNameHits = 0
  if (pattern !== undefined) {
    const hitTools = matchNames(sources.tools.keys(), pattern)
    for (const [name, schema] of sources.tools) {
      if (hitTools.has(name)) nameMatchedTools.push(schema)
    }
    // 只用于说明：names 通道不返回 Skill，但模型很可能正是因为 Skill 才给出这个名字。
    skillNameHits = matchNames(sources.skills.keys(), pattern).size
  }

  let keywordTools: readonly string[] = []
  let keywordSkills: readonly string[] = []
  if (keywords !== '') {
    if (!sources.embeddingEnabled) {
      // 未开启时仍要说明，否则模型会以为没有相关能力而放弃。
      notes.push('向量检索未开启，keywords 通道已忽略；请改用 names 按名称召回。')
    } else if (sources.keywordHits === undefined) {
      notes.push('语义检索暂不可用，keywords 通道已忽略。')
    } else {
      keywordTools = sources.keywordHits.tools
      keywordSkills = sources.keywordHits.skills
    }
  }

  const tools = dedupeTools(sources, nameMatchedTools, keywordTools).slice(0, limit)
  const toolPayloads = tools.map(toolPayload)
  // 名称通道命中优先，Skill 只吃剩余额度；一次召回里工具通常更急用。
  const skills = dedupeSkills(sources, keywordSkills).slice(0, Math.max(0, limit - tools.length))
  const skillPayloads = skills.map(skillPayload)

  if (skillNameHits > 0) {
    notes.push(
      sources.skillCatalogResident
        ? 'Skill 索引已在当前上下文中完整可见，无需召回；直接用 skill 工具按名称加载。'
        : 'names 通道只召回工具；Skill 请改用 keywords 按语义召回。',
    )
  }

  return {
    tools,
    skills,
    notes,
    toolNames: tools.map(tool => tool.name),
    toolPayloads,
    skillPayloads,
  }
}

/** 名称命中在前、语义命中在后；同批内按载荷去重。 */
function dedupeTools(
  sources: MetaSearchSources,
  nameMatched: readonly ToolPayloadSource[],
  keywordNames: readonly string[],
): ToolPayloadSource[] {
  const candidates = [...nameMatched]
  const seenNames = new Set(nameMatched.map(tool => tool.name))
  for (const name of keywordNames) {
    if (seenNames.has(name)) continue
    const schema = sources.tools.get(name)
    if (schema === undefined) continue
    seenNames.add(name)
    candidates.push(schema)
  }
  return dedupeByPayload(candidates, toolPayload, sources.seenTools).kept
}

/** Skill 只来自语义通道；名称通道不参与。 */
function dedupeSkills(
  sources: MetaSearchSources,
  keywordNames: readonly string[],
): SkillPayloadSource[] {
  const candidates: SkillPayloadSource[] = []
  const seenNames = new Set<string>()
  for (const name of keywordNames) {
    if (seenNames.has(name)) continue
    const entry = sources.skills.get(name)
    if (entry === undefined) continue
    seenNames.add(name)
    candidates.push(entry)
  }
  return dedupeByPayload(candidates, skillPayload, sources.seenSkills).kept
}

/**
 * 非法上限一律回落到默认值。
 *
 * 模型给 `limit: 0` 通常是想「不要结果」的笔误，真按 0 执行就等于什么都没召回；
 * 当作没给更接近它的意图。
 */
function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT
  const floored = Math.floor(value)
  if (floored < 1) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, floored)
}
