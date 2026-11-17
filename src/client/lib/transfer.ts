// src/client/lib/transfer.ts
//
// 穿梭框的纯逻辑：把当前可见能力分到两侧、给出两侧计数、把指针位置换算成分栏比例。
//
// 分区只依据 `excluded`，不重新排序：输入已经是筛选结果，换顺序会让用户找不到刚才那一行。
// 分栏比例限制在 [0.25, 0.75]：任一侧窄到看不见列表时就失去了穿梭框的意义。

import type { CapabilityEntry, CapabilityId } from '../../shared/capability.ts'

/** 左栏最小占比；右栏同理，因此两栏都不至于被拖没。 */
export const MIN_SPLIT_RATIO = 0.25
export const MAX_SPLIT_RATIO = 0.75

/** 首次渲染的分栏占比，两栏等宽。 */
export const DEFAULT_SPLIT_RATIO = 0.5

/** 能力池与排出池的划分结果；两段都保持输入的相对顺序。 */
export interface PoolPartition {
  /** 池内能力：可调用、可召回，可设常驻。 */
  pooled: CapabilityEntry[]
  /** 池外能力：不可调用，界面显示在左侧排出池。 */
  excluded: CapabilityEntry[]
}

/**
 * 按排除名单把能力分到两侧。
 *
 * 排除名单里可能有当前筛选结果之外的标识（其他 tab、其他来源），它们只被忽略，
 * 不参与计数——分母是当前可见集合。
 *
 * @param entries - 当前筛选结果，顺序即界面顺序。
 * @param excluded - 配置里的排除名单。
 * @returns 两个新数组；输入不被修改。
 */
export function partitionByPool(
  entries: readonly CapabilityEntry[],
  excluded: readonly CapabilityId[],
): PoolPartition {
  const excludedIds = new Set(excluded)
  const partition: PoolPartition = { pooled: [], excluded: [] }
  for (const entry of entries) {
    if (excludedIds.has(entry.id)) partition.excluded.push(entry)
    else partition.pooled.push(entry)
  }
  return partition
}

/** 两侧计数；分母是当前筛选结果的总数。 */
export interface PoolCounts {
  pooled: number
  excluded: number
  total: number
}

/**
 * 统计当前可见集合的两侧数量。
 *
 * @param entries - 当前筛选结果。
 * @param excluded - 配置里的排除名单。
 * @returns 池内、池外与总数；前后两者之和恒等于总数。
 */
export function countByPool(
  entries: readonly CapabilityEntry[],
  excluded: readonly CapabilityId[],
): PoolCounts {
  const excludedIds = new Set(excluded)
  let pooled = 0
  let dropped = 0
  for (const entry of entries) {
    if (excludedIds.has(entry.id)) dropped += 1
    else pooled += 1
  }
  return { pooled, excluded: dropped, total: entries.length }
}

/**
 * 把指定标识的行提到列表最前。
 *
 * 两种用途共用同一实现：常驻项要浮到能力池顶部；刚创建的自建 Skill 要在排出池
 * 顶部露头——长列表里按字母序沉底等于「创建成功但看不见」。两段内部都保持现有
 * 顺序，不重新排序。
 *
 * @param entries - 一侧的当前行，顺序即界面顺序。
 * @param pinned - 需要置顶的标识；其中不属于 `entries` 的标识被忽略。
 * @returns 置顶项在前的新数组；输入不被修改。
 */
export function sortPinnedFirst(
  entries: readonly CapabilityEntry[],
  pinned: readonly CapabilityId[],
): CapabilityEntry[] {
  const pinnedIds = new Set(pinned)
  const head: CapabilityEntry[] = []
  const tail: CapabilityEntry[] = []
  for (const entry of entries) {
    if (pinnedIds.has(entry.id)) head.push(entry)
    else tail.push(entry)
  }
  return [...head, ...tail]
}

/**
 * 把常驻能力提到列表前面。
 *
 * 常驻是用户显式配置的「初始即可用」，它比字母序更重要：常驻项可能只有一两个，
 * 沉在长列表里会让人以为没保存成功。
 *
 * @param entries - 一侧的当前行，顺序即界面顺序。
 * @param resident - 常驻名单；其中不属于 `entries` 的标识被忽略。
 * @returns 常驻在前的新数组；输入不被修改。
 */
export function sortResidentFirst(
  entries: readonly CapabilityEntry[],
  resident: readonly CapabilityId[],
): CapabilityEntry[] {
  return sortPinnedFirst(entries, resident)
}

/**
 * 把比例夹到可用的分栏范围内。
 *
 * @param ratio - 左栏占比；非有限数退回默认比例（拖拽路径上不会产生，但调用点可传入任意数）。
 * @returns `[MIN_SPLIT_RATIO, MAX_SPLIT_RATIO]` 内的比例。
 */
export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio))
}

/**
 * 把指针横坐标换算成左栏占比。
 *
 * @param clientX - 指针的 viewport 横坐标。
 * @param bounds - 分栏容器的左边界与宽度。
 * @returns 夹在可用范围内的比例；容器尚未布局时退回默认比例。
 */
export function splitRatioAt(clientX: number, bounds: { left: number; width: number }): number {
  if (!(bounds.width > 0)) return DEFAULT_SPLIT_RATIO
  return clampSplitRatio((clientX - bounds.left) / bounds.width)
}
