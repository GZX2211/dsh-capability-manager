// src/host/search/dedupe.ts
//
// 载荷级去重（§3.3）：本次召回载荷 vs 本会话已出现过的**同类型**载荷，
// 逐字完全一致才剔除。
//
// 不按名称、不做语义近似：同一工具的参数变更后就是一份新载荷，应该再次出现。

/** 去重结果：保留下来的项与它们的载荷一一对应。 */
export interface DedupeOutcome<T> {
  /** 保留下来的项，顺序与原输入一致。 */
  kept: T[]
  /** 保留项的载荷，供调用方并入已见集合。 */
  payloads: string[]
}

/**
 * 剔除载荷已在上下文中出现过的项。
 *
 * 同一批内部的重复也按「已出现」处理，只保留首个，否则一次召回会把同一份
 * schema 塞两遍。
 *
 * @param items - 本次召回的候选。
 * @param payloadOf - 从项取出载荷字符串。
 * @param seen - 本会话该类型已出现过的载荷。
 * @returns 保留项与载荷；`seen` 不被修改。
 */
export function dedupeByPayload<T>(
  items: readonly T[],
  payloadOf: (item: T) => string,
  seen: ReadonlySet<string>,
): DedupeOutcome<T> {
  const kept: T[] = []
  const payloads: string[] = []
  // 只跟踪本批内部的新增，调用方的集合保持只读。
  const emitted = new Set<string>()
  for (const item of items) {
    const payload = payloadOf(item)
    if (seen.has(payload) || emitted.has(payload)) continue
    emitted.add(payload)
    kept.push(item)
    payloads.push(payload)
  }
  return { kept, payloads }
}
