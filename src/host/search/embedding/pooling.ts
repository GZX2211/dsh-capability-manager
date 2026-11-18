// src/host/search/embedding/pooling.ts
//
// 句向量：bge 系列取 [CLS] 位置的隐藏状态，再做 L2 归一化。
//
// 归一化后余弦相似度就是点积，检索时不必再算模长。全零向量保持全零而不是
// 除以零：模型偶尔会对退化输入输出零向量，那不该变成 NaN 污染整次排序。

/** `last_hidden_state` 的形状：`[batch, seq, hidden]`。 */
export interface HiddenState {
  data: Float32Array
  dims: readonly number[]
}

/**
 * 从隐藏状态里取第一条样本的 [CLS] 向量并归一化。
 *
 * @param hidden - 模型输出；dims 必须是 `[1, seq, hidden]` 形状。
 * @returns 归一化后的句向量。
 * @throws 维度或数据长度与声明不符时抛出——这属于模型契约漂移，不能静默产出向量。
 */
export function poolCls(hidden: HiddenState): Float32Array {
  const { data, dims } = hidden
  const [batch, , hiddenSize] = dims
  if (dims.length !== 3 || batch === undefined || hiddenSize === undefined || hiddenSize <= 0) {
    throw new Error(`last_hidden_state 的维度应为 [batch, seq, hidden]，收到 ${dims.join('x')}`)
  }
  if (data.length < hiddenSize) {
    throw new Error(`last_hidden_state 的数据不足：需要至少 ${String(hiddenSize)} 个数值，收到 ${String(data.length)}`)
  }

  const cls = new Float32Array(hiddenSize)
  for (let index = 0; index < hiddenSize; index += 1) cls[index] = data[index] ?? 0
  return normalize(cls)
}

/**
 * L2 归一化。
 *
 * @param vector - 任意向量；不被修改。
 * @returns 模长为 1 的新向量；零向量返回全零向量。
 */
export function normalize(vector: Float32Array): Float32Array {
  let squareSum = 0
  for (const value of vector) squareSum += value * value
  const length = Math.sqrt(squareSum)

  const result = new Float32Array(vector.length)
  if (length === 0) return result
  for (let index = 0; index < vector.length; index += 1) result[index] = (vector[index] ?? 0) / length
  return result
}
