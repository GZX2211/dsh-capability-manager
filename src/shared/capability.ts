// src/shared/capability.ts
//
// 能力的身份与描述契约：Host 用它判定池/常驻/黑名单，Client 用它渲染行。
// 只放类型与纯函数，不得引入运行时依赖。

/** 能力只有两类：工具与 Skill。 */
export type CapabilityKind = 'tool' | 'skill'

/**
 * `tool:<name>` 或 `skill:<name>`。
 *
 * 工具名与 Skill 名不共享命名空间，所以类型前缀是身份的一部分：
 * 同名工具与 Skill 是两个不同的能力。
 */
export type CapabilityId = string

/** 工具标识。名称原样拼接，不做转义——名称里的冒号属于名称本身。 */
export function toolId(name: string): CapabilityId {
  return `tool:${name}`
}

/** Skill 标识。 */
export function skillId(name: string): CapabilityId {
  return `skill:${name}`
}

/** 解析结果；`name` 保留名称里的冒号，只按第一个冒号切分类型前缀。 */
export interface ParsedId {
  kind: CapabilityKind
  name: string
}

/**
 * 把标识拆回类型与名称。
 *
 * 只有完全合法的标识才返回结果：未知类型前缀、空类型、空名称、缺少冒号
 * 一律返回 `undefined`。配置来自磁盘，任何非法项都必须能被这里筛掉，
 * 否则下游会在 `restrict` 的命令校验上抛错。
 *
 * @param id - 待解析的标识。
 * @returns 类型与名称；非法时 `undefined`。
 */
export function parseId(id: CapabilityId): ParsedId | undefined {
  const separator = id.indexOf(':')
  if (separator <= 0) return undefined
  const kind = id.slice(0, separator)
  if (kind !== 'tool' && kind !== 'skill') return undefined
  const name = id.slice(separator + 1)
  if (name.length === 0) return undefined
  return { kind, name }
}

/** 能力的来源，决定界面分组与能否编辑/删除。 */
export type CapabilitySource = 'official' | 'custom' | 'mcp'

/** 界面与快照共用的能力条目。 */
export interface CapabilityEntry {
  id: CapabilityId
  kind: CapabilityKind
  name: string
  /** 单行摘要：工具取 description 首行并截断；Skill 取目录描述。 */
  summary: string
  source: CapabilitySource
  /** 该能力是否由本插件自建（决定能否删除/编辑）。 */
  owned: boolean
  /**
   * 当前是否可被模型调用。
   *
   * 工具在其 agent 视角可见时为真；没有活跃会话时 preset 层工具无法枚举，
   * 此时此字段只表达「已注册」而非「当前可见」，界面据此提示。
   */
  available: boolean
}
