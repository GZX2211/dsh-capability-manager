// src/client/components/RowGlyphs.tsx
//
// 行内操作按钮的图形。加号用官方图标；官方图标表没有减号字形，
// 这里按 plus-outline 的 16px 视框与 1px 线宽画出同一根横线——
// 两个按钮挨在一起时必须等重，否则「加」看起来比「减」更醒目。

import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** 与官方 plus-outline 同视框、同线宽的减号。 */
export function MinusGlyph({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth={1}
      className={className}
      data-icon="cm-minus"
      aria-hidden="true"
    >
      <path d="M2 8H14" stroke="currentColor" />
    </svg>
  )
}
