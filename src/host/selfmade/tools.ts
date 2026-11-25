// src/host/selfmade/tools.ts
//
// `<state>/tools` 的发现、注册与热更新。
//
// 两条触发路径刻意并存：
//   · `fs.watch` 让「写入后无需重启」成立
//   · 每次读快照时再 `rescan()` 一次，监听失败或漏事件时界面仍能自愈
//
// 注册表只以「名称 + 内容签名」为键做增量对账：重装同一份内容不产生新的
// `tools/change`，而内容一变就先注销旧的再注册新的，避免同名定义悬挂。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createSelfmadeToolDefinition } from './definition.ts'
import { CODE_ENTRY_FILE } from './executors/code.ts'
import { PYTHON_ENTRY_FILE } from './executors/python.ts'
import { parseToolMeta, type SelfmadeToolMeta } from './meta.ts'

/** 扫描结果：注册所需的最小事实。 */
export interface ScannedSelfmadeTool {
  name: string
  dir: string
  meta: SelfmadeToolMeta
  /** 内容签名；只有它变化才需要重新注册。 */
  signature: string
}

const META_FILE = 'meta.json'
/** 监听事件的合并窗口：一次保存往往触发多个事件。 */
const DEFAULT_DEBOUNCE_MS = 120

/**
 * 枚举状态目录里的自建工具。
 *
 * 单个条目的任何问题都只跳过它自己：一个写坏的文件不该让别人刚创建的工具消失。
 *
 * @param stateDir - 插件状态目录。
 * @param log - 非致命问题；缺省时静默。
 * @returns 通过校验的工具，按名称排序。
 */
export function scanSelfmadeTools(stateDir: string, log?: (message: string) => void): ScannedSelfmadeTool[] {
  const root = join(stateDir, 'tools')
  let dirents
  try {
    dirents = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    // 目录不存在是首次启动的正常形态；其他错误要说出来。
    if (!isMissing(error)) log?.(`自建工具目录不可读（${root}）：${describe(error)}`)
    return []
  }

  const tools: ScannedSelfmadeTool[] = []
  for (const dirent of [...dirents].sort((a, b) => compareNames(a.name, b.name))) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue
    const dir = join(root, dirent.name)
    const metaText = readText(join(dir, META_FILE))
    if (metaText === undefined) {
      log?.(`自建工具 "${dirent.name}" 已跳过：缺少 ${META_FILE}`)
      continue
    }

    let raw: unknown
    try {
      raw = JSON.parse(metaText) as unknown
    } catch (error) {
      log?.(`自建工具 "${dirent.name}" 已跳过：${META_FILE} 不是合法 JSON（${describe(error)}）`)
      continue
    }

    const hasImpl = existsSync(join(dir, CODE_ENTRY_FILE))
    const hasPython = existsSync(join(dir, PYTHON_ENTRY_FILE))
    const parsed = parseToolMeta(raw, { dirName: dirent.name, hasImpl, hasPython })
    if (!parsed.ok) {
      log?.(`自建工具 "${dirent.name}" 已跳过：${parsed.message}`)
      continue
    }

    tools.push({
      name: parsed.meta.name,
      dir,
      meta: parsed.meta,
      signature: signatureOf(metaText, entrySignature(dir, parsed.meta)),
    })
  }
  return tools
}

export interface SelfmadeToolsOptions {
  /** 插件状态目录。 */
  stateDir: string
  /** 把定义挂到工具注册表；返回注销函数。 */
  register: (definition: ToolDefinition) => () => void
  /** 该名字是否已被非自建来源占用；占用时跳过，绝不覆盖已有工具。 */
  isTaken?: (name: string) => boolean
  /** 解析调用方会话的工作目录。 */
  workspaceOf?: (agent: unknown, signal: AbortSignal) => Promise<string | undefined>
  /** 显式指定的 Python 解释器；缺省按内置顺序探测。 */
  pythonPath?: string
  log?: (message: string) => void
  /** 是否监听文件变化；缺省为开启。 */
  watch?: boolean
  debounceMs?: number
}

interface Registration {
  signature: string
  release: () => void
}

/**
 * 自建工具的注册生命周期。
 *
 * 状态只有一份：名称 → 签名 + 注销函数。对账是幂等的，因此重复扫描、
 * 快照请求与文件事件可以任意交错，不需要额外的互斥。
 */
export class SelfmadeTools {
  private readonly registered = new Map<string, Registration>()
  /** 已报告过的问题；同一个坏条目不在每次扫描时重复刷日志。 */
  private readonly warned = new Set<string>()
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout
  private closed = false

  constructor(private readonly options: SelfmadeToolsOptions) {}

  /** 创建目录、注册已有工具，并按需开始监听。失败只记录，不让插件加载失败。 */
  start(): void {
    try {
      mkdirSync(join(this.options.stateDir, 'tools'), { recursive: true })
    } catch (error) {
      this.warn(`无法创建自建工具目录：${describe(error)}`)
    }
    this.rescan()
    if (this.options.watch !== false) this.startWatching()
  }

  /**
   * 重新对账一次。
   *
   * 既用于文件事件，也用于每次读取快照——监听漏掉事件时界面仍然自愈。
   */
  rescan(): void {
    if (this.closed) return
    const scanned = scanSelfmadeTools(this.options.stateDir, message => this.warnOnce(message))
    const desired = new Map(scanned.map(entry => [entry.name, entry]))

    for (const [name, registration] of [...this.registered]) {
      const candidate = desired.get(name)
      if (candidate !== undefined && candidate.signature === registration.signature) continue
      this.release(name)
    }

    for (const entry of scanned) {
      if (this.registered.has(entry.name)) continue
      if (this.options.isTaken?.(entry.name) === true) {
        this.warnOnce(`自建工具 "${entry.name}" 与已有工具同名，已跳过注册（不覆盖已有工具）`)
        continue
      }
      try {
        const definition = createSelfmadeToolDefinition(entry.meta, entry.dir, {
          stateDir: this.options.stateDir,
          ...this.options.workspaceOf === undefined ? {} : { workspaceOf: this.options.workspaceOf },
          ...this.options.pythonPath === undefined ? {} : { pythonPath: this.options.pythonPath },
        })
        const release = this.options.register(definition)
        this.registered.set(entry.name, { signature: entry.signature, release })
      } catch (error) {
        this.warnOnce(`自建工具 "${entry.name}" 注册失败：${describe(error)}`)
      }
    }
  }

  /** 当前已注册的自建工具名；供目录来源判定使用。 */
  names(): ReadonlySet<string> {
    return new Set(this.registered.keys())
  }

  /**
   * 当前扫描结果。
   *
   * 界面需要展示「还没有被任何会话吸收过」的自建工具，因此这里不走注册表，
   * 而是直接回报磁盘事实；调用方自己决定怎么合并。
   *
   * @returns 通过校验的工具条目。
   */
  catalog(): ScannedSelfmadeTool[] {
    return scanSelfmadeTools(this.options.stateDir, message => this.warnOnce(message))
  }

  /** 插件卸载：停止监听并注销全部自建工具。 */
  dispose(): void {
    this.closed = true
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.stopWatcher()
    for (const name of [...this.registered.keys()]) this.release(name)
  }

  private startWatching(): void {
    const root = join(this.options.stateDir, 'tools')
    try {
      this.watcher = watch(root, { recursive: true }, () => this.schedule())
      this.watcher.on('error', error => {
        this.warn(`自建工具目录监听失败，已退化为每次读取快照时重扫：${describe(error)}`)
        this.stopWatcher()
      })
    } catch (error) {
      this.warn(`无法监听自建工具目录，已退化为每次读取快照时重扫：${describe(error)}`)
    }
  }

  private schedule(): void {
    if (this.closed || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.rescan()
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
    // 不让监听窗口拖住宿主退出。
    this.timer.unref?.()
  }

  private stopWatcher(): void {
    const watcher = this.watcher
    this.watcher = undefined
    if (watcher === undefined) return
    try {
      watcher.close()
    } catch {
      // 监听已失效；没有可补救的动作。
    }
  }

  private release(name: string): void {
    const registration = this.registered.get(name)
    if (registration === undefined) return
    this.registered.delete(name)
    try {
      registration.release()
    } catch (error) {
      this.warn(`自建工具 "${name}" 注销失败：${describe(error)}`)
    }
  }

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return
    this.warned.add(message)
    this.warn(message)
  }

  private warn(message: string): void {
    this.options.log?.(message)
  }
}

/** 签名 = meta 原文 + 脚本入口版本；声明式工具没有入口文件，读作空串。 */
function signatureOf(metaText: string, implSignature: string): string {
  return createHash('sha256').update(metaText).update('\u0000').update(implSignature).digest('hex')
}

/** 代码工具的入口：Python 用 main.py，Node 用 impl.mjs；声明式工具没有入口。 */
function entryOf(meta: SelfmadeToolMeta): string | undefined {
  if (meta.kind === 'code') return CODE_ENTRY_FILE
  if (meta.kind === 'python') return meta.python?.entry ?? PYTHON_ENTRY_FILE
  return undefined
}

function entrySignature(dir: string, meta: SelfmadeToolMeta): string {
  const entry = entryOf(meta)
  return entry === undefined ? '' : fileVersion(dir, entry)
}

/** 入口的版本用修改时间与大小表达：读全文算哈希是没必要的 IO。 */
function fileVersion(dir: string, name: string): string {
  try {
    const info = statSync(join(dir, name))
    return `${String(info.mtimeMs)}-${String(info.size)}`
  } catch {
    return 'missing'
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
