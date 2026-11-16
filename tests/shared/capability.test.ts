import { describe, expect, it } from 'vitest'
import { parseId, skillId, toolId } from '../../src/shared/capability.ts'

describe('能力标识构造', () => {
  it('工具标识带 tool: 前缀', () => {
    expect(toolId('read')).toBe('tool:read')
  })

  it('Skill 标识带 skill: 前缀', () => {
    expect(skillId('office-docx')).toBe('skill:office-docx')
  })

  it('工具名与 Skill 名不共享命名空间：同名不同类型的标识不同', () => {
    expect(toolId('office')).not.toBe(skillId('office'))
  })
})

describe('能力标识解析', () => {
  it('解析工具标识', () => {
    expect(parseId('tool:read')).toEqual({ kind: 'tool', name: 'read' })
  })

  it('解析 Skill 标识', () => {
    expect(parseId('skill:office-docx')).toEqual({ kind: 'skill', name: 'office-docx' })
  })

  it('名称里的冒号属于名称本身，只按第一个冒号切分', () => {
    expect(parseId('tool:mcp__a:b')).toEqual({ kind: 'tool', name: 'mcp__a:b' })
  })

  it('往返闭合：带冒号的名称构造后能解析回原值', () => {
    const name = 'server__tool:sub'
    expect(parseId(toolId(name))).toEqual({ kind: 'tool', name })
  })

  it('未知类型前缀不可解析', () => {
    expect(parseId('unknown:read')).toBeUndefined()
  })

  it('类型前缀区分大小写', () => {
    expect(parseId('Tool:read')).toBeUndefined()
  })

  it('缺少名称不可解析', () => {
    expect(parseId('tool:')).toBeUndefined()
  })

  it('缺少类型前缀不可解析', () => {
    expect(parseId(':read')).toBeUndefined()
  })

  it('没有冒号的标识不可解析', () => {
    expect(parseId('read')).toBeUndefined()
  })

  it('空串不可解析', () => {
    expect(parseId('')).toBeUndefined()
  })

  it('名称本身就是一个冒号时仍然可解析', () => {
    expect(parseId('tool::')).toEqual({ kind: 'tool', name: ':' })
  })

  it('空名称在构造侧不校验、在解析侧被拒绝，往返因此不闭合', () => {
    // 构造是纯拼接，调用方（配置读取）不该因为一次空名拼接就崩溃；
    // 拒绝发生在解析侧，所以空名永远进不了下游的 restrict 名单。
    expect(parseId(toolId(''))).toBeUndefined()
  })
})
