// tests/client/lib/roles.test.ts
//
// 角色黑名单与会话角色的界面派生逻辑：纯函数，输入即全部事实。

import { describe, expect, it } from 'vitest'
import type { SessionRoleSnapshot } from '../../../src/shared/api.ts'
import type { CapabilityEntry } from '../../../src/shared/capability.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../../src/shared/config.ts'
import {
  bindingChoiceOf,
  bindingOf,
  bindingPatch,
  blacklistOf,
  blacklistRows,
  sessionRoleRows,
} from '../../../src/client/lib/roles.ts'

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

function capability(name: string, summary = '', kind: 'tool' | 'skill' = 'tool'): CapabilityEntry {
  return {
    id: `${kind}:${name}`,
    kind,
    name,
    summary,
    source: 'official',
    owned: false,
    available: true,
  }
}

const ENTRIES = [capability('read', '读取文本文件'), capability('bash', '执行命令'), capability('office', '写文档', 'skill')]

describe('黑名单投影', () => {
  it('给出该角色被禁用的能力集合', () => {
    const current = config({ blacklist: { router: ['tool:read'], worker: [] } })

    expect([...blacklistOf(current, 'router')]).toEqual(['tool:read'])
  })

  it('两个角色互不影响', () => {
    const current = config({ blacklist: { router: ['tool:read'], worker: ['tool:bash'] } })

    expect([...blacklistOf(current, 'worker')]).toEqual(['tool:bash'])
  })

  it('空配置得到空集合', () => {
    expect(blacklistOf(DEFAULT_CONFIG, 'router').size).toBe(0)
  })
})

describe('手动绑定', () => {
  it('没有绑定时返回 undefined', () => {
    expect(bindingOf(DEFAULT_CONFIG, 'session-1')).toBeUndefined()
  })

  it('只读目标会话的绑定', () => {
    const current = config({ roleBindings: { 'session-1': 'router' } })

    expect(bindingOf(current, 'session-1')).toBe('router')
    expect(bindingOf(current, 'session-2')).toBeUndefined()
  })

  it('界面选择值：没有绑定时是自动', () => {
    expect(bindingChoiceOf(DEFAULT_CONFIG, 'session-1')).toBe('auto')
  })

  it('界面选择值：有绑定时是绑定角色', () => {
    const current = config({ roleBindings: { 'session-1': 'worker' } })

    expect(bindingChoiceOf(current, 'session-1')).toBe('worker')
  })

  it('自动对应解除绑定', () => {
    expect(bindingPatch('session-1', 'auto')).toEqual({ op: 'set-role-binding', sessionId: 'session-1', role: null })
  })

  it('选角色对应写入绑定', () => {
    expect(bindingPatch('session-1', 'router')).toEqual({
      op: 'set-role-binding',
      sessionId: 'session-1',
      role: 'router',
    })
  })
})

describe('黑名单列表', () => {
  function rows(
    current: CapabilityConfig,
    role: 'router' | 'worker',
    query = '',
    kind: 'all' | 'tool' | 'skill' = 'all',
  ) {
    return blacklistRows({ capabilities: ENTRIES, config: current, role, query, kind })
  }

  it('已禁用的置顶，组内保持字母序', () => {
    const current = config({ blacklist: { router: ['tool:read'], worker: [] } })

    expect(rows(current, 'router').rows.map(entry => entry.name)).toEqual(['read', 'bash', 'office'])
  })

  it('没有禁用项时全部按字母序', () => {
    expect(rows(DEFAULT_CONFIG, 'router').rows.map(entry => entry.name)).toEqual(['bash', 'office', 'read'])
  })

  it('计数只统计当前筛选结果', () => {
    const current = config({ blacklist: { router: ['tool:read'], worker: [] } })

    expect(rows(current, 'router')).toMatchObject({ blacklisted: 1, total: 3 })
  })

  it('搜索匹配名称，大小写不敏感', () => {
    expect(rows(DEFAULT_CONFIG, 'router', 'READ').rows.map(entry => entry.name)).toEqual(['read'])
  })

  it('搜索匹配摘要', () => {
    expect(rows(DEFAULT_CONFIG, 'router', '写文档').rows.map(entry => entry.name)).toEqual(['office'])
  })

  it('搜索词首尾空白被忽略', () => {
    expect(rows(DEFAULT_CONFIG, 'router', '  bash  ').rows.map(entry => entry.name)).toEqual(['bash'])
  })

  it('筛选无命中时返回空列表与零计数', () => {
    expect(rows(DEFAULT_CONFIG, 'router', 'nothing')).toMatchObject({ rows: [], blacklisted: 0, total: 0 })
  })

  it('被禁用但筛选后不可见的项不计入计数', () => {
    const current = config({ blacklist: { router: ['tool:read'], worker: [] } })

    expect(rows(current, 'router', 'bash')).toMatchObject({ blacklisted: 0, total: 1 })
  })

  it('不修改传入的能力顺序', () => {
    const entries = [...ENTRIES]
    blacklistRows({ capabilities: entries, config: DEFAULT_CONFIG, role: 'router', query: '', kind: 'all' })

    expect(entries.map(entry => entry.name)).toEqual(ENTRIES.map(entry => entry.name))
  })
})

describe('黑名单的类型筛选', () => {
  function rows(
    current: CapabilityConfig,
    kind: 'all' | 'tool' | 'skill',
    query = '',
  ) {
    return blacklistRows({ capabilities: ENTRIES, config: current, role: 'router', query, kind })
  }

  it('只看工具时只留工具', () => {
    expect(rows(DEFAULT_CONFIG, 'tool').rows.map(entry => entry.name)).toEqual(['bash', 'read'])
  })

  it('只看技能时只留技能', () => {
    expect(rows(DEFAULT_CONFIG, 'skill').rows.map(entry => entry.name)).toEqual(['office'])
  })

  it('全部时三类都留', () => {
    expect(rows(DEFAULT_CONFIG, 'all').total).toBe(3)
  })

  it('计数只统计类型筛选后的行', () => {
    const current = config({ blacklist: { router: ['tool:read', 'skill:office'], worker: [] } })

    expect(rows(current, 'tool')).toMatchObject({ blacklisted: 1, total: 2 })
    expect(rows(current, 'skill')).toMatchObject({ blacklisted: 1, total: 1 })
  })

  it('类型与搜索词叠加生效', () => {
    expect(rows(DEFAULT_CONFIG, 'skill', '写文档').rows.map(entry => entry.name)).toEqual(['office'])
    expect(rows(DEFAULT_CONFIG, 'tool', '写文档').rows).toEqual([])
  })

  it('类型筛选后仍保持已禁用置顶', () => {
    const current = config({ blacklist: { router: ['tool:read'], worker: [] } })

    expect(rows(current, 'tool').rows.map(entry => entry.name)).toEqual(['read', 'bash'])
  })

  it('类型筛选后无命中时是空列表与零计数', () => {
    expect(rows(DEFAULT_CONFIG, 'skill', 'bash')).toMatchObject({ rows: [], blacklisted: 0, total: 0 })
  })
})

describe('会话角色行', () => {
  function session(patch: Partial<SessionRoleSnapshot> & { id: string }): SessionRoleSnapshot {
    return { roleSource: 'unknown', ...patch }
  }

  it('PA 判定且没有绑定时选择自动', () => {
    const [row] = sessionRoleRows([session({ id: 's1', role: 'router', roleSource: 'pa' })], DEFAULT_CONFIG)

    expect(row).toEqual({ id: 's1', role: 'router', roleSource: 'pa', choice: 'auto', bindingDormant: false })
  })

  it('PA 没有答案时绑定生效', () => {
    const [row] = sessionRoleRows(
      [session({ id: 's1' })],
      config({ roleBindings: { s1: 'worker' } }),
    )

    expect(row).toMatchObject({ roleSource: 'unknown', choice: 'worker', bindingDormant: false })
    expect(row?.role).toBeUndefined()
  })

  it('PA 已判定时绑定存在但休眠，界面需要说明', () => {
    const [row] = sessionRoleRows(
      [session({ id: 's1', role: 'router', roleSource: 'pa' })],
      config({ roleBindings: { s1: 'worker' } }),
    )

    expect(row).toMatchObject({ role: 'router', roleSource: 'pa', choice: 'worker', bindingDormant: true })
  })

  it('绑定是角色来源时不算休眠', () => {
    const [row] = sessionRoleRows(
      [session({ id: 's1', role: 'worker', roleSource: 'binding' })],
      config({ roleBindings: { s1: 'worker' } }),
    )

    expect(row?.bindingDormant).toBe(false)
  })

  it('保持输入顺序：排序由服务端负责', () => {
    const rows = sessionRoleRows(
      [session({ id: 's2', role: 'worker', roleSource: 'pa' }), session({ id: 's1', roleSource: 'unknown' })],
      DEFAULT_CONFIG,
    )

    expect(rows.map(row => row.id)).toEqual(['s2', 's1'])
  })

  it('别的会话的绑定不会串到这个会话上', () => {
    const [row] = sessionRoleRows(
      [session({ id: 's1', role: 'router', roleSource: 'pa' })],
      config({ roleBindings: { s2: 'worker' } }),
    )

    expect(row).toMatchObject({ choice: 'auto', bindingDormant: false })
  })

  it('读不到会话列表时返回空数组', () => {
    expect(sessionRoleRows(undefined, DEFAULT_CONFIG)).toEqual([])
  })
})
