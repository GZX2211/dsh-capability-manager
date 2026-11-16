// src/client/components/CapabilityRow.tsx
//
// 列表中的一行：名称、摘要、来源标签，以及「池」与「常」两个开关。
//
// 「常」在池外时禁用：常驻必须是池内能力的子集，允许开启只会让下一次读取
// 把它悄悄剔除，用户却以为自己设置成功了。

import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityEntry, CapabilitySource } from '../../shared/capability.ts'
import type { CapabilityConfig } from '../../shared/config.ts'
import type { Dict, Translate } from '../i18n.ts'

const SOURCE_LABELS: Record<CapabilitySource, keyof Dict> = {
  official: 'sourceOfficial',
  custom: 'sourceCustom',
  mcp: 'sourceMcp',
}

export interface CapabilityRowProps {
  entry: CapabilityEntry
  config: CapabilityConfig
  /** 写入进行中：所有开关禁用，避免并发提交同一份 revision。 */
  disabled: boolean
  onTogglePool: (id: string, next: boolean) => void
  onToggleResident: (id: string, next: boolean) => void
  t: Translate
}

export function CapabilityRow({ entry, config, disabled, onTogglePool, onToggleResident, t }: CapabilityRowProps) {
  const inPool = !config.excluded.includes(entry.id)
  const resident = config.resident.includes(entry.id)

  return (
    <div className="cm-row">
      <div className="cm-row-main">
        <span className="cm-row-name">{entry.name}</span>
        {entry.summary.length > 0 ? <span className="cm-row-summary">{entry.summary}</span> : null}
      </div>

      <div className="cm-row-tags">
        <Tag tone="outline">{t(SOURCE_LABELS[entry.source])}</Tag>
      </div>

      <div className="cm-row-toggles">
        <div className="cm-toggle">
          <Switch
            checked={inPool}
            onChange={next => onTogglePool(entry.id, next)}
            label={`${entry.name} ${t('poolLabel')}`}
            disabled={disabled}
            title={t(inPool ? 'poolTooltipOff' : 'poolTooltipOn')}
          />
          <span className="cm-toggle-label">{t('poolLabel')}</span>
        </div>
        <div className="cm-toggle">
          <Switch
            checked={resident}
            onChange={next => onToggleResident(entry.id, next)}
            label={`${entry.name} ${t('residentLabel')}`}
            disabled={disabled || !inPool}
            title={inPool ? t(resident ? 'residentTooltipOn' : 'residentTooltipOff') : t('residentDisabledTooltip')}
          />
          <span className="cm-toggle-label">{t('residentLabel')}</span>
        </div>
      </div>
    </div>
  )
}
