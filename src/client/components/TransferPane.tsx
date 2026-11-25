// src/client/components/TransferPane.tsx
//
// 穿梭框的一侧：顶部控制栏（池名与「本侧数量 / 总数」）加一个可滚动列表。
//
// 列表动画交给官方 AnimatedRows：被移走的行原地淡出，下方的行立即补位，
// 新进入的行淡入。切换 tab / 筛选 / 搜索时视图整体替换，由 resetKey 关掉动画，
// 否则整页一次性重排会让人误以为数据在流动。

import { Fragment } from 'react'
import { AnimatedRows, Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityEntry } from '../../shared/capability.ts'
import type { CapabilityConfig } from '../../shared/config.ts'
import type { Translate } from '../i18n.ts'
import { CapabilityRow, type RowSide } from './CapabilityRow.tsx'

/** 标题栏里的批量动作；作用范围由调用方限定在当前筛选结果内。 */
export interface PaneBulkAction {
  key: string
  label: string
  /** 悬停说明：交代按钮只作用于当前显示内容。 */
  hint?: string
  disabled?: boolean
  onClick: () => void
}

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
  /** 批量动作，按给定顺序渲染在计数左侧。 */
  bulkActions?: readonly PaneBulkAction[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  onToggleResident: (id: string, next: boolean) => void
  onReveal: (id: string) => void
  t: Translate
}

export function TransferPane({
  side, title, count, total, entries, config, disabled, ready, resetKey,
  emptyTitle, emptyHint, bulkActions, onAdd, onRemove, onToggleResident, onReveal, t,
}: TransferPaneProps) {
  return (
    <section className="cm-pane" aria-label={title}>
      <div className="cm-pane-header">
        <span className="cm-pane-title">{title}</span>
        <div className="cm-pane-header-actions">
          {bulkActions?.map(action => {
            const button = (
              <Button
                className="cm-pane-bulk"
                variant="outline"
                size="sm"
                disabled={disabled || action.disabled === true}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            )
            return (
              <Fragment key={action.key}>
                {action.hint === undefined ? button : <Tooltip label={action.hint} side="bottom">{button}</Tooltip>}
              </Fragment>
            )
          })}
          <span className="cm-pane-count">{count}/{total}</span>
        </div>
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
