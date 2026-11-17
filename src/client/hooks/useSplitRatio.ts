// src/client/hooks/useSplitRatio.ts
//
// 可拖动分栏的比例状态：指针拖拽、键盘微调、双击复位。
//
// 比例换算与夹取在 lib/transfer.ts；这里只处理指针捕获与拖拽状态。
// 用 pointer capture 而不是 window 监听：指针移出分隔条后事件仍回到它，
// 组件卸载时也不会留下挂在 window 上的监听。

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import {
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  splitRatioAt,
} from '../lib/transfer.ts'

/** 一次键盘按键调整的比例步长。 */
const STEP = 0.05

export interface SplitRatioHandle {
  /** 左栏占总宽的比例。 */
  ratio: number
  /** 正在拖拽；用于切换光标与禁用文本选择。 */
  dragging: boolean
  /** 挂到分隔条元素上的 ref。 */
  splitterRef: RefObject<HTMLDivElement>
  /** 展开到分隔条元素上的交互属性。 */
  splitterProps: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
    onDoubleClick: () => void
  }
}

/**
 * 维护可拖动的分栏比例。
 *
 * @param initial - 起始比例，默认等宽。
 * @returns 当前比例、拖拽状态与分隔条属性。
 */
export function useSplitRatio(initial: number = DEFAULT_SPLIT_RATIO): SplitRatioHandle {
  const [ratio, setRatio] = useState(initial)
  const [dragging, setDragging] = useState(false)
  const splitterRef = useRef<HTMLDivElement>(null)
  const bounds = useRef<{ left: number; width: number } | null>(null)
  const active = useRef(false)

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const container = splitterRef.current?.parentElement
    if (event.button !== 0 || container === null || container === undefined) return
    const rect = container.getBoundingClientRect()
    bounds.current = { left: rect.left, width: rect.width }
    active.current = true
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    // 按下即跟随指针，否则第一次拖动会先跳到原位置再跟手。
    setRatio(splitRatioAt(event.clientX, bounds.current))
    event.preventDefault()
  }, [])

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!active.current || bounds.current === null) return
    setRatio(splitRatioAt(event.clientX, bounds.current))
  }, [])

  const stop = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!active.current) return
    active.current = false
    bounds.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        setRatio(current => clampSplitRatio(current - STEP))
        break
      case 'ArrowRight':
        event.preventDefault()
        setRatio(current => clampSplitRatio(current + STEP))
        break
      case 'Home':
        event.preventDefault()
        setRatio(MIN_SPLIT_RATIO)
        break
      case 'End':
        event.preventDefault()
        setRatio(MAX_SPLIT_RATIO)
        break
      default:
        break
    }
  }, [])

  const onDoubleClick = useCallback(() => {
    setRatio(DEFAULT_SPLIT_RATIO)
  }, [])

  return {
    ratio,
    dragging,
    splitterRef,
    splitterProps: { onPointerDown, onPointerMove, onPointerUp: stop, onPointerCancel: stop, onKeyDown, onDoubleClick },
  }
}
