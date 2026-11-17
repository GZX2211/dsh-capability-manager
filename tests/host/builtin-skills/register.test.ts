// tests/host/builtin-skills/register.test.ts
//
// 内置 `capability-creator` 的发现与注册：目录随包发布，正文里的状态目录占位符
// 在注册时替换，因此 Agent 拿到的是一份能直接照着写入的指令。

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CREATOR_SKILL_CANDIDATES,
  CREATOR_SKILL_NAME,
  findBundledSkillDir,
  loadBundledSkill,
  registerCreatorSkill,
  type CreatorSkillContext,
} from '../../../src/host/builtin-skills/register.ts'
import { parseSkillFile } from '../../../src/host/selfmade/skill-file.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-creator-'))
  dirs.push(dir)
  return dir
}

describe('内置 Skill 的发现', () => {
  it('在随包目录里找到 capability-creator', () => {
    const dir = findBundledSkillDir(CREATOR_SKILL_CANDIDATES)

    expect(dir).toBeDefined()
    expect(dir?.replaceAll('\\', '/')).toContain(`skills/${CREATOR_SKILL_NAME}`)
  })

  it('所有候选都不存在时返回 undefined', () => {
    const dir = findBundledSkillDir([pathToFileURL(join(tempDir(), 'nope'))], () => false)

    expect(dir).toBeUndefined()
  })

  it('SKILL.md 本身是合法的 Skill', () => {
    const dir = findBundledSkillDir(CREATOR_SKILL_CANDIDATES)
    if (dir === undefined) throw new Error('creator skill missing')
    const text = readText(join(dir, 'SKILL.md'))

    const parsed = parseSkillFile(text)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.skill.name).toBe(CREATOR_SKILL_NAME)
    expect(parsed.skill.description.length).toBeGreaterThan(0)
  })

  it('四份参考文件都在', () => {
    const dir = findBundledSkillDir(CREATOR_SKILL_CANDIDATES)
    if (dir === undefined) throw new Error('creator skill missing')

    for (const name of ['tool-declarative.md', 'tool-code.md', 'skill.md', 'mcp.md']) {
      expect(readText(join(dir, 'references', name)).length, name).toBeGreaterThan(0)
    }
  })
})

describe('内置 Skill 的注册', () => {
  it('正文里的状态目录占位符被替换成真实路径', () => {
    const stateDir = tempDir()

    const skill = loadBundledSkill(stateDir)

    expect(skill).toBeDefined()
    expect(skill?.content).toContain(stateDir)
    expect(skill?.content).not.toContain('{{STATE_DIR}}')
  })

  it('资源目录指向随包目录，参考文件可按相对路径打开', () => {
    const skill = loadBundledSkill(tempDir())

    expect(skill?.resourceBase.kind).toBe('directory')
    const base = skill?.resourceBase.kind === 'directory' ? skill.resourceBase.path : ''
    expect(readText(join(base, 'references', 'tool-declarative.md')).length).toBeGreaterThan(0)
  })

  it('注册时带上名称、来源与调用策略', () => {
    const registrations: unknown[] = []
    const ctx: CreatorSkillContext = {
      skills: {
        register: skill => {
          registrations.push(skill)
          return () => {}
        },
      },
    }
    const stateDir = tempDir()

    registerCreatorSkill(ctx, stateDir)

    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({
      name: CREATOR_SKILL_NAME,
      source: 'custom',
      invocation: { modelInvocable: true, userInvocable: true },
    })
  })

  it('目录缺失时只记 warning，不抛错也不注册', () => {
    const warnings: string[] = []
    const registered: unknown[] = []
    const ctx: CreatorSkillContext = {
      skills: {
        register: skill => {
          registered.push(skill)
          return () => {}
        },
      },
    }

    registerCreatorSkill(ctx, tempDir(), { log: message => warnings.push(message), candidates: [pathToFileURL(join(tempDir(), 'nope'))] })

    expect(registered).toEqual([])
    expect(warnings.join('\n')).toContain(CREATOR_SKILL_NAME)
  })
})

/** 读文本；缺失时返回空串，让断言给出更直观的失败信息。 */
function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
