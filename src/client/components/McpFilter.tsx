// src/client/components/McpFilter.tsx
//
// MCP 分区顶部的筛选胶囊：全部 / 已连接 / 未连接。
//
// 与工具页的来源筛选同构（都是官方 Pill），差别只在语义：这里筛的是连接状态，
// 用户关心的是「现在能不能用」。

import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../i18n.ts'
import { MCP_FILTERS, MCP_FILTER_LABELS, type McpFilterValue } from '../lib/mcp.ts'

export interface McpFilterProps {
  value: McpFilterValue
  onChange: (value: McpFilterValue) => void
  t: Translate
}

export function McpFilter({ value, onChange, t }: McpFilterProps) {
  return (
    <div className="cm-filters">
      {MCP_FILTERS.map(filter => (
        <Pill key={filter} active={filter === value} onClick={() => onChange(filter)}>
          {t(MCP_FILTER_LABELS[filter])}
        </Pill>
      ))}
    </div>
  )
}
