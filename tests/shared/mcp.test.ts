// tests/shared/mcp.test.ts
//
// MCP 契约的纯函数：两端（Host 写前校验 / Client 表单预校验）共用同一份判定，
// 这里保护的是「同一条配置在弹窗与磁盘上被判成一样」。

import { describe, expect, it } from 'vitest'
import {
  formFromEntry,
  isValidServerName,
  joinCommandLine,
  normalizeServerName,
  parseJsonObject,
  parseMcpJson,
  splitCommandLine,
  targetOf,
  validateMcpForm,
  type McpForm,
} from '../../src/shared/mcp.ts'

function form(overrides: Partial<McpForm> = {}): McpForm {
  return { name: 'playwright', transport: 'stdio', commandLine: 'npx -y @playwright/mcp@latest', env: '', url: '', headers: '', ...overrides }
}

describe('服务器名称', () => {
  it('只接受 1–32 位字母、数字、下划线与连字符', () => {
    expect(isValidServerName('playwright')).toBe(true)
    expect(isValidServerName('code_graph-2')).toBe(true)
    expect(isValidServerName('a'.repeat(32))).toBe(true)
  })

  it('空名、超长、空格、点号、中文都不合法', () => {
    expect(isValidServerName('')).toBe(false)
    expect(isValidServerName('a'.repeat(33))).toBe(false)
    expect(isValidServerName('my server')).toBe(false)
    expect(isValidServerName('a.b')).toBe(false)
    expect(isValidServerName('服务器')).toBe(false)
  })

  it('规范化替换非法字符并截断到 32 位', () => {
    expect(normalizeServerName('  my server  ')).toBe('my-server')
    expect(normalizeServerName('a.b')).toBe('a-b')
    expect(normalizeServerName('x'.repeat(40))).toBe('x'.repeat(32))
  })

  it('全非法输入退化为固定兜底名', () => {
    expect(normalizeServerName('中文')).toBe('mcp')
    expect(normalizeServerName('   ')).toBe('mcp')
  })
})

describe('命令行拆分与拼装', () => {
  it('按空白拆分并去掉首尾空白', () => {
    expect(splitCommandLine('  npx  -y   pkg ')).toEqual(['npx', '-y', 'pkg'])
  })

  it('引号内的空白属于同一个 token', () => {
    expect(splitCommandLine('"C:\\Program Files\\node.exe" script.js')).toEqual(['C:\\Program Files\\node.exe', 'script.js'])
    expect(splitCommandLine("node 'a b.js'")).toEqual(['node', 'a b.js'])
  })

  it('空行拆成空数组', () => {
    expect(splitCommandLine('   ')).toEqual([])
  })

  it('含空格的 token 拼装时加引号，往返一致', () => {
    const line = joinCommandLine('C:\\Program Files\\node.exe', ['a b.js', '--flag'])
    expect(line).toBe('"C:\\Program Files\\node.exe" "a b.js" --flag')
    expect(splitCommandLine(line)).toEqual(['C:\\Program Files\\node.exe', 'a b.js', '--flag'])
  })

  it('无特殊字符的 token 不加引号', () => {
    expect(joinCommandLine('node', ['D:\\mcp\\index.js'])).toBe('node D:\\mcp\\index.js')
  })
})

describe('JSON 对象解析', () => {
  it('空文本视为空对象', () => {
    expect(parseJsonObject('   ')).toEqual({ ok: true, value: {} })
  })

  it('对象解析为字符串字典', () => {
    expect(parseJsonObject('{"A":"1","B":"2"}')).toEqual({ ok: true, value: { A: '1', B: '2' } })
  })

  it('数组与非法 JSON 都是失败', () => {
    expect(parseJsonObject('[1,2]')).toEqual({ ok: false })
    expect(parseJsonObject('{A:1}')).toEqual({ ok: false })
  })
})

describe('表单校验', () => {
  it('合法的 stdio 表单没有问题', () => {
    expect(validateMcpForm(form())).toEqual([])
  })

  it('名称缺失与名称非法分别报告', () => {
    expect(validateMcpForm(form({ name: '' }))).toContain('name-empty')
    expect(validateMcpForm(form({ name: 'a.b' }))).toContain('name-invalid')
  })

  it('stdio 缺命令时不通过', () => {
    expect(validateMcpForm(form({ commandLine: '   ' }))).toContain('command-missing')
  })

  it('streamable-http 要求合法 URL', () => {
    expect(validateMcpForm(form({ transport: 'streamable-http', url: '' }))).toContain('url-missing')
    expect(validateMcpForm(form({ transport: 'streamable-http', url: 'mcp.example.com' }))).toContain('url-invalid')
    expect(validateMcpForm(form({ transport: 'streamable-http', url: 'https://mcp.example.com/mcp' }))).toEqual([])
  })

  it('环境变量文本非法时报告', () => {
    expect(validateMcpForm(form({ env: '{"A":1}' }))).toContain('env-invalid')
  })

  it('请求头文本非法时报告', () => {
    expect(validateMcpForm(form({
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: 'not json',
    }))).toContain('headers-invalid')
  })
})

describe('mcp.json 导入投影', () => {
  it('读取 mcpServers 里的全部服务器', () => {
    const text = JSON.stringify({
      mcpServers: {
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless'] },
        files: { command: 'node', args: ['D:\\mcp\\files.js'], env: { ROOT: 'D:\\work' } },
      },
    })
    const result = parseMcpJson(text)

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.entries.map(item => item.name)).toEqual(['playwright', 'files'])
    expect(result.entries[0]?.entry).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--headless'],
      env: {},
    })
    const second = result.entries[1]?.entry
    expect(second?.transport === 'stdio' ? second.env : undefined).toEqual({ ROOT: 'D:\\work' })
  })

  it('读取 VS Code 风格的 servers 映射', () => {
    const result = parseMcpJson(JSON.stringify({
      servers: { remote: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } } },
    }))

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.entries[0]?.entry).toEqual({
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    })
  })

  it('单个服务器对象按一条导入', () => {
    const result = parseMcpJson(JSON.stringify({ name: 'solo', command: 'node', args: ['x.js'] }))

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.name).toBe('solo')
  })

  it('顶层 name → 条目映射按多条导入', () => {
    const result = parseMcpJson(JSON.stringify({ a: { command: 'node' }, b: { url: 'https://x.example/mcp' } }))

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.entries.map(item => item.name)).toEqual(['a', 'b'])
    expect(result.entries[1]?.entry.transport).toBe('streamable-http')
  })

  it('空文本、非法 JSON、空服务器集合各有失败原因', () => {
    expect(parseMcpJson('  ')).toMatchObject({ ok: false, reason: 'empty' })
    expect(parseMcpJson('{oops')).toMatchObject({ ok: false, reason: 'invalid-json' })
    expect(parseMcpJson('{"mcpServers":{}}')).toMatchObject({ ok: false, reason: 'no-servers' })
  })

  it('sse 传输被拒绝并说明', () => {
    const result = parseMcpJson(JSON.stringify({ mcpServers: { old: { type: 'sse', url: 'https://x.example/sse' } } }))

    expect(result).toMatchObject({ ok: false, reason: 'unsupported-transport' })
    if (result.ok || result.reason !== 'unsupported-transport') return
    expect(result.detail).toContain('old')
  })

  it('条目既无 command 也无 url 时报告', () => {
    expect(parseMcpJson(JSON.stringify({ mcpServers: { broken: { args: ['x'] } } })))
      .toMatchObject({ ok: false, reason: 'no-endpoint' })
  })
})

describe('条目 → 表单回填', () => {
  it('stdio 命令拼回一整行，环境变量转成 JSON 文本', () => {
    const filled = formFromEntry('matrixmedia', {
      transport: 'stdio',
      command: 'node',
      args: ['D:\\matrixmedia\\dist\\index.js'],
      env: { MATRIXMEDIA_DIR: 'D:\\matrixmedia' },
    })

    expect(filled).toEqual({
      name: 'matrixmedia',
      transport: 'stdio',
      commandLine: 'node D:\\matrixmedia\\dist\\index.js',
      env: '{"MATRIXMEDIA_DIR":"D:\\\\matrixmedia"}',
      url: '',
      headers: '',
    })
  })

  it('streamable-http 回填 url 与请求头', () => {
    const filled = formFromEntry('remote', {
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    })

    expect(filled).toEqual({
      name: 'remote',
      transport: 'streamable-http',
      commandLine: '',
      env: '',
      url: 'https://mcp.example.com/mcp',
      headers: '{"Authorization":"Bearer x"}',
    })
  })

  it('缺少传输字段时按 stdio 处理，空集合回填空文本', () => {
    const filled = formFromEntry('legacy', { command: 'node', args: ['x.js'], env: {} })

    expect(filled.transport).toBe('stdio')
    expect(filled.env).toBe('')
    expect(filled.headers).toBe('')
  })
})

describe('条目摘要', () => {
  it('stdio 摘要是一整行命令', () => {
    expect(targetOf({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: {},
      cwd: '',
      url: '',
      headers: {},
    })).toBe('npx -y @playwright/mcp@latest')
  })

  it('streamable-http 摘要是 URL', () => {
    expect(targetOf({
      transport: 'streamable-http',
      command: '',
      args: [],
      env: {},
      cwd: '',
      url: 'https://mcp.example.com/mcp',
      headers: {},
    })).toBe('https://mcp.example.com/mcp')
  })
})
