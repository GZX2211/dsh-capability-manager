// src/client/lib/roles.ts
//
// 角色黑名单与会话角色的界面派生逻辑：纯函数，输入即全部事实。
//
// 这里的每个函数都对应界面上一个可见的问题——「这个角色禁用了什么」「这一行该不该
// 高亮」「这个绑定到底生效没有」。把它们放在 lib 而不是组件里，是为了让「界面显示
// 的状态」与「Host 实际判定的状态」用同一份推导，而不是各自解释配置。

import type { SessionRoleSnapshot, ConfigPatchInput } from '../../shared/api.ts'
import type { CapabilityEntry, CapabilityId, CapabilityKind } from '../../shared/capability.ts'
import type { CapabilityConfig, RoleSource, SessionRoleName } from '../../shared/config.ts'
import { matchesQuery } from './filter.ts'

/** 手动绑定的界面选择值；`auto` 表示不写绑定，让角色判定回落到 `ctx.paRoles`。 */
export type BindingChoice = SessionRoleName | 'auto'

/**
 * 某个角色被禁用的能力标识集合。
 *
 * @param config - 当前配置。
 * @param role - 目标角色。
 * @returns 只读集合；供渲染与计数共用。
 */
export function blacklistOf(config: CapabilityConfig, role: SessionRoleName): ReadonlySet<CapabilityId> {
  return new Set(config.blacklist[role])
}

/**
 * 某个会话的手动绑定。
 *
 * @param config - 当前配置。
 * @param sessionId - 会话身份。
 * @returns 绑定的角色；没有绑定时为 `undefined`。
 */
export function bindingOf(config: CapabilityConfig, sessionId: string): SessionRoleName | undefined {
  return config.roleBindings[sessionId]
}

/**
 * 某个会话的绑定选择值。
 *
 * @param config - 当前配置。
 * @param sessionId - 会话身份。
 * @returns 绑定的角色，或 `auto`。
 */
export function bindingChoiceOf(config: CapabilityConfig, sessionId: string): BindingChoice {
  return bindingOf(config, sessionId) ?? 'auto'
}

/**
 * 把一次绑定选择翻译成配置改动。
 *
 * `auto` 必须显式写 `role: null`：配置是「有就是有、没有就是没有」，
 * 省略字段无法表达「解除绑定」。
 *
 * @param sessionId - 会话身份。
 * @param choice - 界面选择值。
 * @returns 可直接提交给快照写入的改动。
 */
export function bindingPatch(sessionId: string, choice: BindingChoice): ConfigPatchInput {
  return { op: 'set-role-binding', sessionId, role: choice === 'auto' ? null : choice }
}

export interface BlacklistRowsInput {
  capabilities: readonly CapabilityEntry[]
  config: CapabilityConfig
  role: SessionRoleName
  /** 能力类型筛选；`all` 表示不按类型过滤。 */
  kind: CapabilityKind | 'all'
  query: string
}

/** 黑名单一侧的列表内容：已禁用项置顶，另给当前筛选结果内的计数。 */
export interface BlacklistRows {
  rows: CapabilityEntry[]
  /** 当前筛选结果里已被该角色禁用的数量。 */
  blacklisted: number
  /** 当前筛选结果的总数。 */
  total: number
}

/**
 * 计算某个角色的黑名单列表。
 *
 * 已禁用的置顶：这个面板回答的第一个问题是「我禁用了什么」，而不是「按字母排第几」。
 * 组内保持名称序，让打开面板时行不会乱跳。
 *
 * @param input - 全量能力、配置、角色、类型筛选与搜索词。
 * @returns 行、禁用数与总数；输入不被修改。
 */
export function blacklistRows(input: BlacklistRowsInput): BlacklistRows {
  const blacklisted = blacklistOf(input.config, input.role)
  const matched = input.capabilities
    .filter(entry => input.kind === 'all' || entry.kind === input.kind)
    .filter(entry => matchesQuery(entry, input.query))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const head: CapabilityEntry[] = []
  const tail: CapabilityEntry[] = []
  for (const entry of matched) {
    if (blacklisted.has(entry.id)) head.push(entry)
    else tail.push(entry)
  }
  return { rows: [...head, ...tail], blacklisted: head.length, total: matched.length }
}

/** 「会话角色」区的一行。 */
export interface SessionRoleRow {
  id: string
  /** 当前生效的角色；`undefined` 表示未知，不应用黑名单。 */
  role?: SessionRoleName
  /** 生效角色的来源。 */
  roleSource: RoleSource
  /** 手动绑定选择值。 */
  choice: BindingChoice
  /**
   * 已手动绑定，但 `ctx.paRoles` 已给出角色，因此绑定不会生效。
   *
   * 界面必须把这层说清楚：否则用户改了绑定、看到角色没变，会以为功能坏了。
   */
  bindingDormant: boolean
}

/**
 * 把快照里的会话角色合成为界面行。
 *
 * 不重新排序：会话顺序由服务端固定，界面再排一次会让刷新前后顺序不一致。
 *
 * @param sessions - 快照里的会话角色；读不到活跃会话时为 `undefined`。
 * @param config - 当前配置，用于取出手动绑定。
 * @returns 每会话一行；无会话时为空数组。
 */
export function sessionRoleRows(
  sessions: readonly SessionRoleSnapshot[] | undefined,
  config: CapabilityConfig,
): SessionRoleRow[] {
  return (sessions ?? []).map(session => {
    const choice = bindingChoiceOf(config, session.id)
    return {
      id: session.id,
      ...session.role === undefined ? {} : { role: session.role },
      roleSource: session.roleSource,
      choice,
      bindingDormant: choice !== 'auto' && session.roleSource === 'pa',
    }
  })
}
