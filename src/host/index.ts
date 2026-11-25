// src/host/index.ts
//
// 插件宿主入口：装配与生命周期。
//
// 只做装配与协调，业务语义在各模块里。任何一步失败都只记 warning：
// profile 里还有别的插件依赖宿主启动，本插件不该因为一个可选部件坏掉就拖垮整个 Host。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  API_PREFIX,
  ERROR_CODES,
  type ConfigWriteResponse,
  type ErrorResponse,
  type SessionRoleSnapshot,
} from '../shared/api.ts'
import { parseId, skillId, type CapabilityEntry } from '../shared/capability.ts'
import type { ToolSource } from './catalog/collect.ts'
import { summarize } from './catalog/collect.ts'
import { toolId } from '../shared/capability.ts'
import { SKILL_TOOL_ID, type CapabilityConfig, type SessionRoleName } from '../shared/config.ts'
import { applyPatch } from './admin/mutate.ts'
import { createSkillAction, revealAction } from './admin/selfmade.ts'
import { createAdminHandler, type ConfigOutcome } from './admin/server.ts'
import { registerBundledSkills } from './builtin-skills/register.ts'
import { buildSnapshot } from './admin/snapshot.ts'
import { buildToolCandidates } from './catalog/candidates.ts'
import { collectTools } from './catalog/collect.ts'
import { collectSkills, type SkillSource } from './catalog/skills.ts'
import { classifySource } from './catalog/source.ts'
import { ConfigStore } from './config/store.ts'
import type { HostContext } from './context.ts'
import { readMcpServers, writeMcpServers } from './mcp/bridge.ts'
import { EnforcementRegistry, type AgentScope } from './enforcement/registry.ts'
import { RecalledStore, type SessionLike } from './enforcement/recalled.ts'
import { renderIndex, selectToolIndex, shouldInjectIndex } from './prompt/index-section.ts'
import { createRoleResolver, type RoleResolver } from './roles/resolve.ts'
import { EmbeddingService, type EmbeddingCandidate, type EmbeddingServiceOptions } from './search/embedding/index.ts'
import { modelDirOf } from './search/embedding/model.ts'
import type { KeywordHits } from './search/index.ts'
import { skillPayload, type SkillPayloadSource, type ToolPayloadSource } from './search/payload.ts'
import { toolNamesOf, toolPayloadsOf } from './search/seen.ts'
import { SelfmadeSkills } from './selfmade/skills.ts'
import { SelfmadeTools } from './selfmade/tools.ts'
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

/** 向量检索的可替换基础设施；生产不传，测试与无原生运行时环境用。 */
export interface EmbeddingOverrides {
  ensureModel?: EmbeddingServiceOptions['ensureModel']
  loadEmbedder?: EmbeddingServiceOptions['loadEmbedder']
  modelPresent?: () => boolean
}

export interface Config {
  /** 状态目录覆盖；缺省 `<DSH_HOME>/state/capability-manager`。 */
  stateDir?: string
  /** 向量检索的注入点。 */
  embedding?: EmbeddingOverrides
  /** Python 工具使用的解释器绝对路径；缺省按 DSH 运行时、PATH 顺序探测。 */
  pythonPath?: string
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
  const embedding = new EmbeddingService({
    modelDir: modelDirOf(stateDir),
    config: () => store.read(),
    saveEmbedding: embeddingConfig => {
      // 复用配置存储的写路径：一次写入、一次 revision 递增、一次变更通知。
      const current = store.read()
      const written = store.write(
        { ...current, embedding: { ...current.embedding, ...embeddingConfig } },
        store.revision,
      )
      if (!written.ok) {
        log(
          written.code === 'write-failed'
            ? `cannot persist the embedding switch: ${written.message}`
            : `cannot persist the embedding switch: revision conflict at ${String(written.revision)}`,
        )
      }
    },
    ensureModel: config?.embedding?.ensureModel,
    loadEmbedder: config?.embedding?.loadEmbedder,
    modelPresent: config?.embedding?.modelPresent,
    log,
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
    sources: async (agent, signal, request) => {
      const sessionId = agentIdOf(agent)
      const context = skillContextOf(agent)
      const skillUsable = isSkillToolUsable(context)
      // 注册表抖动不应该连累工具召回：Skill 候选降级为空，工具照常返回。
      const skills = skillUsable ? await loadEligibleSkills(skillQuery, context, agent, signal, log) : []
      const entries = catalogEntries(skills)
      // 名称 → 目录条目；召回与语义通道共用同一份，避免两者对「有哪些 Skill」理解不一致。
      const skillEntries = new Map(entries.map(entry => [entry.name, entry]))
      // 模式 A 且目录已注入时，整份 Skill 列表都已出现在上下文中，Skill 召回必然为空。
      const catalogResident = skillUsable && !context.config.embedding.enabled
      const tools = buildToolCandidates({
        schemas: enforcement.schemasOf(),
        present: enforcement.presentOf(sessionId),
        config: context.config,
        role: context.role,
      })
      // 语义命中按 request.keywords 现算：候选依赖当前可见集，无法预先算好。
      const keywordHits = await keywordHitsOf({
        embedding,
        config: context.config,
        keywords: request.keywords,
        tools,
        skills: skillEntries,
      })
      return {
        tools,
        skills: skillEntries,
        seenTools: toolPayloadsOf(visibleToolsOf(agent, log)),
        seenSkills: catalogResident
          ? new Set(entries.map(skillPayload))
          : recalled.skillPayloadsOf(sessionId),
        embeddingEnabled: context.config.embedding.enabled,
        skillCatalogResident: catalogResident,
        keywordHits,
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

  // ---- 自建工具：扫描 <state>/tools 并热注册 ----
  // 注册进 global 层：新工具对之后创建的 agent 可见，对已存在的 agent 由
  // `tools/change` → 吸收 → 重建 restriction 接管。
  const selfmadeTools = new SelfmadeTools({
    stateDir,
    register: definition => ctx.tools.register(definition),
    isTaken: toolName => ctx.tools.get(toolName) !== undefined,
    workspaceOf: cwdOf,
    ...config?.pythonPath === undefined ? {} : { pythonPath: config.pythonPath },
    log,
  })
  guard(log, 'start the self-made tool registry', () => {
    ctx.effect(() => {
      selfmadeTools.start()
      return () => selfmadeTools.dispose()
    }, 'capability-manager: self-made tools')
  })

  // ---- 自建 Skill：<state>/skills 作为 provider 接进 ctx.skills ----
  // 目录变化只用来让注册表丢缓存；列表与正文每次请求都重新读盘。
  const selfmadeSkills = new SelfmadeSkills({ stateDir, log })
  guard(log, 'register the self-made skill provider', () => {
    ctx.effect(() => {
      selfmadeSkills.start()
      let stopWatching: (() => void) | undefined
      const releaseProvider = ctx.skills.registerProvider(control => {
        stopWatching = selfmadeSkills.onChange(control.invalidate)
        return selfmadeSkills.provider()
      })
      return () => {
        stopWatching?.()
        releaseProvider()
        selfmadeSkills.dispose()
      }
    }, 'capability-manager: self-made skills')
  })

  // ---- 内置 Skill：随包发布，正文里的状态目录占位符在注册时替换 ----
  guard(log, 'register the bundled skills', () => {
    const release = registerBundledSkills({ skills: ctx.skills }, stateDir, { log })
    if (release === undefined) return
    ctx.effect(() => release, 'capability-manager: bundled skills')
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
              // 索引是同步回调：直接读磁盘事实与本机连接，不做异步等待。
              tools: summariesOf(collectCapabilities(
                enforcement,
                current,
                selfmadeTools.catalog().map(tool => ({ name: tool.name, description: tool.meta.description })),
                mcpServerNames(ctx),
              )),
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
              // 监听可能漏事件；每次读快照前先对账一次，界面总能自愈。
              selfmadeTools.rescan()
              const current = store.read()
              const mcpServers = mcpServerNames(ctx)
              const selfmade = selfmadeTools.catalog()
              // 活跃会话在一份快照里只取一次：能力目录与角色判定必须看到同一批会话。
              const liveAgents = listLiveAgents(ctx, log)
              return buildSnapshot({
                revision: store.revision,
                capabilities: [
                  ...collectCapabilities(
                    enforcement,
                    current,
                    selfmade.map(tool => ({ name: tool.name, description: tool.meta.description })),
                    mcpServers,
                  ),
                  ...await collectSkillCapabilities(skillQuery, current, selfmadeSkills.names(), liveAgents),
                ],
                config: current,
                rolesAvailable: roles.available,
                sessions: sessionRolesOf(roles, liveAgents),
                embedding: embedding.status(),
                diagnostics: {
                  knownToolCount: enforcement.universe.size,
                  schemaCount: enforcement.schemasOf().size,
                  agents: enforcement.diagnostics(),
                },
              })
            },
            writeConfig: patch => writeConfig(store, patch),
            createSkill: body => createSkillAction({
              store,
              stateDir,
              log,
              onCreated: () => selfmadeSkills.notifyChanged(),
            }, body),
            reveal: body => revealAction({
              stateDir,
              ownsTool: toolName => selfmadeTools.names().has(toolName),
              directoryOfSkill: skillName => selfmadeSkills.directoryOf(skillName),
            }, body),
            enableEmbedding: async () => {
              const result = await embedding.enable()
              if (result.ok) return { status: 200, body: { ok: true } }
              // 下载失败是上游（模型源）问题，运行时不可用是本机能力问题：
              // 分成两个状态码，客户端与日志都能据此分流。
              return {
                status: result.code === 'embedding-download-failed' ? 502 : 503,
                body: { ok: false, code: result.code, message: result.message },
              }
            },
            disableEmbedding: async () => {
              await embedding.disable()
              return { status: 200, body: { ok: true } }
            },
            // MCP 面读官方管理器、写官方配置编辑器：与 Agent / Settings 共用同一份配置。
            mcpRead: () => readMcpServers(ctx),
            mcpWrite: body => writeMcpServers(ctx, body),
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

  // 向量检索：启动自愈（模型缺失/加载失败时保持关闭）与卸载释放。
  guard(log, 'start the embedding service', () => embedding.start())
  ctx.effect(
    () => () => {
      // cleanup 不能等待：释放失败时进程正在退出，缓存与会话由宿主回收。
      void embedding.dispose()
    },
    'capability-manager: embedding',
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
 * schema 缓存是工具的主要来源：它由吸收过程填充，因此包含当前被掩掉的工具——
 * 界面要能显示并重新启用它们。自建工具还要再并一次目录扫描：刚创建、还没有
 * 任何会话吸收过的工具只存在于磁盘上，不能让它在界面上「创建成功却看不见」。
 *
 * @param enforcement - 提供 schema 缓存。
 * @param config - 当前配置，用于判定可用性。
 * @param selfmade - 自建工具的磁盘事实（名称 + 描述）。
 * @param mcpServers - 已连接的 MCP 服务器名，用于来源判定。
 * @returns 工具条目。
 */
function collectCapabilities(
  enforcement: EnforcementRegistry,
  config: CapabilityConfig,
  selfmade: readonly { name: string; description: string }[],
  mcpServers: readonly string[],
): CapabilityEntry[] {
  const definitions = new Map(
    [...enforcement.schemasOf().values()].map(schema => [
      schema.name,
      { name: schema.name, description: schema.description ?? '' },
    ]),
  )
  const owned = new Set<string>()
  for (const tool of selfmade) {
    owned.add(tool.name)
    if (!definitions.has(tool.name)) definitions.set(tool.name, tool)
  }
  return collectTools({
    definitions: [...definitions.values()],
    classify: name => classifySource(name, { owned, mcpServers }),
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
  deps: SkillQueryDependencies,
  config: CapabilityConfig,
  selfmade: ReadonlySet<string>,
  liveAgents: readonly AgentScope[],
): Promise<CapabilityEntry[]> {
  const summaries = await allSkillSummaries(deps, liveAgents)
  const skillToolExcluded = config.excluded.includes(SKILL_TOOL_ID)
  return collectSkills({
    skills: summaries,
    // Skill 侧只有「自建 / 官方」两类来源；MCP 服务器只提供工具。
    classify: name => classifySource(name, { owned: selfmade, mcpServers: [] }),
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

/** 语义通道的输入：服务、配置、关键词与两侧候选。 */
interface KeywordHitsInput {
  embedding: EmbeddingService
  config: CapabilityConfig
  keywords: string | undefined
  tools: ReadonlyMap<string, ToolPayloadSource>
  skills: ReadonlyMap<string, SkillPayloadSource>
}

/**
 * 计算语义通道的名称命中。
 *
 * 只在模式 B 且真的给了 keywords 时计算：模式 A 下 keywords 由检索编排给出
 * 「未开启」的说明，这里返回 undefined 即可。
 *
 * @param input - 服务、配置、关键词与两侧候选。
 * @returns 工具与 Skill 的名称命中；不可用时为 `undefined`。
 */
async function keywordHitsOf(input: KeywordHitsInput): Promise<KeywordHits | undefined> {
  const keywords = input.keywords?.trim() ?? ''
  if (keywords === '' || !input.config.embedding.enabled) return undefined

  const candidates: EmbeddingCandidate[] = []
  for (const [name, schema] of input.tools) {
    candidates.push({ id: toolId(name), summary: summarize(schema.description) })
  }
  for (const [name, entry] of input.skills) {
    candidates.push({ id: skillId(name), summary: entry.description })
  }

  const hits = await input.embedding.search(keywords, candidates)
  if (hits === undefined) return undefined

  const tools: string[] = []
  const skills: string[] = []
  for (const hit of hits) {
    const parsed = parseId(hit.id)
    if (parsed === undefined) continue
    if (parsed.kind === 'tool') tools.push(parsed.name)
    else skills.push(parsed.name)
  }
  return { tools, skills }
}

/**
 * 活跃会话的角色判定，供界面的「会话角色」区渲染。
 *
 * 按 id 排序：会话集合在两次快照之间通常稳定，顺序抖动会让列表每次刷新都重排。
 *
 * @param roles - 角色解析器。
 * @param agents - 活跃 agent。
 * @returns 每会话一条；未知角色不带 `role` 字段。
 */
function sessionRolesOf(roles: RoleResolver, agents: readonly AgentScope[]): SessionRoleSnapshot[] {
  return agents
    .map(agent => {
      const resolution = roles.resolve(agent.id)
      return resolution.role === undefined
        ? { id: agent.id, roleSource: resolution.source }
        : { id: agent.id, role: resolution.role, roleSource: resolution.source }
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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

/** `ctx.mcpManager` 的只读面；本插件只读连接，不新建连接。 */
interface McpManagerLike {
  list(): readonly { name?: unknown }[]
}

/**
 * 受管的 MCP 服务器名。
 *
 * 服务按需探测：MCP 客户端可能比本插件晚加载。读不到时只影响 `<server>__<tool>`
 * 的来源标签，不影响能力池本身。
 *
 * 列表含「连接中 / 未连接 / 已停用」的条目：来源判定问的是「这个命名空间是否由
 * 受管服务器占用」，而不是「此刻是否连通」。
 *
 * @param ctx - 宿主上下文。
 * @returns 非空服务器名；失败时为空数组。
 */
function mcpServerNames(ctx: HostContext): string[] {
  try {
    const manager = ctx.get('mcpManager') as McpManagerLike | undefined
    const servers = manager?.list?.() ?? []
    const names: string[] = []
    for (const server of servers) {
      if (typeof server?.name === 'string' && server.name.length > 0) names.push(server.name)
    }
    return names
  } catch {
    return []
  }
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

