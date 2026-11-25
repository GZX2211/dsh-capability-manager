// src/client/views/Manager.tsx
//
// 能力管理页的骨架：页头 + tab 栏 + 工具栏 + 双栏穿梭框。
//
// 页面只做编排：筛选与搜索是 lib 里的纯函数，两侧分区与分栏比例在 lib/transfer，
// 状态与网络在 useSnapshot，单行渲染在 CapabilityRow。这样「一行怎么显示」、
// 「哪些行在哪一侧」与「拖多宽」可以各自独立验证。

import { Button, IconLoadingOutlineRegular, IconQuestionOutlineRegular, IconRefreshOutlineRegular, Input, IconSearchOutlineRegular, SegmentedTabs, Tooltip, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CapabilityKind } from '../../shared/capability.ts'
import { ApiError } from '../lib/http.ts'
import { localizeCapabilities } from '../lib/capability-text.ts'
import { filterCapabilities, type SourceFilterValue } from '../lib/filter.ts'
import { countByPool, partitionByPool, sortPinnedFirst, sortResidentFirst } from '../lib/transfer.ts'
import { describeWarnings, unseenLines } from '../lib/warnings.ts'
import { useSnapshot } from '../hooks/useSnapshot.ts'
import { useSplitRatio } from '../hooks/useSplitRatio.ts'
import { useToast } from '../hooks/useToast.ts'
import { HelpDialog } from '../components/HelpDialog.tsx'
import { NoticeArea } from '../components/NoticeArea.tsx'
import { SourceFilter } from '../components/SourceFilter.tsx'
import { TransferPane } from '../components/TransferPane.tsx'
import { CreateCapabilityMenu } from '../components/CreateCapabilityMenu.tsx'
import { Settings } from './Settings.tsx'
import { Mcp } from './Mcp.tsx'
import type { Translate } from '../i18n.ts'

type TabValue = 'tools' | 'skills' | 'mcp' | 'settings'

const TABS: { value: TabValue; labelKey: 'tabTools' | 'tabSkills' | 'tabMcp' | 'tabSettings' }[] = [
  { value: 'tools', labelKey: 'tabTools' },
  { value: 'skills', labelKey: 'tabSkills' },
  { value: 'mcp', labelKey: 'tabMcp' },
  { value: 'settings', labelKey: 'tabSettings' },
]

/** 四个 tab 恒定存在，所以这里可以给出非空元组。 */
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
  /**
   * 当前界面语言码；每次渲染现取，切换语言后本地化摘要随之更新。
   */
  currentLanguage: () => string
  /** 新会话 + 预填创建引导语；返回 false 表示当前环境没有该入口。 */
  onCreateWithAgent: () => boolean
}

export function Manager({ t, currentLanguage, onCreateWithAgent }: ManagerProps) {
  const [tab, setTab] = useState<TabValue>('tools')
  const [source, setSource] = useState<SourceFilterValue>('all')
  const [query, setQuery] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  /** 刚创建的能力：第一次出现时置顶，否则会按字母序沉进排出池深处。 */
  const [createdId, setCreatedId] = useState<string | undefined>(undefined)
  const toast = useToast()
  /** 只对新出现的警告弹一次 Toast；同一条在后续刷新里不再重复打扰。 */
  const announced = useRef<Set<string>>(new Set())

  const describe = useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError) {
        if (error.code === 'revision-conflict') return t('revisionConflict')
        if (error.code === 'bad-request' || error.code === 'unknown-capability') return t('writeForbidden')
        if (error.code === 'create-failed') return t('createFailed')
        if (error.code === 'not-owned' || error.code === 'reveal-failed') return t('openFolderFailed')
        // MCP 面：不可用是环境差异（管理器/编辑器缺席），其余错误给官方原文——
        // 原文说明了具体哪条字段被拒，翻译成泛化文案反而不可行动。
        if (error.code === 'mcp-unavailable') return t('mcpUnavailableManager')
        return error.message
      }
      return error instanceof Error ? error.message : String(error)
    },
    [t],
  )

  const snapshot = useSnapshot(describe)
  const split = useSplitRatio()
  const capabilityKind: CapabilityKind = tab === 'tools' ? 'tool' : 'skill'

  const warningLines = useMemo(
    () => describeWarnings(snapshot.snapshot?.warnings ?? [], t),
    [snapshot.snapshot?.warnings, t],
  )

  // 警告初次出现时弹一次 Toast，之后内容由感叹号图标的悬浮提示承载。
  useEffect(() => {
    const fresh = unseenLines(warningLines, announced.current)
    if (fresh.length === 0) return
    for (const line of fresh) announced.current.add(line)
    toast.show(fresh.join('\n'))
  }, [warningLines, toast.show])

  // 操作反馈没有常驻内容：每次出现都作为轻提示显示，由计时收起。
  useEffect(() => {
    if (snapshot.notice !== undefined) toast.show(snapshot.notice)
  }, [snapshot.notice, toast.show])
  useEffect(() => {
    if (snapshot.writeError !== undefined) toast.show(snapshot.writeError)
  }, [snapshot.writeError, toast.show])

  // 从有 MCP 筛选的页面切到 Skill 页时，「MCP」这个筛选在这个页面不存在。
  useEffect(() => {
    if (capabilityKind === 'skill' && source === 'mcp') setSource('all')
  }, [capabilityKind, source])

  // 官方能力的描述只有英文原文：展示前按当前语言覆盖，自建与 MCP 保持原文。
  // 放在筛选之前，中文界面的搜索词才能匹配到中文摘要。
  const language = currentLanguage()
  const capabilities = useMemo(
    () => localizeCapabilities(snapshot.snapshot?.capabilities ?? [], language),
    [snapshot.snapshot, language],
  )

  const visible = useMemo(
    () =>
      filterCapabilities({
        capabilities,
        kind: capabilityKind,
        source,
        query,
      }),
    [capabilities, capabilityKind, source, query],
  )

  const config = snapshot.snapshot?.config
  // 常驻是显式配置，排在能力池最前；刚创建的自建 Skill 排在排出池最前。
  // 两者共用同一套「置顶」逻辑，只是置顶来源不同。
  const pinnedExcluded = useMemo(
    () => createdId !== undefined && config?.excluded.includes(createdId) === true ? [createdId] : [],
    [createdId, config],
  )
  const partition = useMemo(() => {
    const split = partitionByPool(visible, config?.excluded ?? [])
    return {
      pooled: sortResidentFirst(split.pooled, config?.resident ?? []),
      excluded: sortPinnedFirst(split.excluded, pinnedExcluded),
    }
  }, [visible, config, pinnedExcluded])
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
  const reveal = useCallback((id: string) => void snapshot.reveal(id), [snapshot.reveal])

  /**
   * 手动创建：成功之后把视线带到新行。
   *
   * 新能力落在排出池，因此必须切到 Skill 页并清掉筛选与搜索词；
   * 否则「创建成功但列表里没有」和失败在界面上无法区分。
   */
  const createSkill = useCallback(async (): Promise<void> => {
    const created = await snapshot.createSkill()
    if (created === undefined) return
    setTab('skills')
    setSource('all')
    setQuery('')
    setCreatedId(created.id)
  }, [snapshot.createSkill])

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
          <NoticeArea message={toast.text} lines={warningLines} t={t} />
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} onClick={snapshot.refresh}>
            {t('refresh')}
          </Button>
          <CreateCapabilityMenu
            disabled={snapshot.saving}
            t={t}
            onCreateWithAgent={() => {
              if (!onCreateWithAgent()) toast.show(t('createUnavailable'))
            }}
            onCreateSkill={() => { void createSkill() }}
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
          {snapshot.snapshot === undefined ? (
            <SnapshotState error={snapshot.error} onRetry={snapshot.refresh} t={t} />
          ) : (
            <Settings
              snapshot={snapshot.snapshot}
              capabilities={capabilities}
              saving={snapshot.saving}
              onMutate={snapshot.mutate}
              onToggleEmbedding={next => {
                void snapshot.setEmbedding(next)
              }}
              t={t}
            />
          )}
        </div>
      ) : tab === 'mcp' ? (
        // MCP 面不经过能力快照：它读官方管理器，连接状态由分区自己轮询。
        <Mcp describe={describe} t={t} />
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

          <div
            className={split.dragging ? 'cm-content cm-content--dragging' : 'cm-content'}
            id={`cm-panel-${tab}`}
            role="tabpanel"
          >
            {snapshot.snapshot === undefined ? (
              <SnapshotState error={snapshot.error} onRetry={snapshot.refresh} t={t} />
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
                  onReveal={reveal}
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
                  onReveal={reveal}
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
        rolesAvailable={snapshot.snapshot?.rolesAvailable ?? false}
        onClose={() => setHelpOpen(false)}
        t={t}
      />
    </div>
  )
}

/**
 * 快照尚未到位时的占位：读取失败给重试，读取中给加载态。
 *
 * 两个 tab 共用同一段判断，避免一处改了「失败」与「加载中」的分界、另一处没改。
 */
function SnapshotState({ error, onRetry, t }: { error: string | undefined; onRetry: () => void; t: Translate }) {
  if (error !== undefined) {
    return (
      <div className="cm-state">
        <span>{t('loadFailed')}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
    )
  }
  return (
    <div className="cm-state">
      <IconLoadingOutlineRegular />
      <span>{t('loading')}</span>
    </div>
  )
}
