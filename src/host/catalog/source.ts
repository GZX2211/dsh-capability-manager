// src/host/catalog/source.ts
//
// 能力来源判定：决定界面上的分组标签，以及这一项能不能被删除或编辑。
//
// MCP 工具名按官方 mcp-client 的约定形如 `<server>__<tool>`。判定必须完整匹配
// 服务器名前缀，否则叫 `github` 的服务器会把 `github_enterprise__x` 也算成自己的。

import type { CapabilitySource } from '../../shared/capability.ts'

export interface SourceContext {
  /** 本插件自建的能力名（运行期镜像，来自自建目录的扫描结果）。 */
  owned: ReadonlySet<string>
  /** 已连接的 MCP 服务器名。 */
  mcpServers: readonly string[]
}

/**
 * 判定一个能力的来源。
 *
 * 优先级：自建 > MCP > 官方。自建优先是刻意的——同名的自建能力覆盖同命名空间的
 * MCP 工具时，用户看到的应该是他刚创建的那个。
 *
 * @param name - 能力名。
 * @param context - 自建名单与已连接的 MCP 服务器。
 * @returns 来源分类。
 */
export function classifySource(name: string, context: SourceContext): CapabilitySource {
  if (context.owned.has(name)) return 'custom'
  for (const server of context.mcpServers) {
    // 空服务器名的前缀会退化成 "__"，把所有双下划线开头的名字都吃掉。
    if (server.length === 0) continue
    if (name.startsWith(`${server}__`)) return 'mcp'
  }
  return 'official'
}
