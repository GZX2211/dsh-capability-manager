import { describe, expect, it } from 'vitest'
import { applyPatch } from '../../../src/host/admin/mutate.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../../src/shared/config.ts'

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

describe('非法请求', () => {
  it('拒绝非对象', () => {
    expect(applyPatch(DEFAULT_CONFIG, 'set-resident')).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('拒绝未知操作', () => {
    expect(applyPatch(DEFAULT_CONFIG, { op: 'destroy', revision: 0 })).toMatchObject({
      ok: false,
      code: 'bad-request',
    })
  })

  it('拒绝非法能力标识', () => {
    expect(applyPatch(DEFAULT_CONFIG, { op: 'set-excluded', id: 'read', value: true, revision: 0 })).toMatchObject({
      ok: false,
      code: 'unknown-capability',
    })
  })

  it('拒绝非布尔的开关值', () => {
    expect(
      applyPatch(DEFAULT_CONFIG, { op: 'set-excluded', id: 'tool:read', value: 'yes', revision: 0 }),
    ).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('拒绝未知角色', () => {
    expect(
      applyPatch(DEFAULT_CONFIG, { op: 'set-blacklist', role: 'admin', id: 'tool:read', value: true, revision: 0 }),
    ).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('拒绝缺少 revision 的请求', () => {
    expect(applyPatch(DEFAULT_CONFIG, { op: 'set-excluded', id: 'tool:read', value: true })).toMatchObject({
      ok: false,
      code: 'bad-request',
    })
  })
})

describe('池与常驻', () => {
  it('把能力排除出池', () => {
    const result = applyPatch(DEFAULT_CONFIG, { op: 'set-excluded', id: 'tool:read', value: true, revision: 0 })

    expect(result.ok && result.config.excluded).toEqual(['tool:read'])
  })

  it('把能力放回池里', () => {
    const result = applyPatch(config({ excluded: ['tool:read'] }), {
      op: 'set-excluded',
      id: 'tool:read',
      value: false,
      revision: 0,
    })

    expect(result.ok && result.config.excluded).toEqual([])
  })

  it('重复排除不产生重复项', () => {
    const result = applyPatch(config({ excluded: ['tool:read'] }), {
      op: 'set-excluded',
      id: 'tool:read',
      value: true,
      revision: 0,
    })

    expect(result.ok && result.config.excluded).toEqual(['tool:read'])
  })

  it('排除出池时同时取消常驻：常驻必须是池内能力', () => {
    const result = applyPatch(config({ resident: ['tool:meta_search', 'tool:read'] }), {
      op: 'set-excluded',
      id: 'tool:read',
      value: true,
      revision: 0,
    })

    expect(result.ok && result.config.resident).toEqual(['tool:meta_search'])
  })

  it('把能力设为常驻', () => {
    const result = applyPatch(DEFAULT_CONFIG, { op: 'set-resident', id: 'tool:read', value: true, revision: 0 })

    expect(result.ok && result.config.resident).toContain('tool:read')
  })

  it('取消常驻', () => {
    const result = applyPatch(DEFAULT_CONFIG, { op: 'set-resident', id: 'tool:skill', value: false, revision: 0 })

    expect(result.ok && result.config.resident).toEqual(['tool:meta_search'])
  })

  it('拒绝把池外能力设为常驻', () => {
    const result = applyPatch(config({ excluded: ['tool:read'] }), {
      op: 'set-resident',
      id: 'tool:read',
      value: true,
      revision: 0,
    })

    expect(result).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('允许把常驻清空', () => {
    const result = applyPatch(config({ resident: ['tool:read'] }), {
      op: 'set-resident',
      id: 'tool:read',
      value: false,
      revision: 0,
    })

    expect(result.ok && result.config.resident).toEqual([])
  })

  it('Skill 也能设为常驻：常驻同时覆盖工具与 Skill', () => {
    const result = applyPatch(DEFAULT_CONFIG, { op: 'set-resident', id: 'skill:office', value: true, revision: 0 })

    expect(result.ok && result.config.resident).toContain('skill:office')
  })
})

describe('角色黑名单', () => {
  it('加入黑名单', () => {
    const result = applyPatch(DEFAULT_CONFIG, {
      op: 'set-blacklist',
      role: 'router',
      id: 'tool:bash',
      value: true,
      revision: 0,
    })

    expect(result.ok && result.config.blacklist.router).toEqual(['tool:bash'])
  })

  it('移出黑名单', () => {
    const result = applyPatch(config({ blacklist: { router: ['tool:bash'], worker: [] } }), {
      op: 'set-blacklist',
      role: 'router',
      id: 'tool:bash',
      value: false,
      revision: 0,
    })

    expect(result.ok && result.config.blacklist.router).toEqual([])
  })

  it('两个角色互不影响', () => {
    const result = applyPatch(DEFAULT_CONFIG, {
      op: 'set-blacklist',
      role: 'worker',
      id: 'tool:bash',
      value: true,
      revision: 0,
    })

    expect(result.ok && result.config.blacklist).toEqual({ router: [], worker: ['tool:bash'] })
  })

  it('清空某个角色的黑名单', () => {
    const result = applyPatch(config({ blacklist: { router: ['tool:bash', 'tool:read'], worker: ['tool:grep'] } }), {
      op: 'clear-blacklist',
      role: 'router',
      revision: 0,
    })

    expect(result.ok && result.config.blacklist).toEqual({ router: [], worker: ['tool:grep'] })
  })

  it('黑名单可以包含池外能力：重新入池后仍然生效', () => {
    const result = applyPatch(config({ excluded: ['tool:bash'] }), {
      op: 'set-blacklist',
      role: 'router',
      id: 'tool:bash',
      value: true,
      revision: 0,
    })

    expect(result.ok && result.config.blacklist.router).toEqual(['tool:bash'])
  })
})

describe('会话角色绑定', () => {
  it('把会话绑定到某个角色', () => {
    const result = applyPatch(DEFAULT_CONFIG, {
      op: 'set-role-binding',
      sessionId: 'session-1',
      role: 'router',
      revision: 0,
    })

    expect(result.ok && result.config.roleBindings).toEqual({ 'session-1': 'router' })
  })

  it('改变已有绑定', () => {
    const result = applyPatch(config({ roleBindings: { 'session-1': 'router' } }), {
      op: 'set-role-binding',
      sessionId: 'session-1',
      role: 'worker',
      revision: 0,
    })

    expect(result.ok && result.config.roleBindings).toEqual({ 'session-1': 'worker' })
  })

  it('解除绑定：角色为 null 时删除该键', () => {
    const result = applyPatch(config({ roleBindings: { 'session-1': 'router', 'session-2': 'worker' } }), {
      op: 'set-role-binding',
      sessionId: 'session-1',
      role: null,
      revision: 0,
    })

    expect(result.ok && result.config.roleBindings).toEqual({ 'session-2': 'worker' })
  })

  it('绑定只影响目标会话：其余绑定原样保留', () => {
    const result = applyPatch(config({ roleBindings: { 'session-0': 'worker' } }), {
      op: 'set-role-binding',
      sessionId: 'session-1',
      role: 'router',
      revision: 0,
    })

    expect(result.ok && result.config.roleBindings).toEqual({ 'session-0': 'worker', 'session-1': 'router' })
  })

  it('拒绝非法角色', () => {
    expect(
      applyPatch(DEFAULT_CONFIG, { op: 'set-role-binding', sessionId: 'session-1', role: 'admin', revision: 0 }),
    ).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('拒绝空会话标识', () => {
    expect(
      applyPatch(DEFAULT_CONFIG, { op: 'set-role-binding', sessionId: '', role: 'router', revision: 0 }),
    ).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('拒绝会改写原型的会话标识', () => {
    expect(
      applyPatch(DEFAULT_CONFIG, { op: 'set-role-binding', sessionId: '__proto__', role: 'router', revision: 0 }),
    ).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('拒绝非字符串的会话标识', () => {
    expect(
      applyPatch(DEFAULT_CONFIG, { op: 'set-role-binding', sessionId: 42, role: 'router', revision: 0 }),
    ).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('拒绝缺失的角色：解除绑定必须显式给 null', () => {
    expect(
      applyPatch(DEFAULT_CONFIG, { op: 'set-role-binding', sessionId: 'session-1', revision: 0 }),
    ).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('解除不存在的绑定是空操作', () => {
    const result = applyPatch(config({ roleBindings: {} }), {
      op: 'set-role-binding',
      sessionId: 'session-1',
      role: null,
      revision: 0,
    })

    expect(result.ok && result.config.roleBindings).toEqual({})
  })

  it('绑定不修改传入的配置', () => {
    const current = config({ roleBindings: {} })
    applyPatch(current, { op: 'set-role-binding', sessionId: 'session-1', role: 'router', revision: 0 })

    expect(current.roleBindings).toEqual({})
  })
})

describe('纯度', () => {
  it('不修改传入的配置', () => {
    const current = config({ excluded: [] })
    applyPatch(current, { op: 'set-excluded', id: 'tool:read', value: true, revision: 0 })

    expect(current.excluded).toEqual([])
  })

  it('成功后仍校验 revision，交给调用方处理冲突', () => {
    // applyPatch 只负责内容变换；revision 比对由存储层做，避免两处判定不一致。
    const result = applyPatch(DEFAULT_CONFIG, { op: 'set-excluded', id: 'tool:read', value: true, revision: 99 })

    expect(result.ok).toBe(true)
  })
})
