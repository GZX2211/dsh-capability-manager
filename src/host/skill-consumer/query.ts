// src/host/skill-consumer/query.ts
//
// 从 `ctx.skills` 取「某个 agent 此刻可加载哪些 Skill」，以及「界面该列出哪些」。
//
// 两种视图的差别只在范围来源：
//   · agent 视图：作用域链包含 preset/agent 层，cwd 决定项目级 Skill
//   · 界面视图：没有活跃会话时只能读全局层；有会话时合并每个 agent 的视图，
//     这样 preset 自带的 Skill 也能出现在列表里（§12 的已知限制因此收窄）
//
// 这里是异步边界：注册表的 `snapshot()` 是 Promise，而 systemPrompt section 的
// text 回调是同步的——这也是 Skill 目录走 pre-step 消息的原因。

import { skillId } from '../../shared/capability.ts'
import type { CapabilityConfig, SessionRoleName } from '../../shared/config.ts'
import { isModelInvocable, type SkillSource } from '../catalog/skills.ts'
import { isSkillEnabled } from './policy.ts'

/** `ctx.skills.snapshot` 的结构子集。 */
export interface SkillSnapshotSource {
  snapshot(options: {
    readonly cwd?: string | undefined
    readonly signal?: AbortSignal | undefined
    readonly scope?: unknown
  }): Promise<{ readonly skills: readonly SkillSource[] }>
}

export interface SkillQueryDependencies {
  skills: SkillSnapshotSource
  /** 解析 agent 的当前工作目录；失败时退化为 undefined。 */
  cwdOf: (agent: unknown, signal?: AbortSignal) => Promise<string | undefined>
  log?: (message: string) => void
}

export interface EligibleSkillsInput {
  agent: unknown
  config: CapabilityConfig
  role: SessionRoleName | undefined
  signal: AbortSignal
}

/**
 * 该 agent 此刻可加载的 Skill。
 *
 * 调用方负责先判定入口工具 `skill` 是否可用：入口不可用时整份候选应为空。
 *
 * @param deps - 注册表与工作目录解析。
 * @param input - agent、配置、角色与取消信号。
 * @returns 按名称排序的 Skill 摘要；注册表失败时抛错交给调用方决定降级。
 */
export async function eligibleSkills(
  deps: SkillQueryDependencies,
  input: EligibleSkillsInput,
): Promise<SkillSource[]> {
  const cwd = await resolveCwd(deps, input.agent, input.signal)
  const snapshot = await deps.skills.snapshot({ cwd, signal: input.signal, scope: input.agent })
  return snapshot.skills
    .filter(isModelInvocable)
    .filter(skill => isSkillEnabled({ id: skillId(skill.name), config: input.config, role: input.role }))
    .sort((a, b) => compareNames(a.name, b.name))
}

/**
 * 界面用全量摘要：全局层 + 每个活跃 agent 的视图，按名称去重。
 *
 * 全局视图在前：同名 Skill 全局定义优先，避免一个会话的 preset 覆盖用户安装的
 * 同名 Skill。单个来源失败只记 warning，不影响其他来源。
 *
 * @param deps - 注册表与工作目录解析。
 * @param agents - 活跃 agent；用作作用域键。
 * @returns 按名称排序的摘要。
 */
export async function allSkillSummaries(
  deps: SkillQueryDependencies,
  agents: readonly unknown[],
): Promise<SkillSource[]> {
  const merged = new Map<string, SkillSource>()

  try {
    const global = await deps.skills.snapshot({})
    for (const skill of global.skills) merged.set(skill.name, skill)
  } catch (error) {
    deps.log?.(`cannot read the global skill catalog: ${describe(error)}`)
  }

  for (const agent of agents) {
    try {
      const cwd = await resolveCwd(deps, agent)
      const view = await deps.skills.snapshot({ cwd, scope: agent })
      for (const skill of view.skills) {
        if (!merged.has(skill.name)) merged.set(skill.name, skill)
      }
    } catch (error) {
      deps.log?.(`cannot read a skill catalog view: ${describe(error)}`)
    }
  }

  return [...merged.values()].sort((a, b) => compareNames(a.name, b.name))
}

/** 工作目录解析失败只影响项目级 Skill 的可见性，不阻断整份目录。 */
async function resolveCwd(
  deps: SkillQueryDependencies,
  agent: unknown,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    return await deps.cwdOf(agent, signal)
  } catch (error) {
    deps.log?.(`cannot resolve the working directory for a skill lookup: ${describe(error)}`)
    return undefined
  }
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
