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
  /** 只保留 `allow` 里的工具；名单含未知名字会抛错。 */
  restrict(filter: { allow?: readonly string[] }): () => void
}

export interface AgentScope {
  readonly id: string
  readonly session: SessionLike
  readonly ctx: {
    readonly tools: AgentToolsLike
    /**
     * 把一段清理逻辑挂到 agent 的生命周期上。
     *
     * 用它回收 restriction，而不是只依赖插件卸载路径：agent 销毁时宿主一定会
     * 跑这个清理，插件的卸载路径则可能因为整个 Host 一起退出而没有机会执行。
     */
    effect(callback: () => () => void, label?: string): () => void
  }
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
  /** 挂在 agent 生命周期上的兜底释放器；撤掉它只会触发一次幂等的释放。 */
  untrack?: () => void
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
      // 兜底释放器只注册一次，且读 `binding.release` 的**当前值**。
      // 每次重建都重新注册会掉进一个陷阱：撤掉上一个 effect 就会执行它的 cleanup，
      // 而那个独立注册器的 disposer 会把刚建立的新限制一起删掉。
      binding.untrack = agent.ctx.effect(
        () => () => {
          const release = binding.release
          binding.release = undefined
          binding.applyKey = ''
          try {
            release?.()
          } catch {
            // agent 正在销毁，此时无法回报，也没有可回报的对象。
          }
        },
        'capability-manager: restriction',
      )
      this.syncFully(binding)
    })
  }

  onAgentDisposed(agentId: string): void {
    const binding = this.bindings.get(agentId)
    if (binding === undefined) return
    this.bindings.delete(agentId)
    // 宿主可能已经回收了这个 effect；撤掉它是幂等的，没回收时才是必要的。
    binding.untrack?.()
    binding.untrack = undefined
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
    const absorbed = this.absorb(binding.agent)
    binding.present = absorbed.names
    if (absorbed.failed) {
      // 读不到工具集就完全不动：宁可不生效，也不能把会话收进一个召不回来的状态。
      this.warn(`agent ${binding.agent.id}: tool set unavailable, leaving visibility untouched`)
      return
    }

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

    const accepted = this.restrict(binding, safe)
    if (accepted === undefined) return
    this.commit(binding, accepted)
  }

  /**
   * 落实一次限制，返回被接受的名字。
   *
   * agent 层注册的工具（`agent.ctx.tools.register`）会出现在 definitions 里，
   * 却不受 restrict 管辖。名单里混进它们会让整次限制抛错、一条都不生效——
   * 对这类部署（如 Personal Agent 的会话）等于本插件完全没工作。
   * 从错误里取出真正可限制的名字，剔除后重试一次。
   */
  private restrict(binding: Binding, safe: readonly string[]): string[] | undefined {
    try {
      binding.release = binding.agent.ctx.tools.restrict({ allow: safe })
      return [...safe]
    } catch (error) {
      const restrictable = restrictableNamesFrom(error)
      const retry = restrictable === undefined ? [] : safe.filter(name => restrictable.has(name))
      if (retry.length === 0) {
        this.warn(`agent ${binding.agent.id}: cannot restrict tools: ${describe(error)}`)
        binding.release = undefined
        binding.applyKey = ''
        return undefined
      }
      try {
        binding.release = binding.agent.ctx.tools.restrict({ allow: retry })
        return retry
      } catch (retryError) {
        this.warn(`agent ${binding.agent.id}: cannot restrict tools: ${describe(retryError)}`)
        binding.release = undefined
        binding.applyKey = ''
        return undefined
      }
    }
  }

  /**
   * 记下这次限制。
   *
   * 释放由两条路径共同负责：插件卸载时 `dispose()` 主动释放，agent 销毁时宿主
   * 会跑 `onAgentCreated` 里注册的那个兜底释放器。只有一条路径是不够的——
   * 插件的卸载清理没能执行时，限制会永久留在 agent 上，而会话已经没有任何工具可用。
   */
  private commit(binding: Binding, names: readonly string[]): void {
    binding.applied = names
    binding.applyKey = names.join('\u0000')
  }

  private release(binding: Binding): void {
    const release = binding.release
    binding.release = undefined
    binding.applyKey = ''
    if (release === undefined) return
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
   * 必须在解除自己的 restriction 之后调用：`definitions()` 返回的是应用过
   * restriction 的可见集，不解除就读不到被自己掩掉的工具。
   *
   * 只用 `definitions()`：`ToolDefinition` 本来就带 name/description/parameters，
   * 而 `schemas()` 会多做一次投影、并且对个别官方工具可能抛错。曾经因为
   * `schemas()` 抛错导致 schema 缓存为空、召回永远返回空——整个会话的工具
   * 被收走后却召不回来。
   */
  private absorb(agent: AgentScope): { names: Set<string>; failed: boolean } {
    const names = new Set<string>()
    try {
      for (const definition of agent.ctx.tools.definitions(agent)) {
        names.add(definition.name)
        this.schemaCache.set(definition.name, {
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
        })
      }
    } catch (error) {
      // 读不到就不能收紧：present 不可信时收紧等于把工具藏进一个读不到的地方。
      this.warn(`agent ${agent.id}: cannot read tool definitions: ${describe(error)}`)
      return { names, failed: true }
    }
    for (const name of names) this.universeNames.add(name)
    return { names, failed: false }
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
