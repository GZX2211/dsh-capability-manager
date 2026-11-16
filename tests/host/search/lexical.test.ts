import { describe, expect, it } from 'vitest'
import { compileNamePattern, matchNames } from '../../../src/host/search/lexical.ts'

describe('名称片段编译', () => {
  it('编译出大小写不敏感的正则', () => {
    const pattern = compileNamePattern('read')

    expect(pattern?.flags).toBe('i')
  })

  it('未锚定：片段命中名字的任何位置', () => {
    const pattern = compileNamePattern('read')
    if (pattern === undefined) throw new Error('expected a pattern')

    expect(matchNames(['read', 'reader', 'already_read', 'write'], pattern)).toEqual(
      new Set(['read', 'reader', 'already_read']),
    )
  })

  it('竖线分隔的名称组按正则分支处理', () => {
    const pattern = compileNamePattern('read|write')
    if (pattern === undefined) throw new Error('expected a pattern')

    expect(matchNames(['read', 'write', 'edit'], pattern)).toEqual(new Set(['read', 'write']))
  })

  it('非法正则返回 undefined 且不抛错', () => {
    expect(compileNamePattern('[a')).toBeUndefined()
    expect(compileNamePattern('a{2,1}')).toBeUndefined()
  })

  it('空串与纯空白视为未提供', () => {
    expect(compileNamePattern('')).toBeUndefined()
    expect(compileNamePattern('   ')).toBeUndefined()
  })

  it('用户串里的正则元字符按正则解释，不做转义', () => {
    const pattern = compileNamePattern('re.d')
    if (pattern === undefined) throw new Error('expected a pattern')

    expect(matchNames(['read', 'rexd'], pattern)).toEqual(new Set(['read', 'rexd']))
  })

  it('中文名称可直接匹配', () => {
    const pattern = compileNamePattern('读取')
    if (pattern === undefined) throw new Error('expected a pattern')

    expect(matchNames(['读取文件', '写入文件'], pattern)).toEqual(new Set(['读取文件']))
  })
})

describe('名称召回', () => {
  it('保持候选顺序', () => {
    const pattern = compileNamePattern('e')
    if (pattern === undefined) throw new Error('expected a pattern')

    expect([...matchNames(['edit', 'read', 'glob', 'grep'], pattern)]).toEqual(['edit', 'read', 'grep'])
  })

  it('没有命中时返回空集合', () => {
    const pattern = compileNamePattern('zzz')
    if (pattern === undefined) throw new Error('expected a pattern')

    expect(matchNames(['read', 'write'], pattern).size).toBe(0)
  })

  it('空候选返回空集合', () => {
    const pattern = compileNamePattern('read')
    if (pattern === undefined) throw new Error('expected a pattern')

    expect(matchNames([], pattern).size).toBe(0)
  })

  it('带 g 标志的正则被复用也不会因 lastIndex 漏匹配', () => {
    // 调用方可能传进复用中的全局正则；逐个重置才能保证每个候选都被测到。
    expect(matchNames(['read', 'read'], /read/g)).toEqual(new Set(['read']))
  })

  it('同一个正则连续用于多个候选集合结果一致', () => {
    const pattern = compileNamePattern('read')
    if (pattern === undefined) throw new Error('expected a pattern')

    expect(matchNames(['read'], pattern)).toEqual(new Set(['read']))
    expect(matchNames(['read'], pattern)).toEqual(new Set(['read']))
  })
})
