// src/host/search/payload.ts
//
// 载荷的规范化与序列化：去重的唯一比较基准。
//
// 去重判定是「逐字完全一致」，因此这里不做任何截断、省略或模糊归一化——
// 任何放宽都会让本该再次出现的载荷被误剔除。
//
// 只描述本模块需要的形状，不 import 官方 ToolSchema：官方形状漂移时
// 这里按结构守卫收窄，而不是跟着编译失败。

/** 工具载荷需要的字段；其余字段不参与载荷。 */
export interface ToolPayloadSource {
  readonly name: string
  readonly description?: string | undefined
  readonly parameters?: unknown
}

/** Skill 索引条目的形状。 */
export interface SkillPayloadSource {
  readonly name: string
  readonly description: string
}

/**
 * 递归按键名排序，使同一份 JSON Schema 无论键序如何都产出同一个字符串。
 *
 * 数组保持原序：参数顺序在 JSON Schema 里是有意义的结构，重排会改变载荷身份。
 *
 * @param value - 任意 JSON 形状。
 * @returns 键序稳定的等价结构；输入不被修改。
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort(compareNames)) {
      // defineProperty 而非赋值：JSON.parse 会把 "__proto__" 建成自有属性，
      // 直接赋值会改写原型而不是留下这个键。
      Object.defineProperty(sorted, key, {
        value: canonicalize(source[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return sorted
  }
  return value
}

/**
 * 工具载荷：名称 + 描述 + 规范化后的参数。
 *
 * 与工具索引（名称 + 摘要）不是同一种载荷，两者不互相判重。
 *
 * @param schema - 工具 schema。
 * @returns 可直接用于逐字比较的字符串。
 */
export function toolPayload(schema: ToolPayloadSource): string {
  return JSON.stringify({
    name: schema.name,
    description: schema.description ?? '',
    parameters: canonicalize(schema.parameters),
  })
}

/**
 * Skill 载荷：名称 + 描述，与注入目录里那一行逐字一致。
 *
 * 用 NUL 作分隔，任何一边出现空格、冒号或其他可见字符都不会拼出同样的载荷。
 *
 * @param entry - 索引条目。
 * @returns 可直接用于逐字比较的字符串。
 */
export function skillPayload(entry: SkillPayloadSource): string {
  return `${entry.name}\u0000${entry.description}`
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
