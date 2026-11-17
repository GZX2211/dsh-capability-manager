// src/host/skill-consumer/catalog.ts
//
// 自建 Skill 目录的纯逻辑：条目归一、digest、渲染与来源读取。
//
// 官方 consumer 被我们的 shadow 工具挡掉目录注入，所以这里承担同一件事：
// 把当前可用的 Skill 以 durable user message 交给模型，并在条目变化时整表替换。
// 目录身份用 digest 比较条目本身，而不是渲染后的文本——框架文案的变化不该
// 触发一次替换。

import { createHash } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-llm'
import { describeSkill, isModelInvocable, type SkillSource } from '../catalog/skills.ts'

/** 目录消息的来源类型；与官方 `skill-catalog` 分开，互不干扰。 */
export const CATALOG_SOURCE_KIND = 'capability-manager/skill-catalog'

/** 目录里的一行：名称 + 归一后的单行描述。 */
export interface CatalogEntry {
  name: string
  description: string
}

/** 首版目录与替换目录共用一套框架，只在开场句上不同。 */
export type CatalogMode = 'initial' | 'update'

/** 目录消息的 durable source：条目本身随消息落盘，模型文案只用于展示。 */
export interface SkillCatalogSource {
  readonly kind: typeof CATALOG_SOURCE_KIND
  readonly form: 'catalog'
  /** 标记这是一次替换，而不是本会话的首版目录。 */
  readonly update?: true
  /** 恰好是这条消息发布的条目。 */
  readonly entries: readonly CatalogEntry[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'capability-manager/skill-catalog': SkillCatalogSource
  }
}

/** 消息里本模块用到的最小形状；不 import 官方 Message。 */
export interface CatalogMessageLike {
  readonly source?: unknown
}

/**
 * 把 Skill 摘要归一成目录条目。
 *
 * 同名条目先出现的获胜：注册表已经按优先级合并过，这里只是防御重复输入。
 *
 * @param skills - 当前可见的 Skill 摘要。
 * @returns 按名称排序的条目；不可被模型调用的 Skill 被丢弃。
 */
export function catalogEntries(skills: readonly SkillSource[]): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  const seen = new Set<string>()
  for (const skill of skills) {
    if (!isModelInvocable(skill)) continue
    if (seen.has(skill.name)) continue
    seen.add(skill.name)
    entries.push({ name: skill.name, description: describeSkill(skill) })
  }
  return entries.sort((a, b) => compareNames(a.name, b.name))
}

/**
 * 目录身份摘要。
 *
 * 条目顺序不影响结果：目录语义是集合，排序由注册表保证，比较时再排一次
 * 可以让「同一组条目换了顺序」不被误判成变化。
 *
 * @param entries - 目录条目。
 * @returns 十六进制 sha256。
 */
export function catalogDigest(entries: readonly CatalogEntry[]): string {
  const canonical = [...entries]
    .sort((a, b) => compareNames(a.name, b.name) || compareNames(a.description, b.description))
    .map(entry => JSON.stringify([entry.name, entry.description]))
    .join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * 渲染目录消息正文。
 *
 * 空目录也必须渲染：替换为空是退役旧名称的唯一方式，模型不能继续使用
 * 更早清单里的名字。
 *
 * @param entries - 目录条目。
 * @param mode - 首版或替换。
 * @returns 模型可读的 `<system-reminder>` 块。
 */
export function renderCatalog(entries: readonly CatalogEntry[], mode: CatalogMode): string {
  if (entries.length === 0) {
    return [
      '<system-reminder>',
      '当前没有可用的 Skill。不要使用更早清单里的名称。',
      '</system-reminder>',
    ].join('\n')
  }

  const opening = mode === 'update'
    ? 'Skill 目录已变化。以下是当前可用的全部 Skill，替换本会话之前的每一次 Skill 清单：'
    : '以下是本会话可用的 Skill。Skill 是一组可复用的任务指令。'

  const lines = [
    '<system-reminder>',
    opening,
    '',
    '<available_skills>',
    ...entries.map(entry => `- \`${entry.name}\`：${escapeCatalogText(entry.description)}`),
    '</available_skills>',
    '',
    '当用户点名某个 Skill，或任务明显匹配某个 Skill 的描述时，用 skill 工具按准确名称加载后再行动。',
    '本清单只有摘要；加载前不要按摘要推断 Skill 的完整指令。',
    '</system-reminder>',
  ]
  return lines.join('\n')
}

/**
 * 从消息来源读取本模块发布的目录条目。
 *
 * 会话可以被恢复、分叉或由外部写入，来源字段无法假定合法；读不出来时按
 * 「不是本模块的目录」处理，而不是在 pre-step 里抛错。
 *
 * @param source - 消息的 source 字段。
 * @returns 目录条目；不是本模块目录或结构损坏时为 undefined。
 */
export function readCatalogEntries(source: unknown): CatalogEntry[] | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  if ((source as { kind?: unknown }).kind !== CATALOG_SOURCE_KIND) return undefined
  const raw = (source as { entries?: unknown }).entries
  if (!Array.isArray(raw)) return undefined

  const entries: CatalogEntry[] = []
  for (const item of raw as readonly unknown[]) {
    if (typeof item !== 'object' || item === null) return undefined
    const { name, description } = item as { name?: unknown; description?: unknown }
    if (typeof name !== 'string' || name.length === 0) return undefined
    if (typeof description !== 'string') return undefined
    entries.push({ name, description })
  }
  return entries
}

/**
 * 找当前可见历史里最新的一条本模块目录。
 *
 * @param messages - 模型可见的消息，按时间顺序。
 * @returns 最新目录的条目；没有时为 undefined。
 */
export function findPublishedCatalog(messages: readonly CatalogMessageLike[]): CatalogEntry[] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entries = readCatalogEntries(messages[index]?.source)
    if (entries !== undefined) return entries
  }
  return undefined
}

/**
 * 会话里是否曾经出现过任意 Skill 目录（我们自己的或官方的）。
 *
 * 用于决定首版目录的措辞：插件热启用时官方目录可能已经发布过，官方 consumer
 * 会在 shadow 生效的那一步追加一条空目录；我们必须用替换框架把它的名称退役
 * 声明覆盖掉，而不是再追加一条「首版」。
 *
 * @param messages - 模型可见的消息，按时间顺序。
 * @returns 存在任一目录消息时为 true。
 */
export function hasCatalogHistory(messages: readonly CatalogMessageLike[]): boolean {
  for (const message of messages) {
    const source = message.source
    if (typeof source !== 'object' || source === null) continue
    const kind = (source as { kind?: unknown }).kind
    if (kind === CATALOG_SOURCE_KIND || kind === 'skill-catalog') return true
  }
  return false
}

/** 描述会原样嵌进伪 XML 框架，必须转义标记字符。 */
function escapeCatalogText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
