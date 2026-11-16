// src/host/search/index.ts
//
// `meta_search` 的检索编排：名称通道 → 载荷级去重 → 截断。
//
// 这里只做编排与纯计算：候选从哪来、已见载荷从哪来都由调用方注入，
// 所以本模块可以在没有 Host 的情况下完整单测。

import { dedupeByPayload } from './dedupe.ts'
import { compileNamePattern, matchNames } from './lexical.ts'
import { toolPayload, type ToolPayloadSource } from './payload.ts'

/** 默认返回条数。 */
const DEFAULT_LIMIT = 20
/** 返回条数上限：一次召回太多会挤掉真正的工作上下文。 */
const MAX_LIMIT = 50

export interface MetaSearchSources {
  /** 可召回的工具：名称 → 完整 schema。调用方负责按池、黑名单与存在性过滤。 */
  candidates: ReadonlyMap<string, ToolPayloadSource>
  /** 本会话已经出现过的工具载荷。 */
  seen: ReadonlySet<string>
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
  /** 索引条目；M1 阶段恒为空。 */
  skills: { name: string; description: string }[]
  /** 给模型的说明：被忽略的通道、非法参数等。 */
  notes: string[]
  /** 返回的工具名；调用方据此记录召回集合。 */
  names: string[]
  /** 返回工具的载荷；调用方据此并入已见集合。 */
  payloads: string[]
}

/**
 * 执行一次召回。
 *
 * 名称通道永远可用；关键词通道依赖向量检索，未开启时只给说明不报错——
 * 让模型知道「换个方式再来」比直接失败更有用。
 *
 * @param sources - 候选工具与会话已见的载荷。
 * @param request - 模型给出的参数。
 * @returns 工具、说明与供调用方记账的名字/载荷。
 */
export function runMetaSearch(sources: MetaSearchSources, request: MetaSearchRequest): MetaSearchOutcome {
  const notes: string[] = []
  const limit = clampLimit(request.limit)
  const names = request.names?.trim() ?? ''
  const keywords = request.keywords?.trim() ?? ''

  if (names === '' && keywords === '') {
    notes.push('未提供 names 或 keywords，没有执行任何召回。请用 names 给出准确名称或名称组。')
  }

  const matched: ToolPayloadSource[] = []
  if (names !== '') {
    const pattern = compileNamePattern(names)
    if (pattern === undefined) {
      notes.push(`names 不是合法的正则片段：${names}。名称通道已跳过，其他通道不受影响。`)
    } else {
      const hit = matchNames(sources.candidates.keys(), pattern)
      for (const [name, schema] of sources.candidates) {
        if (hit.has(name)) matched.push(schema)
      }
    }
  }

  if (keywords !== '') {
    // 向量检索未开启时仍要说明，否则模型会以为没有相关能力而放弃。
    notes.push('向量检索未开启，keywords 通道已忽略；请改用 names 按名称召回。')
  }

  const deduped = dedupeByPayload(matched, toolPayload, sources.seen)
  return {
    tools: deduped.kept.slice(0, limit),
    skills: [],
    notes,
    names: deduped.kept.slice(0, limit).map(tool => tool.name),
    payloads: deduped.payloads.slice(0, limit),
  }
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
