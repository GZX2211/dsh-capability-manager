// src/client/components/KindFilter.tsx
//
// 能力类型筛选胶囊（全部 / 工具 / 技能）。
//
// 与来源筛选共用同一套 Pill 视觉：同一块区域里出现两种样式的胶囊，
// 会让人以为它们的作用范围不同。类型筛选没有 MCP——MCP 是来源，不是类型。

import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../i18n.ts'

/** 能力类型筛选值；`all` 表示不按类型过滤。 */
export type KindFilterValue = 'all' | 'tool' | 'skill'

const KIND_OPTIONS: readonly KindFilterValue[] = ['all', 'tool', 'skill']

const KIND_LABELS = {
  all: 'filterAll',
  tool: 'kindTool',
  skill: 'kindSkill',
} as const

export interface KindFilterProps {
  value: KindFilterValue
  onChange: (value: KindFilterValue) => void
  t: Translate
}

export function KindFilter({ value, onChange, t }: KindFilterProps) {
  return (
    <div className="cm-filters" role="group" aria-label={t('kindFilterLabel')}>
      {KIND_OPTIONS.map(kind => (
        <Pill key={kind} active={kind === value} onClick={() => onChange(kind)}>
          {t(KIND_LABELS[kind])}
        </Pill>
      ))}
    </div>
  )
}
