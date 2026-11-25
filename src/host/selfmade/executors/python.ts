// src/host/selfmade/executors/python.ts
//
// Python 代码工具：每次调用起一个独立解释器进程跑同目录的 `main.py`。
//
// 与 Node 形态的关键差别是**隔离**：脚本在子进程里跑，崩溃、死循环、内存爆掉
// 都不会带走宿主。代价是每次调用付一次解释器启动成本，这对工具调用可以接受。
//
// 参数走 stdin 的 JSON 信封而不是 argv：既绕开 Windows 约 32K 的命令行上限，
// 也让模型给出的字符串永远只是数据，不参与命令拼接。

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePython, type ResolvedPython } from './interpreter.ts'

/** Python 工具的固定入口文件名。 */
export const PYTHON_ENTRY_FILE = 'main.py'

/** 单路输出的收集上限；超出即终止，避免一个洪水式脚本吃满内存。 */
const MAX_STREAM_CHARS = 4 * 1024 * 1024

/** 报错时附带的 stderr 尾部长度：够定位，又不至于淹没结论。 */
const STDERR_TAIL_CHARS = 2000

/** 子进程环境的透传白名单；与 dsh-run-python 同源，不含任何宿主密钥。 */
const ENV_ALLOWLIST = [
  'PATH', 'PATHEXT', 'SystemRoot', 'ComSpec', 'WINDIR',
  'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'LANG', 'LC_ALL', 'PYTHONPATH',
] as const

/** 一次子进程执行的可观察结果。 */
export interface PythonProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** 输出超过上限被强制终止。 */
  overflow: boolean
}

export interface PythonProcessRequest {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  stdin: string
  timeoutMs: number
  signal?: AbortSignal | undefined
}

/** 可注入的进程执行器；测试用替身，生产用真子进程。 */
export type PythonProcessRunner = (request: PythonProcessRequest) => Promise<PythonProcessResult>

export interface RunPythonOptions {
  signal?: AbortSignal | undefined
  /** 作者声明的执行预算。 */
  timeoutMs: number
  stateDir?: string | undefined
  /** 该会话的工作目录；缺省时以工具目录为 cwd。 */
  workspace?: string | undefined
  /** 入口文件名；缺省 {@link PYTHON_ENTRY_FILE}。 */
  entry?: string | undefined
  /** 显式解释器路径；缺省按 {@link resolvePython} 探测。 */
  pythonPath?: string | undefined
  run?: PythonProcessRunner
  /** 注入解释器解析结果，省掉一次探测。 */
  python?: ResolvedPython
}

/** stdout 的约定：一个 JSON 值。 */
const EMPTY_OUTPUT_HINT =
  '脚本必须把结果作为 JSON 打印到 stdout，例如 print(json.dumps({"ok": True}))'

/**
 * 执行一次 Python 工具。
 *
 * @param dir - 工具目录（`main.py` 所在处）。
 * @param args - 模型给出的调用参数。
 * @param options - 超时、上下文与可注入的执行器。
 * @returns 脚本打印的 JSON 值。
 * @throws 入口缺失、解释器不可用、超时、取消、非零退出或输出不是 JSON。
 */
export async function runPythonTool(
  dir: string,
  args: Record<string, unknown>,
  options: RunPythonOptions,
): Promise<unknown> {
  if (options.signal?.aborted) throw options.signal.reason

  const entry = options.entry ?? PYTHON_ENTRY_FILE
  const script = join(dir, entry)
  if (!existsSync(script)) throw new Error(`找不到 Python 工具入口 ${script}`)

  const python = options.python ?? resolvePython({ pythonPath: options.pythonPath })
  const cwd = options.workspace ?? dir
  const payload = JSON.stringify({
    args,
    ...options.workspace === undefined ? {} : { workspace: options.workspace },
    ...options.stateDir === undefined ? {} : { stateDir: options.stateDir },
  })

  const result = await (options.run ?? spawnPython)({
    command: python.command,
    args: [...python.args, script],
    cwd,
    env: childEnv(),
    stdin: payload,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  })

  if (result.timedOut) {
    throw new Error(`Python 工具超时（${String(options.timeoutMs)}ms）并被终止；请缩小单次工作量或调大 timeoutMs`)
  }
  if (result.overflow) {
    throw new Error(`Python 工具输出超过 ${String(MAX_STREAM_CHARS)} 字符并被终止；请只返回结论，不要打印中间过程`)
  }
  if (options.signal?.aborted) throw options.signal.reason

  const stderr = result.stderr.trim()
  if (result.exitCode !== 0) {
    const tail = stderr.length > STDERR_TAIL_CHARS ? stderr.slice(-STDERR_TAIL_CHARS) : stderr
    throw new Error(
      [`Python 工具以退出码 ${String(result.exitCode)} 结束`, tail].filter(part => part.length > 0).join('\n'),
    )
  }

  const stdout = result.stdout.trim()
  if (stdout.length === 0) throw new Error(`Python 工具没有输出任何内容。${EMPTY_OUTPUT_HINT}`)
  try {
    return JSON.parse(stdout) as unknown
  } catch (error) {
    const snippet = stdout.length > 200 ? `${stdout.slice(0, 200)}…` : stdout
    throw new Error(`Python 工具的 stdout 不是合法 JSON：${describe(error)}\n实际输出：${snippet}\n${EMPTY_OUTPUT_HINT}`)
  }
}

/** 生产执行器：`spawn` 起步，写 stdin，收两路输出，超时/取消/超量一律终止。 */
export const spawnPython: PythonProcessRunner = request =>
  new Promise<PythonProcessResult>((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let overflow = false
    let settled = false

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode, stdout, stderr, timedOut, overflow })
    }

    const terminate = (): void => {
      if (settled) return
      child.kill()
      // 极端情况下 kill 不生效（内核态阻塞），兜底结算，避免调用方永远挂着。
      setTimeout(() => finish(null), 500).unref?.()
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, request.timeoutMs)
    timer.unref?.()

    const onAbort = (): void => terminate()
    request.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > MAX_STREAM_CHARS) {
        overflow = true
        terminate()
        return
      }
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length + chunk.length > MAX_STREAM_CHARS) return
      stderr += chunk
    })

    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onAbort)
      const code = (error as { code?: unknown }).code
      reject(
        code === 'ENOENT'
          ? new Error(`找不到 Python 解释器 "${request.command}"：请安装 Python 或配置 pythonPath`)
          : error,
      )
    })

    child.on('close', code => finish(code))

    // 脚本自己退出后写 stdin 会 EPIPE；那是正常收尾，不是失败。
    child.stdin.on('error', () => undefined)
    child.stdin.end(request.stdin)
  })

/** 只透传白名单变量，并强制 UTF-8：输出要进模型上下文，不能带平台默认编码。 */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  env.PYTHONUTF8 = '1'
  env.PYTHONIOENCODING = 'utf-8'
  env.NO_COLOR = '1'
  return env
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
