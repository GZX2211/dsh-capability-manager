// src/client/hooks/useToast.ts
//
// 页头统一的轻提示：只保留一条当前消息，显示数秒后自动收起。
// 常驻内容不放这里——它收敛在感叹号图标的悬浮提示里。

import { useCallback, useEffect, useRef, useState } from 'react'

const HOLD_MS = 4000

export interface ToastHandle {
  /** 当前消息；收起后为 undefined。 */
  text?: string
  /** 显示一条消息；重复显示同一条会重新计时。 */
  show: (text: string) => void
}

export function useToast(): ToastHandle {
  const [text, setText] = useState<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clear = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
  }, [])

  const show = useCallback((next: string) => {
    clear()
    setText(next)
    timer.current = setTimeout(() => {
      timer.current = undefined
      setText(undefined)
    }, HOLD_MS)
  }, [clear])

  useEffect(() => clear, [clear])

  return { text, show }
}
