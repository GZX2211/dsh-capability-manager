// tests/host/selfmade/create.test.ts
//
// 手动创建 Skill：骨架写入 + 名称冲突自增。创建完立刻扫描应当能发现它，
// 这是「点一下按钮，列表里就多一行」的底层保证。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSelfmadeSkill, nextAvailableSkillName } from '../../../src/host/selfmade/create.ts'
import { parseSkillFile } from '../../../src/host/selfmade/skill-file.ts'
import { scanSelfmadeSkills } from '../../../src/host/selfmade/skills.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-create-'))
  dirs.push(dir)
  return dir
}

describe('创建自建 Skill', () => {
  it('写入 SKILL.md 与 references 目录', () => {
    const root = stateDir()

    const created = createSelfmadeSkill({ stateDir: root, baseName: 'my-skill', description: '待填写' })

    expect(created.name).toBe('my-skill')
    expect(created.dir).toBe(join(root, 'skills', 'my-skill'))
    const text = readFileSync(join(created.dir, 'SKILL.md'), 'utf8')
    expect(text).toContain('name: my-skill')
    expect(text).toContain('description: 待填写')
    expect(text).toContain('references/')
    expect(readFileSync(join(created.dir, 'references', 'README.md'), 'utf8').length).toBeGreaterThan(0)
  })

  it('骨架本身是合法的 Skill，能被解析', () => {
    const root = stateDir()

    const created = createSelfmadeSkill({ stateDir: root, baseName: 'my-skill', description: '待填写' })
    const parsed = parseSkillFile(readFileSync(join(created.dir, 'SKILL.md'), 'utf8'))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.skill.name).toBe('my-skill')
    expect(parsed.skill.invocation).toEqual({ modelInvocable: true, userInvocable: true })
  })

  it('创建后立刻能在目录里被发现', () => {
    const root = stateDir()

    createSelfmadeSkill({ stateDir: root, baseName: 'my-skill', description: '待填写' })

    expect(scanSelfmadeSkills(root).map(skill => skill.name)).toEqual(['my-skill'])
  })

  it('名称冲突时依次加序号，不覆盖已有目录', () => {
    const root = stateDir()
    createSelfmadeSkill({ stateDir: root, baseName: 'my-skill', description: '第一版' })
    const second = createSelfmadeSkill({ stateDir: root, baseName: 'my-skill', description: '第二版' })
    const third = createSelfmadeSkill({ stateDir: root, baseName: 'my-skill', description: '第三版' })

    expect([second.name, third.name]).toEqual(['my-skill-2', 'my-skill-3'])
    expect(readFileSync(join(root, 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toContain('第一版')
  })

  it('目录已存在但没有 SKILL.md 时也不会被覆盖', () => {
    const root = stateDir()
    mkdirSync(join(root, 'skills', 'my-skill'), { recursive: true })
    writeFileSync(join(root, 'skills', 'my-skill', 'notes.md'), 'user data', 'utf8')

    const created = createSelfmadeSkill({ stateDir: root, baseName: 'my-skill', description: '待填写' })

    expect(created.name).toBe('my-skill-2')
    expect(readFileSync(join(root, 'skills', 'my-skill', 'notes.md'), 'utf8')).toBe('user data')
  })

  it('非法基名被拒绝', () => {
    const root = stateDir()

    expect(() => createSelfmadeSkill({ stateDir: root, baseName: 'My Skill', description: 'x' })).toThrow(/kebab/)
    expect(() => createSelfmadeSkill({ stateDir: root, baseName: '', description: 'x' })).toThrow()
  })

  it('状态目录不存在时自动创建', () => {
    const root = join(stateDir(), 'nested', 'state')

    const created = createSelfmadeSkill({ stateDir: root, baseName: 'my-skill', description: 'x' })

    expect(readFileSync(created.path, 'utf8')).toContain('my-skill')
  })
})

describe('名称分配', () => {
  it('无冲突时直接用基名', () => {
    expect(nextAvailableSkillName(stateDir(), 'my-skill', () => false)).toBe('my-skill')
  })

  it('已占用时向上加序号', () => {
    const taken = new Set(['my-skill', 'my-skill-2'])

    expect(nextAvailableSkillName(stateDir(), 'my-skill', name => taken.has(name))).toBe('my-skill-3')
  })

  it('三角测量：基名本身带序号时序号从 -2 起算', () => {
    const taken = new Set(['my-skill-2'])

    expect(nextAvailableSkillName(stateDir(), 'my-skill-2', name => taken.has(name))).toBe('my-skill-2-2')
  })
})
