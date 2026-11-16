// src/host/search/seen.ts
//
// 从会话日志读出「已经以完整 schema 出现过」的工具。
//
// 两个用途共用同一份事实，因此放在一起：
//   · 召回去重的比较基准（载荷）
//   · 索引注入的排除依据（名称）
//
// 日志读不出来时返回空集：这只会让去重与索引多给一些内容，不会让会话失败。

import type { SessionLike } from '../enforcement/recalled.ts'
import { toolPayload, type ToolPayloadSource } from './payload.ts'

/** 会话日志里出现过的全部工具 schema，两次读取口径一致。 */
function historyTools(session: SessionLike): ToolPayloadSource[] {
  let history: { tools: readonly ToolPayloadSource[]; updates: readonly { additions: readonly ToolPayloadSource[] }[] }
  try {
    history = session.toolHistory()
  } catch {
    return []
  }
  const tools: ToolPayloadSource[] = [...history.tools]
  for (const update of history.updates) tools.push(...update.additions)
  return tools
}

/**
 * 已经以完整 schema 出现过的工具载荷。
 *
 * @param session - 会话。
 * @returns 载荷字符串集合。
 */
export function seenToolPayloads(session: SessionLike): ReadonlySet<string> {
  return new Set(historyTools(session).map(toolPayload))
}

/**
 * 已经以完整 schema 出现过的工具名。
 *
 * @param session - 会话。
 * @returns 工具名集合。
 */
export function appearedToolNames(session: SessionLike): ReadonlySet<string> {
  return new Set(historyTools(session).map(tool => tool.name))
}
