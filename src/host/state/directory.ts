// src/host/state/directory.ts
//
// 插件私有状态目录：配置、模型与自建能力都落在它下面。

import { homedir } from 'node:os'
import { join } from 'node:path'

/** 状态目录的默认名称。 */
export const STATE_FOLDER = 'capability-manager'

/**
 * 状态目录的默认值：`<DSH_HOME>/state/capability-manager`。
 *
 * profile 启动的 Harness 一定带着 `DSH_HOME`；没有它时（无 profile 启动）退回
 * `~/.dsh`，与 DSH 自己的默认根一致，避免写到进程工作目录里。
 *
 * @param override - 配置里给出的覆盖路径；空白视为未给出。
 * @returns 绝对路径。
 */
export function resolveStateDirectory(override?: string): string {
  const configured = override?.trim()
  if (configured !== undefined && configured.length > 0) return configured
  const home = process.env.DSH_HOME?.trim()
  const root = home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh')
  return join(root, 'state', STATE_FOLDER)
}
