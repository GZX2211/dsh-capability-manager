// src/host/roles/resolve.ts
//
// 会话角色的判定：优先问 Personal Agent 的只读服务，其次用手动绑定。
//
// 依赖方向是单向的：本插件探测 `ctx.paRoles`，PA 永远不知道谁在读它。
// 服务缺席、账本未就绪、返回了不认识的值，一律按「未知角色」处理——
// 未知角色不应用任何黑名单，宁可多给能力也不凭猜测禁用。

import type { SessionRoleName } from '../../shared/config.ts'

/** `ctx.paRoles` 的最小形状；用结构守卫收窄，不 import PA 的类型。 */
interface PaRolesLike {
  roleOf?: (sessionId: string) => unknown
}

export interface RoleResolver {
  /** 是否检测到 `ctx.paRoles` 服务；界面据此决定是否显示黑名单区。 */
  readonly available: boolean
  /**
   * 判定会话角色。
   * @param sessionId - 会话身份。
   * @returns 角色，或 `undefined` 表示未知。
   */
  roleOf(sessionId: string): SessionRoleName | undefined
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

  return {
    get available() {
      return probe()?.roleOf !== undefined
    },
    roleOf(sessionId) {
      let reported: unknown
      try {
        reported = probe()?.roleOf?.(sessionId)
      } catch {
        // PA 账本未就绪时会拒绝查询；这里降级为「未知角色」而不是让调用方崩溃。
        reported = undefined
      }
      if (reported === 'router' || reported === 'worker') return reported
      return options.bindings()[sessionId]
    },
  }
}
