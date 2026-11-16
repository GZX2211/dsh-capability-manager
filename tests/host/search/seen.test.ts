import { describe, expect, it } from 'vitest'
import { toolNamesOf, toolPayloadsOf } from '../../../src/host/search/seen.ts'

describe('当前可见工具的载荷', () => {
  it('每个工具产出一个载荷', () => {
    const payloads = toolPayloadsOf([
      { name: 'read', description: '读文件', parameters: { type: 'object' } },
      { name: 'bash', description: '执行命令', parameters: { type: 'object' } },
    ])

    expect(payloads.size).toBe(2)
  })

  it('描述不同即载荷不同', () => {
    const payloads = toolPayloadsOf([
      { name: 'read', description: '旧' },
      { name: 'read', description: '新' },
    ])

    expect(payloads.size).toBe(2)
  })

  it('同一份 schema 只产出一个载荷', () => {
    const payloads = toolPayloadsOf([
      { name: 'read', description: '同一个' },
      { name: 'read', description: '同一个' },
    ])

    expect(payloads.size).toBe(1)
  })

  it('没有可见工具时是空集合', () => {
    expect(toolPayloadsOf([]).size).toBe(0)
  })
})

describe('当前可见工具的名称', () => {
  it('取出全部名称', () => {
    expect([...toolNamesOf([{ name: 'read' }, { name: 'bash' }])]).toEqual(['read', 'bash'])
  })

  it('重复名称只留一个', () => {
    expect([...toolNamesOf([{ name: 'read' }, { name: 'read' }])]).toEqual(['read'])
  })

  it('没有可见工具时是空集合', () => {
    expect(toolNamesOf([]).size).toBe(0)
  })
})
