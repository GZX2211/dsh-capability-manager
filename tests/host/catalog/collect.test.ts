import { describe, expect, it } from 'vitest'
import { collectTools, summarize } from '../../../src/host/catalog/collect.ts'

const official = (): 'official' => 'official'

describe('摘要', () => {
  it('取描述首行', () => {
    expect(summarize('读取文本文件。\n\n支持偏移与行数限制。')).toBe('读取文本文件。')
  })

  it('去掉首行两端的空白', () => {
    expect(summarize('   读取文本文件   \n后续')).toBe('读取文本文件')
  })

  it('缺少描述时是空串', () => {
    expect(summarize(undefined)).toBe('')
    expect(summarize('')).toBe('')
  })

  it('纯空白描述压成空串', () => {
    expect(summarize('  \n\t\n ')).toBe('')
  })

  it('超过 200 字符时截断', () => {
    expect(summarize('a'.repeat(250))).toBe('a'.repeat(200))
  })

  it('恰好 200 字符时不截断', () => {
    const text = 'a'.repeat(200)
    expect(summarize(text)).toBe(text)
  })

  it('截断不切碎代理对：emoji 按码点计数', () => {
    const text = '😀'.repeat(250)
    const summary = summarize(text)

    expect([...summary].length).toBe(200)
    expect(summary).not.toContain('\ud83d\ud83d')
  })
})

describe('工具条目收集', () => {
  it('按名称排序输出', () => {
    const entries = collectTools({
      definitions: [{ name: 'write' }, { name: 'bash' }, { name: 'read' }],
      classify: official,
    })

    expect(entries.map(entry => entry.name)).toEqual(['bash', 'read', 'write'])
  })

  it('条目带 kind 与 tool: 前缀的标识', () => {
    const [entry] = collectTools({ definitions: [{ name: 'read', description: '读取文件' }], classify: official })

    expect(entry).toMatchObject({ id: 'tool:read', kind: 'tool', name: 'read', summary: '读取文件' })
  })

  it('官方来源不算自有', () => {
    const [entry] = collectTools({ definitions: [{ name: 'read' }], classify: official })

    expect(entry).toMatchObject({ source: 'official', owned: false })
  })

  it('自建来源算自有，可直接删除或编辑', () => {
    const [entry] = collectTools({ definitions: [{ name: 'my_tool' }], classify: () => 'custom' })

    expect(entry).toMatchObject({ source: 'custom', owned: true })
  })

  it('默认认为可调用', () => {
    const [entry] = collectTools({ definitions: [{ name: 'read' }], classify: official })

    expect(entry?.available).toBe(true)
  })

  it('可由调用方判定当前是否可见', () => {
    const entries = collectTools({
      definitions: [{ name: 'read' }, { name: 'bash' }],
      classify: official,
      isAvailable: name => name !== 'bash',
    })

    expect(entries.find(entry => entry.name === 'bash')?.available).toBe(false)
  })

  it('空输入得到空结果', () => {
    expect(collectTools({ definitions: [], classify: official })).toEqual([])
  })

  it('多行描述只保留首行摘要', () => {
    const [entry] = collectTools({
      definitions: [{ name: 'read', description: '第一行\n第二行' }],
      classify: official,
    })

    expect(entry?.summary).toBe('第一行')
  })
})
