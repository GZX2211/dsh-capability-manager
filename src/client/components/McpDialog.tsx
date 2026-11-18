// src/client/components/McpDialog.tsx
//
// 「配置 MCP」弹窗：手动填写一个连接，或批量导入 mcp.json。
//
// 两个视图共用一个弹窗而不是叠一层：导入只是「另一种填表方式」，
// 在同一层里切换，Esc 与焦点行为由官方 Modal 统一负责。
//
// 宽度与滚动由 `.cm-dialog` / `.cm-dialog__scroll` 统一提供：官方 Modal 默认
// 380px 会把命令与说明压成多行，本插件的两个弹窗都覆盖成同一宽度。
//
// 弹窗只在打开时挂载（父组件用 key 重建），所以内部状态按草稿初始化，
// 不需要「打开时重置」的副作用。

import {
  Button,
  Input,
  Modal,
  SegmentedControl,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useMemo, useState, type ReactNode } from 'react'
import {
  validateMcpForm,
  type McpForm,
  type McpFormIssue,
  type McpTransport,
} from '../../shared/mcp.ts'
import type { Translate } from '../i18n.ts'
import type { McpWriteReply } from '../hooks/useMcpServers.ts'
import { importPreview, importReasonKey, issueLabelKey, type McpImportReason } from '../lib/mcp.ts'

type DialogMode = 'manual' | 'import'

const FORM_ISSUES: readonly McpFormIssue[] = [
  'name-empty',
  'name-invalid',
  'command-missing',
  'url-missing',
  'url-invalid',
  'env-invalid',
  'headers-invalid',
]

const IMPORT_REASONS: readonly McpImportReason[] = [
  'empty',
  'invalid-json',
  'no-servers',
  'unsupported-transport',
  'no-endpoint',
  'invalid-name',
]

function isImportReason(value: string): value is McpImportReason {
  return (IMPORT_REASONS as readonly string[]).includes(value)
}

/**
 * 合并本地校验与服务端拒绝的字段问题。
 *
 * 服务端可能拒绝本地看不到的冲突（例如同名条目由插件注册），因此它的
 * `issues` 必须一起显示，而不是被本地结果覆盖。
 */
function mergedIssues(local: readonly McpFormIssue[], reply: McpWriteReply | undefined): McpFormIssue[] {
  if (reply === undefined || reply.ok) return [...local]
  const remote = (reply.issues ?? []).filter((issue): issue is McpFormIssue => FORM_ISSUES.includes(issue as McpFormIssue))
  return [...new Set([...local, ...remote])]
}

export interface McpDialogProps {
  open: boolean
  /** 正在编辑的服务器名称；新建时为 undefined。 */
  editingName?: string
  /** 初始草稿（新建为空表单，编辑为回填值）。 */
  initialForm: McpForm
  saving: boolean
  onClose: () => void
  onSave: (form: McpForm) => Promise<McpWriteReply>
  onImport: (json: string) => Promise<McpWriteReply>
  onDelete: (name: string) => Promise<McpWriteReply>
  /** 成功后的回调：由页面关闭弹窗。成功状态不再额外提示，列表本身即反馈。 */
  onDone: () => void
  t: Translate
}

export function McpDialog({
  open,
  editingName,
  initialForm,
  saving,
  onClose,
  onSave,
  onImport,
  onDelete,
  onDone,
  t,
}: McpDialogProps) {
  const [mode, setMode] = useState<DialogMode>('manual')
  const [form, setForm] = useState<McpForm>(initialForm)
  const [importText, setImportText] = useState('')
  const [failure, setFailure] = useState<McpWriteReply | undefined>(undefined)
  const [deleteArmed, setDeleteArmed] = useState(false)

  const editing = editingName !== undefined
  const localIssues = mode === 'manual' ? validateMcpForm(form) : []
  const issues = mergedIssues(localIssues, failure)
  const preview = useMemo(() => {
    if (mode !== 'import' || importText.trim().length === 0) return undefined
    return importPreview(importText)
  }, [mode, importText])

  const canSubmit = mode === 'import'
    ? preview !== undefined && preview.ok && preview.rows.length > 0 && !saving
    : localIssues.length === 0 && !saving

  const patch = (fields: Partial<McpForm>): void => {
    setFailure(undefined)
    setForm(previous => ({ ...previous, ...fields }))
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setFailure(undefined)
    if (mode === 'import') {
      const reply = await onImport(importText)
      if (reply.ok) onDone()
      else setFailure(reply)
      return
    }
    const reply = await onSave(form)
    if (reply.ok) onDone()
    else setFailure(reply)
  }

  const confirmDelete = async (): Promise<void> => {
    if (editingName === undefined) return
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    const reply = await onDelete(editingName)
    if (reply.ok) onDone()
    else {
      setDeleteArmed(false)
      setFailure(reply)
    }
  }

  /** 写失败的一句话说明：字段问题另有列表，这里不重复。 */
  const failureText = (): string | undefined => {
    if (failure === undefined || failure.ok || issues.length > 0) return undefined
    if (failure.reason !== undefined && isImportReason(failure.reason)) return t(importReasonKey(failure.reason))
    return failure.message
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(editing ? 'mcpDialogEditTitle' : 'mcpDialogCreateTitle')}
      closeLabel={t('mcpCloseDialog')}
      className="cm-dialog"
      footer={(
        <div className="cm-mcp-dialog-footer">
          {editing && mode === 'manual' ? (
            <Button
              variant="outline"
              size="sm"
              className="cm-mcp-dialog-delete"
              disabled={saving}
              onClick={() => { void confirmDelete() }}
            >
              {t(deleteArmed ? 'mcpDeleteConfirm' : 'mcpDeleteAction')}
            </Button>
          ) : null}
          <span className="cm-mcp-dialog-spacer" />
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            {t('mcpCancelAction')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSubmit}
            onClick={() => { void submit() }}
          >
            {t(mode === 'import' ? 'mcpImportAction' : 'mcpSaveAction')}
          </Button>
        </div>
      )}
    >
      <div className="cm-mcp-dialog cm-dialog__scroll">
        <p className="cm-mcp-dialog-intro">{t('mcpDialogIntro')}</p>

        <SegmentedControl
          id="cm-mcp-mode"
          value={mode}
          options={[
            { value: 'manual', label: t('mcpModeManual') },
            { value: 'import', label: t('mcpModeImport') },
          ]}
          onChange={next => { setMode(next); setFailure(undefined) }}
          label={t('mcpDialogIntro')}
          disabled={saving}
          className="cm-mcp-dialog-modes"
        />

        {mode === 'manual' ? (
          <>
            {/* 名称与连接方式并排：两者都短，纵向堆叠只会把弹窗拉长。 */}
            <div className="cm-mcp-grid">
              <Field label={t('mcpFieldName')} hint={editing ? t('mcpFieldNameLocked') : t('mcpFieldNameHint')}>
                <Input
                  value={form.name}
                  placeholder={t('mcpFieldNamePlaceholder')}
                  aria-label={t('mcpFieldName')}
                  disabled={editing || saving}
                  onChange={event => patch({ name: event.target.value })}
                />
              </Field>

              <Field label={t('mcpFieldTransport')} hint={t('mcpFieldTransportHint')}>
                <SegmentedControl
                  id="cm-mcp-transport"
                  value={form.transport}
                  options={TRANSPORT_OPTIONS(t)}
                  onChange={(next: McpTransport) => patch({ transport: next })}
                  label={t('mcpFieldTransport')}
                  disabled={saving}
                />
              </Field>
            </div>

            {form.transport === 'stdio' ? (
              <>
                <Field label={t('mcpFieldCommand')} hint={t('mcpFieldCommandHint')}>
                  <Input
                    value={form.commandLine}
                    placeholder="npx -y @playwright/mcp@latest --headless"
                    aria-label={t('mcpFieldCommand')}
                    disabled={saving}
                    onChange={event => patch({ commandLine: event.target.value })}
                  />
                </Field>
                <Field label={t('mcpFieldEnv')} hint={t('mcpFieldEnvHint')}>
                  <Input
                    value={form.env}
                    placeholder='{"KEY":"VALUE"}'
                    aria-label={t('mcpFieldEnv')}
                    disabled={saving}
                    onChange={event => patch({ env: event.target.value })}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label={t('mcpFieldUrl')} hint={t('mcpFieldUrlHint')}>
                  <Input
                    value={form.url}
                    placeholder="https://mcp.example.com/mcp"
                    aria-label={t('mcpFieldUrl')}
                    disabled={saving}
                    onChange={event => patch({ url: event.target.value })}
                  />
                </Field>
                <Field label={t('mcpFieldHeaders')} hint={t('mcpFieldHeadersHint')}>
                  <Input
                    value={form.headers}
                    placeholder='{"Authorization":"Bearer …"}'
                    aria-label={t('mcpFieldHeaders')}
                    disabled={saving}
                    onChange={event => patch({ headers: event.target.value })}
                  />
                </Field>
              </>
            )}
          </>
        ) : (
          <>
            <Field label={t('mcpImportTitle')} hint={t('mcpImportOverwriteHint')}>
              {/* 官方原子包没有多行文本输入：InlineEditor 是为短草稿设计的（Enter 保存），
                  不适合粘贴 JSON。这里用原生 textarea，并沿用宿主的输入样式 token。 */}
              <textarea
                className="cm-mcp-import-input"
                rows={5}
                value={importText}
                placeholder={t('mcpImportPlaceholder')}
                aria-label={t('mcpImportTitle')}
                disabled={saving}
                onChange={event => { setImportText(event.target.value); setFailure(undefined) }}
              />
            </Field>

            {preview === undefined ? null : preview.ok ? (
              <div className="cm-mcp-import-preview">
                <span className="cm-mcp-import-count">
                  {`${t('mcpImportPreviewPrefix')} ${String(preview.rows.length)} ${t('mcpCount')}`}
                </span>
                <ul className="cm-mcp-import-rows">
                  {preview.rows.map(row => (
                    <li key={row.name} className="cm-mcp-import-row">
                      <span className="cm-mcp-import-name">{row.name}</span>
                      <Tag tone="neutral">{row.transport === 'stdio' ? 'stdio' : 'http'}</Tag>
                      <span className="cm-mcp-import-target">{row.target}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="cm-mcp-issue">{t(importReasonKey(preview.reason))}</p>
            )}
          </>
        )}

        {issues.length > 0 ? (
          <ul className="cm-mcp-issues">
            {issues.map(issue => (
              <li key={issue} className="cm-mcp-issue">{t(issueLabelKey(issue))}</li>
            ))}
          </ul>
        ) : null}

        {failureText() !== undefined ? <p className="cm-mcp-issue">{failureText()}</p> : null}

        {editing && deleteArmed ? <p className="cm-mcp-issue">{t('mcpDeleteHint')}</p> : null}
      </div>
    </Modal>
  )
}

/** 两种传输方式的分段项；顺序即界面顺序。括号说明放在字段提示里，避免挤压分段。 */
function TRANSPORT_OPTIONS(t: Translate): { value: McpTransport; label: string }[] {
  return [
    { value: 'stdio', label: t('mcpTransportStdio') },
    { value: 'streamable-http', label: t('mcpTransportHttp') },
  ]
}

/** 表单里的一行：标题、控件与可选说明。 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="cm-mcp-field">
      <span className="cm-mcp-field-label">{label}</span>
      {children}
      {hint !== undefined ? <span className="cm-mcp-field-hint">{hint}</span> : null}
    </div>
  )
}
