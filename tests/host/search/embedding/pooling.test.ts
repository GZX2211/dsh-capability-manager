// tests/host/search/embedding/pooling.test.ts
//
// CLS 池化 + L2 归一化：bge 系列用 [CLS] 位置的隐藏状态做句向量。

import { describe, expect, it } from 'vitest'
import { normalize, poolCls } from '../../../../src/host/search/embedding/pooling.ts'

function hidden(data: number[], dims: number[]): { data: Float32Array; dims: number[] } {
  return { data: Float32Array.from(data), dims }
}

describe('CLS 池化', () => {
  it('取 batch 第一条约第 0 个 token 的隐藏状态', () => {
    // dims = [batch=1, seq=3, hidden=2]
    const vector = poolCls(hidden([1, 2, 9, 9, 9, 9], [1, 3, 2]))

    expect([...vector]).toEqual([normalize(Float32Array.from([1, 2]))[0], normalize(Float32Array.from([1, 2]))[1]])
    expect(vector).toHaveLength(2)
  })

  it('结果已做 L2 归一化：模长为 1', () => {
    const vector = poolCls(hidden([3, 4, 7, 7], [1, 2, 2]))
    const norm = Math.hypot(...vector)

    expect(norm).toBeCloseTo(1, 6)
  })

  it('全零向量保持全零，不产生 NaN', () => {
    const vector = poolCls(hidden([0, 0, 5, 5], [1, 2, 2]))

    expect([...vector]).toEqual([0, 0])
  })

  it('维度不足时给出可行动的错误', () => {
    expect(() => poolCls(hidden([1, 2], [1, 2]))).toThrow(/last_hidden_state/)
  })

  it('数据长度小于声明的维度时拒绝取数', () => {
    expect(() => poolCls(hidden([1], [1, 1, 4]))).toThrow(/last_hidden_state/)
  })
})

describe('归一化', () => {
  it('按 L2 范数缩放', () => {
    expect([...normalize(Float32Array.from([0, 5]))]).toEqual([0, 1])
  })

  it('零向量原样返回', () => {
    expect([...normalize(Float32Array.from([0, 0, 0]))]).toEqual([0, 0, 0])
  })

  it('不修改入参', () => {
    const input = Float32Array.from([3, 4])

    normalize(input)

    expect([...input]).toEqual([3, 4])
  })
})
