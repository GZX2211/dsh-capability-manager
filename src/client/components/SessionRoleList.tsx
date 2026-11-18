// src/client/components/SessionRoleList.tsx
//
// 「会话角色」列表：每个活跃会话显示生效角色与来源，并允许写一个手动绑定。
//
// 生效角色与手动绑定必须分开显示。PA 的判定优先于绑定，所以「改了下拉但角色没变」
// 是正常行为；不把这条说清楚，用户会以为自己没保存成功。

import { SegmentedControl, type SegmentedControlOption } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionRoleRow, BindingChoice } from '../lib/roles.ts'
import type { Translate } from '../i18n.ts'

/** 会话标识在行内只展示前几位：完整标识给 title 与无障碍名称。 */
const SHORT_ID_LENGTH = 8

export interface SessionRoleListProps {
  rows: readonly SessionRoleRow[]
  disabled: boolean
  onBind: (sessionId: string, choice: BindingChoice) => void
  t: Translate
}

export function SessionRoleList({ rows, disabled, onBind, t }: SessionRoleListProps) {
  if (rows.length === 0) {
    return (
      <div className="cm-pane-empty">
        <span className="cm-pane-empty-title">{t('sessionsEmpty')}</span>
        <span className="cm-pane-empty-hint">{t('sessionsEmptyHint')}</span>
      </div>
    )
  }

  const options: readonly SegmentedControlOption<BindingChoice>[] = [
    { value: 'auto', label: t('sessionAuto') },
    { value: 'router', label: t('roleRouterShort') },
    { value: 'worker', label: t('roleWorkerShort') },
  ]

  return (
    <div className="cm-session-list" role="list" aria-label={t('sessionsTitle')}>
      {rows.map((row, index) => {
        const short = row.id.length > SHORT_ID_LENGTH ? `${row.id.slice(0, SHORT_ID_LENGTH)}…` : row.id
        const effective = `${t('sessionEffective')}: ${roleLabel(row, t)} · ${sourceLabel(row, t)}`
        return (
          <div className="cm-session-row" role="listitem" key={row.id}>
            <div className="cm-session-main">
              <span className="cm-session-id" title={row.id}>
                {short}
              </span>
              <span className="cm-session-effective">{effective}</span>
              {row.bindingDormant ? <span className="cm-session-hint">{t('sessionBindingDormant')}</span> : null}
            </div>
            <SegmentedControl
              id={`cm-session-role-${String(index)}`}
              value={row.choice}
              options={options}
              onChange={next => onBind(row.id, next)}
              label={`${short} ${t('sessionChoiceLabel')}`}
              disabled={disabled}
              className="cm-session-choice"
            />
          </div>
        )
      })}
    </div>
  )
}

/** 生效角色文案：未知角色与两个已知角色分开表达。 */
function roleLabel(row: SessionRoleRow, t: Translate): string {
  if (row.role === 'router') return t('roleRouterShort')
  if (row.role === 'worker') return t('roleWorkerShort')
  return t('roleUnknown')
}

/** 角色来源文案。 */
function sourceLabel(row: SessionRoleRow, t: Translate): string {
  if (row.roleSource === 'pa') return t('sessionSourcePa')
  if (row.roleSource === 'binding') return t('sessionSourceBinding')
  return t('sessionSourceUnknown')
}
