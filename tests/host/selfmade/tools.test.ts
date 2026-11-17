// tests/host/selfmade/tools.test.ts
//
// `<state>/tools` 的发现、注册与热更新。注册回调由测试注入，
// 因此这里验证的是「目录事实 → 注册动作」的对应关系，而不是宿主实现。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { scanSelfmadeTools, SelfmadeTools } from '../../../src/host/selfmade/tools.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-tools-'))
  dirs.push(dir)
  return dir
}

function writeTool(root: string, name: string, meta: Record<string, unknown>, impl?: string): string {
  const dir = join(root, 'tools', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  if (impl !== undefined) writeFileSync(join(dir, 'impl.mjs'), impl, 'utf8')
  return dir
}

const SHELL_META = {
  name: 'greet',
  description: '打招呼',
  parameters: { type: 'object', properties: {} },
  kind: 'shell',
  shell: { command: 'echo' },
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

describe('扫描自建工具目录', () => {
  it('目录不存在时返回空数组', () => {
    expect(scanSelfmadeTools(stateDir())).toEqual([])
  })

  it('收进合法工具并带上目录与签名', () => {
    const root = stateDir()
    writeTool(root, 'greet', SHELL_META)

    const scanned = scanSelfmadeTools(root)

    expect(scanned).toHaveLength(1)
    expect(scanned[0]?.name).toBe('greet')
    expect(scanned[0]?.dir).toBe(join(root, 'tools', 'greet'))
    expect(scanned[0]?.signature.length).toBeGreaterThan(0)
  })

  it('坏 meta.json 只记 warning 并跳过', () => {
    const root = stateDir()
    const warnings: string[] = []
    const dir = join(root, 'tools', 'broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), '{ not json', 'utf8')

    const scanned = scanSelfmadeTools(root, message => warnings.push(message))

    expect(scanned).toEqual([])
    expect(warnings.join('\n')).toContain('broken')
  })

  it('缺少 meta.json 的目录被跳过', () => {
    const root = stateDir()
    mkdirSync(join(root, 'tools', 'empty'), { recursive: true })

    expect(scanSelfmadeTools(root)).toEqual([])
  })

  it('隐藏目录与非目录条目被忽略', () => {
    const root = stateDir()
    writeTool(root, '.hidden', SHELL_META)
    writeFileSync(join(root, 'tools', 'loose.json'), '{}', 'utf8')

    expect(scanSelfmadeTools(root)).toEqual([])
  })

  it('impl.mjs 内容变化会让签名变化', () => {
    const root = stateDir()
    const meta = { name: 't', description: 'd', parameters: { type: 'object', properties: {} } }
    writeTool(root, 't', meta, 'export default async () => 1')
    const first = scanSelfmadeTools(root)[0]?.signature

    writeTool(root, 't', meta, 'export default async () => 2')

    expect(scanSelfmadeTools(root)[0]?.signature).not.toBe(first)
  })
})

describe('自建工具注册表', () => {
  function createRegistry(root: string) {
    const registered = new Map<string, { definition: ToolDefinition; release: () => void }>()
    const warnings: string[] = []
    const registry = new SelfmadeTools({
      stateDir: root,
      register: definition => {
        const entry = { definition, release: () => { registered.delete(definition.name) } }
        registered.set(definition.name, entry)
        return entry.release
      },
      log: message => warnings.push(message),
      watch: false,
    })
    return { registry, registered, warnings }
  }

  it('启动时注册已有工具', () => {
    const root = stateDir()
    writeTool(root, 'greet', SHELL_META)
    const { registry, registered } = createRegistry(root)

    registry.start()

    expect([...registered.keys()]).toEqual(['greet'])
    registry.dispose()
  })

  it('新增目录后重新扫描即注册，无需重启', () => {
    const root = stateDir()
    const { registry, registered } = createRegistry(root)
    registry.start()

    writeTool(root, 'greet', SHELL_META)
    registry.rescan()

    expect([...registered.keys()]).toEqual(['greet'])
    registry.dispose()
  })

  it('删除目录后重新扫描即注销', () => {
    const root = stateDir()
    writeTool(root, 'greet', SHELL_META)
    const { registry, registered } = createRegistry(root)
    registry.start()

    rmSync(join(root, 'tools', 'greet'), { recursive: true, force: true })
    registry.rescan()

    expect([...registered.keys()]).toEqual([])
    registry.dispose()
  })

  it('内容变化时先注销旧的再注册新的', () => {
    const root = stateDir()
    writeTool(root, 'greet', { ...SHELL_META, description: '第一版' })
    const { registry, registered } = createRegistry(root)
    registry.start()

    writeTool(root, 'greet', { ...SHELL_META, description: '第二版' })
    registry.rescan()

    expect(registered.get('greet')?.definition.description).toBe('第二版')
    registry.dispose()
  })

  it('名称已被非自建来源占用时跳过，不覆盖已有工具', () => {
    const root = stateDir()
    writeTool(root, 'greet', SHELL_META)
    const registered = new Map<string, ToolDefinition>()
    const warnings: string[] = []
    const registry = new SelfmadeTools({
      stateDir: root,
      register: definition => {
        registered.set(definition.name, definition)
        return () => { registered.delete(definition.name) }
      },
      isTaken: () => true,
      log: message => warnings.push(message),
      watch: false,
    })

    registry.start()

    expect(registered.size).toBe(0)
    expect(warnings.join('\n')).toContain('greet')
    registry.dispose()
  })

  it('register 抛错只影响那一个工具', () => {
    const root = stateDir()
    writeTool(root, 'greet', SHELL_META)
    writeTool(root, 'other', { ...SHELL_META, name: 'other' })
    const registered = new Set<string>()
    const warnings: string[] = []
    const registry = new SelfmadeTools({
      stateDir: root,
      register: definition => {
        if (definition.name === 'greet') throw new Error('unsupported schema')
        registered.add(definition.name)
        return () => { registered.delete(definition.name) }
      },
      log: message => warnings.push(message),
      watch: false,
    })

    registry.start()

    expect([...registered]).toEqual(['other'])
    expect(warnings.join('\n')).toContain('greet')
    registry.dispose()
  })

  it('同一个坏条目在多次扫描中只警告一次', () => {
    const root = stateDir()
    const dir = join(root, 'tools', 'broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), '{}', 'utf8')
    const { registry, warnings } = createRegistry(root)

    registry.start()
    registry.rescan()
    registry.rescan()

    expect(warnings.filter(message => message.includes('broken'))).toHaveLength(1)
    registry.dispose()
  })

  it('dispose 注销全部工具并停止监听', () => {
    const root = stateDir()
    writeTool(root, 'greet', SHELL_META)
    const { registry, registered } = createRegistry(root)
    registry.start()

    registry.dispose()

    expect(registered.size).toBe(0)
  })

  it('监听目录变化后自动注册新工具', async () => {
    const root = stateDir()
    const registered = new Set<string>()
    const registry = new SelfmadeTools({
      stateDir: root,
      register: definition => {
        registered.add(definition.name)
        return () => { registered.delete(definition.name) }
      },
      watch: true,
    })
    registry.start()

    writeTool(root, 'greet', SHELL_META)

    await waitFor(() => registered.has('greet'))
    expect(registered.has('greet')).toBe(true)
    registry.dispose()
  })

  it('自建工具的名字集合不含已注销的项', () => {
    const root = stateDir()
    writeTool(root, 'greet', SHELL_META)
    const { registry } = createRegistry(root)
    registry.start()

    rmSync(join(root, 'tools', 'greet'), { recursive: true, force: true })
    registry.rescan()

    expect(registry.names().size).toBe(0)
    registry.dispose()
  })

  it('三角测量：内容未变的重复扫描不重新注册', () => {
    const root = stateDir()
    writeTool(root, 'greet', SHELL_META)
    let registrations = 0
    const registry = new SelfmadeTools({
      stateDir: root,
      register: () => {
        registrations += 1
        return () => {}
      },
      watch: false,
    })

    registry.start()
    registry.rescan()
    registry.rescan()

    expect(registrations).toBe(1)
    registry.dispose()
  })

  it('三角测量：meta.name 改名后旧工具被注销，新名字不注册（目录名不一致）', () => {
    const root = stateDir()
    writeTool(root, 'greet', SHELL_META)
    const { registry, registered } = createRegistry(root)
    registry.start()

    writeTool(root, 'greet', { ...SHELL_META, name: 'salute' })
    registry.rescan()

    expect(registered.size).toBe(0)
    registry.dispose()
  })
})
