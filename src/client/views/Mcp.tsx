// src/client/views/Mcp.tsx
//
// MCP 分区：工具栏（筛选 + 配置入口 + 搜索）+ 单栏列表。
//
// 与工具/技能页的差别：这里没有穿梭框，因为一台服务器只有「启用 / 停用」一个
// 归属，不需要两个池。列表的每一行由 McpRow 渲染，连接状态由 hook 轮询。
//
// 「配置 MCP」放在搜索框左侧：它是这一页的主操作，搜索只是辅助。

import {
  Button,
  IconLoadingOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useMemo, useState } from 'react'
import type { McpServerView } from '../../shared/mcp.ts'
import type { Translate } from '../i18n.ts'
import { useMcpServers } from '../hooks/useMcpServers.ts'
import {
  countMcpServers,
  emptyMcpForm,
  filterMcpServers,
  formOfView,
  type McpFilterValue,
} from '../lib/mcp.ts'
import { McpDialog } from '../components/McpDialog.tsx'
import { McpFilter } from '../components/McpFilter.tsx'
import { McpRow } from '../components/McpRow.tsx'

/** 弹窗的挂载键：每次打开都重建，草稿与错误不会从上一台服务器带过来。 */
interface DialogState {
  mode: 'create' | 'edit'
  server?: McpServerView
  key: number
  open: boolean
}

export interface McpProps {
  /** 把稳定错误码翻成用户语言；由入口注入，组件不依赖词典之外的错误知识。 */
  describe: (error: unknown) => string
  t: Translate
}

export function Mcp({ describe, t }: McpProps) {
  const mcp = useMcpServers(describe)
  const [filter, setFilter] = useState<McpFilterValue>('all')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [dialog, setDialog] = useState<DialogState | undefined>(undefined)

  const servers = mcp.data?.servers ?? []
  const ready = mcp.data !== undefined
  const available = mcp.data?.available ?? true
  const writable = mcp.data?.writable ?? false
  // 数据未到位前不判定可写性：默认 available=true、writable=false 会让「编辑器不可用」
  // 在加载窗口里闪一下。按钮标题同理，未加载时按正常主操作显示。
  const configureTitle = !ready || writable
    ? t('mcpConfigAction')
    : mcp.data?.unavailableReason === 'manager-absent' ? t('mcpUnavailableManager') : t('mcpUnavailableEditor')
  const filtered = useMemo(() => filterMcpServers(servers, filter, query), [servers, filter, query])
  const counts = useMemo(() => countMcpServers(servers), [servers])
  const nothingMatches = filtered.length === 0 && servers.length > 0

  const openDialog = (mode: 'create' | 'edit', server?: McpServerView): void => {
    setNotice(undefined)
    setDialog({ mode, server, key: Date.now(), open: true })
  }
  const closeDialog = (): void => {
    setDialog(previous => (previous === undefined ? undefined : { ...previous, open: false }))
  }

  const toggle = async (name: string, enabled: boolean): Promise<void> => {
    const reply = await mcp.toggle(name, enabled)
    if (!reply.ok) setNotice(reply.message)
  }

  const initialForm = dialog?.mode === 'edit' && dialog.server !== undefined
    ? formOfView(dialog.server)
    : emptyMcpForm()

  return (
    <div className="cm-mcp">
      <div className="cm-toolbar">
        <McpFilter value={filter} onChange={setFilter} t={t} />
        <div className="cm-mcp-actions">
          {/* 计数放在主操作左侧：它回答「一共几台、连上几台」，与这一行的操作同属一簇。 */}
          {servers.length > 0 ? (
            <span className="cm-mcp-counts">
              {`${String(counts.connected)} / ${String(counts.total)} ${t('mcpCount')}`}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            icon={<IconPlusOutlineRegular />}
            disabled={!writable || mcp.saving}
            title={configureTitle}
            onClick={() => openDialog('create')}
          >
            {t('mcpConfigAction')}
          </Button>
          <Input
            className="cm-search"
            icon={<IconSearchOutlineRegular />}
            value={query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      </div>

      {notice !== undefined ? <p className="cm-notice">{notice}</p> : null}
      {/* 只在数据到位后判定：否则加载瞬间会闪出「编辑器不可用」再消失。 */}
      {ready && available && !writable ? <p className="cm-notice">{t('mcpUnavailableEditor')}</p> : null}

      <div className="cm-content">
        {mcp.error !== undefined ? (
          <div className="cm-state">
            <span>{t('mcpLoadFailed')}</span>
            <span className="cm-mcp-state-detail">{mcp.error}</span>
            <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular />} onClick={mcp.refresh}>
              {t('retry')}
            </Button>
          </div>
        ) : mcp.data === undefined ? (
          <div className="cm-state">
            <IconLoadingOutlineRegular />
            <span>{t('loading')}</span>
          </div>
        ) : !available ? (
          <div className="cm-state">
            <span className="cm-mcp-empty-title">{t('mcpEmptyTitle')}</span>
            <span className="cm-mcp-empty-hint">{t('mcpUnavailableManager')}</span>
          </div>
        ) : servers.length === 0 ? (
          <div className="cm-state">
            <span className="cm-mcp-empty-title">{t('mcpEmptyTitle')}</span>
            <span className="cm-mcp-empty-hint">{t('mcpEmptyHint')}</span>
          </div>
        ) : nothingMatches ? (
          <div className="cm-state">
            <span className="cm-mcp-empty-title">{t('mcpNoMatchTitle')}</span>
            <span className="cm-mcp-empty-hint">{t('mcpNoMatchHint')}</span>
          </div>
        ) : (
          <div className="cm-mcp-list" role="list" aria-label={t('mcpListLabel')}>
            {filtered.map(server => (
              <McpRow
                key={server.name}
                server={server}
                disabled={mcp.saving}
                onToggle={(name, enabled) => { void toggle(name, enabled) }}
                onEdit={next => openDialog('edit', next)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {dialog !== undefined ? (
        <McpDialog
          key={dialog.key}
          open={dialog.open}
          editingName={dialog.mode === 'edit' ? dialog.server?.name : undefined}
          initialForm={initialForm}
          saving={mcp.saving}
          onClose={closeDialog}
          onSave={mcp.save}
          onImport={mcp.importJson}
          onDelete={mcp.remove}
          // 成功不额外提示：列表本身已经变了（新行出现、行消失、开关状态翻转）。
          onDone={closeDialog}
          t={t}
        />
      ) : null}
    </div>
  )
}
