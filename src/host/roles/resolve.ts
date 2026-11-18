// src/host/roles/resolve.ts
//
// 会话角色的判定：优先问 Personal Agent 的只读服务，其次用手动绑定。
//
// 依赖方向是单向的：本插件探测 `ctx.paRoles`，PA 永远不知道谁在读它。
// 服务缺席、账本未就绪、返回了不认识的值，一律按「未知角色」处理——
// 未知角色不应用任何黑名单，宁可多给能力也不凭猜测禁用。

import type { RoleSource, SessionRoleName } from '../../shared/config.ts'

/** `ctx.paRoles` 的最小形状；用结构守卫收窄，不 import PA 的类型。 */
interface PaRolesLike {
  roleOf?: (sessionId: string) => unknown
}

/** 一次角色判定的结果：角色本身与它来自哪里。 */
export interface RoleResolution {
  /** 角色；`undefined` 表示未知。 */
  role: SessionRoleName | undefined
  /** 判定来源，界面据此区分「PA 判定」「手动绑定」与「未知」。 */
  source: RoleSource
}

export interface RoleResolver {
  /** 是否检测到 `ctx.paRoles` 服务；界面据此决定是否显示角色区。 */
  readonly available: boolean
  /**
   * 判定会话角色。
   * @param sessionId - 会话身份。
   * @returns 角色，或 `undefined` 表示未知。
   */
  roleOf(sessionId: string): SessionRoleName | undefined
  /**
   * 判定会话角色并给出来源。
   * @param sessionId - 会话身份。
   * @returns 角色与来源。
   */
  resolve(sessionId: string): RoleResolution
}

export interface RoleResolverOptions {
  /** 读一个候选能力服务；不存在时返回 undefined。 */
  lookup: (name: string) => unknown
  /** 手动绑定；`paRoles` 未给出答案时使用。 */
  bindings: () => Readonly<Record<string, SessionRoleName>>
}

/**
 * 建立角色解析器。
 *
 * 服务每次调用都重新探测：PA 可能比本插件晚加载，缓存「没有服务」会让黑名单
 * 在本次进程里永久失效。
 *
 * @param options - 服务查找与手动绑定来源。
 * @returns 只读解析器。
 */
export function createRoleResolver(options: RoleResolverOptions): RoleResolver {
  const probe = (): PaRolesLike | undefined => {
    const service = options.lookup('paRoles')
    return typeof service === 'object' && service !== null ? (service as PaRolesLike) : undefined
  }

  const resolve = (sessionId: string): RoleResolution => {
    let reported: unknown
    try {
      reported = probe()?.roleOf?.(sessionId)
    } catch {
      // PA 账本未就绪时会拒绝查询；这里降级为「未知角色」而不是让调用方崩溃。
      reported = undefined
    }
    if (reported === 'router' || reported === 'worker') return { role: reported, source: 'pa' }

    // 手动绑定只补 PA 没有答案的会话：PA 的工单绑定是权威事实，
    // 两处都猜的时候以它为准，避免「界面写的和实际生效的不一致」。
    const bound = options.bindings()[sessionId]
    if (bound === 'router' || bound === 'worker') return { role: bound, source: 'binding' }
    return { role: undefined, source: 'unknown' }
  }

  return {
    get available() {
      return probe()?.roleOf !== undefined
    },
    roleOf(sessionId) {
      return resolve(sessionId).role
    },
    resolve,
  }
}
