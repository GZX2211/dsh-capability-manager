// tests/host/search/embedding/runtime.test.ts
//
// 嵌入器：把文本变成向量。会话与张量工厂都是注入的，因此这里不加载真实模型。

import { describe, expect, it } from 'vitest'
import { createEmbedder, type SessionLike } from '../../../../src/host/search/embedding/runtime.ts'
import type { Tokenizer } from '../../../../src/host/search/embedding/tokenizer.ts'

interface RecordedFeed {
  ids: number[]
  mask: number[]
  types: number[]
}

/** 只回显输入的假会话：隐藏状态 = [ids.length, 100, 200]。 */
function fakeSession(): { session: SessionLike; feeds: RecordedFeed[] } {
  const feeds: RecordedFeed[] = []
  const session: SessionLike = {
    async run(input) {
      const ids = [...((input['input_ids'] as { data: BigInt64Array }).data)].map(value => Number(value))
      const mask = [...((input['attention_mask'] as { data: BigInt64Array }).data)].map(value => Number(value))
      const types = [...((input['token_type_ids'] as { data: BigInt64Array }).data)].map(value => Number(value))
      feeds.push({ ids, mask, types })
      const hidden = 2
      const data = Float32Array.from([ids.length, 100, 0, 0, 0, 0])
      return { last_hidden_state: { data, dims: [1, ids.length, hidden] } }
    },
  }
  return { session, feeds }
}

const tokenizer: Tokenizer = {
  encode: (text: string) => [101, Math.max(1, [...text].length), 102],
}

function embedder(session: SessionLike) {
  return createEmbedder({
    tokenizer,
    session,
    createTensor: (data, dims) => ({ data, dims: [...dims] }),
  })
}

describe('嵌入器', () => {
  it('逐条编码并返回归一化向量', async () => {
    const { session } = fakeSession()
    const vectors = await embedder(session).embed(['ab', 'abcd'])

    expect(vectors).toHaveLength(2)
    // 假会话对 [101, len, 102] 返回 CLS = [3, 100]（len 恒为 3），归一化后应为此值。
    const norm = Math.sqrt(3 * 3 + 100 * 100)
    expect(vectors[0]?.[0]).toBeCloseTo(3 / norm, 6)
    expect(vectors[0]?.[1]).toBeCloseTo(100 / norm, 6)
    expect(Math.hypot(...vectors[1]!)).toBeCloseTo(1, 6)
  })

  it('把 tokenizer 的输出原样放进三种输入张量', async () => {
    const { session, feeds } = fakeSession()

    await embedder(session).embed(['x'])

    expect(feeds[0]).toEqual({ ids: [101, 1, 102], mask: [1, 1, 1], types: [0, 0, 0] })
  })

  it('空文本仍然跑一次前向', async () => {
    const { session, feeds } = fakeSession()

    const [vector] = await embedder(session).embed([''])

    expect(feeds).toHaveLength(1)
    expect(vector).toHaveLength(2)
  })

  it('空数组不调用模型', async () => {
    const { session, feeds } = fakeSession()

    expect(await embedder(session).embed([])).toEqual([])
    expect(feeds).toEqual([])
  })

  it('模型报错时原样抛出，由调用方决定降级', async () => {
    const broken: SessionLike = {
      async run() {
        throw new Error('session exploded')
      },
    }

    await expect(embedder(broken).embed(['x'])).rejects.toThrow('session exploded')
  })

  it('释放时调用一次 session.release', async () => {
    let released = 0
    const session: SessionLike = {
      ...fakeSession().session,
      async release() {
        released += 1
      },
    }
    const instance = embedder(session)

    await instance.dispose()
    await instance.dispose()

    expect(released).toBe(1)
  })
})
