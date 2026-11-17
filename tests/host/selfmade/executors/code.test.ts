// tests/host/selfmade/executors/code.test.ts
//
// 代码工具的加载契约：默认导出函数、收到参数与上下文、结果必须是 JSON 值；
// 改写 impl.mjs 后无需重启即可生效（模块缓存必须按文件版本失效）。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCodeTool } from '../../../../src/host/selfmade/executors/code.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function toolDir(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-code-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'impl.mjs'), source, 'utf8')
  return dir
}

describe('代码工具执行', () => {
  it('调用默认导出并把返回值带回', async () => {
    const dir = toolDir('export default async args => ({ doubled: args.n * 2 })')

    await expect(runCodeTool(dir, { n: 2 })).resolves.toEqual({ doubled: 4 })
  })

  it('把上下文交给实现', async () => {
    const dir = toolDir('export default async (_args, ctx) => ({ stateDir: ctx.stateDir, aborted: ctx.signal.aborted })')

    await expect(runCodeTool(dir, {}, { stateDir: '/tmp/state' })).resolves.toEqual({
      stateDir: '/tmp/state',
      aborted: false,
    })
  })

  it('实现内部抛错原样传播', async () => {
    const dir = toolDir('export default async () => { throw new Error("boom from impl") }')

    await expect(runCodeTool(dir, {})).rejects.toThrow('boom from impl')
  })

  it('缺少默认导出时说明契约', async () => {
    const dir = toolDir('export const notDefault = 1')

    await expect(runCodeTool(dir, {})).rejects.toThrow(/默认导出/)
  })

  it('默认导出不是函数时说明契约', async () => {
    const dir = toolDir('export default 42')

    await expect(runCodeTool(dir, {})).rejects.toThrow(/函数/)
  })

  it('语法错误时指出 impl.mjs', async () => {
    const dir = toolDir('export default async ( => {')

    await expect(runCodeTool(dir, {})).rejects.toThrow(/impl\.mjs/)
  })

  it('结果不是 JSON 值时报错，而不是把 undefined 当成功', async () => {
    const dir = toolDir('export default async () => 1n')

    await expect(runCodeTool(dir, {})).rejects.toThrow(/JSON/)
  })

  it('循环引用同样被拒绝', async () => {
    const dir = toolDir('export default async () => { const a = {}; a.self = a; return a }')

    await expect(runCodeTool(dir, {})).rejects.toThrow(/JSON/)
  })

  it('改写 impl.mjs 后再次调用立即生效', async () => {
    const dir = toolDir('export default async () => ({ version: 1 })')
    await expect(runCodeTool(dir, {})).resolves.toEqual({ version: 1 })

    writeFileSync(join(dir, 'impl.mjs'), 'export default async () => ({ version: 2 })', 'utf8')

    await expect(runCodeTool(dir, {})).resolves.toEqual({ version: 2 })
  })

  it('缺少 impl.mjs 时给出路径', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-code-empty-'))
    dirs.push(dir)

    await expect(runCodeTool(dir, {})).rejects.toThrow(/impl\.mjs/)
  })

  it('三角测量：数组与字符串同样是合法的 JSON 结果', async () => {
    const arrayDir = toolDir('export default async () => [1, "two"]')
    const stringDir = toolDir("export default async () => 'done'")

    await expect(runCodeTool(arrayDir, {})).resolves.toEqual([1, 'two'])
    await expect(runCodeTool(stringDir, {})).resolves.toBe('done')
  })

  it('三角测量：工作目录也交给实现', async () => {
    const dir = toolDir('export default async (_args, ctx) => ({ workspace: ctx.workspace })')

    await expect(runCodeTool(dir, {}, { workspace: '/work' })).resolves.toEqual({ workspace: '/work' })
  })
})
