// src/host/search/embedding/index.ts
//
// 向量检索服务：把「开启/关闭」「模型就绪」「语义检索」收成一个状态机。
//
// 职责边界：
//   · 配置事实（是否开启）只来自配置；运行时事实（是否 ready）只来自本服务的状态机。
//   · 开启是一次可能很长的操作（下载 24MB + 加载模型），失败必须朝「保持关闭」降级，
//     否则界面会显示已开启、而 mode B 的索引不注入、keywords 又不可用——模型会失去线索。
//   · 语义检索失败只降级为 undefined，让 `meta_search` 给出说明而不是让工具报错。

import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { EmbeddingStatus } from '../../../shared/api.ts'
import type { CapabilityId } from '../../../shared/capability.ts'
import type { CapabilityConfig } from '../../../shared/config.ts'
import { MODEL_DIRECTORY_NAME, MODEL_FILES, MODEL_REVISION } from './model.ts'
import { ensureModel, type EnsureModelOptions, type EnsureModelResult, type ModelFile } from './download.ts'
import { loadEmbedder, type Embedder } from './runtime.ts'
import { VectorStore } from './store.ts'

/** 每个候选池（工具 / Skill 各自）默认返回条数；两池合计最多 10 条。 */
export const DEFAULT_TOP_K = 5

/**
 * 相似度阈值；低于它的命中会被丢弃，宁可少给也不给不相干的能力。
 *
 * 中文 bge-small-zh 的余弦分布下 0.35 会把大量泛相关项塞满 topK，0.52 经多组实测
 * 在保持召回的同时显著降噪；召不到的能力可以再次召回，漏召的代价低于噪声。
 */
export const DEFAULT_THRESHOLD = 0.52

/** 参与语义检索的候选。 */
export interface EmbeddingCandidate {
  id: CapabilityId
  /** 能力名称，参与向量化以免「定时」这类词落在描述之外时漏召回。 */
  name: string
  /** 完整描述，不截断。 */
  description: string
}

/**
 * 向量化正文：名称与描述直接相加，不截断。
 *
 * 名称与描述各占一行，避免两段文字粘连成一个词；模型看到的仍是完整字段。
 */
export function embeddingText(candidate: EmbeddingCandidate): string {
  return `${candidate.name}\n${candidate.description}`
}

/** 一条语义命中。 */
export interface EmbeddingHit {
  id: CapabilityId
  score: number
}

/** 开启失败的两类原因，对应 `ERROR_CODES` 里的稳定错误码。 */
export type EmbeddingFailureCode = 'embedding-download-failed' | 'embedding-unavailable'

export type EmbeddingEnableResult = { ok: true } | { ok: false; code: EmbeddingFailureCode; message: string }

export interface EmbeddingServiceOptions {
  /** 模型目录：`<state>/models/bge-small-zh-v1.5`。 */
  modelDir: string
  config: () => CapabilityConfig
  /** 写回向量检索配置；`enabled` 是唯一必需的字段。 */
  saveEmbedding: (embedding: { enabled: boolean; modelDir?: string; revision?: string }) => void
  /** 向量缓存路径；缺省为 `<modelDir>/vectors.json`。 */
  vectorPath?: string
  /** 返回条数上限；缺省 {@link DEFAULT_TOP_K}。 */
  topK?: number
  /** 相似度阈值；缺省 {@link DEFAULT_THRESHOLD}。 */
  threshold?: number
  /** 可替换的基础设施：测试与无原生运行时环境用。 */
  ensureModel?: (modelDir: string, files?: readonly ModelFile[], options?: EnsureModelOptions) => Promise<EnsureModelResult>
  loadEmbedder?: (modelDir: string) => Promise<Embedder>
  /** 模型文件是否齐全；缺省检查清单里每个文件的大小。 */
  modelPresent?: () => boolean
  log?: (message: string) => void
}

/**
 * 排序、阈值过滤与截断。
 *
 * 分数相同时按 id 排序：同一批候选每次都应得到同样的顺序，否则模型每次看到的能力
 * 列表都在变，召回结果无法复现。
 *
 * @param hits - 未排序的命中。
 * @param topK - 最多返回条数。
 * @param threshold - 最低相似度。
 * @returns 排好序的命中。
 */
export function selectTopK(hits: readonly EmbeddingHit[], topK: number, threshold: number): EmbeddingHit[] {
  return [...hits]
    .filter(hit => hit.score >= threshold)
    .sort((a, b) => (b.score - a.score) || compareIds(a.id, b.id))
    .slice(0, Math.max(0, topK))
}

/**
 * 向量检索服务。
 *
 * 生命周期：`start()`（装配时调用）→ 可能后台加载 → `enable()` / `disable()`；
 * 卸载时 `dispose()`。
 */
export class EmbeddingService {
  private statusValue: EmbeddingStatus['status'] = 'idle'
  private message: string | undefined
  private embedder: Embedder | undefined
  /** 进行中的加载；并发开启、后台加载与按需检索共用它。 */
  private starting: Promise<Embedder | undefined> | undefined
  /** 进行中的开启流程；并发开启复用同一次下载与加载。 */
  private enabling: Promise<EmbeddingEnableResult> | undefined
  private vectors: VectorStore | undefined
  private disposed = false

  constructor(private readonly options: EmbeddingServiceOptions) {}

  /**
   * 当前状态，供快照展示。
   *
   * @returns 配置里的开关 + 运行时状态。
   */
  status(): EmbeddingStatus {
    return {
      enabled: this.options.config().embedding.enabled,
      status: this.statusValue,
      ...this.message === undefined ? {} : { message: this.message },
    }
  }

  /**
   * 装配时调用：配置说开启且模型齐全就后台加载，模型缺失则自愈为关闭。
   *
   * 自愈是必须的：`enabled` 会让索引不再注入（模式 B），如果模型同时不可用，
   * 模型既看不到索引也召不回任何东西。
   */
  start(): void {
    if (this.disposed) return
    if (!this.options.config().embedding.enabled) return
    if (!this.present()) {
      this.warn('向量检索已关闭：模型文件缺失，请重新开启以下载模型')
      this.options.saveEmbedding({ enabled: false })
      return
    }
    void this.beginLoad().then(embedder => {
      // 加载失败同样要自愈为关闭：配置开着但模型不可用，会让 mode B 空转。
      if (embedder === undefined && !this.disposed) this.options.saveEmbedding({ enabled: false })
    })
  }

  /**
   * 开启：补齐模型 → 加载会话 → 写回配置。
   *
   * 整个流程可能持续几十秒（下载 24MB）；调用方同步等待，界面只需要转圈。
   *
   * @returns 成功标志；失败时保持关闭并给出稳定错误码与可行动原因。
   */
  async enable(): Promise<EmbeddingEnableResult> {
    if (this.disposed) return { ok: false, code: 'embedding-unavailable', message: '插件已卸载，无法开启向量检索' }
    // 并发开启（例如两个窗口同时点开关）必须复用同一次下载与加载。
    if (this.enabling !== undefined) return this.enabling
    const running = this.runEnable()
    this.enabling = running
    try {
      return await running
    } finally {
      this.enabling = undefined
    }
  }

  private async runEnable(): Promise<EmbeddingEnableResult> {
    const existing = this.starting
    if (existing !== undefined) {
      const embedder = await existing
      if (embedder !== undefined) {
        this.saveEnabled()
        return { ok: true }
      }
      return { ok: false, code: 'embedding-unavailable', message: this.message ?? '向量模型加载失败' }
    }

    if (this.embedder !== undefined) {
      this.saveEnabled()
      return { ok: true }
    }

    this.statusValue = 'downloading'
    this.message = undefined
    let downloaded: EnsureModelResult
    try {
      downloaded = await this.ensure()(this.options.modelDir, MODEL_FILES, {
        onPhase: phase => {
          if (phase === 'downloading') this.statusValue = 'downloading'
          if (phase === 'verifying') this.statusValue = 'verifying'
        },
        log: this.warn,
      })
    } catch (error) {
      downloaded = { ok: false, message: describe(error) }
    }
    if (!downloaded.ok) {
      this.statusValue = 'failed'
      this.message = `模型下载失败：${downloaded.message}`
      this.warn(this.message)
      return { ok: false, code: 'embedding-download-failed', message: this.message }
    }

    this.statusValue = 'verifying'
    const embedder = await this.beginLoad()
    if (embedder === undefined) {
      return { ok: false, code: 'embedding-unavailable', message: this.message ?? '向量模型加载失败' }
    }
    this.saveEnabled()
    return { ok: true }
  }

  /**
   * 关闭：释放会话并写回配置。
   *
   * @returns 恒为成功——关闭是能收敛到「关着」的操作，没有失败分支。
   */
  async disable(): Promise<{ ok: true }> {
    this.message = undefined
    // 进行中的加载不会被取消；等它落地后再统一释放，避免同一会话被释放两次。
    const pending = this.starting
    if (pending !== undefined) {
      try {
        await pending
      } catch {
        // 加载失败已经记录过；这里只负责不留下会话。
      }
    }
    const embedder = this.embedder
    this.embedder = undefined
    if (embedder !== undefined) {
      try {
        await embedder.dispose()
      } catch (error) {
        this.warn(`释放向量会话失败：${describe(error)}`)
      }
    }
    this.statusValue = 'idle'
    this.options.saveEmbedding({ enabled: false })
    return { ok: true }
  }

  /**
   * 语义检索。
   *
   * 未开启、未就绪或推理失败时返回 `undefined`：调用方据此给模型一句说明，
   * 而不是让一次关键词检索变成工具错误。
   *
   * @param query - 自然语言关键词。
   * @param candidates - 当前可召回的候选（已按池与黑名单过滤）。
   * @returns 按相似度降序的命中；不可用时为 `undefined`。
   */
  async search(query: string, candidates: readonly EmbeddingCandidate[]): Promise<EmbeddingHit[] | undefined> {
    if (this.disposed) return undefined
    if (!this.options.config().embedding.enabled) return undefined

    const embedder = this.embedder ?? await this.beginLoad()
    if (embedder === undefined) return undefined

    try {
      const [queryVector] = await embedder.embed([query])
      if (queryVector === undefined) return undefined

      const vectors = new Map<CapabilityId, Float32Array>()
      const store = this.vectorStore()
      const missing: EmbeddingCandidate[] = []
      for (const candidate of candidates) {
        const cached = store.get(candidate.id, embeddingText(candidate))
        if (cached === undefined) missing.push(candidate)
        else vectors.set(candidate.id, cached)
      }

      if (missing.length > 0) {
        const computed = await embedder.embed(missing.map(embeddingText))
        missing.forEach((candidate, index) => {
          const vector = computed[index]
          if (vector === undefined) return
          vectors.set(candidate.id, vector)
          store.set(candidate.id, embeddingText(candidate), vector)
        })
        store.flush()
      }

      const hits: EmbeddingHit[] = []
      for (const candidate of candidates) {
        const vector = vectors.get(candidate.id)
        if (vector === undefined) continue
        hits.push({ id: candidate.id, score: dot(queryVector, vector) })
      }
      return selectTopK(hits, this.options.topK ?? DEFAULT_TOP_K, this.options.threshold ?? DEFAULT_THRESHOLD)
    } catch (error) {
      this.warn(`语义检索失败：${describe(error)}`)
      return undefined
    }
  }

  /** 卸载：释放会话，不再接受新的检索。 */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    // 加载中卸载：等它落地，否则会话会在赋值之后失去唯一的释放机会。
    const pending = this.starting
    if (pending !== undefined) {
      try {
        await pending
      } catch {
        // 同上：加载失败没有可释放的会话。
      }
    }
    const embedder = this.embedder
    this.embedder = undefined
    if (embedder !== undefined) {
      try {
        await embedder.dispose()
      } catch (error) {
        this.warn(`释放向量会话失败：${describe(error)}`)
      }
    }
  }

  /** 加载会话；并发调用共享同一个 promise。 */
  private beginLoad(): Promise<Embedder | undefined> {
    if (this.starting !== undefined) return this.starting
    this.statusValue = 'verifying'
    const loading = (async (): Promise<Embedder | undefined> => {
      try {
        const embedder = await this.load()(this.options.modelDir)
        this.embedder = embedder
        this.statusValue = 'ready'
        this.message = undefined
        return embedder
      } catch (error) {
        this.statusValue = 'failed'
        this.message = `向量模型加载失败：${describe(error)}`
        this.warn(this.message)
        return undefined
      } finally {
        this.starting = undefined
      }
    })()
    this.starting = loading
    return loading
  }

  /** 写入开启状态：模型目录与 revision 一起记下来，便于将来升级判断。 */
  private saveEnabled(): void {
    this.options.saveEmbedding({ enabled: true, modelDir: MODEL_DIRECTORY_NAME, revision: MODEL_REVISION })
  }

  private vectorStore(): VectorStore {
    if (this.vectors === undefined) {
      this.vectors = new VectorStore({
        path: this.options.vectorPath ?? join(this.options.modelDir, 'vectors.json'),
        log: this.warn,
      })
    }
    return this.vectors
  }

  private present(): boolean {
    if (this.options.modelPresent !== undefined) return this.options.modelPresent()
    try {
      return MODEL_FILES.every(file => statSync(join(this.options.modelDir, file.fileName)).size === file.size)
    } catch {
      return false
    }
  }

  private ensure(): NonNullable<EmbeddingServiceOptions['ensureModel']> {
    return this.options.ensureModel ?? ensureModel
  }

  private load(): (modelDir: string) => Promise<Embedder> {
    return this.options.loadEmbedder ?? loadEmbedder
  }

  private warn = (message: string): void => {
    this.options.log?.(message)
  }
}

/** 余弦相似度：两个向量都已归一化，点积即相似度。 */
function dot(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length)
  let sum = 0
  for (let index = 0; index < length; index += 1) sum += (left[index] ?? 0) * (right[index] ?? 0)
  return sum
}

function compareIds(left: CapabilityId, right: CapabilityId): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
