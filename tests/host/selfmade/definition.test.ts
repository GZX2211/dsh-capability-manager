// tests/host/selfmade/definition.test.ts
//
// 自建工具描述到 ToolDefinition 的投影：名称/参数/输出与执行路径。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSelfmadeToolDefinition } from '../../../src/host/selfmade/definition.ts'
import type { SelfmadeToolMeta } from '../../../src/host/selfmade/meta.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-def-'))
  dirs.push(dir)
  return dir
}

const BASE: Omit<SelfmadeToolMeta, 'kind'> = {
  name: 'greet',
  description: '打招呼',
  parameters: { type: 'object', properties: { target: { type: 'string' } } },
  output: { schema: { type: 'object' } },
}

describe('自建工具定义', () => {
  it('名称、描述与参数原样投影给模型', () => {
    const definition = createSelfmadeToolDefinition(
      { ...BASE, kind: 'shell', shell: { command: 'echo', args: [], timeoutMs: 5000 } },
      '/tmp/x',
      { stateDir: '/tmp/state' },
    )

    expect(definition.name).toBe('greet')
    expect(definition.description).toBe('打招呼')
    expect(definition.parameters).toEqual(BASE.parameters)
    expect(definition.timeoutMs).toBe(5000)
  })

  it('输出渲染成 JSON 文本', () => {
    const definition = createSelfmadeToolDefinition(
      { ...BASE, kind: 'shell', shell: { command: 'echo', args: [], timeoutMs: 5000 } },
      '/tmp/x',
      { stateDir: '/tmp/state' },
    )

    expect(definition.output.render({}, { ok: true })).toEqual([{ type: 'text', text: '{\n  "ok": true\n}' }])
  })

  it('代码工具的默认超时由宿主策略决定，这里不声明', () => {
    const definition = createSelfmadeToolDefinition({ ...BASE, kind: 'code' }, '/tmp/x', { stateDir: '/tmp/state' })

    expect(definition.timeoutMs).toBeUndefined()
  })

  it('shell 工具执行后把退出码与输出交给调用方', async () => {
    const definition = createSelfmadeToolDefinition(
      {
        ...BASE,
        kind: 'shell',
        shell: { command: process.execPath, args: ['-e', 'process.stdout.write("pong")'], timeoutMs: 10_000 },
      },
      '/tmp/x',
      { stateDir: '/tmp/state' },
    )

    await expect(definition.execute({}, { agent: undefined, signal: new AbortController().signal } as never)).resolves.toEqual(
      { exitCode: 0, stdout: 'pong', stderr: '' },
    )
  })

  it('代码工具收到状态目录与工作目录', async () => {
    const dir = workspace()
    writeFileSync(
      join(dir, 'impl.mjs'),
      'export default async (_args, ctx) => ({ stateDir: ctx.stateDir, workspace: ctx.workspace })',
      'utf8',
    )
    const definition = createSelfmadeToolDefinition({ ...BASE, kind: 'code' }, dir, {
      stateDir: '/tmp/state',
      workspaceOf: async () => '/tmp/work',
    })

    await expect(definition.execute({}, { agent: {}, signal: new AbortController().signal } as never)).resolves.toEqual({
      stateDir: '/tmp/state',
      workspace: '/tmp/work',
    })
  })

  it('参数不是对象时给出可行动的说明', async () => {
    const definition = createSelfmadeToolDefinition({ ...BASE, kind: 'code' }, '/tmp/x', { stateDir: '/tmp/state' })

    await expect(definition.execute('nope', { signal: new AbortController().signal } as never)).rejects.toThrow(/对象/)
  })

  it('工作目录解析失败只降级为 undefined，不让调用整体失败', async () => {
    const dir = workspace()
    writeFileSync(join(dir, 'impl.mjs'), 'export default async (_args, ctx) => ({ workspace: ctx.workspace })', 'utf8')
    const definition = createSelfmadeToolDefinition({ ...BASE, kind: 'code' }, dir, {
      stateDir: '/tmp/state',
      workspaceOf: async () => {
        throw new Error('no session')
      },
    })

    await expect(definition.execute({}, { agent: {}, signal: new AbortController().signal } as never)).resolves.toEqual({
      workspace: undefined,
    })
  })
})
