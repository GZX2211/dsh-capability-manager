// src/client/components/McpRow.tsx
//
// MCP 列表的一行：状态点、名称与连接目标、状态标签、编辑入口与启用开关。
//
// 状态点在最左：一眼能看出「这台现在连没连上」。开关在右：它是这一行唯一的
// 主操作。编辑按钮放在开关左侧——先改配置再决定启用，顺序与用户的操作一致。
//
// 由插件注册的服务器只读：开关与编辑都禁用，因为它们不在本面板的配置里。

import {
  Button,
  IconEditOutlineRegular,
  StateDot,
  Switch,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServerView, McpState } from '../../shared/mcp.ts'
import type { Translate } from '../i18n.ts'
import { mcpStateDot, mcpStateLabelKey } from '../lib/mcp.ts'

/** 状态标签的配色：只让「已连接」「失败」「等待凭据」带颜色，其余保持中性。 */
function stateTone(state: McpState): 'success' | 'danger' | 'warning' | 'outline' {
  if (state === 'connected') return 'success'
  if (state === 'failed') return 'danger'
  if (state === 'waiting-credentials') return 'warning'
  return 'outline'
}

export interface McpRowProps {
  server: McpServerView
  /** 读取或写入进行中：整行控件禁用，避免并发提交。 */
  disabled: boolean
  onToggle: (name: string, enabled: boolean) => void
  onEdit: (server: McpServerView) => void
  t: Translate
}

export function McpRow({ server, disabled, onToggle, onEdit, t }: McpRowProps) {
  const stateLabel = t(mcpStateLabelKey(server.state))
  const editable = server.configured && !server.registered
  // 摘要为空说明配置里读不到字段（注册条目或残留条目），退回状态文案，
  // 避免一行只剩名字。
  const summary = server.target.length > 0 ? server.target : t(mcpStateLabelKey(server.state))

  return (
    <div className="cm-row cm-mcp-row" data-row-key={server.name}>
      <span className="cm-mcp-state" title={stateLabel}>
        <StateDot state={mcpStateDot(server.state)} />
      </span>

      <Tooltip label={server.target} side="top" delayMs={300} onlyWhenClipped portal>
        <div className="cm-row-main">
          <span className="cm-row-name">{server.name}</span>
          <span className="cm-row-summary">{summary}</span>
        </div>
      </Tooltip>

      <div className="cm-row-tags">
        <Tag tone={stateTone(server.state)}>{stateLabel}</Tag>
        {server.state === 'connected' && server.toolCount !== undefined ? (
          <Tag tone="outline">{`${String(server.toolCount)} ${t('mcpTools')}`}</Tag>
        ) : null}
        <Tag tone="neutral">{server.transport === 'stdio' ? 'stdio' : 'http'}</Tag>
        {server.registered ? <Tag tone="info">{t('mcpRegistered')}</Tag> : null}
        {!server.configured ? <Tag tone="quiet">{t('mcpStale')}</Tag> : null}
      </div>

      <div className="cm-row-actions">
        <Tooltip label={editable ? t('mcpEditTooltip') : t('mcpReadonlyTooltip')} side="left">
          <Button
            className="cm-row-action"
            variant="ghost"
            size="sm"
            icon={<IconEditOutlineRegular />}
            aria-label={`${t('mcpEditAction')}: ${server.name}`}
            disabled={disabled || !editable}
            onClick={() => onEdit(server)}
          />
        </Tooltip>
        <Switch
          checked={server.enabled}
          onChange={next => onToggle(server.name, next)}
          label={`${server.name} ${t('mcpToggleLabel')}`}
          disabled={disabled || !server.configured || server.registered}
          title={t('mcpToggleLabel')}
          className="cm-row-switch"
        />
      </div>
    </div>
  )
}
