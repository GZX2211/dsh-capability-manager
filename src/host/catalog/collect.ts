// src/host/catalog/collect.ts
//
// 把工具定义收敛成界面与快照共用的 CapabilityEntry。
//
// 摘要只留首行并截断：索引注入与列表行都只放一行，多行描述在这里就被压掉，
// 免得上游各自截断导致同一工具在不同地方显示不同摘要。

import { toolId, type CapabilityEntry, type CapabilitySource } from '../../shared/capability.ts'

/** 摘要上限。索引与列表共用同一刻度，避免同一项两处显示不一致。 */
const SUMMARY_LIMIT = 200

/** 工具定义的形状；只描述这里需要的字段，不 import 官方类型。 */
export interface ToolSource {
  readonly name: string
  readonly description?: string | undefined
}

export interface CollectToolsInput {
  definitions: readonly ToolSource[]
  /** 来源判定；由调用点注入，便于按部署给出自建名单与 MCP 服务器。 */
  classify: (name: string) => CapabilitySource
  /**
   * 该工具此刻是否可被模型调用。
   *
   * 缺省为「是」：没有活跃会话时 preset 层工具无法枚举，此时只表达「已注册」。
   */
  isAvailable?: (name: string) => boolean
}

/**
 * 收集工具条目。
 *
 * @param input - 工具定义、来源判定与可见性判定。
 * @returns 按名称排序的条目。
 */
export function collectTools(input: CollectToolsInput): CapabilityEntry[] {
  const isAvailable = input.isAvailable ?? (() => true)
  return input.definitions
    .map(definition => {
      const source = input.classify(definition.name)
      return {
        id: toolId(definition.name),
        kind: 'tool' as const,
        name: definition.name,
        summary: summarize(definition.description),
        source,
        owned: source === 'custom',
        available: isAvailable(definition.name),
      }
    })
    .sort((a, b) => compareNames(a.name, b.name))
}

/**
 * 把多行描述压成一行摘要。
 *
 * 按码点截断而不是按码元：`slice` 会把代理对切成两个孤立半区，界面上显示成乱码。
 *
 * @param description - 原始描述，可缺省。
 * @returns 首行、去两端空白、至多 200 个码点。
 */
export function summarize(description: string | undefined): string {
  if (description === undefined) return ''
  const firstLine = description.split(/\r?\n/, 1)[0] ?? ''
  const characters = [...firstLine.trim()]
  return characters.length <= SUMMARY_LIMIT ? characters.join('') : characters.slice(0, SUMMARY_LIMIT).join('')
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
