import { describe, expect, it, vi, type Mock } from 'vitest'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import {
  CATALOG_SOURCE_KIND,
  type CatalogEntry,
} from '../../../src/host/skill-consumer/catalog.ts'
import {
  injectCatalogStep,
  type CatalogInjectDependencies,
  type CatalogPlan,
} from '../../../src/host/skill-consumer/catalog-inject.ts'

function entry(name: string, description = `${name} 的说明`): CatalogEntry {
  return { name, description }
}

function catalogMessage(entries: readonly CatalogEntry[], update = false): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: 'catalog' }],
    source: {
      kind: CATALOG_SOURCE_KIND,
      form: 'catalog',
      ...update ? { update: true } : {},
      entries,
    },
  })
}

function userMessage(text = '用户输入'): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

interface Harness {
  readonly payload: {
    agent: { session: { deriveMessages(): readonly UserMessage[] } }
    messages: readonly UserMessage[]
    signal: AbortSignal
  }
  readonly next: Mock<() => Promise<PreStepDecision>>
  readonly deps: CatalogInjectDependencies
  readonly log: ReturnType<typeof vi.fn>
}

function harness(options: {
  history?: readonly UserMessage[]
  plan?: CatalogPlan | Error
  deriveThrows?: Error
  signal?: AbortSignal
} = {}): Harness {
  const history = options.history ?? []
  const log = vi.fn()
  const next: Mock<() => Promise<PreStepDecision>> = vi.fn(async () => ({ kind: 'enter', messages: [userMessage()] }))
  const deps: CatalogInjectDependencies = {
    catalogOf: async () => {
      if (options.plan instanceof Error) throw options.plan
      return options.plan ?? { active: true, entries: [entry('alpha')] }
    },
    log,
  }
  const payload = {
    agent: {
      session: {
        deriveMessages() {
          if (options.deriveThrows !== undefined) throw options.deriveThrows
          return history
        },
      },
    },
    messages: [] as readonly UserMessage[],
    signal: options.signal ?? new AbortController().signal,
  }
  return { payload, next, deps, log }
}

function catalogOf(decision: PreStepDecision): UserMessage | undefined {
  if (decision.kind === 'reject') return undefined
  return decision.messages.find(message => (message.source as { kind?: string }).kind === CATALOG_SOURCE_KIND)
}

describe('首版目录', () => {
  it('首次 step 注入目录消息', async () => {
    const h = harness()

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    const message = catalogOf(decision)
    expect(message).toBeDefined()
    const source = message?.source as unknown as { entries: CatalogEntry[]; update?: true }
    expect(source.entries).toEqual([entry('alpha')])
    expect(source.update).toBeUndefined()
    const text = (message?.content[0] as { text: string }).text
    expect(text).toContain('<available_skills>')
    expect(text).toContain('- `alpha`：alpha 的说明')
  })

  it('保留 next() 给出的决策与消息', async () => {
    const h = harness()

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect(decision.kind).toBe('enter')
    if (decision.kind === 'enter') {
      expect(decision.messages.some(message => (message.source as { kind?: string }).kind === 'user')).toBe(true)
    }
  })

  it('reject 决策原样返回，不读取目录', async () => {
    const h = harness()
    h.next.mockResolvedValue({ kind: 'reject' })
    const catalogOfSpy = vi.spyOn(h.deps, 'catalogOf')

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect(decision).toEqual({ kind: 'reject' })
    expect(catalogOfSpy).not.toHaveBeenCalled()
  })

  it('空目录且没有任何历史时什么都不发：首版空目录没有信息量', async () => {
    const h = harness({ plan: { active: true, entries: [] } })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect(catalogOf(decision)).toBeUndefined()
  })
})

describe('增量替换', () => {
  it('条目未变时不重复注入', async () => {
    const h = harness({ history: [catalogMessage([entry('alpha')])] })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect(catalogOf(decision)).toBeUndefined()
  })

  it('条目变化时发布替换目录', async () => {
    const h = harness({
      history: [catalogMessage([entry('alpha')])],
      plan: { active: true, entries: [entry('alpha'), entry('beta')] },
    })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    const source = catalogOf(decision)?.source as unknown as { entries: CatalogEntry[]; update?: true }
    expect(source.entries.map(item => item.name)).toEqual(['alpha', 'beta'])
    expect(source.update).toBe(true)
  })

  it('描述变化也算目录变化', async () => {
    const h = harness({
      history: [catalogMessage([entry('alpha', '旧描述')])],
      plan: { active: true, entries: [entry('alpha', '新描述')] },
    })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect(catalogOf(decision)).toBeDefined()
  })

  it('只认最新一条目录：历史里更早的旧目录不影响判断', async () => {
    const h = harness({
      history: [
        catalogMessage([entry('old')]),
        catalogMessage([entry('alpha')]),
      ],
    })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect(catalogOf(decision)).toBeUndefined()
  })

  it('决策里已带目录消息时替换它，而不是追加第二条', async () => {
    const h = harness()
    const existing = catalogMessage([entry('old')])
    h.next.mockResolvedValue({ kind: 'enter', messages: [existing, userMessage()] })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    if (decision.kind !== 'enter') throw new Error('expected enter')
    const catalogs = decision.messages.filter(
      message => (message.source as { kind?: string }).kind === CATALOG_SOURCE_KIND,
    )
    expect(catalogs).toHaveLength(1)
    expect((catalogs[0]?.source as unknown as { entries: CatalogEntry[] }).entries).toEqual([entry('alpha')])
  })
})

describe('不注入与退役', () => {
  it('当前模式不注入且从未发布过目录时什么都不做', async () => {
    const h = harness({ plan: { active: false } })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect(catalogOf(decision)).toBeUndefined()
  })

  it('当前模式不注入但历史有目录时发布空目录退役旧名称', async () => {
    const h = harness({
      history: [catalogMessage([entry('alpha')])],
      plan: { active: false },
    })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    const source = catalogOf(decision)?.source as unknown as { entries: CatalogEntry[]; update?: true }
    expect(source.entries).toEqual([])
    expect(source.update).toBe(true)
  })

  it('入口工具不可用但有历史目录时发布空目录', async () => {
    const h = harness({
      history: [catalogMessage([entry('alpha')])],
      plan: { active: true, entries: [] },
    })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect((catalogOf(decision)?.source as unknown as { entries: CatalogEntry[] }).entries).toEqual([])
  })
})

describe('失败隔离', () => {
  it('目录计算失败时返回原决策并记 warning', async () => {
    const h = harness({ plan: new Error('skill registry unavailable') })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect(catalogOf(decision)).toBeUndefined()
    expect(h.log).toHaveBeenCalled()
  })

  it('读取会话历史失败时返回原决策并记 warning', async () => {
    const h = harness({ deriveThrows: new Error('session detached') })

    const decision = await injectCatalogStep(h.deps, h.payload, h.next)

    expect(decision.kind).toBe('enter')
    expect(h.log).toHaveBeenCalled()
  })

  it('取消后不把异常当作可降级的失败', async () => {
    const controller = new AbortController()
    const h = harness({
      signal: controller.signal,
      plan: new Error('aborted'),
    })
    controller.abort('stop')

    await expect(injectCatalogStep(h.deps, h.payload, h.next)).rejects.toBe('stop')
    expect(h.log).not.toHaveBeenCalled()
  })
})
