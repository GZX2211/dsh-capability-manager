// src/host/selfmade/definition.ts
//
// 自建工具描述到 ToolDefinition 的投影：模型看到的名称/描述/参数，
// 以及真正执行时走哪条通道。三种形态的差异全部收在这里，注册表只负责生命周期。

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { runCodeTool } from './executors/code.ts'
import { runHttpTool } from './executors/http.ts'
import { runShellTool } from './executors/shell.ts'
import type { SelfmadeToolMeta } from './meta.ts'

/** 执行期需要的外部事实；由装配处注入，定义本身不读环境。 */
export interface SelfmadeToolRuntime {
  stateDir: string
  /** 解析调用方会话的工作目录；失败时应由实现降级为 undefined。 */
  workspaceOf?: (agent: unknown, signal: AbortSignal) => Promise<string | undefined>
}

/**
 * 把一份自建工具描述变成可注册的工具定义。
 *
 * @param meta - 已通过校验的描述。
 * @param dir - 工具目录（代码工具的入口在它下面）。
 * @param runtime - 状态目录与工作目录解析。
 * @returns 可直接交给 `ctx.tools.register` 的定义。
 */
export function createSelfmadeToolDefinition(
  meta: SelfmadeToolMeta,
  dir: string,
  runtime: SelfmadeToolRuntime,
): ToolDefinition {
  // 声明式工具的超时是作者声明的执行预算；代码工具的合作式超时由宿主策略决定。
  const timeoutMs = meta.kind === 'shell' ? meta.shell?.timeoutMs : meta.kind === 'http' ? meta.http?.timeoutMs : undefined

  return {
    name: meta.name,
    description: meta.description,
    // 描述来自磁盘 JSON，已在 meta.ts 用官方断言收窄过子集；这里只做类型投影。
    parameters: meta.parameters as unknown as ToolDefinition['parameters'],
    ...timeoutMs === undefined ? {} : { timeoutMs },
    output: {
      schema: meta.output.schema as unknown as ToolDefinition['output']['schema'],
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) ?? 'null' }],
    },
    async execute(rawArgs, exec) {
      const context = exec as unknown as { agent?: unknown; signal: AbortSignal }
      const args = asArgumentObject(rawArgs)
      if (context.signal?.aborted) throw context.signal.reason

      if (meta.kind === 'shell' && meta.shell !== undefined) {
        return await runShellTool(meta.shell, args, undefined, context.signal)
      }
      if (meta.kind === 'http' && meta.http !== undefined) {
        return await runHttpTool(meta.http, args, { signal: context.signal })
      }
      if (meta.kind === 'code') {
        const workspace = await resolveWorkspace(runtime, context.agent, context.signal)
        return await runCodeTool(dir, args, {
          signal: context.signal,
          stateDir: runtime.stateDir,
          ...workspace === undefined ? {} : { workspace },
        })
      }
      throw new Error(`自建工具 "${meta.name}" 缺少执行描述：kind 为 ${meta.kind} 但没有对应配置`)
    },
  }
}

/** 工具参数在协议上永远是对象；模型给出别的东西时直接说明，而不是静默当作空对象。 */
function asArgumentObject(rawArgs: unknown): Record<string, unknown> {
  if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
    return rawArgs as Record<string, unknown>
  }
  throw new Error('自建工具的参数必须是对象：请按 meta.json 声明的 parameters 传参')
}

/** 目录解析失败只影响「工具能不能拿到工作目录」，不该让一次调用整体失败。 */
async function resolveWorkspace(
  runtime: SelfmadeToolRuntime,
  agent: unknown,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (runtime.workspaceOf === undefined) return undefined
  try {
    return await runtime.workspaceOf(agent, signal)
  } catch {
    return undefined
  }
}
