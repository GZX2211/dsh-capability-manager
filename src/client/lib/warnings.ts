// src/client/lib/warnings.ts
//
// 风险提示文案：服务端给码与角色，客户端归并成可显示的行。
// 同一条规则命中两个角色时服务端发两条，界面只显示一行并合并角色，
// 否则同一个句子会在提示区里重复出现两次。

import type { SnapshotWarning, WarningCode } from '../../shared/api.ts'
import type { SessionRoleName } from '../../shared/config.ts'
import type { Dict, Translate } from '../i18n.ts'

const WARNING_LABELS: Record<WarningCode, keyof Dict> = {
  'meta-search-not-resident': 'warningMetaSearchNotResident',
  'meta-search-excluded': 'warningMetaSearchExcluded',
  'skill-excluded': 'warningSkillExcluded',
  'resident-empty': 'warningResidentEmpty',
  'blacklist-excludes-resident': 'warningBlacklistExcludesResident',
}

const ROLE_ORDER: readonly SessionRoleName[] = ['router', 'worker']

/**
 * 按码归并提示：同码的多条只出一行，角色按固定顺序去重后附在句尾。
 * 行序取码首次出现的顺序，刷新后同一批提示不会跳动。
 */
export function describeWarnings(warnings: readonly SnapshotWarning[], t: Translate): string[] {
  const rolesByCode = new Map<WarningCode, Set<SessionRoleName>>()
  for (const warning of warnings) {
    let roles = rolesByCode.get(warning.code)
    if (roles === undefined) {
      roles = new Set<SessionRoleName>()
      rolesByCode.set(warning.code, roles)
    }
    for (const role of ROLE_ORDER) {
      if (warning.roles?.includes(role) === true) roles.add(role)
    }
  }
  return [...rolesByCode].map(([code, roles]) => {
    const text = t(WARNING_LABELS[code])
    const labels = ROLE_ORDER.filter(role => roles.has(role)).map(role => t(role === 'router' ? 'roleRouterShort' : 'roleWorkerShort'))
    return labels.length === 0 ? text : `${text} · ${labels.join(' / ')}`
  })
}

/** 挑出尚未提示过的行；seen 由调用方更新，本函数不改动它。 */
export function unseenLines(lines: readonly string[], seen: ReadonlySet<string>): string[] {
  return lines.filter(line => !seen.has(line))
}
