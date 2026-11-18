// src/host/search/embedding/tokenizer.ts
//
// BERT WordPiece 分词：bge-small-zh 的输入侧契约。
//
// 只实现推理需要的那条路径：normalize → basic tokenize → wordPiece → 特殊 token。
// 不读 `tokenizer.json` 的 normalizer/pre_tokenizer 配置——模型固定、规则固定，
// 让行为由代码常量决定，而不是由某个版本的文件内容决定。
//
// 纯函数：词表由调用方传入，本模块不读盘、不缓存。

/** 特殊 token 的固定 id（BERT 约定，与词表内容无关）。 */
export const PAD_ID = 0
export const UNK_ID = 100
export const CLS_ID = 101
export const SEP_ID = 102

/** 序列上限（含 [CLS] 与 [SEP]）；bge-small-zh 的位置上限就是 512。 */
export const MAX_SEQUENCE_LENGTH = 512

/** 单个词的字符上限；超过直接 [UNK]，避免病态输入上的长回溯。 */
const MAX_WORD_CHARS = 100

/** `tokenizer.json` 里本模块需要的最小形状。 */
export interface TokenizerData {
  model: { vocab: Record<string, number> }
}

export interface Tokenizer {
  /**
   * 把一段文本编码成模型输入 id 序列。
   *
   * @param text - 任意文本；空串或纯空白只产出 `[CLS] [SEP]`。
   * @returns 以 `[CLS]` 开头、`[SEP]` 结尾、长度不超过 {@link MAX_SEQUENCE_LENGTH} 的 id。
   */
  encode(text: string): number[]
}

/** 汉字、假名与谚文：逐字成词，不参与拉丁词累积。 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u
/** 字母与数字（含 CJK，调用点先排除 CJK）。 */
const WORD_CHAR = /[\p{L}\p{N}]/u
const WHITESPACE = /\s/u
const COMBINING_MARK = /\p{Mn}/gu

/**
 * 建立分词器。
 *
 * @param data - 至少包含 `model.vocab` 的 tokenizer 数据。
 * @returns 只读分词器。
 */
export function createTokenizer(data: TokenizerData): Tokenizer {
  const vocab = data.model.vocab
  const unkId = vocab['[UNK]'] ?? UNK_ID

  return {
    encode(text) {
      const ids: number[] = [CLS_ID]
      // 留出 [SEP] 的位置：正文最多 MAX - 2 个 id。
      const budget = MAX_SEQUENCE_LENGTH - 2
      for (const token of basicTokenize(text)) {
        if (ids.length - 1 >= budget) break
        for (const piece of wordPiece(vocab, token)) {
          if (ids.length - 1 >= budget) break
          ids.push(vocab[piece] ?? unkId)
        }
      }
      ids.push(SEP_ID)
      return ids
    },
  }
}

/**
 * 归一化后切分：空白分隔、CJK 逐字、其余非字母数字逐字、字母数字连成词。
 *
 * 转小写与去重音是方案 §5.5 的固定规则，不依赖 `tokenizer.json` 里的开关。
 */
function basicTokenize(text: string): string[] {
  const tokens: string[] = []
  let word = ''
  const flush = (): void => {
    if (word.length === 0) return
    tokens.push(word)
    word = ''
  }

  for (const char of stripAccents(text)) {
    if (WHITESPACE.test(char)) {
      flush()
      continue
    }
    if (CJK.test(char) || !WORD_CHAR.test(char)) {
      flush()
      tokens.push(char)
      continue
    }
    word += char
  }
  flush()
  return tokens
}

/** 转小写并去掉组合用变音符；`Café` → `cafe`。 */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARK, '').toLowerCase()
}

/**
 * 贪心最长匹配：从当前位置向右找词表里存在的最长片段。
 *
 * 词内片段带 `##` 前缀；任何一段都匹配不上时整词变成 `[UNK]`
 * （WordPiece 的语义是「整词不认识」，而不是返回已匹配的前缀）。
 */
function wordPiece(vocab: Record<string, number>, token: string): string[] {
  if (token.length > MAX_WORD_CHARS) return ['[UNK]']
  const pieces: string[] = []
  let start = 0
  while (start < token.length) {
    let end = token.length
    let found: string | undefined
    while (start < end) {
      const candidate = (start > 0 ? '##' : '') + token.slice(start, end)
      if (Object.hasOwn(vocab, candidate)) {
        found = candidate
        break
      }
      end -= 1
    }
    if (found === undefined) return ['[UNK]']
    pieces.push(found)
    start = end
  }
  return pieces
}
