// src/host/skill-consumer/catalog-inject.ts
//
// 在 `agent/pre-step` 交付 Skill 目录：首版追加一条 durable user message，之后只在
// digest 变化时整表替换；不注入的时机（语义检索开启且 meta_search 可用）用空目录
// 退役旧名称。
//
// 目录是预步骤消息而不是 systemPrompt section：Skill 发现是异步的，而 section 的
// text 回调是同步的；只有 pre-step 能在不预取、不缓存的前提下拿到当前注册表。

import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type Message, type UserMessage } from '@deepseek-ai/dsh-llm'
import {
  catalogDigest,
  CATALOG_SOURCE_KIND,
  findPublishedCatalog,
  readCatalogEntries,
  renderCatalog,
  type CatalogEntry,
} from './catalog.ts'

/** 当前 step 的目录意图：active=false 表示当前模式不应注入目录。 */
export type CatalogPlan =
  | { readonly active: true; readonly entries: readonly CatalogEntry[] }
  | { readonly active: false }

export interface CatalogInjectDependencies {
  /**
   * 计算该 agent 当前应发布的目录。
   *
   * 失败时调用方保留既有目录不动：把一次注册表抖动当成「所有 Skill 消失」会让
   * 模型在下一个 step 忘掉可用能力。
   */
  catalogOf: (agent: unknown, signal: AbortSignal) => Promise<CatalogPlan>
  log?: (message: string) => void
}

/** 本模块用到的 Agent 形状；真实 Agent 的 Session 满足它。 */
export interface CatalogAgentLike {
  readonly session: {
    deriveMessages(): readonly Message[]
  }
}

/** `agent/pre-step` 里本模块读取的字段。 */
export interface CatalogStepPayload {
  readonly agent: CatalogAgentLike
  readonly messages: readonly UserMessage[]
  readonly signal: AbortSignal
}

/**
 * 执行一次目录注入决策。
 *
 * 顺序是「先问 `next()` 再决定是否追加」：waterfall 里不调用 `next()` 等于否决
 * 整条链，目录插件没有这个权力。
 *
 * @param deps - 目录计算入口与日志。
 * @param payload - pre-step 载荷。
 * @param next - 后续 waterfall 链。
 * @returns 完整决策；失败时返回未改动的原决策。
 */
export async function injectCatalogStep(
  deps: CatalogInjectDependencies,
  payload: CatalogStepPayload,
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision> {
  const decision = await next()
  if (decision.kind === 'reject') return decision

  const { signal } = payload
  let history: readonly Message[]
  try {
    history = payload.agent.session.deriveMessages()
  } catch (error) {
    // 读不到历史时无法判断是否已发布，保持原样比重复发布安全。
    deps.log?.(`cannot read the session history for the skill catalog: ${describe(error)}`)
    return decision
  }

  const published = findPublishedCatalog(history)

  let plan: CatalogPlan
  try {
    plan = await deps.catalogOf(payload.agent, signal)
  } catch (error) {
    if (signal.aborted) throw signal.reason
    deps.log?.(`cannot build the skill catalog: ${describe(error)}`)
    return decision
  }
  if (signal.aborted) throw signal.reason

  const desired = plan.active ? plan.entries : []
  if (published === undefined) {
    // 首版空目录没有信息量；不注入模式也无需退役任何名称。
    if (!plan.active || desired.length === 0) return decision
  } else if (catalogDigest(published) === catalogDigest(desired)) {
    return decision
  }

  const update = published !== undefined
  const message = createUserMessage({
    content: [{ type: 'text', text: renderCatalog(desired, update ? 'update' : 'initial') }],
    source: {
      kind: CATALOG_SOURCE_KIND,
      form: 'catalog',
      ...update ? { update: true as const } : {},
      entries: desired,
    },
  })

  // 同一 step 的决策里可能已经带着一条目录（例如恢复中的会话），替换而不是追加。
  return {
    ...decision,
    messages: [...decision.messages.filter(item => readCatalogEntries(item.source) === undefined), message],
  }
}

/**
 * 生成本插件的 pre-step 监听器。
 *
 * @param deps - 目录计算入口与日志。
 * @returns 可直接交给 `ctx.on('agent/pre-step', ...)` 的监听器。
 */
export function createCatalogListener(
  deps: CatalogInjectDependencies,
): (payload: CatalogStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision> {
  return (payload, next) => injectCatalogStep(deps, payload, next)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
