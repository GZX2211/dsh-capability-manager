// src/host/search/embedding/runtime.ts
//
// 推理封装：文本 → 句向量。
//
// 会话与张量工厂都是注入的，所以本模块在没有原生运行时、没有模型文件的环境里
// 也能单测；真正加载 onnxruntime-node 与模型的入口是 `loadEmbedder`。
//
// 一次一条文本推理（batch=1）：单条 2–4ms，几十个能力的总耗时在百毫秒级，
// 换来的是不必处理变长序列填充与 mask 对齐。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { poolCls, type HiddenState } from './pooling.ts'
import { createTokenizer, type Tokenizer } from './tokenizer.ts'

/** 会话里本模块用到的最小面；真实 `InferenceSession` 满足它。 */
export interface SessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>
  release?(): Promise<void>
}

/** 构造 int64 张量；注入以便在测试里用普通对象代替 ORT。 */
export type TensorFactory = (values: BigInt64Array, dims: readonly number[]) => unknown

export interface Embedder {
  /**
   * 把一批文本编码成句向量。
   *
   * @param texts - 任意文本；空数组不触发推理。
   * @returns 与输入等长、逐条归一化的向量。
   */
  embed(texts: readonly string[]): Promise<Float32Array[]>
  /** 释放会话；重复调用只生效一次。 */
  dispose(): Promise<void>
}

export interface CreateEmbedderOptions {
  tokenizer: Pick<Tokenizer, 'encode'>
  session: SessionLike
  createTensor: TensorFactory
}

/**
 * 用现成的会话与分词器建立嵌入器。
 *
 * @param options - 分词器、会话与张量工厂。
 * @returns 嵌入器。
 */
export function createEmbedder(options: CreateEmbedderOptions): Embedder {
  let disposed = false

  return {
    async embed(texts) {
      const vectors: Float32Array[] = []
      for (const text of texts) {
        const ids = options.tokenizer.encode(text)
        const length = ids.length
        const inputIds = BigInt64Array.from(ids.map(value => BigInt(value)))
        const attentionMask = BigInt64Array.from({ length }, () => 1n)
        const tokenTypes = BigInt64Array.from({ length }, () => 0n)
        const dims = [1, length]

        const output = await options.session.run({
          input_ids: options.createTensor(inputIds, dims),
          attention_mask: options.createTensor(attentionMask, dims),
          token_type_ids: options.createTensor(tokenTypes, dims),
        })
        const hidden = output['last_hidden_state']
        if (hidden === undefined) throw new Error('模型输出缺少 last_hidden_state')
        vectors.push(poolCls(hidden as HiddenState))
      }
      return vectors
    },

    async dispose() {
      if (disposed) return
      disposed = true
      await options.session.release?.()
    },
  }
}

/**
 * 从模型目录加载嵌入器。
 *
 * 动态导入 `onnxruntime-node`：插件启动时不需要原生模块，只有真正开启向量检索
 * 才付出加载成本；原生模块加载失败也能被上层当成一次「不可用」处理。
 *
 * @param modelDir - 模型目录（tokenizer.json 与 model_quantized.onnx 所在处）。
 * @returns 嵌入器。
 */
export async function loadEmbedder(modelDir: string): Promise<Embedder> {
  const ort = await import('onnxruntime-node')
  const tokenizer = createTokenizer(
    JSON.parse(readFileSync(join(modelDir, 'tokenizer.json'), 'utf8')) as {
      model: { vocab: Record<string, number> }
    },
  )

  const session = await ort.InferenceSession.create(join(modelDir, 'model_quantized.onnx'), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: 2,
  })

  return createEmbedder({
    tokenizer,
    session: {
      async run(feeds) {
        const output = await session.run(feeds as Parameters<typeof session.run>[0])
        return output as unknown as Awaited<ReturnType<SessionLike['run']>>
      },
      async release() {
        await session.release()
      },
    },
    createTensor: (values, dims) => new ort.Tensor('int64', values, [...dims]),
  })
}
