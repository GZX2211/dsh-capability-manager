// tests/host/selfmade/executors/python.test.ts
//
// Python 工具执行器：stdin 信封、stdout 的 JSON 契约、错误与超时的文案。
// 绝大多数用例注入进程替身，因此测的是「契约」而不是本机是否装了 Python；
// 末尾保留一个真实解释器用例，缺 Python 时跳过，避免把环境问题算成回归。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePython, type ResolvedPython } from '../../../../src/host/selfmade/executors/interpreter.ts'
import {
  PYTHON_ENTRY_FILE,
  runPythonTool,
  type PythonProcessRequest,
  type PythonProcessResult,
} from '../../../../src/host/selfmade/executors/python.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PYTHON: ResolvedPython = { command: '/usr/bin/python3', args: [], version: '3.12.0' }

function toolDir(entry = PYTHON_ENTRY_FILE, body = 'print("{}")'): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-py-'))
  dirs.push(dir)
  if (entry.length > 0) writeFileSync(join(dir, entry), body, 'utf8')
  return dir
}

function ok(stdout: string): PythonProcessResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false, overflow: false }
}

/** 本机是否有可用 Python：真实解释器用例据此跳过。 */
function availablePython(): ResolvedPython | undefined {
  try {
    return resolvePython()
  } catch {
    return undefined
  }
}

describe('Python 工具执行器', () => {
  it('把调用参数与上下文作为 JSON 信封写进 stdin', async () => {
    const requests: PythonProcessRequest[] = []
    const dir = toolDir()

    const value = await runPythonTool(dir, { city: '深圳' }, {
      timeoutMs: 5000,
      stateDir: '/tmp/state',
      workspace: '/tmp/work',
      python: PYTHON,
      run: async request => {
        requests.push(request)
        return ok('{"ok":true}')
      },
    })

    expect(value).toEqual({ ok: true })
    const request = requests[0]
    expect(request?.command).toBe(PYTHON.command)
    expect(request?.args).toEqual([join(dir, PYTHON_ENTRY_FILE)])
    expect(request?.cwd).toBe('/tmp/work')
    expect(request?.timeoutMs).toBe(5000)
    expect(request?.env.PYTHONUTF8).toBe('1')
    expect(JSON.parse(request?.stdin ?? '{}')).toEqual({
      args: { city: '深圳' },
      workspace: '/tmp/work',
      stateDir: '/tmp/state',
    })
  })

  it('没有工作目录时以工具目录为 cwd，信封里也不带 workspace', async () => {
    const requests: PythonProcessRequest[] = []
    const dir = toolDir()

    await runPythonTool(dir, {}, {
      timeoutMs: 1000,
      python: PYTHON,
      run: async request => {
        requests.push(request)
        return ok('null')
      },
    })

    expect(requests[0]?.cwd).toBe(dir)
    expect(JSON.parse(requests[0]?.stdin ?? '{}')).toEqual({ args: {} })
  })

  it('非零退出码把 stderr 尾部交给调用方', async () => {
    await expect(
      runPythonTool(toolDir(), {}, {
        timeoutMs: 1000,
        python: PYTHON,
        run: async () => ({ exitCode: 2, stdout: '', stderr: '  Traceback: KeyError: city  ', timedOut: false, overflow: false }),
      }),
    ).rejects.toThrow(/退出码 2[\s\S]*KeyError: city/)
  })

  it('没有输出时点名 stdout 的 JSON 契约', async () => {
    await expect(
      runPythonTool(toolDir(), {}, {
        timeoutMs: 1000,
        python: PYTHON,
        run: async () => ok('   '),
      }),
    ).rejects.toThrow(/没有输出任何内容[\s\S]*JSON/)
  })

  it('stdout 不是 JSON 时带上实际输出片段', async () => {
    await expect(
      runPythonTool(toolDir(), {}, {
        timeoutMs: 1000,
        python: PYTHON,
        run: async () => ok('hello world'),
      }),
    ).rejects.toThrow(/不是合法 JSON[\s\S]*hello world/)
  })

  it('超时与输出超量都给出可行动的说明', async () => {
    await expect(
      runPythonTool(toolDir(), {}, {
        timeoutMs: 1500,
        python: PYTHON,
        run: async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true, overflow: false }),
      }),
    ).rejects.toThrow(/超时（1500ms）/)

    await expect(
      runPythonTool(toolDir(), {}, {
        timeoutMs: 1000,
        python: PYTHON,
        run: async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: false, overflow: true }),
      }),
    ).rejects.toThrow(/输出超过/)
  })

  it('入口文件缺失时说清缺哪个文件', async () => {
    const dir = toolDir('')

    await expect(
      runPythonTool(dir, {}, { timeoutMs: 1000, python: PYTHON, run: async () => ok('null') }),
    ).rejects.toThrow(new RegExp(`找不到 Python 工具入口 .*${PYTHON_ENTRY_FILE.replace('.', '\\.')}`))
  })

  it('调用方取消时抛取消原因', async () => {
    const controller = new AbortController()
    const reason = new Error('user cancelled')
    controller.abort(reason)

    await expect(
      runPythonTool(toolDir(), {}, { timeoutMs: 1000, python: PYTHON, signal: controller.signal, run: async () => ok('null') }),
    ).rejects.toBe(reason)
  })

  it('真实解释器：脚本从 stdin 读到参数并打印 JSON', async () => {
    const python = availablePython()
    if (python === undefined) {
      // 本机没有满足版本要求的 Python：跳过而不判失败。
      expect(python).toBeUndefined()
      return
    }
    const dir = toolDir(PYTHON_ENTRY_FILE, [
      'import json, os, sys',
      'envelope = json.load(sys.stdin)',
      'print(json.dumps({',
      '  "echo": envelope["args"],',
      '  "workspace": envelope.get("workspace"),',
      '  "stateDir": envelope.get("stateDir"),',
      '  "utf8": os.environ.get("PYTHONUTF8"),',
      '}))',
    ].join('\n'))

    const value = await runPythonTool(dir, { target: '世界' }, {
      timeoutMs: 20_000,
      stateDir: '/tmp/state',
      workspace: dir,
      python,
    })

    expect(value).toEqual({ echo: { target: '世界' }, workspace: dir, stateDir: '/tmp/state', utf8: '1' })
  })
})
