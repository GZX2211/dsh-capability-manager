// src/host/admin/mutate.ts
//
// 配置写操作的内容变换：把一次 ConfigPatch 应用到配置上。
//
// 只做内容变换，不比对 revision——那是 ConfigStore 的职责。两处各自判定
// 同一件事迟早会不一致，所以这里只保证「内容合法且满足不变量」。
//
// 不变量：常驻是池的子集。任何破坏它的操作都必须同时修复另一侧。

import { parseId, toolId, type CapabilityId } from '../../shared/capability.ts'
import type { CapabilityConfig, SessionRoleName } from '../../shared/config.ts'
import { META_SEARCH_TOOL_ID } from '../../shared/config.ts'
import { isSafeBindingKey } from '../config/sanitize.ts'

export type ApplyPatchResult =
  | { ok: true; config: CapabilityConfig }
  | { ok: false; code: 'bad-request' | 'unknown-capability'; message: string }

/**
 * 把一次改动应用到配置上。
 *
 * @param config - 当前配置；不被修改。
 * @param patch - 未经校验的请求体。
 * @returns 新的完整配置，或可行动的错误。
 */
export function applyPatch(config: CapabilityConfig, patch: unknown): ApplyPatchResult {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return badRequest('请求体必须是一个对象')
  }
  const record = patch as Record<string, unknown>
  if (typeof record.revision !== 'number' || !Number.isFinite(record.revision)) {
    return badRequest('revision 必须是数字：写操作必须带上读取时的 revision')
  }

  switch (record.op) {
    case 'set-excluded':
      return setExcluded(config, record)
    case 'set-resident':
      return setResident(config, record)
    case 'set-excluded-many':
      return setExcludedMany(config, record)
    case 'set-resident-many':
      return setResidentMany(config, record)
    case 'set-blacklist':
      return setBlacklist(config, record)
    case 'clear-blacklist':
      return clearBlacklist(config, record)
    case 'set-role-binding':
      return setRoleBinding(config, record)
    default:
      return badRequest(`未知的 op：${String(record.op)}`)
  }
}

function setExcluded(config: CapabilityConfig, record: Record<string, unknown>): ApplyPatchResult {
  const id = capabilityId(record)
  if (id === undefined) return unknownCapability(record)
  const value = booleanValue(record)
  if (value === undefined) return badRequest('value 必须是布尔值')

  if (value) {
    return {
      ok: true,
      config: {
        ...config,
        excluded: addUnique(config.excluded, id),
        // 常驻必须是池内能力：排除出池的那一刻就要同时取消常驻。
        resident: config.resident.filter(residentId => residentId !== id),
      },
    }
  }
  return { ok: true, config: { ...config, excluded: config.excluded.filter(excludedId => excludedId !== id) } }
}

function setResident(config: CapabilityConfig, record: Record<string, unknown>): ApplyPatchResult {
  const id = capabilityId(record)
  if (id === undefined) return unknownCapability(record)
  const value = booleanValue(record)
  if (value === undefined) return badRequest('value 必须是布尔值')

  if (value) {
    // 只有 Skill 标识需要额外判断池：工具与 Skill 共用同一条不变量。
    if (config.excluded.includes(id)) {
      return badRequest(`能力 ${id} 已被排除出池，不能设为常驻；请先把它放回池内`)
    }
    return { ok: true, config: { ...config, resident: addUnique(config.resident, id) } }
  }
  return { ok: true, config: { ...config, resident: config.resident.filter(residentId => residentId !== id) } }
}

function setExcludedMany(config: CapabilityConfig, record: Record<string, unknown>): ApplyPatchResult {
  const ids = capabilityIdList(record)
  if (ids === undefined) return badRequest('ids 必须是非空的能力标识数组，元素形如 tool:<name> 或 skill:<name>')
  const value = booleanValue(record)
  if (value === undefined) return badRequest('value 必须是布尔值')

  if (value) {
    return {
      ok: true,
      config: {
        ...config,
        excluded: ids.reduce((acc, id) => addUnique(acc, id), config.excluded),
        // 与单条排除同一条不变量：移出池时同时取消常驻。
        resident: config.resident.filter(residentId => !ids.includes(residentId)),
      },
    }
  }
  return { ok: true, config: { ...config, excluded: config.excluded.filter(excludedId => !ids.includes(excludedId)) } }
}

function setResidentMany(config: CapabilityConfig, record: Record<string, unknown>): ApplyPatchResult {
  const ids = capabilityIdList(record)
  if (ids === undefined) return badRequest('ids 必须是非空的能力标识数组，元素形如 tool:<name> 或 skill:<name>')
  const value = booleanValue(record)
  if (value === undefined) return badRequest('value 必须是布尔值')

  if (value) {
    // 不变量：常驻必须是池内能力。界面只传池内条目，这里仍过滤掉池外的以防越界写入。
    const eligible = ids.filter(id => !config.excluded.includes(id))
    return { ok: true, config: { ...config, resident: eligible.reduce((acc, id) => addUnique(acc, id), config.resident) } }
  }
  return { ok: true, config: { ...config, resident: config.resident.filter(residentId => !ids.includes(residentId)) } }
}

function setBlacklist(config: CapabilityConfig, record: Record<string, unknown>): ApplyPatchResult {
  const role = roleValue(record)
  if (role === undefined) return badRequest('role 必须是 router 或 worker')
  const id = capabilityId(record)
  if (id === undefined) return unknownCapability(record)
  const value = booleanValue(record)
  if (value === undefined) return badRequest('value 必须是布尔值')

  // 黑名单与池无关：池外能力留在黑名单里，重新入池后立刻生效。
  const current = config.blacklist[role]
  const next = value ? addUnique(current, id) : current.filter(entry => entry !== id)
  return { ok: true, config: { ...config, blacklist: { ...config.blacklist, [role]: next } } }
}

function clearBlacklist(config: CapabilityConfig, record: Record<string, unknown>): ApplyPatchResult {
  const role = roleValue(record)
  if (role === undefined) return badRequest('role 必须是 router 或 worker')

  return { ok: true, config: { ...config, blacklist: { ...config.blacklist, [role]: [] } } }
}

/**
 * 手动角色绑定：只影响角色判定，不碰池、常驻或黑名单。
 *
 * 角色判定优先问 `ctx.paRoles`，因此这里登记的是「PA 没有答案时的补足」。
 * 允许给还不存在的会话写入绑定：会话可能稍后才创建，提前登记不影响任何现存会话。
 */
function setRoleBinding(config: CapabilityConfig, record: Record<string, unknown>): ApplyPatchResult {
  if (typeof record.sessionId !== 'string' || !isSafeBindingKey(record.sessionId)) {
    return badRequest(`sessionId 必须是非空的会话标识，收到 ${JSON.stringify(record.sessionId)}`)
  }
  const role = record.role
  if (role !== null && role !== 'router' && role !== 'worker') {
    return badRequest(`role 必须是 router、worker 或 null，收到 ${JSON.stringify(role)}`)
  }

  const bindings = { ...config.roleBindings }
  if (role === null) delete bindings[record.sessionId]
  else bindings[record.sessionId] = role
  return { ok: true, config: { ...config, roleBindings: bindings } }
}

/** 收窄标识；非法标识一律当作未知能力，而不是静默忽略。 */
function capabilityId(record: Record<string, unknown>): CapabilityId | undefined {
  if (typeof record.id !== 'string') return undefined
  return parseId(record.id) === undefined ? undefined : record.id
}

/** 收窄批量标识；为空或含非法元素时返回 undefined，由调用方给出可行动的错误。 */
function capabilityIdList(record: Record<string, unknown>): CapabilityId[] | undefined {
  if (!Array.isArray(record.ids) || record.ids.length === 0) return undefined
  const ids: CapabilityId[] = []
  for (const value of record.ids) {
    if (typeof value !== 'string' || parseId(value) === undefined) return undefined
    ids.push(value)
  }
  return ids
}

function booleanValue(record: Record<string, unknown>): boolean | undefined {
  return typeof record.value === 'boolean' ? record.value : undefined
}

function roleValue(record: Record<string, unknown>): SessionRoleName | undefined {
  return record.role === 'router' || record.role === 'worker' ? record.role : undefined
}

function addUnique(ids: readonly CapabilityId[], id: CapabilityId): CapabilityId[] {
  return ids.includes(id) ? [...ids] : [...ids, id]
}

function badRequest(message: string): ApplyPatchResult {
  return { ok: false, code: 'bad-request', message }
}

function unknownCapability(record: Record<string, unknown>): ApplyPatchResult {
  return {
    ok: false,
    code: 'unknown-capability',
    message: `id 必须是 tool:<name> 或 skill:<name>，收到 ${JSON.stringify(record.id)}`,
  }
}

/** 供装配处判断某个标识是否是 `meta_search` 自己。 */
export const META_SEARCH_ID: CapabilityId = META_SEARCH_TOOL_ID

/** 供装配处把工具名转成标识。 */
export function toToolId(name: string): CapabilityId {
  return toolId(name)
}
