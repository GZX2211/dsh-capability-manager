// tests/host/mcp/bridge.test.ts
//
// 运行时桥：官方 MCP 管理器与配置编辑器都是可选服务，缺任何一个都要给出
// 「为什么不可用」而不是空列表；写入必须经 configEditor 的同一事务，
// 让 Loader 热对账，而不是自己写 profile 文件。

import { describe, expect, it, vi } from 'vitest'
import { readMcpServers, writeMcpServers, type BridgeContext } from '../../../src/host/mcp/bridge.ts'
import { ERROR_CODES } from '../../../src/shared/api.ts'

const SERVERS = {
  playwright: {
    transport: 'stdio',
    command: 'cmd.exe',
    args: ['/d', '/c', 'npx', '-y', '@playwright/mcp@latest'],
    env: {},
    enabled: true,
  },
}

function makeContext(options: {
  manager?: unknown
  editor?: unknown
  config?: Record<string, unknown>
}): BridgeContext {
  return {
    get: (name: string) => (name === 'mcpManager' ? options.manager : name === 'configEditor' ? options.editor : undefined),
  }
}

function makeManager(options: {
  servers?: Record<string, unknown>
  list?: () => unknown
} = {}): unknown {
  return {
    list: options.list ?? (() => [
      { name: 'playwright', configured: true, status: { state: 'connected', toolCount: 7, connectedAt: 1 } },
    ]),
    config: { servers: { get: () => options.servers ?? SERVERS } },
  }
}

function makeEditor(options: {
  entries?: readonly unknown[]
  edit?: (entry: unknown, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) => Promise<void>
} = {}): unknown {
  return {
    entries: () => options.entries ?? [{ options: { id: 'mcp-manager', name: '@deepseek-ai/dsh-mcp-manager' } }],
    edit: options.edit ?? (async () => undefined),
  }
}

describe('读取 MCP 列表', () => {
  it('管理器缺席时报告不可用而不是空列表', async () => {
    const response = await readMcpServers(makeContext({}))

    expect(response).toEqual({ available: false, writable: false, servers: [], unavailableReason: 'manager-absent' })
  })

  it('缺少配置编辑器时仍可列出，但标记为只读', async () => {
    const response = await readMcpServers(makeContext({ manager: makeManager() }))

    expect(response).toMatchObject({ available: true, writable: false, unavailableReason: 'editor-absent' })
    expect(response.servers).toHaveLength(1)
    expect(response.servers[0]).toMatchObject({ name: 'playwright', state: 'connected', toolCount: 7 })
  })

  it('两个服务都在时给出可写视图', async () => {
    const response = await readMcpServers(makeContext({ manager: makeManager(), editor: makeEditor() }))

    expect(response).toMatchObject({ available: true, writable: true })
    expect(response.unavailableReason).toBeUndefined()
    expect(response.servers[0]?.target).toBe('cmd.exe /d /c npx -y @playwright/mcp@latest')
  })

  it('运行时形状漂移按空配置降级，不让面板整页失败', async () => {
    const manager = { list: () => [{ name: 'x', configured: true, status: { state: 'connected', toolCount: 1 } }], config: {} }
    const response = await readMcpServers(makeContext({ manager }))

    expect(response.servers).toEqual([{
      name: 'x',
      configured: true,
      registered: true,
      enabled: true,
      transport: 'stdio',
      target: '',
      state: 'connected',
      toolCount: 1,
    }])
  })

  it('列表读取失败向上抛出，不伪装成没有服务器', async () => {
    const manager = makeManager({ list: () => { throw new Error('manager disposed') } })

    await expect(readMcpServers(makeContext({ manager }))).rejects.toThrow('manager disposed')
  })
})

describe('写入 MCP 配置', () => {
  it('缺少编辑器时返回 mcp-unavailable', async () => {
    const outcome = await writeMcpServers(makeContext({ manager: makeManager() }), { op: 'delete', name: 'playwright' })

    expect(outcome.status).toBe(503)
    expect(outcome.body).toMatchObject({ ok: false, code: ERROR_CODES.mcpUnavailable })
  })

  it('找不到官方管理器条目时返回 mcp-unavailable', async () => {
    const outcome = await writeMcpServers(
      makeContext({ manager: makeManager(), editor: makeEditor({ entries: [] }) }),
      { op: 'delete', name: 'playwright' },
    )

    expect(outcome.status).toBe(503)
    expect(outcome.body).toMatchObject({ ok: false, code: ERROR_CODES.mcpUnavailable })
  })

  it('保存经 configEditor 的 change 事务写入，并返回新列表', async () => {
    const edit = vi.fn(async (
      _entry: unknown,
      change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const current = { servers: SERVERS }
      expect(change(current, {})).toMatchObject({
        servers: {
          playwright: { enabled: true },
          files: { transport: 'stdio', command: 'npx', enabled: true },
        },
      })
    })
    const outcome = await writeMcpServers(
      makeContext({ manager: makeManager(), editor: makeEditor({ edit }) }),
      {
        op: 'save',
        form: { name: 'files', transport: 'stdio', commandLine: 'npx -y @modelcontextprotocol/server-filesystem', env: '', url: '', headers: '' },
      },
      'linux',
    )

    expect(edit).toHaveBeenCalledTimes(1)
    expect(outcome.status).toBe(200)
    expect(outcome.body).toMatchObject({ ok: true })
  })

  it('未知服务器返回 mcp-unknown-server', async () => {
    const outcome = await writeMcpServers(
      makeContext({ manager: makeManager(), editor: makeEditor() }),
      { op: 'toggle', name: 'nope', enabled: true },
    )

    expect(outcome.status).toBe(404)
    expect(outcome.body).toMatchObject({ ok: false, code: ERROR_CODES.mcpUnknownServer })
  })

  it('非法表单返回 mcp-invalid-entry 并带出问题码', async () => {
    const outcome = await writeMcpServers(
      makeContext({ manager: makeManager(), editor: makeEditor() }),
      { op: 'save', form: { name: 'a.b', transport: 'stdio', commandLine: '', env: '', url: '', headers: '' } },
      'linux',
    )

    expect(outcome.status).toBe(400)
    expect(outcome.body).toMatchObject({ ok: false, code: ERROR_CODES.mcpInvalidEntry, issues: ['name-invalid', 'command-missing'] })
  })

  it('导入失败返回 mcp-import-invalid 并带出原因', async () => {
    const outcome = await writeMcpServers(
      makeContext({ manager: makeManager(), editor: makeEditor() }),
      { op: 'import', json: '{"mcpServers":{}}' },
    )

    expect(outcome.status).toBe(400)
    expect(outcome.body).toMatchObject({ ok: false, code: ERROR_CODES.mcpImportInvalid, reason: 'no-servers' })
  })

  it('配置编辑器写入失败返回 mcp-write-failed 并带出原文', async () => {
    const edit = async (): Promise<void> => {
      throw new Error('servers.playwright: a stdio server requires "command"')
    }
    const outcome = await writeMcpServers(
      makeContext({ manager: makeManager(), editor: makeEditor({ edit }) }),
      { op: 'delete', name: 'playwright' },
    )

    expect(outcome.status).toBe(502)
    expect(outcome.body).toMatchObject({ ok: false, code: ERROR_CODES.mcpWriteFailed })
    expect((outcome.body as { message: string }).message).toContain('requires "command"')
  })

  it('请求体不是对象时返回 bad-request', async () => {
    const outcome = await writeMcpServers(makeContext({ manager: makeManager(), editor: makeEditor() }), 'nope')

    expect(outcome.status).toBe(400)
    expect(outcome.body).toMatchObject({ ok: false, code: ERROR_CODES.badRequest })
  })
})
