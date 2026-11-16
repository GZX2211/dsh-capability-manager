import { describe, expect, it } from 'vitest'
import { createRoleResolver } from '../../../src/host/roles/resolve.ts'

function resolver(service: unknown, bindings: Record<string, 'router' | 'worker'> = {}) {
  return createRoleResolver({ lookup: name => (name === 'paRoles' ? service : undefined), bindings: () => bindings })
}

describe('角色解析', () => {
  it('没有 paRoles 服务时报告不可用', () => {
    expect(resolver(undefined).available).toBe(false)
  })

  it('有 paRoles 服务时报告可用', () => {
    expect(resolver({ roleOf: () => 'router' }).available).toBe(true)
  })

  it('服务形状不对时视为不可用', () => {
    expect(resolver({ notAResolver: true }).available).toBe(false)
    expect(resolver('paRoles').available).toBe(false)
  })

  it('优先采用服务给出的角色', () => {
    expect(resolver({ roleOf: () => 'worker' }).roleOf('s1')).toBe('worker')
  })

  it('服务返回未知值时回落到手动绑定', () => {
    expect(resolver({ roleOf: () => undefined }, { s1: 'router' }).roleOf('s1')).toBe('router')
  })

  it('服务返回不认识的值时回落到手动绑定', () => {
    expect(resolver({ roleOf: () => 'admin' }, { s1: 'worker' }).roleOf('s1')).toBe('worker')
  })

  it('两者都没有答案时返回 undefined', () => {
    expect(resolver({ roleOf: () => undefined }).roleOf('s1')).toBeUndefined()
  })

  it('服务抛错时按未知角色处理而不是让调用方崩溃', () => {
    const broken = {
      roleOf: () => {
        throw new Error('ledger not ready')
      },
    }

    expect(resolver(broken).roleOf('s1')).toBeUndefined()
  })

  it('服务抛错时仍然回落到手动绑定', () => {
    const broken = {
      roleOf: () => {
        throw new Error('ledger not ready')
      },
    }

    expect(resolver(broken, { s1: 'worker' }).roleOf('s1')).toBe('worker')
  })

  it('每次调用都重新探测服务：晚加载的 PA 也能被发现', () => {
    let service: unknown
    const dynamic = createRoleResolver({
      lookup: name => (name === 'paRoles' ? service : undefined),
      bindings: () => ({}),
    })
    expect(dynamic.available).toBe(false)

    service = { roleOf: () => 'router' }

    expect(dynamic.available).toBe(true)
    expect(dynamic.roleOf('s1')).toBe('router')
  })
})
