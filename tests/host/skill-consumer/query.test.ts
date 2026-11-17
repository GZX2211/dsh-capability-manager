import { describe, expect, it, vi } from 'vitest'
import {
  allSkillSummaries,
  eligibleSkills,
  type SkillSnapshotSource,
} from '../../../src/host/skill-consumer/query.ts'
import type { SkillSource } from '../../../src/host/catalog/skills.ts'
import { DEFAULT_CONFIG, type CapabilityConfig } from '../../../src/shared/config.ts'

function skill(name: string, modelInvocable = true): SkillSource {
  return { name, description: `${name} 的说明`, invocation: { modelInvocable } }
}

function config(patch: Partial<CapabilityConfig>): CapabilityConfig {
  return { ...DEFAULT_CONFIG, ...patch }
}

function snapshotter(skills: readonly SkillSource[]): SkillSnapshotSource & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    async snapshot(options) {
      calls.push(options)
      return { skills, complete: true }
    },
  }
}

const AGENT = { id: 's1', session: { id: 's1' } }
const SIGNAL = new AbortController().signal

describe('agent 可见的 Skill 候选', () => {
  it('只保留 modelInvocable 的 Skill', async () => {
    const skills = snapshotter([skill('alpha'), skill('beta', false)])

    const eligible = await eligibleSkills(
      { skills, cwdOf: async () => 'C:\\workspace' },
      { agent: AGENT, config: DEFAULT_CONFIG, role: undefined, signal: SIGNAL },
    )

    expect(eligible.map(item => item.name)).toEqual(['alpha'])
  })

  it('池外的 Skill 被剔除', async () => {
    const skills = snapshotter([skill('alpha'), skill('beta')])

    const eligible = await eligibleSkills(
      { skills, cwdOf: async () => undefined },
      { agent: AGENT, config: config({ excluded: ['skill:alpha'] }), role: undefined, signal: SIGNAL },
    )

    expect(eligible.map(item => item.name)).toEqual(['beta'])
  })

  it('该角色黑名单里的 Skill 被剔除', async () => {
    const skills = snapshotter([skill('alpha'), skill('beta')])

    const eligible = await eligibleSkills(
      { skills, cwdOf: async () => undefined },
      {
        agent: AGENT,
        config: config({ blacklist: { router: ['skill:beta'], worker: [] } }),
        role: 'router',
        signal: SIGNAL,
      },
    )

    expect(eligible.map(item => item.name)).toEqual(['alpha'])
  })

  it('把 cwd、signal 与 agent 作用域透传给注册表', async () => {
    const skills = snapshotter([skill('alpha')])

    await eligibleSkills(
      { skills, cwdOf: async () => 'C:\\project' },
      { agent: AGENT, config: DEFAULT_CONFIG, role: 'worker', signal: SIGNAL },
    )

    expect(skills.calls).toEqual([{ cwd: 'C:\\project', signal: SIGNAL, scope: AGENT }])
  })

  it('cwd 解析失败时退化为不传 cwd，仍返回候选', async () => {
    const skills = snapshotter([skill('alpha')])
    const log = vi.fn()

    const eligible = await eligibleSkills(
      {
        skills,
        cwdOf: async () => {
          throw new Error('working directory unavailable')
        },
        log,
      },
      { agent: AGENT, config: DEFAULT_CONFIG, role: undefined, signal: SIGNAL },
    )

    expect(eligible.map(item => item.name)).toEqual(['alpha'])
    expect(skills.calls).toEqual([{ cwd: undefined, signal: SIGNAL, scope: AGENT }])
    expect(log).toHaveBeenCalled()
  })

  it('按名称排序', async () => {
    const skills = snapshotter([skill('write'), skill('alpha'), skill('read')])

    const eligible = await eligibleSkills(
      { skills, cwdOf: async () => undefined },
      { agent: AGENT, config: DEFAULT_CONFIG, role: undefined, signal: SIGNAL },
    )

    expect(eligible.map(item => item.name)).toEqual(['alpha', 'read', 'write'])
  })

  it('注册表失败时把错误交给调用方处理', async () => {
    const skills: SkillSnapshotSource = {
      async snapshot() {
        throw new Error('registry disposed')
      },
    }

    await expect(
      eligibleSkills(
        { skills, cwdOf: async () => undefined },
        { agent: AGENT, config: DEFAULT_CONFIG, role: undefined, signal: SIGNAL },
      ),
    ).rejects.toThrow('registry disposed')
  })
})

describe('界面用的全量 Skill 摘要', () => {
  it('合并全局视图与每个活跃 agent 的视图，按名称去重', async () => {
    const agentA = { id: 'a1' }
    const agentB = { id: 'a2' }
    const views = new Map<unknown, readonly SkillSource[]>([
      [undefined, [skill('alpha'), skill('shared')]],
      [agentA, [skill('preset-only'), skill('shared')]],
      [agentB, [skill('worker-only')]],
    ])
    const calls: unknown[] = []
    const skills: SkillSnapshotSource = {
      async snapshot(options) {
        calls.push(options)
        return { skills: views.get(options.scope) ?? [] }
      },
    }

    const summaries = await allSkillSummaries(
      { skills, cwdOf: async () => 'C:\\workspace' },
      [agentA, agentB],
    )

    expect(summaries.map(item => item.name)).toEqual(['alpha', 'preset-only', 'shared', 'worker-only'])
    expect(calls).toHaveLength(3)
  })

  it('单个 agent 视图失败不影响其他来源', async () => {
    const log = vi.fn()
    let index = 0
    const skills: SkillSnapshotSource = {
      async snapshot() {
        index += 1
        if (index === 2) throw new Error('provider failed')
        return { skills: [skill(index === 1 ? 'global-only' : 'other')] }
      },
    }

    const summaries = await allSkillSummaries(
      { skills, cwdOf: async () => undefined, log },
      [{ id: 'a1' }, { id: 'a2' }],
    )

    expect(summaries.map(item => item.name)).toEqual(['global-only', 'other'])
    expect(log).toHaveBeenCalled()
  })

  it('没有任何来源时是空数组', async () => {
    const skills: SkillSnapshotSource = { async snapshot() { return { skills: [] } } }

    await expect(allSkillSummaries({ skills, cwdOf: async () => undefined }, [])).resolves.toEqual([])
  })
})
