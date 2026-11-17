// tests/host/selfmade/executors/template.test.ts

import { describe, expect, it } from 'vitest'
import { fillTemplate } from '../../../../src/host/selfmade/executors/template.ts'

describe('模板展开', () => {
  it('替换单个占位符', () => {
    expect(fillTemplate('hello {{name}}', { name: 'ada' })).toBe('hello ada')
  })

  it('替换多个占位符，同一个键可重复出现', () => {
    expect(fillTemplate('{{a}}-{{b}}-{{a}}', { a: 1, b: 2 })).toBe('1-2-1')
  })

  it('缺少参数时展开为空串，而不是留下占位符', () => {
    expect(fillTemplate('x{{missing}}y', {})).toBe('xy')
  })

  it('对象与数组参数序列化为 JSON', () => {
    expect(fillTemplate('{{payload}}', { payload: { a: 1 } })).toBe('{"a":1}')
    expect(fillTemplate('{{list}}', { list: [1, 2] })).toBe('[1,2]')
  })

  it('null 与布尔值按 JSON 文本展开', () => {
    expect(fillTemplate('{{v}}', { v: null })).toBe('null')
    expect(fillTemplate('{{v}}', { v: false })).toBe('false')
  })

  it('没有占位符时原样返回', () => {
    expect(fillTemplate('plain text', { a: 1 })).toBe('plain text')
  })

  it('未闭合的花括号按字面保留', () => {
    expect(fillTemplate('{{name', { name: 'ada' })).toBe('{{name')
  })

  it('编码函数只作用于展开后的值', () => {
    expect(fillTemplate('/u/{{name}}/x', { name: 'a b/c' }, encodeURIComponent)).toBe('/u/a%20b%2Fc/x')
  })
})
