// src/host/enforcement/registry.ts
//
// 每个 agent 的 `restrict` 生命周期，以及不受 restriction 影响的工具全集。
//
// 这里是全插件最危险的一处：算错会静默藏掉工具，算空会让 agent 全盲，
// 名单里混进已消失的名字会让 `tools.restrict()` 抛错并中断 agent 创建。
// 三条防线分别是 `present` 交集、空名单守卫、apply 前的二次过滤。

import { computeAllow } from '../policy/visible.ts'
import type { ToolSource } from '../catalog/collect.ts'
import type { ToolPayloadSource } from '../search/payload.ts'
import type { CapabilityConfig, SessionRoleName } from '../../shared/config.ts'
import type { RecalledStore, SessionLike } from './recalled.ts'

/** agent 作用域里本模块用到的工具服务面。 */
export interface AgentToolsLike {
  /** 该 agent 当前可见的工具；**已应用 restriction**。 */
  definitions(scope: unknown): readonly ToolSource[]
  /** 该 agent 当前可见工具的完整 schema；同样**已应用 restriction**。 */
  schemas(scope: unknown): readonly ToolPayloadSource[]
  /** 只保留 `allow` 里的工具；名单含未知名字会抛错。 */
  restrict(filter: { allow?: readonly string[] }): () => void
}

export interface AgentScope {
  readonly id: string
  readonly session: SessionLike
  readonly ctx: { readonly tools: AgentToolsLike }
}

export interface EnforcementOptions {
  config: () => CapabilityConfig
  roleOf: (sessionId: string) => SessionRoleName | undefined
  recalled: RecalledStore
  log?: (message: string) => void
}

interface Binding {
  readonly agent: AgentScope
  /** 上一次成功应用时的可见工具名。空集合表示尚未限制过。 */
  present: Set<string>
  /** 上一次成功应用的 allow；空名单守卫要恢复它。 */
  applied: readonly string[]
  /** `applied` 的拼接键，用于短路比较。 */
  applyKey: string
  release?: () => void
}

export class EnforcementRegistry {
  /** 本部署中出现过的全部工具名。计算 allow 的唯一依据，只增不减。 */
  private readonly universeNames = new Set<string>()
  /** 工具名的完整 schema。schema 与 agent 无关，因此插件级共享。 */
  private readonly schemaCache = new Map<string, ToolPayloadSource>()
  private readonly bindings = new Map<string, Binding>()
  /** 自身引发的 `tools/change` 不再触发重入。 */
  private busy = false

  constructor(private readonly options: EnforcementOptions) {}

  /** 已知工具全集；只读。 */
  get universe(): ReadonlySet<string> {
    return this.universeNames
  }

  /** 已缓存的工具 schema；`meta_search` 据此返回可直接调用的定义。 */
  schemasOf(): ReadonlyMap<string, ToolPayloadSource> {
    return this.schemaCache
  }

  /** 某个 agent 此刻存在的工具名；未知 agent 返回空集。 */
  presentOf(agentId: string): ReadonlySet<string> {
    return this.bindings.get(agentId)?.present ?? EMPTY_NAMES
  }

  /**
   * 记录本插件自己注册的工具。
   *
   * 注册方自己知道名字与 schema，不必等下一次吸收——`meta_search` 自己也要能被召回。
   *
   * @param name - 工具名。
   * @param schema - 该工具的完整 schema。
   */
  noteOwnTool(name: string, schema?: ToolPayloadSource): void {
    this.universeNames.add(name)
    if (schema !== undefined) this.schemaCache.set(name, schema)
  }

  /** agent 创建：先吸收全集再应用限制。顺序颠倒会让被掩掉的工具永远读不到。 */
  onAgentCreated(agent: AgentScope): void {
    this.run(() => {
      const binding: Binding = { agent, present: new Set(), applied: [], applyKey: '' }
      this.bindings.set(agent.id, binding)
      this.syncFully(binding)
    })
  }

  onAgentDisposed(agentId: string): void {
    const binding = this.bindings.get(agentId)
    if (binding === undefined) return
    this.bindings.delete(agentId)
    this.release(binding)
  }

  /** `tools/change`：工具集变了，必须重新吸收再重建所有 agent。 */
  onToolsChange(): void {
    this.run(() => {
      for (const binding of this.bindings.values()) this.syncFully(binding)
    })
  }

  /** 配置或召回变化：名单没变就短路，避免无意义的 `tools/change`。 */
  rebuild(): void {
    this.run(() => {
      for (const binding of this.bindings.values()) {
        if (this.unchanged(binding)) continue
        this.syncFully(binding)
      }
    })
  }

  /** 插件卸载：解除所有限制，把工具可见性还给宿主。 */
  dispose(): void {
    for (const binding of [...this.bindings.values()]) this.release(binding)
    this.bindings.clear()
  }

  /**
   * 名单是否与上次应用的一致。
   *
   * 没有生效中的限制时一律返回 false：名单相同也必须重新应用，否则 restriction
   * 会停在「已解除」的状态上。
   */
  private unchanged(binding: Binding): boolean {
    if (binding.release === undefined) return false
    const desired = this.desired(binding, binding.present)
    return desired.length > 0 && desired.join('\u0000') === binding.applyKey
  }

  /**
   * 完整重建：解除自己的限制 → 读取当前真实存在的工具 → 重算 → 应用。
   *
   * 解除是必需的：`definitions()` 返回的是应用过 restriction 的可见集，
   * 不解除就读不到被自己掩掉的工具。整个窗口在同一个事件循环内闭合。
   */
  private syncFully(binding: Binding): void {
    this.release(binding)
    binding.present = this.absorb(binding.agent)
    const allow = this.desired(binding, binding.present)

    if (allow.length === 0) {
      // 空名单会隐藏一切工具。绝不因为一次空计算结果让 agent 失去所有能力。
      this.warn(`agent ${binding.agent.id}: computed an empty allow list, keeping the previous restriction`)
      const previous = binding.applied.filter(name => binding.present.has(name))
      if (previous.length > 0) this.apply(binding, previous)
      return
    }
    this.apply(binding, allow)
  }

  private desired(binding: Binding, present: ReadonlySet<string>): string[] {
    return computeAllow({
      config: this.options.config(),
      role: this.options.roleOf(binding.agent.session.id),
      universe: this.universeNames,
      present,
      recalled: this.options.recalled.namesOf(binding.agent.session),
    })
  }

  private apply(binding: Binding, names: readonly string[]): void {
    // 二次过滤：`present` 是刚才吸收的快照，期间工具集可能又变了。
    // 让未知名字进到 restrict 里就等于让 agent 创建失败。
    const safe = names.filter(name => binding.present.has(name))
    if (safe.length === 0) return

    try {
      binding.release = binding.agent.ctx.tools.restrict({ allow: safe })
    } catch (error) {
      // agent 层注册的工具（`agent.ctx.tools.register`）会出现在 definitions 里，
      // 却不受 restrict 管辖。名单里混进它们会让整次限制抛错、一条都不生效——
      // 对这类部署（如 Personal Agent 的会话）等于本插件完全没工作。
      // 从错误里取出真正可限制的名字，剔除后重试一次。
      const restrictable = restrictableNamesFrom(error)
      const retry = restrictable === undefined ? [] : safe.filter(name => restrictable.has(name))
      if (retry.length === 0) {
        this.warn(`agent ${binding.agent.id}: cannot restrict tools: ${describe(error)}`)
        binding.release = undefined
        binding.applyKey = ''
        return
      }
      try {
        binding.release = binding.agent.ctx.tools.restrict({ allow: retry })
        binding.applied = retry
        binding.applyKey = retry.join('\u0000')
      } catch (retryError) {
        this.warn(`agent ${binding.agent.id}: cannot restrict tools: ${describe(retryError)}`)
        binding.release = undefined
        binding.applyKey = ''
      }
      return
    }

    binding.applied = safe
    binding.applyKey = safe.join('\u0000')
  }

  private release(binding: Binding): void {
    const release = binding.release
    if (release === undefined) return
    binding.release = undefined
    binding.applyKey = ''
    try {
      release()
    } catch (error) {
      // 释放失败不影响后续重建：新的 restrict 会覆盖这层限制。
      this.warn(`agent ${binding.agent.id}: cannot release the previous restriction: ${describe(error)}`)
    }
  }

  /**
   * 读取 agent 当前的完整工具集，并并入全集与 schema 缓存。
   *
   * 必须在解除自己的 restriction 之后调用：`definitions()` 与 `schemas()` 返回的
   * 都是应用过 restriction 的可见集，不解除就读不到被自己掩掉的工具。
   */
  private absorb(agent: AgentScope): Set<string> {
    const names = new Set<string>()
    try {
      for (const definition of agent.ctx.tools.definitions(agent)) names.add(definition.name)
      for (const schema of agent.ctx.tools.schemas(agent)) {
        names.add(schema.name)
        this.schemaCache.set(schema.name, schema)
      }
    } catch (error) {
      // 读不到就当作「一个都没有」：这次不重建，等下一次 tools/change。
      this.warn(`agent ${agent.id}: cannot read tool definitions: ${describe(error)}`)
      return names
    }
    for (const name of names) this.universeNames.add(name)
    return names
  }

  private run(operation: () => void): void {
    if (this.busy) return
    this.busy = true
    try {
      operation()
    } finally {
      this.busy = false
    }
  }

  private warn(message: string): void {
    this.options.log?.(message)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 从 `restrict()` 的错误里取出「可限制的名字」全集。
 *
 * 官方错误形如：
 * `tools.restrict() names unknown global tool "x"; known global tools: a, b, c`
 *
 * 这份解析只在失败路径上用到：它的作用是从一次失败中恢复出正确名单，
 * 解析不出来就放弃这次限制（保持上一次状态），不会因此让 agent 创建失败。
 *
 * @param error - `restrict()` 抛出的错误。
 * @returns 可限制的名字；错误形状不认识时为 undefined。
 */
function restrictableNamesFrom(error: unknown): Set<string> | undefined {
  const message = error instanceof Error ? error.message : ''
  const marker = 'known global tools: '
  const index = message.indexOf(marker)
  if (index < 0) return undefined
  const tail = message.slice(index + marker.length).trim()
  const names = tail
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0 && name !== '(none)')
  return names.length === 0 ? undefined : new Set(names)
}

/** 空名字集合：未知 agent 复用同一个只读实例。 */
const EMPTY_NAMES: ReadonlySet<string> = new Set()
