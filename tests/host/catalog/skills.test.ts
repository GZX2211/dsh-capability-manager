import { describe, expect, it } from 'vitest'
import { collectSkills, describeSkill, isModelInvocable, type SkillSource } from '../../../src/host/catalog/skills.ts'
import { skillId } from '../../../src/shared/capability.ts'

function skill(name: string, description = `${name} 的说明`, modelInvocable = true): SkillSource {
  return { name, description, invocation: { modelInvocable } }
}

function collect(
  skills: readonly SkillSource[],
  options: { available?: (skill: SkillSource) => boolean } = {},
) {
  return collectSkills({
    skills,
    classify: () => 'official',
    ...options.available === undefined ? {} : { isAvailable: options.available },
  })
}

describe('Skill 摘要归一', () => {
  it('取首行并去掉两端空白', () => {
    expect(describeSkill({ description: '  第一行  \n第二行' })).toBe('第一行')
  })

  it('超过 200 个码点时截断，不切断代理对', () => {
    const description = '😀'.repeat(250)

    expect([...describeSkill({ description })]).toHaveLength(200)
  })

  it('缺省描述产出空串', () => {
    expect(describeSkill({ description: '' })).toBe('')
  })
})

describe('modelInvocable 判定', () => {
  it('显式为 true 才可被模型调用', () => {
    expect(isModelInvocable(skill('a'))).toBe(true)
    expect(isModelInvocable(skill('b', '说明', false))).toBe(false)
  })

  it('缺省 invocation 按不可调用处理：官方目录也不会列出它', () => {
    expect(isModelInvocable({ name: 'c', description: '说明' })).toBe(false)
  })
})

describe('Skill 条目收集', () => {
  it('只保留 modelInvocable 的 Skill', () => {
    const entries = collect([skill('alpha'), skill('beta', '说明', false)])

    expect(entries.map(entry => entry.name)).toEqual(['alpha'])
  })

  it('产出 skill:<name> 标识与 skill 类型', () => {
    const [entry] = collect([skill('office-docx')])

    expect(entry?.id).toBe(skillId('office-docx'))
    expect(entry?.kind).toBe('skill')
  })

  it('摘要与目录共用同一份归一结果', () => {
    const [entry] = collect([skill('alpha', '第一行\n第二行')])

    expect(entry?.summary).toBe('第一行')
  })

  it('来源与 owned 由来源判定给出', () => {
    const entries = collectSkills({
      skills: [skill('alpha'), skill('beta')],
      classify: name => (name === 'beta' ? 'custom' : 'official'),
    })

    expect(entries.find(entry => entry.name === 'alpha')?.owned).toBe(false)
    expect(entries.find(entry => entry.name === 'beta')?.owned).toBe(true)
  })

  it('可用性由调用方注入；缺省视为可用', () => {
    expect(collect([skill('alpha')])[0]?.available).toBe(true)
    expect(collect([skill('alpha')], { available: () => false })[0]?.available).toBe(false)
  })

  it('按名称排序', () => {
    const entries = collect([skill('write'), skill('alpha'), skill('read')])

    expect(entries.map(entry => entry.name)).toEqual(['alpha', 'read', 'write'])
  })

  it('没有 Skill 时是空数组', () => {
    expect(collect([])).toEqual([])
  })

  it('不修改输入', () => {
    const skills = [skill('write'), skill('alpha')]
    const before = [...skills]

    collect(skills)

    expect(skills).toEqual(before)
  })
})
