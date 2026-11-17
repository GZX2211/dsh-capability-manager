// src/host/skill-consumer/shadow.ts
//
// 官方 `skill` 工具的 shadow：在 agent scope 注册同名工具，由我们自己校验能力池、
// 角色黑名单与常驻资格，并复用官方的 `<skill_content>` 渲染。
//
// 为什么必须 shadow：官方目录只要看到它的 `skill` 工具可见就注入全部
// model-invocable Skill，没有任何过滤钩子；同名 shadow 是唯一能让目录受池管辖的
// 方式（官方 consumer 用定义身份比较，见 §2.4）。
//
// 为什么 `when` 要管常驻：agent scope 注册的工具不受 `restrict` 约束，只有 `when`
// 能落实「非常驻、且未召回 → 不可见」。

import { isSkillName, renderSkillContent, type SkillResourceBase } from '@deepseek-ai/dsh-skill'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { skillId } from '../../shared/capability.ts'
import { SKILL_TOOL_ID, type CapabilityConfig, type SessionRoleName } from '../../shared/config.ts'
import type { RecalledStore, SessionLike } from '../enforcement/recalled.ts'
import { isSkillEnabled, isSkillToolUsable, SKILL_TOOL_NAME } from './policy.ts'

export { SKILL_TOOL_NAME }

/** shadow 工具的描述；与官方工具同一职责，但明确写出受能力池管辖。 */
export const SKILL_TOOL_DESCRIPTION = `按名称加载一个 Skill 的完整指令。当用户点名某个 Skill，或任务明显匹配目录里某个 Skill 的描述时，先调用它再行动。

参数 name 必须是目录里的准确名称。Skill 不在能力池内、被该角色禁止、或入口工具当前不可用时，加载会失败。`

/** 注册表返回的完整 Skill 定义；只描述这里用到的字段。 */
export interface LoadedSkill {
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly content: string
  readonly invocation?: { readonly modelInvocable: boolean } | undefined
  readonly resourceBase?: SkillResourceBase | undefined
}

/** `ctx.skills` 的只读面；由装配处注入真实服务。 */
export interface SkillLookup {
  get(
    name: string,
    options: { readonly cwd?: string | undefined; readonly signal?: AbortSignal | undefined; readonly scope?: unknown },
  ): Promise<LoadedSkill | undefined>
}

export interface ShadowSkillDependencies {
  config: () => CapabilityConfig
  roleOf: (sessionId: string) => SessionRoleName | undefined
  recalled: RecalledStore
  skills: SkillLookup
  /** 当前会话的工作目录；缺省时不传 cwd，项目级 Skill 可能不可见。 */
  cwdOf?: (agent: unknown, signal: AbortSignal) => Promise<string | undefined>
  log?: (message: string) => void
}

/** agent scope 里本模块用到的工具注册面。 */
export interface ShadowSkillAgentScope {
  readonly id: string
  readonly session: SessionLike
  readonly ctx: {
    readonly tools: {
      register(definition: ToolDefinition, options?: { when?: (context: { agent: unknown }) => boolean }): () => void
    }
  }
}

/**
 * 构造 `skill` 工具定义。
 *
 * `when` 由 {@link whenSkillToolUsable} 单独提供；工具定义本身与 agent 无关，
 * 因此整个插件只构造一份。
 *
 * @param deps - 配置、角色、召回集合与 Skill 注册表。
 * @returns 可直接注册的工具定义。
 */
export function createShadowSkillTool(deps: ShadowSkillDependencies): ToolDefinition {
  return defineTool({
    name: SKILL_TOOL_NAME,
    description: SKILL_TOOL_DESCRIPTION,
    parameters: {
      name: { type: 'string', required: true, description: 'Skill 的准确名称，必须来自当前 Skill 目录。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          resourceBase: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'directory' },
                  path: { type: 'string', required: true },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'url' },
                  url: { type: 'string', required: true },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'opaque' },
                  description: { type: 'string', required: true },
                },
              },
            ],
          },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: renderSkillContent(value as Parameters<typeof renderSkillContent>[0]) },
      ],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('skill 只能在会话内调用：当前没有发起调用的 agent')
      }
      if (!isSkillName(args.name)) throw new Error(`invalid skill name "${args.name}"`)

      const config = deps.config()
      const role = deps.roleOf(agent.session.id)
      // `when` 已经把不可用的工具排除出本 step，这里再挡一次直接派发：
      // agent 层注册的工具不受 restrict 约束，不能只依赖 admission。
      if (!isSkillToolUsable({ config, role, recalled: deps.recalled.namesOf(agent.session) })) {
        throw new Error('skill 工具当前不可用：它不在能力池内、被该角色禁止，或不是常驻/已召回')
      }
      if (!isSkillEnabled({ id: skillId(args.name), config, role })) {
        throw new Error(`skill "${args.name}" is not available in this session`)
      }

      const cwd = await resolveCwd(deps, agent, exec.signal, args.name)
      const skill = await deps.skills.get(args.name, { cwd, signal: exec.signal, scope: agent })
      if (skill === undefined) {
        throw new Error(`skill "${args.name}" is unknown or no longer available`)
      }
      if (skill.invocation?.modelInvocable !== true) {
        throw new Error(`skill "${args.name}" is not available for model invocation`)
      }

      return {
        name: skill.name,
        provider: skill.provider,
        ...skill.resourceBase === undefined ? {} : { resourceBase: skill.resourceBase },
        content: skill.content,
      }
    },
  })
}

/**
 * 工具在当前 step 是否参与执行。
 *
 * 判定与 `restrict` 同源：池内 + 非该角色黑名单 + (常驻 或 本会话已召回)。
 *
 * @param deps - 配置、角色与召回集合。
 * @returns 供 `tools.register(def, { when })` 使用的同步判定。
 */
export function whenSkillToolUsable(
  deps: ShadowSkillDependencies,
): (context: { agent: unknown }) => boolean {
  return context => {
    const agent = context.agent as { session: SessionLike }
    return isSkillToolUsable({
      config: deps.config(),
      role: deps.roleOf(agent.session.id),
      recalled: deps.recalled.namesOf(agent.session),
    })
  }
}

/**
 * 每 agent 的 shadow 注册生命周期。
 *
 * 只保留「插件卸载时能主动释放」这一条路径所需的最小状态：agent 销毁时宿主
 * 会回收 agent context 上的注册，但插件热卸载不会，所以两处都要释放。
 */
export class ShadowSkillRegistry {
  private readonly definition: ToolDefinition
  private readonly when: (context: { agent: unknown }) => boolean
  private readonly releases = new Map<string, () => void>()

  constructor(private readonly deps: ShadowSkillDependencies) {
    this.definition = createShadowSkillTool(deps)
    this.when = whenSkillToolUsable(deps)
  }

  /** agent 创建：注册 shadow；重复调用是幂等的（先释放上一次）。 */
  onAgentCreated(agent: ShadowSkillAgentScope): void {
    this.onAgentDisposed(agent.id)
    try {
      const release = agent.ctx.tools.register(this.definition, { when: this.when })
      this.releases.set(agent.id, release)
    } catch (error) {
      this.deps.log?.(`cannot register the shadow skill tool for agent ${agent.id}: ${describe(error)}`)
    }
  }

  /** agent 销毁或插件卸载：解除该 agent 的 shadow。 */
  onAgentDisposed(agentId: string): void {
    const release = this.releases.get(agentId)
    if (release === undefined) return
    this.releases.delete(agentId)
    try {
      release()
    } catch (error) {
      this.deps.log?.(`cannot release the shadow skill tool for agent ${agentId}: ${describe(error)}`)
    }
  }

  /** 插件卸载：解除全部 shadow。 */
  dispose(): void {
    for (const agentId of [...this.releases.keys()]) this.onAgentDisposed(agentId)
  }
}

/**
 * 解析当前工作目录。
 *
 * 目录解析失败只影响「哪些项目级 Skill 可见」，不应该让一次合法加载整体失败：
 * 用户级 Skill 仍然可以按名称加载。降级方向是少给候选，而不是拒绝调用。
 */
async function resolveCwd(
  deps: ShadowSkillDependencies,
  agent: unknown,
  signal: AbortSignal,
  name: string,
): Promise<string | undefined> {
  if (deps.cwdOf === undefined) return undefined
  try {
    return await deps.cwdOf(agent, signal)
  } catch (error) {
    deps.log?.(`cannot resolve the working directory for skill "${name}": ${describe(error)}`)
    return undefined
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
