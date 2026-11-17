// tests/host/selfmade/executors/shell.test.ts
//
// 声明式 shell 工具的执行边界：参数以 argv 数组传递，绝不拼成 shell 字符串。

import { describe, expect, it } from 'vitest'
import { runShellTool, type ExecFileRunner } from '../../../../src/host/selfmade/executors/shell.ts'
import type { SelfmadeShellSpec } from '../../../../src/host/selfmade/meta.ts'

const spec: SelfmadeShellSpec = { command: 'echo', args: ['--name', '{{target}}'], timeoutMs: 1234 }

function runner(outcome: Awaited<ReturnType<ExecFileRunner>>) {
  const calls: { command: string; args: string[]; options: { signal?: AbortSignal | undefined; timeoutMs: number } }[] = []
  const run: ExecFileRunner = async (command, args, options) => {
    calls.push({ command, args, options })
    return outcome
  }
  return { run, calls }
}

describe('shell 执行', () => {
  it('以 argv 数组调用，模板参数各自成为一个元素', async () => {
    const fake = runner({ exitCode: 0, stdout: 'ok\n', stderr: '' })

    const result = await runShellTool(spec, { target: 'a b; rm -rf /' }, fake.run)

    expect(fake.calls[0]?.command).toBe('echo')
    expect(fake.calls[0]?.args).toEqual(['--name', 'a b; rm -rf /'])
    expect(result).toEqual({ exitCode: 0, stdout: 'ok\n', stderr: '' })
  })

  it('把超时预算交给执行器', async () => {
    const fake = runner({ exitCode: 0, stdout: '', stderr: '' })

    await runShellTool(spec, { target: 'x' }, fake.run)

    expect(fake.calls[0]?.options.timeoutMs).toBe(1234)
  })

  it('非零退出码作为结果返回，而不是抛错', async () => {
    const fake = runner({ exitCode: 2, stdout: '', stderr: 'boom' })

    await expect(runShellTool(spec, {}, fake.run)).resolves.toEqual({ exitCode: 2, stdout: '', stderr: 'boom' })
  })

  it('可执行文件不存在时给出可行动的说明', async () => {
    const failing: ExecFileRunner = async () => {
      throw Object.assign(new Error('spawn echo ENOENT'), { code: 'ENOENT' })
    }

    await expect(runShellTool(spec, {}, failing)).rejects.toThrow(/echo/)
  })

  it('超时失败说明超时与命令', async () => {
    const failing: ExecFileRunner = async () => {
      throw Object.assign(new Error('killed'), { killed: true })
    }

    await expect(runShellTool(spec, {}, failing)).rejects.toThrow(/超时/)
  })

  it('调用方取消时原样传播取消原因', async () => {
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))
    const failing: ExecFileRunner = async () => {
      throw new Error('should not run')
    }

    await expect(runShellTool(spec, {}, failing, controller.signal)).rejects.toThrow('user cancelled')
  })

  it('未取消的调用把 signal 传给执行器', async () => {
    const controller = new AbortController()
    const fake = runner({ exitCode: 0, stdout: '', stderr: '' })

    await runShellTool(spec, {}, fake.run, controller.signal)

    expect(fake.calls[0]?.options.signal).toBe(controller.signal)
  })

  it('默认执行器可直接跑一条真实命令', async () => {
    const result = await runShellTool({ command: process.execPath, args: ['-e', 'process.stdout.write("hi")'], timeoutMs: 10_000 }, {})

    expect(result).toEqual({ exitCode: 0, stdout: 'hi', stderr: '' })
  })

  it('真实执行器把非零退出码与标准错误带回来', async () => {
    const result = await runShellTool(
      { command: process.execPath, args: ['-e', 'process.stderr.write("bad"); process.exit(3)'], timeoutMs: 10_000 },
      {},
    )

    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('bad')
  })
})
