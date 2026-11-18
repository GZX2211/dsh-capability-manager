// src/client/views/Settings.tsx
//
// 设置页：左侧分区导航 + 右侧内容。布局与工具/Skill 页不同（那两页是穿梭框），
// 因为设置会持续增加分区，导航必须独立于内容滚动。
//
// 角色相关的分区只在检测到 `ctx.paRoles` 时出现（§3.6 BL-7）：没有角色判定时，
// 黑名单既不生效也无从验证，摆一个能配置却不生效的面板比不显示更糟。

import { Button, IconSearchOutlineRegular, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useMemo, useState } from 'react'
import type { ConfigPatchInput, SnapshotResponse } from '../../shared/api.ts'
import type { CapabilityEntry, CapabilityId } from '../../shared/capability.ts'
import type { SessionRoleName } from '../../shared/config.ts'
import type { Translate } from '../i18n.ts'
import { bindingPatch, blacklistOf, blacklistRows, sessionRoleRows, type BindingChoice } from '../lib/roles.ts'
import { RoleBlacklistPane } from '../components/RoleBlacklistPane.tsx'
import { SessionRoleList } from '../components/SessionRoleList.tsx'

type SettingsSection = 'roles' | 'sessions' | 'embedding'

const SECTION_LABELS: Record<SettingsSection, 'sectionRoles' | 'sectionSessions' | 'sectionEmbedding'> = {
  roles: 'sectionRoles',
  sessions: 'sectionSessions',
  embedding: 'sectionEmbedding',
}

export interface SettingsProps {
  snapshot: SnapshotResponse
  /** 已本地化的全量能力：与穿梭框共用同一份摘要，搜索词才能一致命中。 */
  capabilities: readonly CapabilityEntry[]
  saving: boolean
  onMutate: (patch: ConfigPatchInput) => void
  t: Translate
}

export function Settings({ snapshot, capabilities, saving, onMutate, t }: SettingsProps) {
  const [section, setSection] = useState<SettingsSection>('roles')
  const [query, setQuery] = useState('')

  const rolesAvailable = snapshot.rolesAvailable
  const sections = useMemo<SettingsSection[]>(
    () => (rolesAvailable ? ['roles', 'sessions', 'embedding'] : ['embedding']),
    [rolesAvailable],
  )
  // 分区集合会随 PA 的出现/消失变化；当前分区失效时退回第一个可用分区，
  // 否则用户会停在一个渲染为空的页面里。
  const active = sections.includes(section) ? section : sections[0]

  const config = snapshot.config
  const excludedIds = useMemo(() => new Set<CapabilityId>(config.excluded), [config.excluded])
  const routerRows = useMemo(
    () => blacklistRows({ capabilities, config, role: 'router', query }),
    [capabilities, config, query],
  )
  const workerRows = useMemo(
    () => blacklistRows({ capabilities, config, role: 'worker', query }),
    [capabilities, config, query],
  )
  const sessions = useMemo(() => sessionRoleRows(snapshot.sessions, config), [snapshot.sessions, config])

  const toggleBlacklist = useCallback(
    (role: SessionRoleName, id: CapabilityId, next: boolean): void => {
      onMutate({ op: 'set-blacklist', role, id, value: next })
    },
    [onMutate],
  )
  const clearBlacklist = useCallback(
    (role: SessionRoleName): void => {
      onMutate({ op: 'clear-blacklist', role })
    },
    [onMutate],
  )
  const bindSession = useCallback(
    (sessionId: string, choice: BindingChoice): void => {
      onMutate(bindingPatch(sessionId, choice))
    },
    [onMutate],
  )

  return (
    <div className="cm-settings">
      <nav className="cm-settings-nav" aria-label={t('settingsNavLabel')}>
        {sections.map(value => (
          <Button
            key={value}
            variant="ghost"
            size="sm"
            className={value === active ? 'cm-settings-nav-item cm-settings-nav-item--active' : 'cm-settings-nav-item'}
            aria-current={value === active ? 'page' : undefined}
            onClick={() => setSection(value)}
          >
            {t(SECTION_LABELS[value])}
          </Button>
        ))}
      </nav>

      <div className="cm-settings-body">
        {active === 'roles' ? (
          <section className="cm-settings-section" aria-label={t('rolesTitle')}>
            <h2 className="cm-settings-title">{t('rolesTitle')}</h2>
            <p className="cm-settings-intro">{t('rolesIntro')}</p>
            {rolesAvailable ? (
              <>
                <div className="cm-settings-toolbar">
                  <Input
                    className="cm-search"
                    icon={<IconSearchOutlineRegular />}
                    value={query}
                    placeholder={t('searchPlaceholder')}
                    aria-label={t('searchLabel')}
                    onChange={event => setQuery(event.target.value)}
                  />
                </div>
                <div className="cm-blacklist-grid">
                  <RoleBlacklistPane
                    role="router"
                    title={t('roleRouter')}
                    rows={routerRows.rows}
                    blacklist={blacklistOf(config, 'router')}
                    blacklisted={routerRows.blacklisted}
                    total={routerRows.total}
                    excludedIds={excludedIds}
                    disabled={saving}
                    ready
                    onToggle={toggleBlacklist}
                    onClear={clearBlacklist}
                    t={t}
                  />
                  <RoleBlacklistPane
                    role="worker"
                    title={t('roleWorker')}
                    rows={workerRows.rows}
                    blacklist={blacklistOf(config, 'worker')}
                    blacklisted={workerRows.blacklisted}
                    total={workerRows.total}
                    excludedIds={excludedIds}
                    disabled={saving}
                    ready
                    onToggle={toggleBlacklist}
                    onClear={clearBlacklist}
                    t={t}
                  />
                </div>
              </>
            ) : (
              <p className="cm-settings-notice">{t('rolesUnavailable')}</p>
            )}
          </section>
        ) : active === 'sessions' ? (
          <section className="cm-settings-section" aria-label={t('sessionsTitle')}>
            <h2 className="cm-settings-title">{t('sessionsTitle')}</h2>
            <p className="cm-settings-intro">{t('sessionsIntro')}</p>
            {rolesAvailable ? (
              <div className="cm-settings-panel">
                <SessionRoleList rows={sessions} disabled={saving} onBind={bindSession} t={t} />
              </div>
            ) : (
              <p className="cm-settings-notice">{t('rolesUnavailable')}</p>
            )}
          </section>
        ) : (
          <section className="cm-settings-section" aria-label={t('embeddingTitle')}>
            <h2 className="cm-settings-title">{t('embeddingTitle')}</h2>
            <p className="cm-settings-intro">{t('embeddingIntro')}</p>
            <p className="cm-settings-state">
              {t(snapshot.embedding.enabled ? 'embeddingStateOn' : 'embeddingStateOff')}
            </p>
            {snapshot.embedding.message !== undefined ? (
              <p className="cm-settings-notice">{snapshot.embedding.message}</p>
            ) : null}
            <p className="cm-settings-notice">{t('embeddingComingSoon')}</p>
          </section>
        )}
      </div>
    </div>
  )
}
