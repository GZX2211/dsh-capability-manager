// src/shared/config.ts
//
// 能力管理的持久化配置契约。Host 负责读写与自愈，Client 只读快照。
// 共享层禁止运行时 import，因此默认值用字面量写出，不调用 toolId()。

import type { CapabilityId } from './capability.ts'

/** 配置结构版本。读到不同版本的磁盘文件时回落默认配置（尚无迁移器）。 */
export const CONFIG_VERSION = 1

/**
 * 两个元能力的标识。
 *
 * `meta_search` 是召回入口，`skill` 是加载 Skill 正文的入口；默认常驻这两个，
 * 少任何一个都会让「召回 → 使用」多一次往返或直接断链。
 */
export const META_SEARCH_TOOL_ID: CapabilityId = 'tool:meta_search'
export const SKILL_TOOL_ID: CapabilityId = 'tool:skill'

/** 会话角色。判定由 `ctx.paRoles` 提供，本插件只消费。 */
export type SessionRoleName = 'router' | 'worker'

/**
 * 角色判定的来源。
 *
 * `pa` 优先；`binding` 是手动绑定，只补 `paRoles` 没有答案的会话；
 * `unknown` 表示两者都没答案，此时不应用任何黑名单。
 */
export type RoleSource = 'pa' | 'binding' | 'unknown'

/** 向量检索配置；默认关闭。 */
export interface EmbeddingConfig {
  enabled: boolean
  /** 已下载的模型目录，未下载时缺省。 */
  modelDir?: string
  /** 模型 revision，用于升级判断。 */
  revision?: string
}

/** 按角色划分的能力黑名单；黑名单优先级高于能力池与常驻。 */
export interface BlacklistConfig {
  router: CapabilityId[]
  worker: CapabilityId[]
}

/** 插件的完整持久化配置。 */
export interface CapabilityConfig {
  version: typeof CONFIG_VERSION
  /** 排除出能力池的能力：不可调用、不可召回、不注入上下文。 */
  excluded: CapabilityId[]
  /** 常驻能力：启动即直接可用。必须是池内能力的子集，读取时自愈。 */
  resident: CapabilityId[]
  blacklist: BlacklistConfig
  embedding: EmbeddingConfig
  /** 手动角色绑定覆盖，sessionId → 角色；`ctx.paRoles` 缺省时使用。 */
  roleBindings: Record<string, SessionRoleName>
}

/** 开箱状态：全部能力在池内，只常驻两个元能力，黑名单为空，向量检索关闭。 */
export const DEFAULT_CONFIG: CapabilityConfig = {
  version: CONFIG_VERSION,
  excluded: [],
  resident: [META_SEARCH_TOOL_ID, SKILL_TOOL_ID],
  blacklist: { router: [], worker: [] },
  embedding: { enabled: false },
  roleBindings: {},
}
