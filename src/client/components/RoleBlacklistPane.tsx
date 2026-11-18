// src/client/components/RoleBlacklistPane.tsx
//
// 一个角色的黑名单面板：标题、禁用计数、清空动作，以及可滚动的能力列表。
//
// 两个角色是两份独立的配置，所以这里是两个并排的面板而不是一个列表两列开关：
// 「这个角色禁用了什么」是分开的两个问题，并排能一眼比较，也不会让同一行承载两种状态。

import { Button, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityEntry, CapabilityId } from '../../shared/capability.ts'
import type { SessionRoleName } from '../../shared/config.ts'
import type { Translate } from '../i18n.ts'
import { BlacklistRow } from './BlacklistRow.tsx'

export interface RoleBlacklistPaneProps {
  role: SessionRoleName
  title: string
  /** 已按「禁用置顶、名称序」排好的当前筛选结果。 */
  rows: readonly CapabilityEntry[]
  /** 该角色禁用的能力标识，逐行判定开关状态。 */
  blacklist: ReadonlySet<CapabilityId>
  /** 当前筛选结果里被该角色禁用的数量。 */
  blacklisted: number
  /** 当前筛选结果总数，作为计数分母。 */
  total: number
  /** 已排除出能力池的能力标识，用于行内「池外」标记。 */
  excludedIds: ReadonlySet<CapabilityId>
  disabled: boolean
  /** 数据未到位时显示占位而不是空态。 */
  ready: boolean
  onToggle: (role: SessionRoleName, id: CapabilityId, next: boolean) => void
  onClear: (role: SessionRoleName) => void
  t: Translate
}

export function RoleBlacklistPane({
  role, title, rows, blacklist, blacklisted, total, excludedIds, disabled, ready, onToggle, onClear, t,
}: RoleBlacklistPaneProps) {
  return (
    <section className="cm-pane" aria-label={title}>
      <div className="cm-pane-header">
        <span className="cm-pane-title">{title}</span>
        <div className="cm-pane-header-actions">
          <Button
            className="cm-pane-clear"
            variant="ghost"
            size="sm"
            disabled={disabled || blacklisted === 0}
            title={t('blacklistClearTooltip')}
            onClick={() => onClear(role)}
          >
            {t('blacklistClear')}
          </Button>
          <span className="cm-pane-count">
            {t('blacklistDisabled')} {blacklisted}/{total}
          </span>
        </div>
      </div>

      <div className="cm-pane-body">
        {!ready ? (
          <div className="cm-pane-empty">
            <IconLoadingOutlineRegular />
            <span className="cm-pane-empty-title">{t('loading')}</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="cm-pane-empty">
            <span className="cm-pane-empty-title">{t('empty')}</span>
            <span className="cm-pane-empty-hint">{t('emptyHint')}</span>
          </div>
        ) : (
          <div className="cm-pane-list" role="list" aria-label={title}>
            {rows.map(entry => (
              <div role="listitem" key={entry.id}>
                <BlacklistRow
                  entry={entry}
                  blacklisted={blacklist.has(entry.id)}
                  excludedFromPool={excludedIds.has(entry.id)}
                  disabled={disabled}
                  roleLabel={title}
                  onToggle={(_id, next) => onToggle(role, entry.id, next)}
                  t={t}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
