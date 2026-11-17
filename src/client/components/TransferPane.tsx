// src/client/components/TransferPane.tsx
//
// 穿梭框的一侧：顶部控制栏（池名与「本侧数量 / 总数」）加一个可滚动列表。
//
// 列表动画交给官方 AnimatedRows：被移走的行原地淡出，下方的行立即补位，
// 新进入的行淡入。切换 tab / 筛选 / 搜索时视图整体替换，由 resetKey 关掉动画，
// 否则整页一次性重排会让人误以为数据在流动。

import { AnimatedRows } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityEntry } from '../../shared/capability.ts'
import type { CapabilityConfig } from '../../shared/config.ts'
import type { Translate } from '../i18n.ts'
import { CapabilityRow, type RowSide } from './CapabilityRow.tsx'

export interface TransferPaneProps {
  side: RowSide
  title: string
  /** 本侧当前行数。 */
  count: number
  /** 当前筛选结果总数，作为两侧共用的分母。 */
  total: number
  entries: readonly CapabilityEntry[]
  config: CapabilityConfig
  disabled: boolean
  /** 数据已到位；首帧不做动画。 */
  ready: boolean
  /** 视图替换键：tab、来源、搜索词变化时立即结算，不做动画。 */
  resetKey: string
  emptyTitle: string
  emptyHint: string
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  onToggleResident: (id: string, next: boolean) => void
  onReveal: (id: string) => void
  t: Translate
}

export function TransferPane({
  side, title, count, total, entries, config, disabled, ready, resetKey,
  emptyTitle, emptyHint, onAdd, onRemove, onToggleResident, onReveal, t,
}: TransferPaneProps) {
  return (
    <section className="cm-pane" aria-label={title}>
      <div className="cm-pane-header">
        <span className="cm-pane-title">{title}</span>
        <span className="cm-pane-count">{count}/{total}</span>
      </div>

      <div className="cm-pane-body">
        {entries.length === 0 ? (
          <div className="cm-pane-empty">
            <span className="cm-pane-empty-title">{emptyTitle}</span>
            <span className="cm-pane-empty-hint">{emptyHint}</span>
          </div>
        ) : (
          <AnimatedRows
            className="cm-pane-list"
            role="list"
            label={title}
            rowKeys={entries.map(entry => entry.id)}
            ready={ready}
            resetKey={resetKey}
          >
            {entries.map(entry => (
              <CapabilityRow
                key={entry.id}
                entry={entry}
                config={config}
                side={side}
                disabled={disabled}
                onAdd={onAdd}
                onRemove={onRemove}
                onToggleResident={onToggleResident}
                onReveal={onReveal}
                t={t}
              />
            ))}
          </AnimatedRows>
        )}
      </div>
    </section>
  )
}
