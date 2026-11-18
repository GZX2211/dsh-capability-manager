// tests/host/mcp/actions.test.ts
//
// 一次界面动作对「配置里的服务器映射」做了什么：这是写盘前的最后一次内容变换，
// 必须保持不可变、保留官方未展示字段，并在传输方式切换时清掉另一侧的字段。

import { describe, expect, it } from 'vitest'
import { applyMcpAction, type McpServersMap } from '../../../src/host/mcp/actions.ts'

function existing(): McpServersMap {
  return {
    playwright: {
      transport: 'stdio',
      command: 'cmd.exe',
      args: ['/d', '/c', 'npx', '-y', '@playwright/mcp@latest'],
      env: {},
      enabled: true,
      toolCallTimeoutMs: 90_000,
    },
    kino: {
      transport: 'stdio',
      command: 'D:\\kinocut\\kino.exe',
      args: [],
      env: {},
      enabled: false,
    },
  }
}

describe('保存服务器', () => {
  it('新名称新增一条并默认启用', () => {
    const outcome = applyMcpAction(existing(), {
      op: 'save',
      form: { name: 'files', transport: 'stdio', commandLine: 'npx -y @modelcontextprotocol/server-filesystem', env: '', url: '', headers: '' },
    }, 'linux')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.servers.files).toMatchObject({ transport: 'stdio', command: 'npx', enabled: true })
  })

  it('覆盖既有条目时保留启用意图与官方未展示字段', () => {
    const outcome = applyMcpAction(existing(), {
      op: 'save',
      form: { name: 'kino', transport: 'stdio', commandLine: 'D:\\kinocut\\kino.exe --verbose', env: '', url: '', headers: '' },
    }, 'win32')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.servers.kino).toMatchObject({ enabled: false, args: ['--verbose'] })
  })

  it('stdio 保存会清掉上一次 http 残留的 url 与 headers', () => {
    const servers: McpServersMap = {
      remote: { transport: 'streamable-http', url: 'https://old.example/mcp', headers: { A: '1' }, enabled: true },
    }
    const outcome = applyMcpAction(servers, {
      op: 'save',
      form: { name: 'remote', transport: 'stdio', commandLine: 'node x.js', env: '', url: '', headers: '' },
    }, 'linux')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.servers.remote).not.toHaveProperty('url')
    expect(outcome.servers.remote).not.toHaveProperty('headers')
  })

  it('http 保存会清掉另一侧的 command 与 args', () => {
    const servers: McpServersMap = {
      remote: { transport: 'stdio', command: 'node', args: ['x.js'], env: {}, enabled: true },
    }
    const outcome = applyMcpAction(servers, {
      op: 'save',
      form: { name: 'remote', transport: 'streamable-http', commandLine: '', env: '', url: 'https://mcp.example.com/mcp', headers: '' },
    }, 'linux')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.servers.remote).toMatchObject({ transport: 'streamable-http', url: 'https://mcp.example.com/mcp' })
    expect(outcome.servers.remote).not.toHaveProperty('command')
    expect(outcome.servers.remote).not.toHaveProperty('args')
  })

  it('非法表单被拒绝并带出问题码', () => {
    const outcome = applyMcpAction(existing(), {
      op: 'save',
      form: { name: 'a.b', transport: 'stdio', commandLine: '', env: '', url: '', headers: '' },
    }, 'linux')

    expect(outcome).toMatchObject({ ok: false, code: 'bad-request' })
    if (outcome.ok) return
    expect(outcome.issues).toEqual(['name-invalid', 'command-missing'])
  })

  it('不修改传入的映射', () => {
    const servers = existing()
    const snapshot = structuredClone(servers)

    applyMcpAction(servers, { op: 'toggle', name: 'playwright', enabled: false })

    expect(servers).toEqual(snapshot)
  })
})

describe('启停服务器', () => {
  it('切换一条既有服务器的启用意图', () => {
    const outcome = applyMcpAction(existing(), { op: 'toggle', name: 'playwright', enabled: false })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.servers.playwright).toMatchObject({ enabled: false })
    expect(outcome.servers.playwright).toMatchObject({ command: 'cmd.exe' })
  })

  it('未知名称是稳定错误，而不是静默新增', () => {
    const outcome = applyMcpAction(existing(), { op: 'toggle', name: 'nope', enabled: true })

    expect(outcome).toMatchObject({ ok: false, code: 'unknown-server' })
  })
})

describe('删除服务器', () => {
  it('删掉一条并保留其余', () => {
    const outcome = applyMcpAction(existing(), { op: 'delete', name: 'kino' })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(Object.keys(outcome.servers)).toEqual(['playwright'])
  })

  it('未知名称是稳定错误', () => {
    expect(applyMcpAction(existing(), { op: 'delete', name: 'nope' })).toMatchObject({ ok: false, code: 'unknown-server' })
  })
})

describe('批量导入', () => {
  it('一次写入多台，新条目默认启用', () => {
    const json = JSON.stringify({
      mcpServers: {
        a: { command: 'node', args: ['a.js'] },
        b: { url: 'https://b.example/mcp' },
      },
    })
    const outcome = applyMcpAction(existing(), { op: 'import', json })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.changed).toEqual(['a', 'b'])
    expect(outcome.servers.a).toMatchObject({ enabled: true })
    expect(outcome.servers.b).toMatchObject({ transport: 'streamable-http' })
  })

  it('同名条目覆盖内容但保留原有启用意图', () => {
    const json = JSON.stringify({ mcpServers: { kino: { command: 'D:\\kinocut\\kino.exe', args: ['--new'] } } })
    const outcome = applyMcpAction(existing(), { op: 'import', json })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.servers.kino).toMatchObject({ enabled: false, args: ['--new'] })
  })

  it('解析失败时带出导入原因', () => {
    const outcome = applyMcpAction(existing(), { op: 'import', json: '{}' })

    expect(outcome).toMatchObject({ ok: false, code: 'bad-request' })
    if (outcome.ok) return
    expect(outcome.reason).toBe('no-servers')
  })
})
