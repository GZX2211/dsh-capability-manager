// src/host/search/embedding/download.ts
//
// 模型下载：按需补齐缺失或损坏的文件，多源回退，落盘前逐个校验 size + sha256。
//
// 三条硬性要求来自方案 §5.5：
//   · 只下载需要的那几个文件，已就绪的目录不发任何请求；
//   · 校验不过就删掉重下，绝不留下「看起来下载完了」的坏文件；
//   · 失败时必须清理临时文件，否则下次启动会对着半截内容反复失败。
//
// 网络与磁盘都是副作用，因此这里接受注入的 fetch 与日志，便于在没有外网的测试里验证规则。

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MODEL_FILES,
  MODEL_MANIFEST_NAME,
  MODEL_REPO,
  MODEL_REVISION,
  MODEL_SOURCES,
  sourceUrl,
  type ModelFile,
  type ModelManifest,
} from './model.ts'

export type { ModelFile } from './model.ts'

/** 下载器对外报告的状态；服务据此驱动 `embedding.status`。 */
export type EnsureModelPhase = 'downloading' | 'verifying' | 'ready' | 'failed'

export interface EnsureModelOptions {
  /** 源的顺序；缺省为 {@link MODEL_SOURCES}。 */
  origins?: readonly string[]
  /** 注入的 fetch；缺省用全局 fetch。 */
  fetch?: typeof fetch
  /** 单次请求超时。 */
  timeoutMs?: number
  onPhase?: (phase: EnsureModelPhase) => void
  log?: (message: string) => void
}

export type EnsureModelResult = { ok: true } | { ok: false; message: string }

/**
 * 确保模型目录里有一份完整、校验通过的模型。
 *
 * @param modelDir - 模型目录；不存在时创建。
 * @param files - 清单；缺省为 {@link MODEL_FILES}（测试注入假清单）。
 * @param options - 源、超时、阶段回调与日志。
 * @returns 成功标志；失败时给出可行动的原因。
 */
export async function ensureModel(
  modelDir: string,
  files: readonly ModelFile[] = MODEL_FILES,
  options: EnsureModelOptions = {},
): Promise<EnsureModelResult> {
  const fetchImpl = options.fetch ?? fetch
  const origins = options.origins ?? MODEL_SOURCES
  const timeoutMs = options.timeoutMs ?? 120_000
  const log = options.log ?? (() => {})

  mkdirSync(modelDir, { recursive: true })

  const pending = files.filter(file => !verifyFile(join(modelDir, file.fileName), file))
  if (pending.length === 0) {
    writeManifest(modelDir, files)
    options.onPhase?.('ready')
    return { ok: true }
  }

  options.onPhase?.('downloading')

  for (const file of pending) {
    const target = join(modelDir, file.fileName)
    const temporary = `${target}.part`
    let lastFailure = 'no source configured'
    let saved = false

    for (const origin of origins) {
      const url = sourceUrl(origin, file)
      try {
        await download(url, temporary, { fetch: fetchImpl, timeoutMs })
        options.onPhase?.('verifying')
        if (!verifyFile(temporary, file)) {
          throw new Error(`校验失败：期望 ${String(file.size)} B / sha256 ${file.sha256}`)
        }
        // 先写临时文件再改名：任何时刻目标路径要么不存在，要么是完整且校验过的内容。
        renameSync(temporary, target)
        saved = true
        break
      } catch (error) {
        lastFailure = `${origin} 失败：${describe(error)}`
        log(`model download failed for ${file.fileName} from ${origin}: ${describe(error)}`)
        rmSync(temporary, { force: true })
      }
    }

    if (!saved) {
      options.onPhase?.('failed')
      return { ok: false, message: `无法获取模型文件 ${file.fileName}。${lastFailure}` }
    }
  }

  writeManifest(modelDir, files)
  options.onPhase?.('ready')
  return { ok: true }
}

/**
 * 把远程文件写到临时路径。
 *
 * 模型最大 24MB，一次性读入即可：流式写盘会多一层错误面（半截流、句柄泄漏），
 * 而收益在这个体量上可以忽略。
 */
async function download(
  url: string,
  target: string,
  options: { fetch: typeof fetch; timeoutMs: number },
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await options.fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    writeFileSync(target, buffer)
  } finally {
    clearTimeout(timer)
  }
}

/** 文件存在、大小一致且 sha256 一致。 */
function verifyFile(path: string, file: ModelFile): boolean {
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size !== file.size) return false
    return sha256Of(path) === file.sha256
  } catch {
    // 不存在、不可读、是目录：都按「需要重新下载」处理。
    return false
  }
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeManifest(modelDir: string, files: readonly ModelFile[]): void {
  const manifest: ModelManifest = { repo: MODEL_REPO, revision: MODEL_REVISION, files: [...files] }
  writeFileSync(join(modelDir, MODEL_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
