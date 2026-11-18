// src/host/mcp/entry.ts
//
// 表单草稿 → 官方配置条目。
//
// 校验口径来自 shared/mcp：Host 写入前与 Client 提交前用同一份判定，
// 因此这里不重复写「什么算合法」，只负责把合法草稿落成条目。
// 反向的回填（条目 → 表单）同样在 shared/mcp，界面与这里共用。

import {
  parseJsonObject,
  validateMcpForm,
  type McpEntryInput,
  type McpForm,
  type McpFormIssue,
} from '../../shared/mcp.ts'
import { resolveSpawnCommandLine } from './spawn.ts'

/** 转换结果：问题码不翻译，由界面词典给出文案。 */
export type EntryFromFormResult =
  | { ok: true; name: string; entry: McpEntryInput }
  | { ok: false; issues: McpFormIssue[] }

/**
 * 把一份通过校验的草稿落成配置条目。
 *
 * @param form - 表单草稿。
 * @param platform - 启动命令的目标平台；默认当前进程平台。
 * @returns 条目，或全部问题码。
 */
export function entryFromForm(form: McpForm, platform: string = process.platform): EntryFromFormResult {
  const issues = validateMcpForm(form)
  if (issues.length > 0) return { ok: false, issues }
  const name = String(form.name).trim()

  if (form.transport === 'streamable-http') {
    const headers = parseJsonObject(form.headers)
    return {
      ok: true,
      name,
      entry: {
        transport: 'streamable-http',
        url: String(form.url).trim(),
        // 校验已保证文本可解析；这里再取值的空对象只是类型上的兜底。
        headers: headers.ok ? headers.value : {},
      },
    }
  }

  const spawn = resolveSpawnCommandLine(form.commandLine, platform)
  const env = parseJsonObject(form.env)
  return {
    ok: true,
    name,
    entry: {
      transport: 'stdio',
      command: spawn.command,
      args: spawn.args,
      env: env.ok ? env.value : {},
    },
  }
}
