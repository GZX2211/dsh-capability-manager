// src/client/components/WarningBar.tsx
//
// 风险提示条。文案由服务端给码、客户端翻成当前语言：服务端不该关心语言。
//
// 黑名单类提示带角色：同一批能力可能只对其中一个角色不可用，不带角色会让人
// 以为配置影响了全部会话。

import { IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotWarning, WarningCode } from '../../shared/api.ts'
import type { Dict, Translate } from '../i18n.ts'

const WARNING_LABELS: Record<WarningCode, keyof Dict> = {
  'meta-search-not-resident': 'warningMetaSearchNotResident',
  'meta-search-excluded': 'warningMetaSearchExcluded',
  'skill-excluded': 'warningSkillExcluded',
  'resident-empty': 'warningResidentEmpty',
  'blacklist-excludes-resident': 'warningBlacklistExcludesResident',
}

export interface WarningBarProps {
  warnings: readonly SnapshotWarning[]
  t: Translate
}

export function WarningBar({ warnings, t }: WarningBarProps) {
  if (warnings.length === 0) return null
  return (
    <div className="cm-warnings">
      {warnings.map((warning, index) => (
        <div className="cm-warning" key={`${warning.code}-${String(index)}`}>
          <IconWarningOutlineRegular className="cm-warning-icon" />
          <span>{describe(warning, t)}</span>
        </div>
      ))}
    </div>
  )
}

/** 提示正文：按码取文案，命中角色时在后面补角色名。 */
function describe(warning: SnapshotWarning, t: Translate): string {
  const text = t(WARNING_LABELS[warning.code])
  const roles = (warning.roles ?? []).map(role => t(role === 'router' ? 'roleRouterShort' : 'roleWorkerShort'))
  return roles.length === 0 ? text : `${text} · ${roles.join(' / ')}`
}
