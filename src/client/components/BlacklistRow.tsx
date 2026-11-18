// src/client/components/BlacklistRow.tsx
//
// 角色黑名单列表里的一行：名称、摘要、类型与来源标签，以及「对该角色禁用」开关。
//
// 开关的读法是「打开 = 禁用」：面板标题已经写明是黑名单，行内再写一次「启用」
// 只会让两种语义同一个开关上打架。
// 池外能力仍然列出并标注：黑名单与池互相独立，先配置、后入池是合法用法。

import { Switch, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityEntry, CapabilitySource } from '../../shared/capability.ts'
import type { Dict, Translate } from '../i18n.ts'

const SOURCE_LABELS: Record<CapabilitySource, keyof Dict> = {
  official: 'sourceOfficial',
  custom: 'sourceCustom',
  mcp: 'sourceMcp',
}

export interface BlacklistRowProps {
  entry: CapabilityEntry
  /** 该能力是否已被当前角色禁用。 */
  blacklisted: boolean
  /** 该能力是否已被排除出能力池；池外能力即使不黑名单也不可用。 */
  excludedFromPool: boolean
  /** 写入进行中：开关禁用，避免并发提交同一份 revision。 */
  disabled: boolean
  /** 角色标签，拼进无障碍名称。 */
  roleLabel: string
  onToggle: (id: string, next: boolean) => void
  t: Translate
}

export function BlacklistRow({
  entry, blacklisted, excludedFromPool, disabled, roleLabel, onToggle, t,
}: BlacklistRowProps) {
  return (
    <div className="cm-row" data-row-key={entry.id}>
      {/* 摘要只显示一行：被截断时悬停可读全文，未截断则不出提示。 */}
      <Tooltip label={entry.summary} side="top" delayMs={300} onlyWhenClipped portal>
        <div className="cm-row-main">
          <span className="cm-row-name">{entry.name}</span>
          {entry.summary.length > 0 ? <span className="cm-row-summary">{entry.summary}</span> : null}
        </div>
      </Tooltip>

      <div className="cm-row-tags">
        <Tag tone="outline">{t(entry.kind === 'tool' ? 'kindTool' : 'kindSkill')}</Tag>
        <Tag tone="outline">{t(SOURCE_LABELS[entry.source])}</Tag>
        {excludedFromPool ? (
          <Tooltip label={t('blacklistExcludedHint')} side="top">
            <span className="cm-tag-anchor">
              <Tag tone="warning">{t('blacklistExcludedTag')}</Tag>
            </span>
          </Tooltip>
        ) : null}
      </div>

      <div className="cm-row-actions">
        <Switch
          checked={blacklisted}
          onChange={next => onToggle(entry.id, next)}
          label={`${entry.name} ${t('blacklistSwitchLabel')} ${roleLabel}`}
          disabled={disabled}
          title={t(blacklisted ? 'blacklistSwitchTooltipOn' : 'blacklistSwitchTooltipOff')}
          className="cm-row-switch"
        />
      </div>
    </div>
  )
}
