// src/client/views/Manager.tsx
//
// 能力管理页的骨架：页头 + tab 栏 + 工具栏 + 双栏穿梭框。
//
// 页面只做编排：筛选与搜索是 lib 里的纯函数，两侧分区与分栏比例在 lib/transfer，
// 状态与网络在 useSnapshot，单行渲染在 CapabilityRow。这样「一行怎么显示」、
// 「哪些行在哪一侧」与「拖多宽」可以各自独立验证。

import { Button, IconLoadingOutlineRegular, IconQuestionOutlineRegular, IconRefreshOutlineRegular, Input, IconSearchOutlineRegular, SegmentedTabs, Tooltip, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { CapabilityKind } from '../../shared/capability.ts'
import { ApiError } from '../lib/http.ts'
import { filterCapabilities, type SourceFilterValue } from '../lib/filter.ts'
import { countByPool, partitionByPool, sortResidentFirst } from '../lib/transfer.ts'
import { useSnapshot } from '../hooks/useSnapshot.ts'
import { useSplitRatio } from '../hooks/useSplitRatio.ts'
import { HelpDialog } from '../components/HelpDialog.tsx'
import { SourceFilter } from '../components/SourceFilter.tsx'
import { TransferPane } from '../components/TransferPane.tsx'
import { WarningBar } from '../components/WarningBar.tsx'
import { CreateCapabilityMenu } from '../components/CreateCapabilityMenu.tsx'
import type { Translate } from '../i18n.ts'

type TabValue = 'tools' | 'skills' | 'settings'

const TABS: { value: TabValue; labelKey: 'tabTools' | 'tabSkills' | 'tabSettings' }[] = [
  { value: 'tools', labelKey: 'tabTools' },
  { value: 'skills', labelKey: 'tabSkills' },
  { value: 'settings', labelKey: 'tabSettings' },
]

/** 三个 tab 恒定存在，所以这里可以给出非空元组。 */
function tabItems(t: Translate): [SegmentedTab<TabValue>, ...SegmentedTab<TabValue>[]] {
  const items = TABS.map(entry => ({
    value: entry.value,
    label: t(entry.labelKey),
    id: `cm-tab-${entry.value}`,
    panelId: `cm-panel-${entry.value}`,
  }))
  // TABS 是固定长度的常量数组，展开后至少一项。
  return [items[0]!, ...items.slice(1)]
}

export interface ManagerProps {
  t: Translate
  /** 新会话 + 预填创建引导语；返回 false 表示当前环境没有该入口。 */
  onCreateWithAgent: () => boolean
}

export function Manager({ t, onCreateWithAgent }: ManagerProps) {
  const [tab, setTab] = useState<TabValue>('tools')
  const [source, setSource] = useState<SourceFilterValue>('all')
  const [query, setQuery] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [createFailed, setCreateFailed] = useState(false)

  const describe = useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError) {
        if (error.code === 'revision-conflict') return t('revisionConflict')
        if (error.code === 'bad-request' || error.code === 'unknown-capability') return t('writeForbidden')
        return error.message
      }
      return error instanceof Error ? error.message : String(error)
    },
    [t],
  )

  const snapshot = useSnapshot(describe)
  const split = useSplitRatio()
  const capabilityKind: CapabilityKind = tab === 'tools' ? 'tool' : 'skill'

  // 从有 MCP 筛选的页面切到 Skill 页时，「MCP」这个筛选在这个页面不存在。
  useEffect(() => {
    if (capabilityKind === 'skill' && source === 'mcp') setSource('all')
  }, [capabilityKind, source])

  const visible = useMemo(
    () =>
      filterCapabilities({
        capabilities: snapshot.snapshot?.capabilities ?? [],
        kind: capabilityKind,
        source,
        query,
      }),
    [snapshot.snapshot, capabilityKind, source, query],
  )

  const config = snapshot.snapshot?.config
  // 常驻是显式配置，排在能力池最前；字母序在它之下。
  const partition = useMemo(() => {
    const split = partitionByPool(visible, config?.excluded ?? [])
    return { ...split, pooled: sortResidentFirst(split.pooled, config?.resident ?? []) }
  }, [visible, config])
  const counts = useMemo(() => countByPool(visible, config?.excluded ?? []), [visible, config])
  // 搜索 / 筛选无命中与「某一侧恰好为空」是两种状态：空态文案不能混用。
  const nothingMatches = counts.total === 0
  const resetKey = `${tab}|${source}|${query}`

  const addToPool = useCallback(
    (id: string) => void snapshot.mutate({ op: 'set-excluded', id, value: false }),
    [snapshot.mutate],
  )
  const removeFromPool = useCallback(
    (id: string) => void snapshot.mutate({ op: 'set-excluded', id, value: true }),
    [snapshot.mutate],
  )
  const toggleResident = useCallback(
    (id: string, next: boolean) => void snapshot.mutate({ op: 'set-resident', id, value: next }),
    [snapshot.mutate],
  )

  const pane = (side: 'excluded' | 'pooled') => ({
    count: side === 'excluded' ? counts.excluded : counts.pooled,
    total: counts.total,
    entries: side === 'excluded' ? partition.excluded : partition.pooled,
    emptyTitle: t(nothingMatches ? 'empty' : side === 'excluded' ? 'paneExcludedEmpty' : 'panePoolEmpty'),
    emptyHint: t(nothingMatches ? 'emptyHint' : side === 'excluded' ? 'paneExcludedEmptyHint' : 'panePoolEmptyHint'),
  })

  return (
    <div className="cm-page">
      <div className="cm-header">
        <div className="cm-heading">
          <div className="cm-title-row">
            <span className="cm-title">{t('pageTitle')}</span>
            <Tooltip label={t('helpTooltip')}>
              <Button
                className="cm-help-button"
                variant="ghost"
                size="sm"
                icon={<IconQuestionOutlineRegular />}
                aria-label={t('helpTooltip')}
                onClick={() => setHelpOpen(true)}
              />
            </Tooltip>
          </div>
          <span className="cm-subtitle">{t('pageSubtitle')}</span>
        </div>
        <div className="cm-header-actions">
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} onClick={snapshot.refresh}>
            {t('refresh')}
          </Button>
          <CreateCapabilityMenu
            disabled={snapshot.saving}
            t={t}
            onCreateWithAgent={() => setCreateFailed(!onCreateWithAgent())}
          />
        </div>
      </div>

      <div className="cm-tabbar">
        <SegmentedTabs
          className="cm-tabs"
          items={tabItems(t)}
          value={tab}
          onChange={setTab}
          label={t('pageTitle')}
        />
      </div>

      {tab === 'settings' ? (
        <div className="cm-content">
          <div className="cm-body">
            <p className="cm-placeholder">{t('settingsPlaceholder')}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="cm-toolbar">
            <SourceFilter kind={capabilityKind} value={source} onChange={setSource} t={t} />
            <Input
              className="cm-search"
              icon={<IconSearchOutlineRegular />}
              value={query}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchLabel')}
              onChange={event => setQuery(event.target.value)}
            />
          </div>

          {snapshot.snapshot !== undefined ? <WarningBar warnings={snapshot.snapshot.warnings} t={t} /> : null}
          {createFailed ? <p className="cm-notice">{t('createUnavailable')}</p> : null}
          {snapshot.notice !== undefined ? <p className="cm-notice">{snapshot.notice}</p> : null}
          {snapshot.writeError !== undefined ? <p className="cm-notice">{snapshot.writeError}</p> : null}

          <div
            className={split.dragging ? 'cm-content cm-content--dragging' : 'cm-content'}
            id={`cm-panel-${tab}`}
            role="tabpanel"
          >
            {snapshot.error !== undefined && snapshot.snapshot === undefined ? (
              <div className="cm-state">
                <span>{t('loadFailed')}</span>
                <Button variant="outline" size="sm" onClick={snapshot.refresh}>
                  {t('retry')}
                </Button>
              </div>
            ) : snapshot.snapshot === undefined ? (
              <div className="cm-state">
                <IconLoadingOutlineRegular />
                <span>{t('loading')}</span>
              </div>
            ) : tab === 'skills' ? (
              <div className="cm-body">
                <p className="cm-placeholder">{t('skillsPlaceholder')}</p>
              </div>
            ) : config === undefined ? null : (
              <div
                className="cm-transfer"
                style={{ '--cm-split': `${(split.ratio * 100).toFixed(4)}%` } as CSSProperties}
              >
                <TransferPane
                  side="excluded"
                  title={t('paneExcludedTitle')}
                  {...pane('excluded')}
                  config={config}
                  disabled={snapshot.saving}
                  ready
                  resetKey={resetKey}
                  onAdd={addToPool}
                  onRemove={removeFromPool}
                  onToggleResident={toggleResident}
                  t={t}
                />

                <div
                  ref={split.splitterRef}
                  className="cm-splitter"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('splitterLabel')}
                  aria-valuemin={25}
                  aria-valuemax={75}
                  aria-valuenow={Math.round(split.ratio * 100)}
                  tabIndex={0}
                  {...split.splitterProps}
                />

                <TransferPane
                  side="pooled"
                  title={t('panePoolTitle')}
                  {...pane('pooled')}
                  config={config}
                  disabled={snapshot.saving}
                  ready
                  resetKey={resetKey}
                  onAdd={addToPool}
                  onRemove={removeFromPool}
                  onToggleResident={toggleResident}
                  t={t}
                />
              </div>
            )}
          </div>
        </>
      )}

      <HelpDialog
        open={helpOpen}
        embeddingEnabled={snapshot.snapshot?.embedding.enabled ?? false}
        onClose={() => setHelpOpen(false)}
        t={t}
      />
    </div>
  )
}
