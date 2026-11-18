// tests/host/mcp/entry.test.ts
//
// 表单草稿与官方配置条目之间的转换：这里错了，界面保存出来的东西
// 要么被官方管理器拒绝，要么起不来进程。

import { describe, expect, it } from 'vitest'
import { entryFromForm } from '../../../src/host/mcp/entry.ts'
import type { McpForm } from '../../../src/shared/mcp.ts'

function form(overrides: Partial<McpForm> = {}): McpForm {
  return { name: 'playwright', transport: 'stdio', commandLine: 'npx -y @playwright/mcp@latest', env: '', url: '', headers: '', ...overrides }
}

describe('stdio 表单 → 条目', () => {
  it('Windows 上把裸命令展开成 cmd.exe 启动', () => {
    const result = entryFromForm(form(), 'win32')

    expect(result).toEqual({
      ok: true,
      name: 'playwright',
      entry: {
        transport: 'stdio',
        command: 'cmd.exe',
        args: ['/d', '/c', 'npx', '-y', '@playwright/mcp@latest'],
        env: {},
      },
    })
  })

  it('Unix 上原样保留 launcher', () => {
    const result = entryFromForm(form(), 'linux')

    expect(result).toMatchObject({ ok: true, entry: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } })
  })

  it('环境变量文本解析进条目', () => {
    const result = entryFromForm(form({ env: '{"ROOT":"D:\\\\work"}' }), 'win32')

    expect(result).toMatchObject({ ok: true, entry: { env: { ROOT: 'D:\\work' } } })
  })
})

describe('streamable-http 表单 → 条目', () => {
  it('只带 url 与 headers', () => {
    const result = entryFromForm(form({
      name: 'remote',
      transport: 'streamable-http',
      commandLine: 'ignored',
      url: 'https://mcp.example.com/mcp',
      headers: '{"Authorization":"Bearer x"}',
    }), 'win32')

    expect(result).toEqual({
      ok: true,
      name: 'remote',
      entry: {
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      },
    })
  })
})

describe('非法表单', () => {
  it('返回全部问题码且不产出条目', () => {
    const result = entryFromForm(form({ name: 'a.b', commandLine: '' }), 'win32')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual(['name-invalid', 'command-missing'])
  })
})
