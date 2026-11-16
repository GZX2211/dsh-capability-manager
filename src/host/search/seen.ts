// src/host/search/seen.ts
//
// 「哪些工具此刻已经以完整 schema 在上下文里」——召回去重与索引注入共用这一份事实。
//
// 判定基准必须是**当前可见**的工具集，不能是会话历史。
// 曾经用 `Session.toolHistory()` 的历史全集：那里面记录着工具被收走之前出现过的全部
// 定义，于是限制生效后每一次召回都被自己判成「已经在上下文里」而剔除，
// 模型既看不到工具、又召不回来——会话被自己的去重逻辑锁死。

import type { ToolSource } from '../catalog/collect.ts'
import { toolPayload, type ToolPayloadSource } from './payload.ts'

/**
 * 当前可见工具的载荷，用作召回去重的比较基准。
 *
 * @param tools - 该 agent 此刻可见的工具。
 * @returns 载荷字符串集合。
 */
export function toolPayloadsOf(tools: readonly ToolPayloadSource[]): ReadonlySet<string> {
  return new Set(tools.map(toolPayload))
}

/**
 * 当前可见工具的名称，用作索引注入的排除依据。
 *
 * @param tools - 该 agent 此刻可见的工具。
 * @returns 工具名集合。
 */
export function toolNamesOf(tools: readonly ToolSource[]): ReadonlySet<string> {
  return new Set(tools.map(tool => tool.name))
}
