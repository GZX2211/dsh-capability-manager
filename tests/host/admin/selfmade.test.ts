// tests/host/admin/selfmade.test.ts
//
// 管理面的两个自建能力动作：手动创建 Skill 与打开目录。
//
// 这里用真实的 ConfigStore 与真实文件系统，只把「打开目录」这一步换成替身：
// 创建失败时的回滚、revision 冲突与配置落盘都是必须一起验证的事实。

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSkillAction, revealAction } from '../../../src/host/admin/selfmade.ts'
import { ConfigStore } from '../../../src/host/config/store.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-admin-selfmade-'))
  dirs.push(dir)
  return dir
}

function openStore(directory: string): ConfigStore {
  return ConfigStore.open({ directory })
}

describe('手动创建 Skill', () => {
  it('写入骨架并把新 Skill 放进排出池', () => {
    const dir = stateDir()
    const store = openStore(dir)

    const outcome = createSkillAction({ store, stateDir: dir }, { revision: store.revision })

    expect(outcome.status).toBe(200)
    const body = outcome.body as { ok: true; revision: number; capability: { id: string; name: string } }
    expect(body.capability.id).toBe('skill:my-skill')
    expect(body.revision).toBe(1)
    expect(existsSync(join(dir, 'skills', 'my-skill', 'SKILL.md'))).toBe(true)
    const config = store.read()
    expect(config.excluded).toContain('skill:my-skill')
    expect(config.resident).not.toContain('skill:my-skill')
  })

  it('连续创建得到递增的名称，两个都在排出池里', () => {
    const dir = stateDir()
    const store = openStore(dir)
    createSkillAction({ store, stateDir: dir }, { revision: store.revision })

    const outcome = createSkillAction({ store, stateDir: dir }, { revision: store.revision })

    const body = outcome.body as { capability: { name: string } }
    expect(body.capability.name).toBe('my-skill-2')
    expect(store.read().excluded).toEqual(['skill:my-skill', 'skill:my-skill-2'])
  })

  it('revision 不匹配时返回冲突且不创建任何目录', () => {
    const dir = stateDir()
    const store = openStore(dir)

    const outcome = createSkillAction({ store, stateDir: dir }, { revision: 99 })

    expect(outcome.status).toBe(409)
    expect(outcome.body).toMatchObject({ ok: false, code: 'revision-conflict', revision: 0 })
    expect(existsSync(join(dir, 'skills'))).toBe(false)
  })

  it('请求体缺少 revision 时拒绝', () => {
    const dir = stateDir()
    const store = openStore(dir)

    expect(createSkillAction({ store, stateDir: dir }, {}).status).toBe(400)
    expect(createSkillAction({ store, stateDir: dir }, 'nope').status).toBe(400)
    expect(createSkillAction({ store, stateDir: dir }, { revision: '1' }).status).toBe(400)
  })

  it('目录不可写时返回 create-failed，配置保持不变', () => {
    const dir = stateDir()
    const store = openStore(dir)
    // 用一个普通文件占住 skills 需要的位置，mkdir 必然失败。
    writeFileSync(join(dir, 'skills'), 'not a directory', 'utf8')

    const outcome = createSkillAction({ store, stateDir: dir }, { revision: store.revision })

    expect(outcome.status).toBe(500)
    expect(outcome.body).toMatchObject({ ok: false, code: 'create-failed' })
    expect(store.read().excluded).toEqual([])
    expect(store.revision).toBe(0)
  })

  it('创建成功后立即通知技能注册表丢缓存', () => {
    const dir = stateDir()
    const store = openStore(dir)
    let notified = 0

    createSkillAction({ store, stateDir: dir, onCreated: () => { notified += 1 } }, { revision: store.revision })

    expect(notified).toBe(1)
  })

  it('revision 冲突时不通知', () => {
    const dir = stateDir()
    const store = openStore(dir)
    let notified = 0

    const outcome = createSkillAction({ store, stateDir: dir, onCreated: () => { notified += 1 } }, { revision: 99 })

    expect(outcome.status).toBe(409)
    expect(notified).toBe(0)
  })

  it('骨架创建失败时不通知', () => {
    const dir = stateDir()
    const store = openStore(dir)
    let notified = 0
    writeFileSync(join(dir, 'skills'), 'not a directory', 'utf8')

    const outcome = createSkillAction({ store, stateDir: dir, onCreated: () => { notified += 1 } }, { revision: store.revision })

    expect(outcome.status).toBe(500)
    expect(notified).toBe(0)
  })

  it('三角测量：基名与描述可由调用方覆盖', () => {
    const dir = stateDir()
    const store = openStore(dir)

    const outcome = createSkillAction(
      { store, stateDir: dir, baseName: 'ticket-helper', description: '处理工单时使用' },
      { revision: store.revision },
    )

    expect(outcome.status).toBe(200)
    expect(store.read().excluded).toContain('skill:ticket-helper')
    expect(readFileSync(join(dir, 'skills', 'ticket-helper', 'SKILL.md'), 'utf8')).toContain('description: 处理工单时使用')
  })
})


describe('打开自建能力目录', () => {
  function deps(directory: string, revealed: string[]) {
    return {
      stateDir: directory,
      ownsTool: (name: string) => name === 'greet',
      directoryOfSkill: (name: string) => (name === 'my-skill' ? join(directory, 'skills', 'my-skill') : undefined),
      reveal: (path: string) => revealed.push(path),
    }
  }

  it('自建工具打开 <state>/tools/<name>', () => {
    const dir = stateDir()
    const revealed: string[] = []

    const outcome = revealAction(deps(dir, revealed), { id: 'tool:greet' })

    expect(outcome.status).toBe(200)
    expect(revealed).toEqual([join(dir, 'tools', 'greet')])
  })

  it('自建 Skill 用 provider 给出的目录，而不是按名字拼路径', () => {
    const dir = stateDir()
    const revealed: string[] = []

    const outcome = revealAction(deps(dir, revealed), { id: 'skill:my-skill' })

    expect(outcome.status).toBe(200)
    expect(revealed).toEqual([join(dir, 'skills', 'my-skill')])
  })

  it('非法 id 返回 unknown-capability', () => {
    const dir = stateDir()
    const revealed: string[] = []

    expect(revealAction(deps(dir, revealed), { id: 'nope' }).status).toBe(400)
    expect(revealAction(deps(dir, revealed), {}).status).toBe(400)
    expect(revealAction(deps(dir, revealed), { id: 'tool:missing' }).status).toBe(403)
    expect(revealAction(deps(dir, revealed), { id: 'skill:missing' }).status).toBe(403)
    expect(revealed).toEqual([])
  })

  it('打开失败返回 reveal-failed 并带上原因', () => {
    const dir = stateDir()
    const outcome = revealAction(
      {
        ...deps(dir, []),
        reveal: () => {
          throw new Error('no file manager')
        },
      },
      { id: 'tool:greet' },
    )

    expect(outcome.status).toBe(500)
    expect(outcome.body).toMatchObject({ ok: false, code: 'reveal-failed' })
  })
})

describe('创建与落盘的一致性', () => {
  it('配置写入失败时把刚创建的目录清理掉，不留半截状态', () => {
    const dir = stateDir()
    const store = openStore(dir)
    const failing = {
      revision: store.revision,
      read: () => store.read(),
      write: () => ({ ok: false as const, code: 'write-failed' as const, message: 'disk full' }),
    }

    const outcome = createSkillAction({ store: failing, stateDir: dir }, { revision: 0 })

    expect(outcome.status).toBe(500)
    expect(readdirSync(join(dir, 'skills'))).toEqual([])
  })
})
