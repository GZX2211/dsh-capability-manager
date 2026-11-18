// tests/host/search/embedding/tokenizer.test.ts
//
// BERT WordPiece 分词：bge-small-zh 的输入侧契约。
//
// 用自建小词表而不是真实 tokenizer.json：断言点应该是「规则」，而不是某一版词表的内容。

import { describe, expect, it } from 'vitest'
import { CLS_ID, MAX_SEQUENCE_LENGTH, SEP_ID, UNK_ID, createTokenizer } from '../../../../src/host/search/embedding/tokenizer.ts'

/** 小词表：只放本文件用到的 token，便于断言每一步的命中情况。 */
const VOCAB: Record<string, number> = {
  '[PAD]': 0,
  '[UNK]': 100,
  '[CLS]': CLS_ID,
  '[SEP]': SEP_ID,
  读: 700,
  取: 701,
  文: 702,
  本: 703,
  件: 704,
  read: 800,
  play: 801,
  '##ing': 802,
  '##s': 803,
  cafe: 900,
  ability: 901,
  manager: 902,
  a: 903,
  b: 904,
}

function encode(text: string): number[] {
  return createTokenizer({ model: { vocab: VOCAB } }).encode(text)
}

describe('特殊 token', () => {
  it('空串只产出 [CLS] [SEP]', () => {
    expect(encode('')).toEqual([CLS_ID, SEP_ID])
  })

  it('纯空白等同于空串', () => {
    expect(encode('   \n\t ')).toEqual([CLS_ID, SEP_ID])
  })

  it('缺少 [UNK] 时回落到 BERT 的固定 id 100', () => {
    const tokenizer = createTokenizer({ model: { vocab: { '[CLS]': CLS_ID, '[SEP]': SEP_ID } } })

    // 「未登录」是三个汉字，各自成词，各自 [UNK]。
    expect(tokenizer.encode('未登录')).toEqual([CLS_ID, UNK_ID, UNK_ID, UNK_ID, SEP_ID])
  })
})

describe('中文', () => {
  it('按字切分', () => {
    // 读 取 文 本 文 件
    expect(encode('读取文本文件')).toEqual([CLS_ID, 700, 701, 702, 703, 702, 704, SEP_ID])
  })

  it('中文与拉丁混排时各自成词', () => {
    expect(encode('读取read文本文件')).toEqual([CLS_ID, 700, 701, 800, 702, 703, 702, 704, SEP_ID])
  })
})

describe('拉丁子词', () => {
  it('整词命中时不再拆分', () => {
    expect(encode('read')).toEqual([CLS_ID, 800, SEP_ID])
  })

  it('整词未命中时贪心最长匹配，词内片段带 ## 前缀', () => {
    expect(encode('playing')).toEqual([CLS_ID, 801, 802, SEP_ID])
  })

  it('转小写后再匹配', () => {
    expect(encode('READ Play')).toEqual([CLS_ID, 800, 801, SEP_ID])
  })

  it('去重音后再匹配', () => {
    expect(encode('Café')).toEqual([CLS_ID, 900, SEP_ID])
  })

  it('完全无法拆分时整词变成 [UNK]', () => {
    expect(encode('zzz')).toEqual([CLS_ID, UNK_ID, SEP_ID])
  })

  it('数字按连续序列成词：词表里没有时是 [UNK]', () => {
    expect(encode('123')).toEqual([CLS_ID, UNK_ID, SEP_ID])
  })
})

describe('标点与空白', () => {
  it('标点单独成词', () => {
    expect(encode('a,b')).toEqual([CLS_ID, 903, UNK_ID, 904, SEP_ID])
  })

  it('连续空白不产生空 token', () => {
    expect(encode('read   play')).toEqual([CLS_ID, 800, 801, SEP_ID])
  })
})

describe('截断', () => {
  it('超长输入截断到最大长度，首尾仍是特殊 token', () => {
    const ids = encode('读'.repeat(MAX_SEQUENCE_LENGTH + 100))

    expect(ids).toHaveLength(MAX_SEQUENCE_LENGTH)
    expect(ids[0]).toBe(CLS_ID)
    expect(ids.at(-1)).toBe(SEP_ID)
  })

  it('正好等于上限时不被截断', () => {
    const ids = encode('读'.repeat(MAX_SEQUENCE_LENGTH - 2))

    expect(ids).toHaveLength(MAX_SEQUENCE_LENGTH)
  })

  it('超过单词长度上限的拉丁词整体变成 [UNK]', () => {
    expect(encode('a'.repeat(150))).toEqual([CLS_ID, UNK_ID, SEP_ID])
  })

  it('正文预算正好用满时保留完整的 [CLS] … [SEP]', () => {
    const ids = encode('读'.repeat(MAX_SEQUENCE_LENGTH - 2))

    expect(ids).toHaveLength(MAX_SEQUENCE_LENGTH)
    expect(ids[1]).toBe(700)
    expect(ids[MAX_SEQUENCE_LENGTH - 2]).toBe(700)
  })
})

describe('字母数字连写', () => {
  it('字母与数字视为同一个词，整体未登录时是 [UNK]', () => {
    expect(encode('abc123')).toEqual([CLS_ID, UNK_ID, SEP_ID])
  })
})
