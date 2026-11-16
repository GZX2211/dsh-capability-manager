// src/host/enforcement/recalled.ts
//
// 每会话的召回集合。
//
// 有两个来源，缺一不可：
//   · 运行期累加：`meta_search` 返回工具时立即记下，不用等下一次请求
//   · 会话日志重建：重启后内存是空的，必须能从 `toolHistory()` 复原
//
// 只增不减是刻意的：召回过的工具在这一会话里持续可用，即使后来配置收紧
// （收窄对进行中的会话本来就有延迟，见 §2.3）。

import type { ToolSource } from '../catalog/collect.ts'

/** `Session.toolHistory()` 里本模块用到的部分。 */
export interface ToolHistoryLike {
  readonly tools: readonly ToolSource[]
  readonly updates: readonly { readonly additions: readonly ToolSource[] }[]
}

/** 会话的最小形状；只依赖读取历史这一个能力。 */
export interface SessionLike {
  readonly id: string
  toolHistory(): ToolHistoryLike
}

export class RecalledStore {
  private readonly cache = new Map<string, Set<string>>()
  /** 尚未重建过的会话也允许先累加，重建时取并集。 */
  private readonly pending = new Map<string, Set<string>>()

  /**
   * 记录一次召回。
   *
   * @param sessionId - 会话身份。
   * @param names - 本次召回到达的工具名。
   * @returns 是否真的带来了新名字；没有新名字时调用方可以跳过重建。
   */
  add(sessionId: string, names: Iterable<string>): boolean {
    const target = this.cache.get(sessionId) ?? this.pending.get(sessionId) ?? new Set<string>()
    let changed = false
    for (const name of names) {
      if (target.has(name)) continue
      target.add(name)
      changed = true
    }
    if (this.cache.has(sessionId)) this.cache.set(sessionId, target)
    else this.pending.set(sessionId, target)
    return changed
  }

  /**
   * 读取会话的召回集合。
   *
   * 首次调用从会话日志重建，之后直接返回缓存。
   *
   * @param session - 会话。
   * @returns 只读集合；调用方不得修改。
   */
  namesOf(session: SessionLike): ReadonlySet<string> {
    const cached = this.cache.get(session.id)
    if (cached !== undefined) return cached

    const names = this.pending.get(session.id) ?? new Set<string>()
    this.pending.delete(session.id)
    for (const name of reconstruct(session)) names.add(name)
    this.cache.set(session.id, names)
    return names
  }

  /** 丢弃一个会话的缓存；下次读取会重新从日志重建。 */
  forget(sessionId: string): void {
    this.cache.delete(sessionId)
    this.pending.delete(sessionId)
  }
}

/**
 * 从会话日志还原召回集合。
 *
 * `toolHistory().updates` 记录的是「基线之后新增的工具」，正是我们重建 limit
 * 后新出现的那些；`tools` 是当前基线（首次请求就存在的常驻工具），不算召回。
 *
 * 日志读不出来时返回空集：这只会让该会话少恢复几个召回工具，不该让 agent 创建失败。
 */
function reconstruct(session: SessionLike): Set<string> {
  const names = new Set<string>()
  let history: ToolHistoryLike
  try {
    history = session.toolHistory()
  } catch {
    return names
  }
  for (const update of history.updates) {
    for (const addition of update.additions) names.add(addition.name)
  }
  return names
}
