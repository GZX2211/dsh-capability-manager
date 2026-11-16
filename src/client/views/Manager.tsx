// src/client/views/Manager.tsx
//
// 能力管理页的骨架：页头 + tab 栏 + 工具栏 + 列表容器。
//
// 页面只做编排：筛选与搜索是 lib 里的纯函数，状态与网络在 useSnapshot，
// 单行渲染在 CapabilityRow。这样「一行怎么显示」与「哪些行显示」可以各自独立验证。

import { Button, IconLoadingOutlineRegular, IconQuestionOutlineRegular, IconRefreshOutlineRegular, Input, IconSearchOutlineRegular, SegmentedTabs, Tooltip, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CapabilityKind } from '../../shared/capability.ts'
import { ApiError } from '../lib/http.ts'
import { filterCapabilities, type SourceFilterValue } from '../lib/filter.ts'
import { useSnapshot } from '../hooks/useSnapshot.ts'
import { CapabilityRow } from '../components/CapabilityRow.tsx'
import { HelpDialog } from '../components/HelpDialog.tsx'
import { SourceFilter } from '../components/SourceFilter.tsx'
import { WarningBar } from '../components/WarningBar.tsx'
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
}

export function Manager({ t }: ManagerProps) {
  const [tab, setTab] = useState<TabValue>('tools')
  const [source, setSource] = useState<SourceFilterValue>('all')
  const [query, setQuery] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)

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

  return (
    <div className="cm-page">
      <div className="cm-header">
        <div className="cm-heading">
          <span className="cm-title">{t('pageTitle')}</span>
          <span className="cm-subtitle">{t('pageSubtitle')}</span>
        </div>
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} onClick={snapshot.refresh}>
          {t('refresh')}
        </Button>
      </div>

      <div className="cm-tabs">
        <SegmentedTabs
          items={tabItems(t)}
          value={tab}
          onChange={setTab}
          label={t('pageTitle')}
        />
      </div>

      {tab === 'settings' ? (
        <div className="cm-body">
          <p className="cm-placeholder">{t('settingsPlaceholder')}</p>
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
            <Tooltip label={t('helpTooltip')}>
              <Button
                variant="ghost"
                size="sm"
                icon={<IconQuestionOutlineRegular />}
                aria-label={t('helpTooltip')}
                onClick={() => setHelpOpen(true)}
              />
            </Tooltip>
          </div>

          {snapshot.snapshot !== undefined ? <WarningBar warnings={snapshot.snapshot.warnings} t={t} /> : null}
          {snapshot.notice !== undefined ? <p className="cm-notice">{snapshot.notice}</p> : null}
          {snapshot.writeError !== undefined ? <p className="cm-notice">{snapshot.writeError}</p> : null}

          <div className="cm-body" id={`cm-panel-${tab}`} role="tabpanel">
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
              <p className="cm-placeholder">{t('skillsPlaceholder')}</p>
            ) : visible.length === 0 ? (
              <div className="cm-empty">
                <span className="cm-empty-title">{t('empty')}</span>
                <span className="cm-empty-hint">{t('emptyHint')}</span>
              </div>
            ) : config === undefined ? null : (
              <div className="cm-list">
                {visible.map(entry => (
                  <CapabilityRow
                    key={entry.id}
                    entry={entry}
                    config={config}
                    disabled={snapshot.saving}
                    t={t}
                    onTogglePool={(id, next) => void snapshot.mutate({ op: 'set-excluded', id, value: !next })}
                    onToggleResident={(id, next) => void snapshot.mutate({ op: 'set-resident', id, value: next })}
                  />
                ))}
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
