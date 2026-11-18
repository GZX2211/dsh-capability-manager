// src/client/hooks/useSyncedScroll.ts
//
// 多个滚动容器同步滚动：滚动任意一个，其余容器跟到同一位置。
//
// 用途是 Router / Worker 两个黑名单面板的并排对比：两边行数相同、行内容一致，
// 对齐滚动位置后「这一行在两边分别是什么状态」可以直接横着读。
//
// 不做事件回环保护标志：给目标容器赋一个与当前相同的 scrollTop 不会触发 scroll
// 事件，而写入前先跳过「已经对齐」的容器，于是同步链最多走一步就结束。

import { useCallback, useRef } from 'react'

export interface SyncedScroll {
  /** 给第 `index` 个滚动容器用的 callback ref（同一 index 多次渲染复用同一函数）。 */
  refOf(index: number): (node: HTMLDivElement | null) => void
  /** 第 `index` 个容器滚动时调用。 */
  onScroll(index: number): void
}

/**
 * 建立一组同步滚动的容器。
 *
 * @returns 各容器的 ref 与滚动处理器。
 */
export function useSyncedScroll(): SyncedScroll {
  const nodes = useRef<(HTMLDivElement | null)[]>([])
  const refs = useRef(new Map<number, (node: HTMLDivElement | null) => void>())

  const refOf = useCallback((index: number) => {
    const existing = refs.current.get(index)
    if (existing !== undefined) return existing
    const created = (node: HTMLDivElement | null): void => {
      nodes.current[index] = node
    }
    refs.current.set(index, created)
    return created
  }, [])

  const onScroll = useCallback((index: number) => {
    const source = nodes.current[index]
    if (source === undefined || source === null) return
    for (let other = 0; other < nodes.current.length; other += 1) {
      if (other === index) continue
      const target = nodes.current[other]
      if (target === undefined || target === null) continue
      // 已经对齐就跳过：赋值不会触发事件，但跳过能省掉无意义的布局查询。
      if (Math.abs(target.scrollTop - source.scrollTop) < 1) continue
      target.scrollTop = source.scrollTop
    }
  }, [])

  return { refOf, onScroll }
}
