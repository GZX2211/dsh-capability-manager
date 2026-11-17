// src/host/index.ts
//
// 插件宿主入口：装配与生命周期。
//
// 只做装配与协调，业务语义在各模块里。任何一步失败都只记 warning：
// profile 里还有别的插件依赖宿主启动，本插件不该因为一个可选部件坏掉就拖垮整个 Host。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { API_PREFIX, ERROR_CODES, type ConfigWriteResponse, type ErrorResponse } from '../shared/api.ts'
import { skillId, type CapabilityEntry } from '../shared/capability.ts'
import type { ToolSource } from './catalog/collect.ts'
import { toolId } from '../shared/capability.ts'
import { SKILL_TOOL_ID, type CapabilityConfig, type SessionRoleName } from '../shared/config.ts'
import { applyPatch } from './admin/mutate.ts'
import { createAdminHandler, type ConfigOutcome } from './admin/server.ts'
import { buildSnapshot } from './admin/snapshot.ts'
import { buildToolCandidates } from './catalog/candidates.ts'
import { collectTools } from './catalog/collect.ts'
import { collectSkills, type SkillSource } from './catalog/skills.ts'
import { classifySource } from './catalog/source.ts'
import { ConfigStore } from './config/store.ts'
import type { HostContext } from './context.ts'
import { EnforcementRegistry, type AgentScope } from './enforcement/registry.ts'
import { RecalledStore, type SessionLike } from './enforcement/recalled.ts'
import { renderIndex, selectToolIndex, shouldInjectIndex } from './prompt/index-section.ts'
import { createRoleResolver } from './roles/resolve.ts'
import { skillPayload } from './search/payload.ts'
import { toolNamesOf, toolPayloadsOf } from './search/seen.ts'
import { catalogEntries } from './skill-consumer/catalog.ts'
import { createCatalogListener, type CatalogPlan } from './skill-consumer/catalog-inject.ts'
import { isSkillToolUsable, shouldInjectSkillCatalog } from './skill-consumer/policy.ts'
import {
  allSkillSummaries,
  eligibleSkills,
  type SkillQueryDependencies,
  type SkillSnapshotSource,
} from './skill-consumer/query.ts'
import { ShadowSkillRegistry, type ShadowSkillAgentScope, type SkillLookup } from './skill-consumer/shadow.ts'
import { resolveStateDirectory } from './state/directory.ts'
import {
  createMetaSearchTool,
  META_SEARCH_DESCRIPTION,
  META_SEARCH_PARAMETERS,
  META_SEARCH_TOOL_NAME,
} from './tools/meta_search/index.ts'

export const name = 'dsh-capability-manager'

/** 需要的宿主服务：缺任何一个都不该沉默地半启动。 */
export const inject = ['tools', 'systemPrompt', 'webServer', 'agents', 'skills']

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

  // ---- Skill 侧共享的查询面 ----
  // workingDirectory 是可选服务：缺席时项目级 Skill 不可见，但用户级 Skill 与
  // 全局能力仍然工作，因此不让它成为插件的加载前置条件。每次调用重新探测，
  // 与 paRoles 的理由相同：服务可能比本插件晚加载。
  const cwdOf = async (agent: unknown, signal?: AbortSignal): Promise<string | undefined> => {
    const workingDirectory = ctx.get('workingDirectory') as WorkingDirectoryLike | undefined
    if (workingDirectory === undefined) return undefined
    try {
      return await workingDirectory.ensure(agent, signal)
    } catch (error) {
      log(`cannot resolve the working directory: ${describe(error)}`)
      return undefined
    }
  }
  const skillQuery: SkillQueryDependencies = { skills: ctx.skills as unknown as SkillSnapshotSource, cwdOf, log }
  const shadowSkills = new ShadowSkillRegistry({
    config: () => store.read(),
    roleOf: sessionId => roles.roleOf(sessionId),
    recalled,
    skills: ctx.skills as unknown as SkillLookup,
    cwdOf,
    log,
  })

  /** 会话角色与召回集合的唯一读取点；多数 Skill 判定都要这两样。 */
  const skillContextOf = (agent: unknown) => {
    const session = sessionOf(agent)
    const current = store.read()
    return {
      config: current,
      role: roles.roleOf(session.id),
      recalled: recalled.namesOf(session),
    }
  }

  // ---- meta_search ----
  const metaSearch = createMetaSearchTool({
    sources: async (agent, signal) => {
      const sessionId = agentIdOf(agent)
      const context = skillContextOf(agent)
      const skillUsable = isSkillToolUsable(context)
      // 注册表抖动不应该连累工具召回：Skill 候选降级为空，工具照常返回。
      const skills = skillUsable ? await loadEligibleSkills(skillQuery, context, agent, signal, log) : []
      const entries = catalogEntries(skills)
      // 模式 A 且目录已注入时，整份 Skill 列表都已出现在上下文中，Skill 召回必然为空。
      const catalogResident = skillUsable && !context.config.embedding.enabled
      return {
        tools: buildToolCandidates({
          schemas: enforcement.schemasOf(),
          present: enforcement.presentOf(sessionId),
          config: context.config,
          role: context.role,
        }),
        skills: new Map(entries.map(entry => [entry.name, entry])),
        seenTools: toolPayloadsOf(visibleToolsOf(agent, log)),
        seenSkills: catalogResident
          ? new Set(entries.map(skillPayload))
          : recalled.skillPayloadsOf(sessionId),
        embeddingEnabled: context.config.embedding.enabled,
        skillCatalogResident: catalogResident,
      }
    },
    record: (sessionId, outcome) => {
      recalled.add(sessionId, outcome.toolNames)
      if (outcome.skillPayloads.length > 0) recalled.addSkills(sessionId, outcome.skillPayloads)
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

  // ---- Skill 目录注入（pre-step） ----
  guard(log, 'register skill catalog', () => {
    ctx.effect(
      () =>
        ctx.on(
          'agent/pre-step',
          createCatalogListener({
            catalogOf: async (agent, signal): Promise<CatalogPlan> => {
              const context = skillContextOf(agent)
              if (!shouldInjectSkillCatalog(context)) return { active: false }
              if (!isSkillToolUsable(context)) return { active: true, entries: [] }
              const skills = await eligibleSkills(skillQuery, {
                agent,
                config: context.config,
                role: context.role,
                signal,
              })
              return { active: true, entries: catalogEntries(skills) }
            },
            log,
          }),
          // 必须是最外层 listener：waterfall 的 outer 在 next() 返回后才追加消息，
          // 也就是最后写入 decision.messages。官方 consumer 若在我们内层追了一条
          // 空目录退役旧名称，我们的目录必须排在它后面才能生效。
          { prepend: true },
        ),
      'capability-manager: skill catalog',
    )
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

  // ---- 每 agent 的可见集与 shadow skill ----
  ctx.effect(
    () =>
      ctx.on('agent/created', payload => {
        try {
          enforcement.onAgentCreated(agentScopeOf(payload.agent))
        } catch (error) {
          log(`cannot apply agent visibility for ${payload.agent.id}: ${describe(error)}`)
        }
        try {
          shadowSkills.onAgentCreated(skillScopeOf(payload.agent))
        } catch (error) {
          log(`cannot register the shadow skill tool for ${payload.agent.id}: ${describe(error)}`)
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
        try {
          shadowSkills.onAgentDisposed(payload.agent.id)
        } catch (error) {
          log(`cannot release the shadow skill tool for ${payload.agent.id}: ${describe(error)}`)
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
            snapshot: async () => {
              const current = store.read()
              return buildSnapshot({
                revision: store.revision,
                capabilities: [
                  ...collectCapabilities(enforcement, current),
                  ...await collectSkillCapabilities(ctx, skillQuery, current, log),
                ],
                config: current,
                rolesAvailable: roles.available,
                // M2 只有模式 A：向量检索恒为关闭状态。
                embedding: { enabled: current.embedding.enabled, status: 'idle' },
                diagnostics: {
                  knownToolCount: enforcement.universe.size,
                  schemaCount: enforcement.schemasOf().size,
                  agents: enforcement.diagnostics(),
                },
              })
            },
            writeConfig: patch => writeConfig(store, patch),
          }),
        }),
      'capability-manager: http',
    )
  })

  // 插件卸载时把所有 agent 的 shadow 与可见性还原给宿主。
  ctx.effect(
    () => () => {
      shadowSkills.dispose()
      enforcement.dispose()
    },
    'capability-manager: enforcement',
  )

  // 插件热启用或重载时，已存在的 agent 不会再发 `agent/created`，上面那个监听收不到它们。
  // 不补这一步，「启用后当前会话不受管理」和「启用后没生效」在界面上看不出区别。
  for (const agent of listLiveAgents(ctx, log)) {
    guard(log, `apply agent visibility for ${agent.id}`, () => enforcement.onAgentCreated(agent))
    guard(log, `register the shadow skill tool for ${agent.id}`, () => shadowSkills.onAgentCreated(skillScopeOf(agent)))
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
    // M2 尚无自建工具与 MCP 连接：全部按官方来源呈现。
    classify: name => classifySource(name, { owned: new Set(), mcpServers: [] }),
    isAvailable: name => !config.excluded.includes(toolId(name)),
  })
}

/**
 * Skill 侧的全量目录。
 *
 * 来源是全局视图加每个活跃 agent 的视图：没有活跃会话时只能读到全局层，
 * preset 自带的 Skill 需要一次会话才能出现在列表里（§12 的已知限制）。
 */
async function collectSkillCapabilities(
  ctx: HostContext,
  deps: SkillQueryDependencies,
  config: CapabilityConfig,
  log: (message: string) => void,
): Promise<CapabilityEntry[]> {
  const summaries = await allSkillSummaries(deps, listLiveAgents(ctx, log))
  const skillToolExcluded = config.excluded.includes(SKILL_TOOL_ID)
  return collectSkills({
    skills: summaries,
    // M2 尚无自建 Skill：全部按官方来源呈现。
    classify: name => classifySource(name, { owned: new Set(), mcpServers: [] }),
    // 入口工具被排除时所有 Skill 都无法加载；其余情况只看 Skill 自己的池归属。
    isAvailable: skill => !skillToolExcluded && !config.excluded.includes(skillId(skill.name)),
  })
}

/** 读一次该 agent 的 Skill 候选；注册表失败时降级为空并记 warning。 */
async function loadEligibleSkills(
  deps: SkillQueryDependencies,
  context: { config: CapabilityConfig; role: SessionRoleName | undefined },
  agent: unknown,
  signal: AbortSignal,
  log: (message: string) => void,
): Promise<SkillSource[]> {
  try {
    return await eligibleSkills(deps, { agent, config: context.config, role: context.role, signal })
  } catch (error) {
    log(`cannot load the skill candidates: ${describe(error)}`)
    return []
  }
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

/** `Agent` 的运行期形状满足 shadow 的注册面；与 {@link agentScopeOf} 同样只收窄一次。 */
function skillScopeOf(agent: unknown): ShadowSkillAgentScope {
  return agent as ShadowSkillAgentScope
}

/** Skill 判定只读取会话身份与召回集合；没有会话时按空会话处理。 */
function sessionOf(agent: unknown): SessionLike {
  return (agent as { session: SessionLike }).session
}

/** `workingDirectory` 是用到时才探测的可选服务；缺席时项目级 Skill 不可见。 */
interface WorkingDirectoryLike {
  ensure(agent: unknown, signal?: AbortSignal): Promise<string>
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

