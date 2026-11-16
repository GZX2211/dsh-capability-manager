// src/client/components/SourceFilter.tsx
//
// 来源筛选胶囊。只渲染该类型页面上真实存在的来源：
// Skill 页不出现 MCP，因为 MCP 服务器只提供工具。

import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityKind } from '../../shared/capability.ts'
import type { Translate } from '../i18n.ts'
import { availableSources, SOURCE_FILTER_LABELS, type SourceFilterValue } from '../lib/filter.ts'

export interface SourceFilterProps {
  kind: CapabilityKind
  value: SourceFilterValue
  onChange: (value: SourceFilterValue) => void
  t: Translate
}

export function SourceFilter({ kind, value, onChange, t }: SourceFilterProps) {
  return (
    <div className="cm-filters">
      {availableSources(kind).map(source => (
        <Pill key={source} active={source === value} onClick={() => onChange(source)}>
          {t(SOURCE_FILTER_LABELS[source])}
        </Pill>
      ))}
    </div>
  )
}
