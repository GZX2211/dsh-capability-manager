import { describe, expect, it } from 'vitest'
import { sanitizeConfig } from '../../../src/host/config/sanitize.ts'
import { DEFAULT_CONFIG } from '../../../src/shared/config.ts'

describe('配置自愈：整体回落', () => {
  it('缺省输入得到默认配置', () => {
    expect(sanitizeConfig(undefined)).toEqual(DEFAULT_CONFIG)
  })

  it('非对象输入得到默认配置', () => {
    for (const raw of ['config', 42, true, []]) {
      expect(sanitizeConfig(raw)).toEqual(DEFAULT_CONFIG)
    }
  })

  it('null 输入得到默认配置', () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG)
  })

  it('空对象补齐全部字段', () => {
    expect(sanitizeConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it('未知版本号回落默认配置', () => {
    expect(sanitizeConfig({ version: 2, excluded: ['tool:read'] })).toEqual(DEFAULT_CONFIG)
  })

  it('缺少版本号按当前版本处理', () => {
    expect(sanitizeConfig({ excluded: ['tool:read'] }).excluded).toEqual(['tool:read'])
  })
})

describe('配置自愈：excluded', () => {
  it('非数组回落为空', () => {
    expect(sanitizeConfig({ excluded: 'tool:read' }).excluded).toEqual([])
  })

  it('剔除非字符串项', () => {
    expect(sanitizeConfig({ excluded: ['tool:read', 7, null, { id: 'tool:write' }] }).excluded).toEqual(['tool:read'])
  })

  it('剔除非法标识', () => {
    expect(sanitizeConfig({ excluded: ['read', 'Tool:grep', 'tool:', ':glob', 'skill:office'] }).excluded).toEqual([
      'skill:office',
    ])
  })

  it('去重并保留首次出现顺序', () => {
    const { excluded } = sanitizeConfig({ excluded: ['tool:b', 'tool:a', 'tool:b', 'tool:c', 'tool:a'] })
    expect(excluded).toEqual(['tool:b', 'tool:a', 'tool:c'])
  })
})

describe('配置自愈：resident', () => {
  it('剔除被排除出池的项', () => {
    const { resident } = sanitizeConfig({
      excluded: ['tool:meta_search'],
      resident: ['tool:meta_search', 'tool:skill'],
    })
    expect(resident).toEqual(['tool:skill'])
  })

  it('剔除非法标识并去重', () => {
    const { resident } = sanitizeConfig({ resident: ['tool:skill', 'nope', 'tool:skill', 'tool:'] })
    expect(resident).toEqual(['tool:skill'])
  })

  it('池内常驻清空后仍允许为空', () => {
    const { resident } = sanitizeConfig({ excluded: ['tool:skill'], resident: ['tool:skill'] })
    expect(resident).toEqual([])
  })

  it('显式空常驻保留为空，不回落到默认的两个元能力', () => {
    expect(sanitizeConfig({ resident: [] }).resident).toEqual([])
  })

  it('常驻字段类型不对时回落默认值，而不是当作清空', () => {
    expect(sanitizeConfig({ resident: 'tool:skill' }).resident).toEqual(DEFAULT_CONFIG.resident)
  })
})

describe('配置自愈：blacklist', () => {
  it('缺失时补两个空数组', () => {
    expect(sanitizeConfig({}).blacklist).toEqual({ router: [], worker: [] })
  })

  it('单个角色非法时只回落该角色', () => {
    const { blacklist } = sanitizeConfig({ blacklist: { router: ['tool:bash'], worker: 'tool:read' } })
    expect(blacklist).toEqual({ router: ['tool:bash'], worker: [] })
  })

  it('黑名单不受池影响：池外能力仍可留在黑名单里', () => {
    // 黑名单优先级高于池，池外能力重新入池后黑名单必须还在。
    const { blacklist } = sanitizeConfig({
      excluded: ['tool:bash'],
      blacklist: { router: ['tool:bash'], worker: [] },
    })
    expect(blacklist.router).toEqual(['tool:bash'])
  })
})

describe('配置自愈：embedding', () => {
  it('缺失时关闭且无模型目录', () => {
    expect(sanitizeConfig({}).embedding).toEqual({ enabled: false })
  })

  it('enabled 非布尔回落 false', () => {
    expect(sanitizeConfig({ embedding: { enabled: 'yes' } }).embedding.enabled).toBe(false)
  })

  it('非字符串的模型路径与版本被丢弃', () => {
    expect(sanitizeConfig({ embedding: { enabled: true, modelDir: 7, revision: null } }).embedding).toEqual({
      enabled: true,
    })
  })
})

describe('配置自愈：roleBindings', () => {
  it('缺失时为空映射', () => {
    expect(sanitizeConfig({}).roleBindings).toEqual({})
  })

  it('剔除非法角色值与空键', () => {
    const { roleBindings } = sanitizeConfig({
      roleBindings: { s1: 'router', s2: 'admin', '': 'worker', s3: 'worker' },
    })
    expect(roleBindings).toEqual({ s1: 'router', s3: 'worker' })
  })

  it('拒绝会改动原型链的键', () => {
    // JSON.parse 会把 "__proto__" 建成自有属性，赋值时就变成原型污染。
    const raw = JSON.parse('{"roleBindings":{"__proto__":"router","s1":"worker"}}') as unknown
    const { roleBindings } = sanitizeConfig(raw)
    expect(Object.keys(roleBindings)).toEqual(['s1'])
    expect(Object.getPrototypeOf(roleBindings)).toBe(Object.prototype)
  })
})

describe('配置自愈：纯度', () => {
  it('不修改输入对象', () => {
    const raw = { excluded: ['tool:read', 'bogus'], resident: ['tool:read'] }
    sanitizeConfig(raw)
    expect(raw).toEqual({ excluded: ['tool:read', 'bogus'], resident: ['tool:read'] })
  })

  it('结果与默认配置不共享引用', () => {
    const first = sanitizeConfig(undefined)
    first.resident.push('tool:injected')
    expect(DEFAULT_CONFIG.resident).toEqual(['tool:meta_search', 'tool:skill'])
  })

  it('未知字段不出现在结果里', () => {
    expect(sanitizeConfig({ version: 1, future: true })).not.toHaveProperty('future')
  })
})
