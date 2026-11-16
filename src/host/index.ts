// src/host/index.ts
//
// 插件宿主入口：装配与生命周期。
//
// 只做装配与协调，业务语义在各模块里。任何一步失败都只记 warning：
// profile 里还有别的插件依赖宿主启动，本插件不该因为一个可选部件坏掉就拖垮整个 Host。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { API_PREFIX, ERROR_CODES, type ConfigWriteResponse, type ErrorResponse } from '../shared/api.ts'
import type { CapabilityEntry } from '../shared/capability.ts'
import type { ToolSource } from './catalog/collect.ts'
import { toolId } from '../shared/capability.ts'
import type { CapabilityConfig } from '../shared/config.ts'
import { applyPatch } from './admin/mutate.ts'
import { createAdminHandler, type ConfigOutcome } from './admin/server.ts'
import { buildSnapshot } from './admin/snapshot.ts'
import { buildToolCandidates } from './catalog/candidates.ts'
import { collectTools } from './catalog/collect.ts'
import { classifySource } from './catalog/source.ts'
import { ConfigStore } from './config/store.ts'
import type { HostContext } from './context.ts'
import { EnforcementRegistry, type AgentScope } from './enforcement/registry.ts'
import { RecalledStore } from './enforcement/recalled.ts'
import { renderIndex, selectToolIndex, shouldInjectIndex } from './prompt/index-section.ts'
import { createRoleResolver, type RoleResolver } from './roles/resolve.ts'
import { toolNamesOf, toolPayloadsOf } from './search/seen.ts'
import { resolveStateDirectory } from './state/directory.ts'
import {
  createMetaSearchTool,
  META_SEARCH_DESCRIPTION,
  META_SEARCH_PARAMETERS,
  META_SEARCH_TOOL_NAME,
} from './tools/meta_search/index.ts'

export const name = 'dsh-capability-manager'

/** 需要的宿主服务：缺任何一个都不该沉默地半启动。 */
export const inject = ['tools', 'systemPrompt', 'webServer', 'agents']

/**
 * 索引 section 的位置：放在第一方环境后缀之后。
 *
 * 静态 prompt 在前、动态索引在后，对前缀缓存最友好。
 */
const INDEX_SECTION_ORDER = 10150

export interface Config {
  /** 状态目录覆盖；缺省 `<DSH_HOME>/state/capability-manager`。 */
  stateDir?: string
}

export function apply(ctx: HostContext, config?: Config): void {
  const stateDir = resolveStateDirectory(config?.stateDir)
  const log = (message: string): void => {
    ctx.logger?.warn('capability-manager: %s', message)
  }

  const store = ConfigStore.open({ directory: stateDir, log })
  const recalled = new RecalledStore()
  const roles = createRoleResolver({
    lookup: serviceName => ctx.get(serviceName),
    bindings: () => store.read().roleBindings,
  })
  const enforcement = new EnforcementRegistry({
    config: () => store.read(),
    roleOf: sessionId => roles.roleOf(sessionId),
    recalled,
    log,
  })

  // ---- meta_search ----
  const metaSearch = createMetaSearchTool({
    candidates: agent => {
      const sessionId = agentIdOf(agent)
      const current = store.read()
      return buildToolCandidates({
        schemas: enforcement.schemasOf(),
        present: enforcement.presentOf(sessionId),
        config: current,
        role: roles.roleOf(sessionId),
      })
    },
    seen: agent => toolPayloadsOf(visibleToolsOf(agent, log)),
    record: (sessionId, outcome) => {
      recalled.add(sessionId, outcome.names)
      // 立即重建：下一个 step 的 resolve() 会重新读 view，agent-loop 自动追加 tool-addition。
      enforcement.rebuild()
    },
  })

  // 先登记自己，再注册：注册失败时 universe 里多一个名字无害，反过来则会漏掉自己。
  enforcement.noteOwnTool(META_SEARCH_TOOL_NAME, {
    name: META_SEARCH_TOOL_NAME,
    description: META_SEARCH_DESCRIPTION,
    parameters: META_SEARCH_PARAMETERS,
  })
  guard(log, 'register meta_search', () => {
    ctx.effect(() => ctx.tools.register(metaSearch), 'capability-manager: meta_search')
  })

  // ---- 模式 A 的索引注入 ----
  guard(log, 'register index section', () => {
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: 'capability-manager/index',
          order: INDEX_SECTION_ORDER,
          text: context => {
            const current = store.read()
            if (!shouldInjectIndex(current)) return ''
            const agent = context.agent
            if (agent === undefined) return ''
            const tools = selectToolIndex({
              tools: summariesOf(collectCapabilities(enforcement, current)),
              config: current,
              role: roles.roleOf(agent.id),
              appeared: toolNamesOf(visibleToolsOf(agent, log)),
            })
            return renderIndex({ tools, skills: [] })
          },
        }),
      'capability-manager: index section',
    )
  })

  // ---- 每 agent 的可见集 ----
  ctx.effect(
    () =>
      ctx.on('agent/created', payload => {
        try {
          enforcement.onAgentCreated(agentScopeOf(payload.agent))
        } catch (error) {
          log(`cannot apply agent visibility for ${payload.agent.id}: ${describe(error)}`)
        }
      }),
    'capability-manager: agent created',
  )

  ctx.effect(
    () =>
      ctx.on('agent/disposed', payload => {
        try {
          enforcement.onAgentDisposed(payload.agent.id)
        } catch (error) {
          log(`cannot release agent visibility for ${payload.agent.id}: ${describe(error)}`)
        }
        recalled.forget(payload.agent.id)
      }),
    'capability-manager: agent disposed',
  )

  ctx.effect(
    () =>
      ctx.on('tools/change', () => {
        try {
          enforcement.onToolsChange()
        } catch (error) {
          log(`cannot rebuild visibility after a tool change: ${describe(error)}`)
        }
      }),
    'capability-manager: tools change',
  )

  // 配置变化：所有活跃 agent 的名单立即重建，下一个 step 生效。
  ctx.effect(() => store.subscribe(() => {
    try {
      enforcement.rebuild()
    } catch (error) {
      log(`cannot rebuild visibility after a config change: ${describe(error)}`)
    }
  }), 'capability-manager: config changes')

  // ---- HTTP ----
  guard(log, 'register http', () => {
    const origin = ctx.webServer.getOrigin()
    const version = readPackageVersion()
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'prefix',
          path: API_PREFIX,
          handler: createAdminHandler({
            plugin: name,
            version,
            origin,
            stateDir,
            snapshot: () => {
              const current = store.read()
              return buildSnapshot({
                revision: store.revision,
                capabilities: collectCapabilities(enforcement, current),
                config: current,
                rolesAvailable: roles.available,
                // M1 只有模式 A：向量检索恒为关闭状态。
                embedding: { enabled: current.embedding.enabled, status: 'idle' },
              })
            },
            writeConfig: patch => writeConfig(store, patch),
          }),
        }),
      'capability-manager: http',
    )
  })

  // 插件卸载时把所有 agent 的可见性还原给宿主。
  ctx.effect(() => () => enforcement.dispose(), 'capability-manager: enforcement')

  // 插件热启用或重载时，已存在的 agent 不会再发 `agent/created`，上面那个监听收不到它们。
  // 不补这一步，「启用后当前会话不受管理」和「启用后没生效」在界面上看不出区别。
  for (const agent of listLiveAgents(ctx, log)) {
    guard(log, `apply agent visibility for ${agent.id}`, () => enforcement.onAgentCreated(agent))
  }

  log(`state directory: ${stateDir}`)
}

/** 读一次现存 agent；agents 服务不可用时返回空数组。 */
function listLiveAgents(ctx: HostContext, log: (message: string) => void): AgentScope[] {
  try {
    return ctx.agents.list().map(agent => agentScopeOf(agent))
  } catch (error) {
    log(`cannot enumerate live agents: ${describe(error)}`)
    return []
  }
}

/**
 * 全量能力目录。
 *
 * schema 缓存是唯一的工具来源：它由吸收过程填充，因此包含当前被掩掉的工具——
 * 界面要能显示并重新启用它们。
 */
function collectCapabilities(enforcement: EnforcementRegistry, config: CapabilityConfig): CapabilityEntry[] {
  const definitions = [...enforcement.schemasOf().values()].map(schema => ({
    name: schema.name,
    description: schema.description,
  }))
  return collectTools({
    definitions,
    // M1 尚无自建能力与 MCP 连接：全部按官方来源呈现。
    classify: name => classifySource(name, { owned: new Set(), mcpServers: [] }),
    isAvailable: name => !config.excluded.includes(toolId(name)),
  })
}

/**
 * 该 agent 此刻真正能看到的工具。
 *
 * 召回的去重基准与索引的排除依据都必须是这一份，而不是会话历史：
 * 历史里记着工具被收走之前的定义，拿它当基准会让召回永远返回空。
 */
function visibleToolsOf(agent: unknown, log: (message: string) => void): readonly ToolSource[] {
  const scope = agentScopeOf(agent)
  try {
    return scope.ctx.tools.definitions(scope)
  } catch (error) {
    log(`cannot read the visible tool set: ${describe(error)}`)
    return []
  }
}

/** 索引只放名称与摘要，与列表共用同一份摘要。 */
function summariesOf(capabilities: readonly CapabilityEntry[]): Map<string, string> {
  return new Map(capabilities.filter(entry => entry.kind === 'tool').map(entry => [entry.name, entry.summary]))
}

async function writeConfig(store: ConfigStore, patch: unknown): Promise<ConfigOutcome> {
  const applied = applyPatch(store.read(), patch)
  if (!applied.ok) {
    const body: ErrorResponse = { ok: false, code: applied.code, message: applied.message }
    return { status: 400, body }
  }

  const expected = typeof (patch as { revision?: unknown }).revision === 'number'
    ? (patch as { revision: number }).revision
    : Number.NaN
  const result = store.write(applied.config, expected)

  if (result.ok) {
    const body: ConfigWriteResponse = { ok: true, revision: result.revision }
    return { status: 200, body }
  }
  if (result.code === 'revision-conflict') {
    // 冲突要带上服务端最新的 revision，客户端据此重新拉快照。
    return {
      status: 409,
      body: { ok: false, code: ERROR_CODES.revisionConflict, message: 'configuration changed elsewhere', revision: result.revision },
    }
  }
  return { status: 500, body: { ok: false, code: ERROR_CODES.internal, message: result.message } }
}

/** `Agent` 的运行期形状满足 {@link AgentScope}；这里只做一次收窄，避免各调用点重复。 */
function agentScopeOf(agent: unknown): AgentScope {
  return agent as AgentScope
}

function agentIdOf(agent: unknown): string {
  const candidate = agent as { id?: unknown }
  return typeof candidate.id === 'string' ? candidate.id : ''
}

/** 单步装配的容错边界：失败只记 warning，不让插件加载失败。 */
function guard(log: (message: string) => void, label: string, operation: () => void): void {
  try {
    operation()
  } catch (error) {
    log(`cannot ${label}: ${describe(error)}`)
  }
}

/** 版本号的真身是 package.json；读不到也不能让插件起不来。 */
function readPackageVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

