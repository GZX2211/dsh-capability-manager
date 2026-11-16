// src/host/config/sanitize.ts
//
// 配置自愈：把磁盘上的任意形状收敛成 CapabilityConfig。
//
// 配置可以被手改、被旧版本写坏、被半截写入截断，而它的消费方是
// `tools.restrict()`——名单里出现未知名字会抛错并中断整个 agent 创建。
// 因此这里的取舍是「宁可少一个配置项，也不让非法项流到下游」。
//
// 纯函数：不读环境、不写盘、不修改入参，且不与 DEFAULT_CONFIG 共享引用。

import { parseId, type CapabilityId } from '../../shared/capability.ts'
import {
  CONFIG_VERSION,
  DEFAULT_CONFIG,
  type BlacklistConfig,
  type CapabilityConfig,
  type EmbeddingConfig,
  type SessionRoleName,
} from '../../shared/config.ts'

/** 空标识表，供「缺这个字段就等于没有」的字段使用。 */
const NO_IDS: readonly CapabilityId[] = []

/**
 * 收敛一份可能损坏的配置。
 *
 * 降级顺序：整体不可用 → 默认配置；单个字段不可用 → 该字段回落空值。
 * 不认识的字段一律丢弃，结果只含契约里的字段。
 *
 * @param raw - 磁盘上读到的任意值。
 * @returns 一份全新、可直接使用的配置。
 */
export function sanitizeConfig(raw: unknown): CapabilityConfig {
  if (!isRecord(raw)) return defaultConfig()
  // 只有确知版本号不符才整体回落；缺字段（含版本号）按当前版本就地补全，
  // 这样旧文件里仍然有效的配置不会因为缺个 version 就全部丢失。
  if (raw.version !== undefined && raw.version !== CONFIG_VERSION) return defaultConfig()

  const excluded = normalizeIds(raw.excluded, NO_IDS)
  // 常驻是池的子集，所以被排除出池的项不能留在常驻里。
  const excludedSet = new Set(excluded)
  // 字段缺失回落到默认常驻，字段是空数组则是用户显式清空——两者不能混为一谈。
  const resident = normalizeIds(raw.resident, DEFAULT_CONFIG.resident).filter(id => !excludedSet.has(id))

  return {
    version: CONFIG_VERSION,
    excluded,
    resident,
    // 黑名单与池无关：能力重新入池后黑名单必须仍然生效，所以不做池过滤。
    blacklist: normalizeBlacklist(raw.blacklist),
    embedding: normalizeEmbedding(raw.embedding),
    roleBindings: normalizeRoleBindings(raw.roleBindings),
  }
}

/** 一份与默认配置等值但不共享引用的新配置。默认值的唯一来源是 DEFAULT_CONFIG。 */
function defaultConfig(): CapabilityConfig {
  return {
    version: CONFIG_VERSION,
    excluded: [...DEFAULT_CONFIG.excluded],
    resident: [...DEFAULT_CONFIG.resident],
    blacklist: { router: [...DEFAULT_CONFIG.blacklist.router], worker: [...DEFAULT_CONFIG.blacklist.worker] },
    embedding: { ...DEFAULT_CONFIG.embedding },
    roleBindings: { ...DEFAULT_CONFIG.roleBindings },
  }
}

/**
 * 收敛标识数组：丢掉非字符串、非法标识与重复项，保留首次出现的顺序。
 *
 * 池外能力可能只是当前未加载，所以这里不判断「是否存在」——那是 catalog 的职责。
 * 字段类型不对（含缺失）回落到 fallback；字段是空数组则尊重它。
 */
function normalizeIds(value: unknown, fallback: readonly CapabilityId[]): CapabilityId[] {
  if (!Array.isArray(value)) return [...fallback]
  const seen = new Set<string>()
  const ids: CapabilityId[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    if (parseId(item) === undefined) continue
    if (seen.has(item)) continue
    seen.add(item)
    ids.push(item)
  }
  return ids
}

function normalizeBlacklist(value: unknown): BlacklistConfig {
  if (!isRecord(value)) return { router: [], worker: [] }
  return { router: normalizeIds(value.router, NO_IDS), worker: normalizeIds(value.worker, NO_IDS) }
}

/** 只认字面 `true`：`"yes"`、`1`、`"true"` 都不是开启向量检索的理由。 */
function normalizeEmbedding(value: unknown): EmbeddingConfig {
  if (!isRecord(value)) return { enabled: false }
  const embedding: EmbeddingConfig = { enabled: value.enabled === true }
  if (typeof value.modelDir === 'string' && value.modelDir.length > 0) embedding.modelDir = value.modelDir
  if (typeof value.revision === 'string' && value.revision.length > 0) embedding.revision = value.revision
  return embedding
}

/**
 * 保留键之一：这些键在普通对象上赋值会改动原型而不是属性。
 * 配置来自磁盘，必须显式拒绝。
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function normalizeRoleBindings(value: unknown): Record<string, SessionRoleName> {
  if (!isRecord(value)) return {}
  const bindings: Record<string, SessionRoleName> = {}
  for (const [sessionId, role] of Object.entries(value)) {
    if (sessionId.length === 0) continue
    if (UNSAFE_KEYS.has(sessionId)) continue
    if (role !== 'router' && role !== 'worker') continue
    bindings[sessionId] = role
  }
  return bindings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
