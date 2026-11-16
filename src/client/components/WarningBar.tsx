// src/client/components/WarningBar.tsx
//
// 风险提示条。文案由服务端给码、客户端翻成当前语言：服务端不该关心语言。

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
          <span>{t(WARNING_LABELS[warning.code])}</span>
        </div>
      ))}
    </div>
  )
}
