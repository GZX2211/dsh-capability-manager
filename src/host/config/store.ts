// src/host/config/store.ts
//
// 配置的唯一所有者：内存态 + 原子落盘 + revision 乐观并发 + 变更通知。
//
// 「已持久化」是内存态的唯一含义：写盘失败时内存态保持不变，避免出现
// 「界面显示已生效、重启后却回退」的分裂状态。
//
// 写入用「临时文件 + rename」：真实配置路径永远不会出现半截 JSON。

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeConfig } from './sanitize.ts'
import type { CapabilityConfig } from '../../shared/config.ts'

/** 写操作的稳定结果码；HTTP 层按码分派状态码，不解析文案。 */
export type ConfigWriteResult =
  | { ok: true; revision: number }
  | { ok: false; code: 'revision-conflict'; revision: number }
  | { ok: false; code: 'write-failed'; message: string }

/** 一次成功写入的广播内容；`config` 已是独立副本。 */
export interface ConfigChange {
  config: CapabilityConfig
  revision: number
}

export interface ConfigStoreOptions {
  /** 状态目录；配置文件为其中的 `config.json`。 */
  directory: string
  /** 非致命的读取/写入问题。缺省时静默。 */
  log?: (message: string) => void
}

export class ConfigStore {
  /**
   * 读一次磁盘并建立存储。缺文件、缺目录、坏 JSON 都只降级不抛错——
   * 插件加载失败会拖垮整个 profile。
   *
   * @param options - 状态目录与日志回调。
   * @returns 就绪的存储，revision 从 0 开始。
   */
  static open(options: ConfigStoreOptions): ConfigStore {
    const path = join(options.directory, 'config.json')
    const log = options.log ?? (() => {})

    let text: string | undefined
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      // 只有「不存在」是正常首次启动；其他读取失败要说出来。
      if (!isMissing(error)) log(`cannot read ${path}: ${describe(error)}`)
    }

    let config: CapabilityConfig
    if (text === undefined) {
      config = sanitizeConfig(undefined)
    } else {
      try {
        config = sanitizeConfig(JSON.parse(text) as unknown)
      } catch (error) {
        log(`ignoring unreadable ${path}: ${describe(error)}`)
        config = sanitizeConfig(undefined)
      }
    }

    return new ConfigStore(path, config, log)
  }

  private revisionValue = 0
  private current: CapabilityConfig
  private serialized: string
  private readonly listeners = new Set<(change: ConfigChange) => void>()

  private constructor(
    private readonly path: string,
    config: CapabilityConfig,
    private readonly log: (message: string) => void,
  ) {
    this.current = config
    // 以内存态的规范化文本为基线：启动就把磁盘上的非法项「重写一遍」是多余的
    // 副作用，只读启动即可，下一次真实写入自然会带上修复结果。
    this.serialized = serialize(config)
  }

  /** 当前 revision；写操作的乐观并发依据。 */
  get revision(): number {
    return this.revisionValue
  }

  /** 当前配置的独立副本，调用方可以随意修改。 */
  read(): CapabilityConfig {
    return structuredClone(this.current)
  }

  /**
   * 提交一份新配置。
   *
   * 入参先经过自愈，所以非法内容永远不会落盘。内容与当前一致时视为成功但
   * 不递增 revision、不写盘、不通知——界面重复提交同一状态不该产生噪音。
   *
   * @param next - 期望的完整配置；不要求是 read() 的结果。
   * @param expectedRevision - 调用方读到的 revision。
   * @returns 成功的新 revision、冲突时的最新 revision，或写盘失败。
   */
  write(next: CapabilityConfig, expectedRevision: number): ConfigWriteResult {
    if (expectedRevision !== this.revisionValue) {
      return { ok: false, code: 'revision-conflict', revision: this.revisionValue }
    }

    const config = sanitizeConfig(next)
    const serialized = serialize(config)
    if (serialized === this.serialized) return { ok: true, revision: this.revisionValue }

    try {
      this.persist(serialized)
    } catch (error) {
      this.log(`cannot write ${this.path}: ${describe(error)}`)
      return { ok: false, code: 'write-failed', message: describe(error) }
    }

    this.current = config
    this.serialized = serialized
    this.revisionValue += 1
    this.notify({ config: this.read(), revision: this.revisionValue })
    return { ok: true, revision: this.revisionValue }
  }

  /**
   * 订阅成功写入。
   *
   * @param listener - 每次成功写入调用一次，参数是独立副本。
   * @returns 取消订阅。
   */
  subscribe(listener: (change: ConfigChange) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 临时文件 + rename，保证真实路径从不出现半截内容。 */
  private persist(text: string): void {
    const directory = join(this.path, '..')
    mkdirSync(directory, { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, text, 'utf8')
      renameSync(temporary, this.path)
    } catch (error) {
      // 清理失败不掩盖真正的写入错误。
      try {
        rmSync(temporary, { force: true })
      } catch {
        // 留给操作系统回收
      }
      throw error
    }
  }

  private notify(change: ConfigChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change)
      } catch (error) {
        // 一个订阅者出错不该打断其他订阅者，也不该让已落盘的写入报失败。
        this.log(`config change listener failed: ${describe(error)}`)
      }
    }
  }
}

/** 带缩进的 JSON 便于人工核对与 diff；末尾换行让文件以行结尾。 */
function serialize(config: CapabilityConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
