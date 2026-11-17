// tests/host/selfmade/skill-file.test.ts
//
// SKILL.md 的解析规则。只支持 frontmatter 里的标量键，这与本插件的骨架一致：
// 允许的写法越窄，「用户照着骨架填」就越不会踩到 YAML 的边角语义。

import { describe, expect, it } from 'vitest'
import { parseSkillFile } from '../../../src/host/selfmade/skill-file.ts'

const VALID = ['---', 'name: my-skill', 'description: 处理票据', '---', '', '# 标题', '', '正文'].join('\n')

describe('SKILL.md 解析', () => {
  it('解析名称、描述与正文', () => {
    const result = parseSkillFile(VALID)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.name).toBe('my-skill')
    expect(result.skill.description).toBe('处理票据')
    expect(result.skill.content).toBe('# 标题\n\n正文')
  })

  it('默认模型与用户都可调用', () => {
    const result = parseSkillFile(VALID)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.invocation).toEqual({ modelInvocable: true, userInvocable: true })
  })

  it('缺少 frontmatter 时说明要求', () => {
    const result = parseSkillFile('# 只有正文')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('frontmatter')
  })

  it('frontmatter 未闭合时给出原因', () => {
    const result = parseSkillFile(['---', 'name: x', 'description: y'].join('\n'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('---')
  })

  it('缺少 description 时拒绝', () => {
    const result = parseSkillFile(['---', 'name: my-skill', '---', 'body'].join('\n'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('description')
  })

  it('名称不是 kebab-case 时拒绝', () => {
    const result = parseSkillFile(['---', 'name: My Skill', 'description: d', '---', ''].join('\n'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('name')
  })

  it('引号包裹的值去掉引号，冒号留在值里', () => {
    const result = parseSkillFile(['---', 'name: my-skill', 'description: "说明：含冒号"', '---', ''].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.description).toBe('说明：含冒号')
  })

  it('disable-model-invocation 关闭模型调用', () => {
    const result = parseSkillFile(
      ['---', 'name: my-skill', 'description: d', 'disable-model-invocation: true', '---', ''].join('\n'),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.invocation.modelInvocable).toBe(false)
    expect(result.skill.invocation.userInvocable).toBe(true)
  })

  it('user-invocable: false 关闭用户手势调用', () => {
    const result = parseSkillFile(['---', 'name: my-skill', 'description: d', 'user-invocable: false', '---', ''].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.invocation.userInvocable).toBe(false)
  })

  it('旧键名被明确拒绝，避免静默失效', () => {
    const result = parseSkillFile(['---', 'name: my-skill', 'description: d', 'disableModelInvocation: true', '---', ''].join('\n'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('disable-model-invocation')
  })

  it('whenToUse 被保留', () => {
    const result = parseSkillFile(
      ['---', 'name: my-skill', 'description: d', 'whenToUse: 处理票据时', '---', ''].join('\n'),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.whenToUse).toBe('处理票据时')
  })

  it('CRLF 换行同样能解析', () => {
    const result = parseSkillFile(['---', 'name: my-skill', 'description: d', '---', 'body'].join('\r\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.content).toBe('body')
  })

  it('注释行与空行被忽略', () => {
    const result = parseSkillFile(['---', '# 注释', '', 'name: my-skill', 'description: d', '---', ''].join('\n'))

    expect(result.ok).toBe(true)
  })

  it('正文可以为空', () => {
    const result = parseSkillFile(['---', 'name: my-skill', 'description: d', '---', ''].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.content).toBe('')
  })
})
