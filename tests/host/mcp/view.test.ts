// tests/host/mcp/view.test.ts
//
// 官方管理器的事实（列表 + 配置）如何合并成界面列表：状态点、摘要、
// 「能否编辑」都由这一层决定，界面不再自己推断。

import { describe, expect, it } from 'vitest'
import { buildMcpServerViews } from '../../../src/host/mcp/view.ts'
import type { McpServersMap } from '../../../src/host/mcp/actions.ts'

describe('配置条目', () => {
  it('已连接：状态连通并带工具数量', () => {
    const views = buildMcpServerViews({
      managed: [{ name: 'playwright', configured: true, status: { state: 'connected', toolCount: 22, connectedAt: 1 } }],
      servers: {
        playwright: { transport: 'stdio', command: 'cmd.exe', args: ['/d', '/c', 'npx', '-y', 'pkg'], env: {}, enabled: true },
      },
    })

    expect(views).toEqual([{
      name: 'playwright',
      configured: true,
      registered: false,
      enabled: true,
      transport: 'stdio',
      target: 'cmd.exe /d /c npx -y pkg',
      state: 'connected',
      toolCount: 22,
      entry: { transport: 'stdio', command: 'cmd.exe', args: ['/d', '/c', 'npx', '-y', 'pkg'], env: {} },
    }])
  })

  it('停用：状态是 disabled，启用意图为 false', () => {
    const [view] = buildMcpServerViews({
      managed: [{ name: 'kino', configured: true, status: { state: 'disabled' } }],
      servers: { kino: { transport: 'stdio', command: 'D:\\kino.exe', args: [], env: {}, enabled: false } },
    })

    expect(view).toMatchObject({ state: 'disabled', enabled: false, target: 'D:\\kino.exe' })
  })

  it('失败：带出诊断原文', () => {
    const [view] = buildMcpServerViews({
      managed: [{ name: 'x', configured: true, status: { state: 'failed', reason: 'gave-up', lastError: 'spawn ENOENT' } }],
      servers: { x: { transport: 'streamable-http', url: 'https://x.example/mcp', headers: {}, enabled: true } },
    })

    expect(view).toMatchObject({ state: 'failed', lastError: 'spawn ENOENT', transport: 'streamable-http', target: 'https://x.example/mcp' })
  })

  it('等待凭据与重连都是独立状态', () => {
    const views = buildMcpServerViews({
      managed: [
        { name: 'a', configured: true, status: { state: 'waiting-credentials', lastError: 'missing MCP_TOKEN' } },
        { name: 'b', configured: true, status: { state: 'reconnecting', attempt: 2, maxAttempts: 10, nextRetryAtMs: 0, lastError: 'boom' } },
      ],
      servers: {
        a: { transport: 'streamable-http', url: 'https://a.example/mcp', headers: { Authorization: 'Bearer ${credential:MCP_TOKEN}' }, enabled: true },
        b: { transport: 'stdio', command: 'node', args: ['b.js'], env: {}, enabled: true },
      },
    })

    expect(views.map(view => view.state)).toEqual(['waiting-credentials', 'reconnecting'])
    expect(views[0]?.lastError).toBe('missing MCP_TOKEN')
  })
})

describe('注册条目与残留条目', () => {
  it('插件注册的服务器可列出但不可编辑', () => {
    const [view] = buildMcpServerViews({
      managed: [{ name: 'example', configured: true, status: { state: 'connected', toolCount: 3, connectedAt: 1 } }],
      servers: {},
    })

    expect(view).toMatchObject({ name: 'example', configured: true, registered: true, enabled: true, state: 'connected' })
    expect(view?.entry).toBeUndefined()
  })

  it('已删除但清理未完成的条目按未连接展示', () => {
    const [view] = buildMcpServerViews({
      managed: [{ name: 'gone', configured: false, status: { state: 'failed', reason: 'cleanup', result: { closeConfirmed: false } } }],
      servers: {},
    })

    expect(view).toMatchObject({ name: 'gone', configured: false, registered: false, enabled: false, state: 'failed' })
  })

  it('未知状态按未连接处理，不让界面显示一个不存在的绿点', () => {
    const [view] = buildMcpServerViews({
      managed: [{ name: 'odd', configured: true, status: { state: 'something-new' } }],
      servers: {},
    })

    expect(view).toMatchObject({ state: 'closed', registered: true })
  })
})

describe('顺序与空列表', () => {
  it('保持官方列表顺序：配置在前，注册与残留随后', () => {
    const servers: McpServersMap = {
      first: { transport: 'stdio', command: 'node', args: [], env: {}, enabled: true },
      second: { transport: 'stdio', command: 'node', args: [], env: {}, enabled: true },
    }
    const views = buildMcpServerViews({
      managed: [
        { name: 'first', configured: true, status: { state: 'connecting', attempt: 0 } },
        { name: 'second', configured: true, status: { state: 'connecting', attempt: 0 } },
        { name: 'registered', configured: true, status: { state: 'connected', toolCount: 1, connectedAt: 1 } },
      ],
      servers,
    })

    expect(views.map(view => view.name)).toEqual(['first', 'second', 'registered'])
  })

  it('没有服务器时返回空数组', () => {
    expect(buildMcpServerViews({ managed: [], servers: {} })).toEqual([])
  })
})
