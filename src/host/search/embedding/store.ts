// src/host/search/embedding/store.ts
//
// 向量缓存的落盘格式与命中规则。
//
// 缓存键是能力 id，命中条件是「摘要哈希一致」：摘要变了说明这个能力的语义变了，
// 旧向量必须重算。读盘是惰性的——启动时不该为一个可能用不上的缓存读盘。
//
// 文件是模型的邻居，损坏不影响功能：最坏情况是重新算一遍向量，所以这里对
// 任何读取失败都只记日志、退化为空表。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 落盘的一条记录。 */
export interface VectorRecord {
  /** 摘要的 sha256：缓存是否仍然有效的判据。 */
  hash: string
  /** 向量分量；JSON 里是数字数组。 */
  vector: number[]
}

export type VectorCacheData = Record<string, VectorRecord>

export interface VectorStoreOptions {
  /** `vectors.json` 的完整路径。 */
  path: string
  log?: (message: string) => void
}

/** 摘要哈希；同一摘要必然得到同一向量键。 */
export function summaryHash(summary: string): string {
  return createHash('sha256').update(summary).digest('hex')
}

/**
 * 向量缓存。
 *
 * 内存态是权威，落盘由 {@link flush} 决定；`dirty` 让调用方可以只在有变更时写盘。
 */
export class VectorStore {
  private readonly path: string
  private readonly log: (message: string) => void
  private records: Map<string, VectorRecord> | undefined
  private touched = false

  constructor(options: VectorStoreOptions) {
    this.path = options.path
    this.log = options.log ?? (() => {})
  }

  /** 是否还有未落盘的变更。 */
  get dirty(): boolean {
    this.load()
    return this.touched
  }

  /** 当前缓存的条目数。 */
  get size(): number {
    this.load()
    return this.records?.size ?? 0
  }

  /**
   * 读一个能力的缓存向量。
   *
   * @param id - 能力标识（`tool:<name>` / `skill:<name>`）。
   * @param summary - 当前摘要；与记录里的哈希不一致时视为未命中。
   * @returns 向量副本；未命中时为 `undefined`。
   */
  get(id: string, summary: string): Float32Array | undefined {
    this.load()
    const record = this.records?.get(id)
    if (record === undefined) return undefined
    if (record.hash !== summaryHash(summary)) return undefined
    return Float32Array.from(record.vector)
  }

  /**
   * 写入一条缓存。
   *
   * @param id - 能力标识。
   * @param summary - 生成该向量时的摘要。
   * @param vector - 已归一化的向量。
   */
  set(id: string, summary: string, vector: Float32Array): void {
    this.load()
    if (this.records === undefined) this.records = new Map()
    this.records.set(id, { hash: summaryHash(summary), vector: [...vector] })
    this.touched = true
  }

  /**
   * 把变更原子落盘。
   *
   * 没有变更时什么都不做：检索是热路径，不能每次都写盘。
   */
  flush(): void {
    this.load()
    if (!this.touched || this.records === undefined) return
    const data: VectorCacheData = {}
    for (const [id, record] of this.records) data[id] = record
    const temporary = `${this.path}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(temporary, `${JSON.stringify(data)}\n`, 'utf8')
      renameSync(temporary, this.path)
      this.touched = false
    } catch (error) {
      // 写盘失败不响应用户：缓存丢了只是下次重算，向量本身仍然可用。
      rmSync(temporary, { force: true })
      this.log(`cannot persist the vector cache: ${describe(error)}`)
    }
  }

  /** 首次访问时读盘；失败只记一次日志。 */
  private load(): void {
    if (this.records !== undefined) return
    this.records = new Map()
    if (!existsSync(this.path)) return
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      this.records = normalizeCache(parsed)
    } catch (error) {
      this.log(`cannot read the vector cache at ${this.path}: ${describe(error)}`)
    }
  }
}

/** 收窄磁盘上的任意结构；非法条目被丢弃，而不是让整份缓存失效。 */
function normalizeCache(raw: unknown): Map<string, VectorRecord> {
  const records = new Map<string, VectorRecord>()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return records
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const record = value as { hash?: unknown; vector?: unknown }
    if (typeof record.hash !== 'string') continue
    if (!Array.isArray(record.vector)) continue
    const vector = record.vector.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    records.set(id, { hash: record.hash, vector })
  }
  return records
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
