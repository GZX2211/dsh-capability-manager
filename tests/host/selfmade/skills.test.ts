// tests/host/selfmade/skills.test.ts
//
// `<state>/skills` 的发现与加载：目录即 Skill 包，frontmatter 决定名称与调用策略。

import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import { SelfmadeSkills, scanSelfmadeSkills } from '../../../src/host/selfmade/skills.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-skills-'))
  dirs.push(dir)
  return dir
}

function writeSkill(root: string, dirName: string, body: string, overrides: Record<string, string> = {}): string {
  const dir = join(root, 'skills', dirName)
  mkdirSync(dir, { recursive: true })
  const frontmatter = {
    name: dirName,
    description: `${dirName} 的说明`,
    ...overrides,
  }
  const lines = ['---', ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`), '---', body]
  writeFileSync(join(dir, 'SKILL.md'), lines.join('\n'), 'utf8')
  return dir
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('condition not met in time'))
        return
      }
      setTimeout(tick, 25)
    }
    tick()
  })
}

describe('扫描自建 Skill 目录', () => {
  it('目录不存在时返回空数组', () => {
    expect(scanSelfmadeSkills(stateDir())).toEqual([])
  })

  it('收进合法 Skill 并保留目录与正文', () => {
    const root = stateDir()
    const dir = writeSkill(root, 'my-skill', '正文内容')

    const scanned = scanSelfmadeSkills(root)

    expect(scanned).toHaveLength(1)
    expect(scanned[0]?.name).toBe('my-skill')
    expect(scanned[0]?.dir).toBe(dir)
    expect(scanned[0]?.content).toBe('正文内容')
  })

  it('缺少 SKILL.md 的目录被跳过并记 warning', () => {
    const root = stateDir()
    mkdirSync(join(root, 'skills', 'empty'), { recursive: true })
    const warnings: string[] = []

    scanSelfmadeSkills(root, message => warnings.push(message))

    expect(warnings.join('\n')).toContain('empty')
  })

  it('非法 SKILL.md 被跳过，不影响其他 Skill', () => {
    const root = stateDir()
    writeSkill(root, 'good-skill', 'ok')
    const broken = join(root, 'skills', 'broken')
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, 'SKILL.md'), 'no frontmatter', 'utf8')
    const warnings: string[] = []

    const scanned = scanSelfmadeSkills(root, message => warnings.push(message))

    expect(scanned.map(skill => skill.name)).toEqual(['good-skill'])
    expect(warnings.join('\n')).toContain('broken')
  })

  it('同名 Skill 只保留目录名靠前的一个', () => {
    const root = stateDir()
    writeSkill(root, 'a-dir', 'first', { name: 'same-skill' })
    writeSkill(root, 'b-dir', 'second', { name: 'same-skill' })

    const scanned = scanSelfmadeSkills(root)

    expect(scanned).toHaveLength(1)
    expect(scanned[0]?.content).toBe('first')
  })

  it('隐藏目录被忽略', () => {
    const root = stateDir()
    writeSkill(root, '.hidden', 'x')

    expect(scanSelfmadeSkills(root)).toEqual([])
  })
})

describe('自建 Skill provider', () => {
  /** provider 约定允许返回观测对象；本实现总是整表返回，这里替测试收窄。 */
  async function listCandidates(skills: SelfmadeSkills): Promise<readonly SkillCandidate[]> {
    const listed = await skills.provider().list({})
    if (!Array.isArray(listed)) throw new Error('unexpected provider observation')
    return listed
  }

  function create(root: string, watch = false) {
    const skills = new SelfmadeSkills({ stateDir: root, watch })
    skills.start()
    return skills
  }

  it('提供者名称固定，候选带 custom 来源与官方 custom 档排名', async () => {
    const root = stateDir()
    writeSkill(root, 'my-skill', 'body')
    const skills = create(root)

    const candidates = await listCandidates(skills)

    expect(skills.provider().name).toBe('capability-manager')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      name: 'my-skill',
      source: 'custom',
      provider: 'capability-manager',
      rank: 300,
      resourceBase: { kind: 'directory', path: join(root, 'skills', 'my-skill') },
      invocation: { modelInvocable: true, userInvocable: true },
    })
    skills.dispose()
  })

  it('list 保留 invocation 策略，由上层决定是否过滤', async () => {
    const root = stateDir()
    writeSkill(root, 'my-skill', 'body', { 'disable-model-invocation': 'true' })
    const skills = create(root)

    const candidates = await listCandidates(skills)

    expect(candidates[0]?.invocation.modelInvocable).toBe(false)
    skills.dispose()
  })

  it('get 返回正文与资源目录', async () => {
    const root = stateDir()
    writeSkill(root, 'my-skill', '正文')
    const skills = create(root)
    const [candidate] = await listCandidates(skills)
    if (candidate === undefined) throw new Error('candidate missing')

    const loaded = await skills.provider().get(candidate, {})

    expect(loaded).toMatchObject({
      name: 'my-skill',
      content: '正文',
      resourceBase: { kind: 'directory', path: join(root, 'skills', 'my-skill') },
    })
    skills.dispose()
  })

  it('get 读到最新正文，不缓存旧内容', async () => {
    const root = stateDir()
    writeSkill(root, 'my-skill', '第一版')
    const skills = create(root)
    const [candidate] = await listCandidates(skills)
    if (candidate === undefined) throw new Error('candidate missing')

    writeSkill(root, 'my-skill', '第二版')

    await expect(skills.provider().get(candidate, {})).resolves.toMatchObject({ content: '第二版' })
    skills.dispose()
  })

  it('文件被删除后 get 返回 undefined', async () => {
    const root = stateDir()
    const dir = writeSkill(root, 'my-skill', '正文')
    const skills = create(root)
    const [candidate] = await listCandidates(skills)
    if (candidate === undefined) throw new Error('candidate missing')

    unlinkSync(join(dir, 'SKILL.md'))

    await expect(skills.provider().get(candidate, {})).resolves.toBeUndefined()
    skills.dispose()
  })

  it('frontmatter 改名后过期候选返回 undefined，而不是加载成名不副实的正文', async () => {
    const root = stateDir()
    writeSkill(root, 'my-skill', '正文')
    const skills = create(root)
    const [candidate] = await listCandidates(skills)
    if (candidate === undefined) throw new Error('candidate missing')

    writeSkill(root, 'my-skill', '正文', { name: 'renamed-skill' })

    await expect(skills.provider().get(candidate, {})).resolves.toBeUndefined()
    skills.dispose()
  })

  it('names() 取自 frontmatter，而不是目录名', () => {
    const root = stateDir()
    writeSkill(root, 'dir-name', 'body', { name: 'real-name' })
    const skills = create(root)

    expect([...skills.names()]).toEqual(['real-name'])
    skills.dispose()
  })

  it('三角测量：directoryOf 按 frontmatter 名找到实际目录', () => {
    const root = stateDir()
    const dir = writeSkill(root, 'dir-name', 'body', { name: 'real-name' })
    const skills = create(root)

    expect(skills.directoryOf('real-name')).toBe(dir)
    expect(skills.directoryOf('dir-name')).toBeUndefined()
    skills.dispose()
  })

  it('notifyChanged 立即通知订阅者，不等文件监听的去抖', () => {
    const root = stateDir()
    const skills = create(root)
    let changes = 0
    skills.onChange(() => { changes += 1 })

    skills.notifyChanged()

    expect(changes).toBe(1)
    skills.dispose()
  })

  it('dispose 之后 notifyChanged 不再通知', () => {
    const root = stateDir()
    const skills = create(root)
    let changes = 0
    skills.onChange(() => { changes += 1 })
    skills.dispose()

    skills.notifyChanged()

    expect(changes).toBe(0)
  })

  it('监听文件变化时通知变更；dispose 后不再通知', async () => {
    const root = stateDir()
    const skills = create(root, true)
    let changes = 0
    skills.onChange(() => { changes += 1 })

    writeSkill(root, 'my-skill', 'body')
    await waitFor(() => changes > 0)

    expect(changes).toBeGreaterThan(0)
    skills.dispose()
    const settled = changes
    writeSkill(root, 'another-skill', 'body')
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(changes).toBe(settled)
  })
})
