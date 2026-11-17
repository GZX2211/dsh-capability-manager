// src/client/components/CapabilityRow.tsx
//
// 穿梭框里的一行：名称、摘要、来源标签，以及把它换到另一侧的动作。
//
// 能力池一侧多给一个常驻开关；排出池一侧只有加号——池外能力不能常驻，
// 给一个禁用的开关只会让人猜测为什么点不动。
// `data-row-key` 是 AnimatedRows 定位同一行的依据，缺了它补位与淡出都不会发生。

import { Button, IconFolderOpenOutlineRegular, IconPlusOutlineRegular, Switch, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityEntry, CapabilitySource } from '../../shared/capability.ts'
import type { CapabilityConfig } from '../../shared/config.ts'
import type { Dict, Translate } from '../i18n.ts'
import { MinusGlyph } from './RowGlyphs.tsx'

const SOURCE_LABELS: Record<CapabilitySource, keyof Dict> = {
  official: 'sourceOfficial',
  custom: 'sourceCustom',
  mcp: 'sourceMcp',
}

/** 行所在的一侧：能力池可设常驻，排出池只能加回。 */
export type RowSide = 'pooled' | 'excluded'

export interface CapabilityRowProps {
  entry: CapabilityEntry
  config: CapabilityConfig
  side: RowSide
  /** 写入进行中：所有按钮禁用，避免并发提交同一份 revision。 */
  disabled: boolean
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  onToggleResident: (id: string, next: boolean) => void
  /** 打开自建能力的目录；只有 `owned` 的行会出现入口。 */
  onReveal: (id: string) => void
  t: Translate
}

export function CapabilityRow({ entry, config, side, disabled, onAdd, onRemove, onToggleResident, onReveal, t }: CapabilityRowProps) {
  const resident = config.resident.includes(entry.id)

  return (
    <div className="cm-row" data-row-key={entry.id}>
      <div className="cm-row-main">
        <span className="cm-row-name">{entry.name}</span>
        {entry.summary.length > 0 ? <span className="cm-row-summary">{entry.summary}</span> : null}
      </div>

      <div className="cm-row-tags">
        <Tag tone="outline">{t(SOURCE_LABELS[entry.source])}</Tag>
      </div>

      <div className="cm-row-actions">
        {/* 目录入口在加号/减号左侧：它是「先去编辑」，主操作仍然是入池/出池。 */}
        {entry.owned ? (
          <Tooltip label={t('openFolder')} side="left">
            <Button
              className="cm-row-action"
              variant="ghost"
              size="sm"
              icon={<IconFolderOpenOutlineRegular />}
              aria-label={`${t('openFolder')}: ${entry.name}`}
              disabled={disabled}
              onClick={() => onReveal(entry.id)}
            />
          </Tooltip>
        ) : null}
        {side === 'pooled' ? (
          <>
            <Switch
              checked={resident}
              onChange={next => onToggleResident(entry.id, next)}
              label={`${entry.name} ${t('residentLabel')}`}
              disabled={disabled}
              title={t(resident ? 'residentTooltipOn' : 'residentTooltipOff')}
              className="cm-row-switch"
            />
            <Tooltip label={t('removeFromPool')} side="left">
              <Button
                className="cm-row-action"
                variant="ghost"
                size="sm"
                icon={<MinusGlyph />}
                aria-label={`${t('removeFromPool')}: ${entry.name}`}
                disabled={disabled}
                onClick={() => onRemove(entry.id)}
              />
            </Tooltip>
          </>
        ) : (
          <Tooltip label={t('addToPool')} side="left">
            <Button
              className="cm-row-action"
              variant="ghost"
              size="sm"
              icon={<IconPlusOutlineRegular />}
              aria-label={`${t('addToPool')}: ${entry.name}`}
              disabled={disabled}
              onClick={() => onAdd(entry.id)}
            />
          </Tooltip>
        )}
      </div>
    </div>
  )
}
