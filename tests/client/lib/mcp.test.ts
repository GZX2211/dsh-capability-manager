// tests/client/lib/mcp.test.ts
//
// MCP 分区的纯逻辑：筛选、状态点、编辑草稿与导入预览。
// 组件只消费这些结果，所以这里保护的是「界面上看到什么」。

import { describe, expect, it } from 'vitest'
import {
  emptyMcpForm,
  filterMcpServers,
  formOfView,
  importPreview,
  issueLabelKey,
  mcpStateDot,
  mcpStateLabelKey,
  type McpFilterValue,
} from '../../../src/client/lib/mcp.ts'
import type { McpServerView } from '../../../src/shared/mcp.ts'

function view(overrides: Partial<McpServerView> = {}): McpServerView {
  return {
    name: 'playwright',
    configured: true,
    registered: false,
    enabled: true,
    transport: 'stdio',
    target: 'npx -y @playwright/mcp@latest',
    state: 'connected',
    ...overrides,
  }
}

const SERVERS: McpServerView[] = [
  view(),
  view({ name: 'kino', state: 'disabled', enabled: false, target: 'D:\\kinocut\\kino.exe' }),
  view({ name: 'remote', transport: 'streamable-http', state: 'failed', target: 'https://mcp.example.com/mcp' }),
  view({ name: 'example', registered: true, state: 'connected', target: '' }),
]

describe('筛选', () => {
  const namesOf = (filter: McpFilterValue, query = ''): string[] =>
    filterMcpServers(SERVERS, filter, query).map(server => server.name)

  it('全部按名称排序', () => {
    expect(namesOf('all')).toEqual(['example', 'kino', 'playwright', 'remote'])
  })

  it('已连接只给出 connected', () => {
    expect(namesOf('connected')).toEqual(['example', 'playwright'])
  })

  it('未连接包含停用、失败与连接中', () => {
    expect(namesOf('disconnected')).toEqual(['kino', 'remote'])
  })

  it('搜索命中名称与连接目标', () => {
    expect(namesOf('all', 'PLAY')).toEqual(['playwright'])
    expect(namesOf('all', 'mcp.example')).toEqual(['remote'])
    expect(namesOf('all', 'kinocut')).toEqual(['kino'])
  })

  it('搜索词首尾空白被忽略，空搜索命中全部', () => {
    expect(namesOf('all', '   ')).toEqual(['example', 'kino', 'playwright', 'remote'])
  })
})

describe('状态点', () => {
  it('已连接是绿点，停用与关闭是灰点', () => {
    expect(mcpStateDot('connected')).toBe('done')
    expect(mcpStateDot('disabled')).toBe('idle')
    expect(mcpStateDot('closed')).toBe('idle')
  })

  it('进行中是转圈，等待凭据是警告，失败是红点', () => {
    expect(mcpStateDot('connecting')).toBe('ongoing')
    expect(mcpStateDot('reconnecting')).toBe('ongoing')
    expect(mcpStateDot('waiting-credentials')).toBe('warning')
    expect(mcpStateDot('failed')).toBe('error')
  })

  it('每种状态都有文案键', () => {
    for (const state of ['connected', 'connecting', 'reconnecting', 'waiting-credentials', 'failed', 'closed', 'disabled'] as const) {
      expect(mcpStateLabelKey(state)).toMatch(/^mcpState/)
    }
  })
})

describe('编辑草稿', () => {
  it('配置条目回填名称与命令', () => {
    const form = formOfView(view({
      name: 'files',
      entry: { transport: 'stdio', command: 'node', args: ['D:\\mcp\\files.js'], env: { ROOT: 'D:\\work' } },
    }))

    expect(form).toEqual({
      name: 'files',
      transport: 'stdio',
      commandLine: 'node D:\\mcp\\files.js',
      env: '{"ROOT":"D:\\\\work"}',
      url: '',
      headers: '',
    })
  })

  it('远程条目回填 URL 与请求头', () => {
    const form = formOfView(view({
      name: 'remote',
      transport: 'streamable-http',
      entry: { transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } },
    }))

    expect(form).toMatchObject({ transport: 'streamable-http', commandLine: '', url: 'https://mcp.example.com/mcp' })
    expect(form.headers).toBe('{"Authorization":"Bearer x"}')
  })

  it('注册条目没有可编辑字段，回填空表单但保留名称', () => {
    const form = formOfView(view({ name: 'example', registered: true }))

    expect(form).toEqual({ name: 'example', transport: 'stdio', commandLine: '', env: '', url: '', headers: '' })
  })

  it('新建草稿默认为 stdio 且没有名称', () => {
    expect(emptyMcpForm()).toEqual({ name: '', transport: 'stdio', commandLine: '', env: '', url: '', headers: '' })
    expect(emptyMcpForm('', 'streamable-http').transport).toBe('streamable-http')
  })
})

describe('问题码文案键', () => {
  it('每个表单问题都有对应键', () => {
    for (const issue of ['name-empty', 'name-invalid', 'command-missing', 'url-missing', 'url-invalid', 'env-invalid', 'headers-invalid'] as const) {
      expect(issueLabelKey(issue)).toMatch(/^mcpIssue/)
    }
  })
})

describe('导入预览', () => {
  it('成功时给出每台服务器的名称、传输方式与目标', () => {
    const preview = importPreview(JSON.stringify({
      mcpServers: {
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
        remote: { url: 'https://mcp.example.com/mcp' },
      },
    }))

    expect(preview).toEqual({
      ok: true,
      rows: [
        { name: 'playwright', transport: 'stdio', target: 'npx -y @playwright/mcp@latest' },
        { name: 'remote', transport: 'streamable-http', target: 'https://mcp.example.com/mcp' },
      ],
    })
  })

  it('失败时给出原因码，交给词典翻译', () => {
    expect(importPreview('')).toEqual({ ok: false, reason: 'empty' })
    expect(importPreview('{oops')).toMatchObject({ ok: false, reason: 'invalid-json' })
    expect(importPreview('{"mcpServers":{}}')).toEqual({ ok: false, reason: 'no-servers' })
  })

  it('sse 传输在预览阶段就被拒', () => {
    expect(importPreview(JSON.stringify({ mcpServers: { old: { type: 'sse', url: 'https://x/sse' } } })))
      .toMatchObject({ ok: false, reason: 'unsupported-transport' })
  })
})
