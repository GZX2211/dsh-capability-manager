// tests/host/selfmade/meta.test.ts
//
// 自建工具 `meta.json` 的收窄规则。这里是磁盘内容进入注册表的唯一入口：
// 放行一个不合法条目，代价是 `tools.register()` 抛错、整个工具静默消失。

import { describe, expect, it } from 'vitest'
import { parseToolMeta } from '../../../src/host/selfmade/meta.ts'

const BASE = {
  name: 'greet',
  description: '向某人打招呼',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { target: { type: 'string', description: '对方' } },
    required: ['target'],
  },
}

const context = { dirName: 'greet', hasImpl: false }

describe('meta.json 收窄', () => {
  it('接受声明式 shell 工具并补全默认值', () => {
    const result = parseToolMeta({ ...BASE, kind: 'shell', shell: { command: 'echo' } }, context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.kind).toBe('shell')
    expect(result.meta.shell).toEqual({ command: 'echo', args: [], timeoutMs: 30000 })
  })

  it('kind 缺省时按 impl.mjs 判定为代码工具', () => {
    const result = parseToolMeta(BASE, { dirName: 'greet', hasImpl: true })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.kind).toBe('code')
  })

  it('kind 缺省且没有 impl.mjs 时说明缺哪个字段', () => {
    const result = parseToolMeta(BASE, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('kind')
  })

  it('未知 kind 被拒绝', () => {
    const result = parseToolMeta({ ...BASE, kind: 'python' }, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('python')
  })

  it('目录名与 name 不一致时拒绝，避免两个名字各说各话', () => {
    const result = parseToolMeta({ ...BASE, kind: 'shell', shell: { command: 'echo' } }, { dirName: 'other', hasImpl: false })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('other')
  })

  it.each(['Greet', 'gre et', '', '1greet', 'greet!'])('拒绝非法工具名 %j', name => {
    const result = parseToolMeta({ ...BASE, name, kind: 'shell', shell: { command: 'echo' } }, { dirName: name, hasImpl: false })

    expect(result.ok).toBe(false)
  })

  it('description 必须非空', () => {
    const result = parseToolMeta({ ...BASE, description: '  ', kind: 'shell', shell: { command: 'echo' } }, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('description')
  })

  it('parameters 必须是 object 根的 JSON Schema', () => {
    const result = parseToolMeta({ ...BASE, parameters: { type: 'string' }, kind: 'shell', shell: { command: 'echo' } }, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('parameters')
  })

  it('parameters 含不支持的 JSON Schema 关键字时拒绝', () => {
    const parameters = { type: 'object', properties: { target: { $ref: '#/x' } } }

    const result = parseToolMeta({ ...BASE, parameters, kind: 'shell', shell: { command: 'echo' } }, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('parameters')
  })

  it('output 缺省时给出开放式对象 schema', () => {
    const result = parseToolMeta({ ...BASE, kind: 'shell', shell: { command: 'echo' } }, context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.output.schema).toEqual({ type: 'object' })
  })

  it('shell 缺少 command 时拒绝', () => {
    const result = parseToolMeta({ ...BASE, kind: 'shell', shell: {} }, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('command')
  })

  it('shell.args 必须全是字符串', () => {
    const result = parseToolMeta({ ...BASE, kind: 'shell', shell: { command: 'echo', args: ['a', 1] } }, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('args')
  })

  it('shell.timeoutMs 越界时拒绝', () => {
    for (const timeoutMs of [0, -1, 1.5, 600_001]) {
      const result = parseToolMeta({ ...BASE, kind: 'shell', shell: { command: 'echo', timeoutMs } }, context)

      expect(result.ok, `timeoutMs=${timeoutMs}`).toBe(false)
    }
  })

  it('http 只接受 http/https 的 URL', () => {
    const ftp = parseToolMeta({ ...BASE, kind: 'http', http: { url: 'ftp://example.com' } }, context)
    const relative = parseToolMeta({ ...BASE, kind: 'http', http: { url: '/v1/ping' } }, context)

    expect(ftp.ok).toBe(false)
    expect(relative.ok).toBe(false)
  })

  it('http 补全默认方法与超时', () => {
    const result = parseToolMeta({ ...BASE, kind: 'http', http: { url: 'https://example.com/v1' } }, context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.http).toMatchObject({ method: 'GET', headers: {}, timeoutMs: 30000 })
  })

  it('http.method 只接受已支持的方法', () => {
    const result = parseToolMeta({ ...BASE, kind: 'http', http: { url: 'https://example.com', method: 'TRACE' } }, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('method')
  })

  it('http.headers 只接受字符串值', () => {
    const result = parseToolMeta(
      { ...BASE, kind: 'http', http: { url: 'https://example.com', headers: { authorization: 1 } } },
      context,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('headers')
  })

  it('忽略与执行无关的字段', () => {
    const result = parseToolMeta(
      { ...BASE, kind: 'shell', shell: { command: 'echo' }, author: 'someone', version: 3 },
      context,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta).not.toHaveProperty('author')
  })

  it('三角测量：下划线、数字与连字符都在名称允许范围内', () => {
    for (const name of ['my_tool', 'tool-2', 'a1_b2-c3']) {
      const result = parseToolMeta({ ...BASE, name, kind: 'shell', shell: { command: 'echo' } }, { dirName: name, hasImpl: false })

      expect(result.ok, name).toBe(true)
    }
  })

  it('三角测量：输出 schema 可以是任意受支持根类型', () => {
    const result = parseToolMeta(
      { ...BASE, kind: 'shell', shell: { command: 'echo' }, output: { schema: { type: 'array', items: { type: 'string' } } } },
      context,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.output.schema).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('三角测量：超时边界值被接受', () => {
    for (const timeoutMs of [1, 600_000]) {
      const result = parseToolMeta({ ...BASE, kind: 'shell', shell: { command: 'echo', timeoutMs } }, context)

      expect(result.ok, String(timeoutMs)).toBe(true)
    }
  })

  it('三角测量：required 引用了未声明的属性时同样落到 parameters 错误', () => {
    const parameters = { type: 'object', properties: {}, required: ['missing'] }

    const result = parseToolMeta({ ...BASE, parameters, kind: 'shell', shell: { command: 'echo' } }, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('bad-parameters')
  })
})
