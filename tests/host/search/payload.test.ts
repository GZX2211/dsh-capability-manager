import { describe, expect, it } from 'vitest'
import { canonicalize, skillPayload, toolPayload } from '../../../src/host/search/payload.ts'

describe('载荷规范化', () => {
  it('键序不同的同一对象产出同一个值', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: 2 }))).toBe(JSON.stringify(canonicalize({ a: 2, b: 1 })))
  })

  it('嵌套对象也按键序排序', () => {
    const left = canonicalize({ a: { d: 1, c: 2 }, b: 3 })
    const right = canonicalize({ b: 3, a: { c: 2, d: 1 } })

    expect(JSON.stringify(left)).toBe(JSON.stringify(right))
  })

  it('数组顺序保留：不同顺序是不同的载荷', () => {
    expect(JSON.stringify(canonicalize([1, 2]))).not.toBe(JSON.stringify(canonicalize([2, 1])))
  })

  it('数组元素里的对象同样被排序', () => {
    const left = canonicalize([{ b: 1, a: 2 }])
    const right = canonicalize([{ a: 2, b: 1 }])

    expect(JSON.stringify(left)).toBe(JSON.stringify(right))
  })

  it('原始值原样返回', () => {
    expect(canonicalize(1)).toBe(1)
    expect(canonicalize('x')).toBe('x')
    expect(canonicalize(true)).toBe(true)
    expect(canonicalize(null)).toBeNull()
    expect(canonicalize(undefined)).toBeUndefined()
  })

  it('__proto__ 作为数据键被保留，而不是改写原型', () => {
    const source = JSON.parse('{"__proto__":{"x":1},"a":2}') as Record<string, unknown>
    const text = JSON.stringify(canonicalize(source))

    expect(text).toContain('__proto__')
    expect(text).toContain('"a":2')
  })

  it('不修改输入对象', () => {
    const source = { b: 1, a: 2 }
    canonicalize(source)

    expect(Object.keys(source)).toEqual(['b', 'a'])
  })
})

describe('工具载荷', () => {
  const schema = {
    name: 'read',
    description: '读取文本文件',
    parameters: { path: { type: 'string' }, offset: { type: 'number' } },
  }

  it('参数键序不影响载荷', () => {
    const reordered = {
      name: 'read',
      description: '读取文本文件',
      parameters: { offset: { type: 'number' }, path: { type: 'string' } },
    }

    expect(toolPayload(schema)).toBe(toolPayload(reordered))
  })

  it('描述变化会改变载荷', () => {
    expect(toolPayload(schema)).not.toBe(toolPayload({ ...schema, description: '改了' }))
  })

  it('缺少描述时按空串参与规范化', () => {
    const withoutDescription = toolPayload({ name: 'noop', parameters: {} })

    expect(withoutDescription).toBe(toolPayload({ name: 'noop', description: '', parameters: {} }))
  })

  it('载荷与工具索引无关：索引不含参数', () => {
    expect(toolPayload(schema)).not.toContain('summary')
  })

  it('参数缺省与参数为空对象是两份不同载荷', () => {
    expect(toolPayload({ name: 'noop' })).not.toBe(toolPayload({ name: 'noop', parameters: {} }))
  })
})

describe('Skill 载荷', () => {
  it('名称与描述拼成一条载荷', () => {
    expect(skillPayload({ name: 'office', description: '办公文档' })).toBe('office\u0000办公文档')
  })

  it('描述不同则载荷不同', () => {
    expect(skillPayload({ name: 'office', description: 'A' })).not.toBe(
      skillPayload({ name: 'office', description: 'B' }),
    )
  })

  it('名称与描述的分隔不会被内容抹平', () => {
    // 用 NUL 作分隔：任何一边出现空格或冒号都不会产生同样的载荷。
    expect(skillPayload({ name: 'a b', description: 'c' })).not.toBe(skillPayload({ name: 'a', description: 'b c' }))
  })
})
