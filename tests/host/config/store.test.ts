import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../../src/host/config/store.ts'
import { DEFAULT_CONFIG } from '../../../src/shared/config.ts'

const directories: string[] = []

/** 每个测试一个独立状态目录，避免测试之间互相看见文件。 */
function stateDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'capability-manager-config-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function configFile(directory: string): string {
  return join(directory, 'config.json')
}

describe('配置存储：读取', () => {
  it('目录不存在时给出默认配置，且不创建目录', () => {
    const directory = join(stateDirectory(), 'missing')
    const store = ConfigStore.open({ directory })

    expect(store.read()).toEqual(DEFAULT_CONFIG)
    expect(existsSync(directory)).toBe(false)
  })

  it('文件不存在时给出默认配置', () => {
    expect(ConfigStore.open({ directory: stateDirectory() }).read()).toEqual(DEFAULT_CONFIG)
  })

  it('文件无法解析时回落默认配置并记一条警告', () => {
    const directory = stateDirectory()
    writeFileSync(configFile(directory), '{ this is not json', 'utf8')
    const log = vi.fn()

    expect(ConfigStore.open({ directory, log }).read()).toEqual(DEFAULT_CONFIG)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('读到合法配置时原样返回', () => {
    const directory = stateDirectory()
    writeFileSync(
      configFile(directory),
      JSON.stringify({ version: 1, excluded: ['tool:bash'], resident: ['tool:meta_search'] }),
      'utf8',
    )

    const config = ConfigStore.open({ directory }).read()
    expect(config.excluded).toEqual(['tool:bash'])
    expect(config.resident).toEqual(['tool:meta_search'])
  })

  it('读到需要自愈的内容时按自愈规则收敛，不记警告', () => {
    const directory = stateDirectory()
    writeFileSync(
      configFile(directory),
      JSON.stringify({ excluded: ['bogus', 'tool:bash', 'tool:bash'], resident: ['tool:bash', 'tool:read'] }),
      'utf8',
    )
    const log = vi.fn()

    const config = ConfigStore.open({ directory, log }).read()
    expect(config.excluded).toEqual(['tool:bash'])
    expect(config.resident).toEqual(['tool:read'])
    expect(log).not.toHaveBeenCalled()
  })

  it('read 返回的配置不与内部状态共享引用', () => {
    const store = ConfigStore.open({ directory: stateDirectory() })
    store.read().resident.push('tool:injected')

    expect(store.read().resident).toEqual(DEFAULT_CONFIG.resident)
  })

  it('嵌套字段也是独立副本', () => {
    const store = ConfigStore.open({ directory: stateDirectory() })
    store.read().blacklist.router.push('tool:bash')
    store.read().roleBindings.s1 = 'router'

    expect(store.read().blacklist.router).toEqual([])
    expect(store.read().roleBindings).toEqual({})
  })
})

describe('配置存储：写入', () => {
  it('写入后可从磁盘重新读出', () => {
    const directory = stateDirectory()
    const store = ConfigStore.open({ directory })
    const next = { ...store.read(), excluded: ['tool:bash'] }

    const result = store.write(next, 0)

    expect(result).toEqual({ ok: true, revision: 1 })
    expect(ConfigStore.open({ directory }).read().excluded).toEqual(['tool:bash'])
  })

  it('写入前先自愈，非法标识不会落盘', () => {
    const directory = stateDirectory()
    const store = ConfigStore.open({ directory })

    store.write({ ...store.read(), excluded: ['bogus', 'tool:bash'] }, 0)

    const onDisk = JSON.parse(readFileSync(configFile(directory), 'utf8')) as { excluded: string[] }
    expect(onDisk.excluded).toEqual(['tool:bash'])
  })

  it('落盘内容为带缩进的 UTF-8 JSON，便于人工核对与 diff', () => {
    const directory = stateDirectory()
    const store = ConfigStore.open({ directory })
    store.write({ ...store.read(), excluded: ['tool:bash'] }, 0)

    const text = readFileSync(configFile(directory), 'utf8')
    expect(text).toContain('\n  ')
    expect(text.endsWith('\n')).toBe(true)
    expect(() => JSON.parse(text) as unknown).not.toThrow()
  })

  it('写入成功后内存态立即生效', () => {
    const store = ConfigStore.open({ directory: stateDirectory() })
    store.write({ ...store.read(), resident: [] }, 0)

    expect(store.read().resident).toEqual([])
  })

  it('写入过程不在状态目录留下临时文件', () => {
    const directory = stateDirectory()
    const store = ConfigStore.open({ directory })
    store.write({ ...store.read(), excluded: ['tool:bash'] }, 0)

    expect(readdirSync(directory)).toEqual(['config.json'])
  })

  it('写入会创建缺失的状态目录', () => {
    const directory = join(stateDirectory(), 'nested', 'state')
    const store = ConfigStore.open({ directory })

    expect(store.write({ ...store.read(), excluded: ['tool:bash'] }, 0)).toEqual({ ok: true, revision: 1 })
    expect(existsSync(configFile(directory))).toBe(true)
  })
})

describe('配置存储：revision 与并发', () => {
  it('revision 随每次内容变化的写入递增', () => {
    const store = ConfigStore.open({ directory: stateDirectory() })

    expect(store.revision).toBe(0)
    store.write({ ...store.read(), excluded: ['tool:bash'] }, 0)
    expect(store.revision).toBe(1)
    store.write({ ...store.read(), excluded: ['tool:read'] }, 1)
    expect(store.revision).toBe(2)
  })

  it('revision 不匹配时拒绝写入且不改变任何状态', () => {
    const directory = stateDirectory()
    const store = ConfigStore.open({ directory })
    store.write({ ...store.read(), excluded: ['tool:bash'] }, 0)

    const result = store.write({ ...store.read(), excluded: ['tool:read'] }, 0)

    expect(result).toEqual({ ok: false, code: 'revision-conflict', revision: 1 })
    expect(store.read().excluded).toEqual(['tool:bash'])
    expect(ConfigStore.open({ directory }).read().excluded).toEqual(['tool:bash'])
  })

  it('revision 不匹配时不创建配置文件', () => {
    const directory = stateDirectory()
    ConfigStore.open({ directory }).write(DEFAULT_CONFIG, 5)

    expect(existsSync(configFile(directory))).toBe(false)
  })
})

describe('配置存储：写盘失败', () => {
  it('状态目录被同名文件占住时报告写盘失败，且内存态与 revision 都不变', () => {
    const directory = join(stateDirectory(), 'blocked')
    writeFileSync(directory, 'not a directory', 'utf8')
    const store = ConfigStore.open({ directory })

    const result = store.write({ ...store.read(), excluded: ['tool:bash'] }, 0)

    expect(result).toMatchObject({ ok: false, code: 'write-failed' })
    expect(store.revision).toBe(0)
    expect(store.read()).toEqual(DEFAULT_CONFIG)
  })
})

describe('配置存储：订阅', () => {
  it('写入成功后通知订阅者，并带上新配置与 revision', () => {
    const store = ConfigStore.open({ directory: stateDirectory() })
    const listener = vi.fn()
    store.subscribe(listener)

    store.write({ ...store.read(), resident: [] }, 0)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ config: expect.objectContaining({ resident: [] }), revision: 1 })
  })

  it('写入失败时不通知订阅者', () => {
    const store = ConfigStore.open({ directory: stateDirectory() })
    const listener = vi.fn()
    store.subscribe(listener)

    store.write(DEFAULT_CONFIG, 9)

    expect(listener).not.toHaveBeenCalled()
  })

  it('内容没有变化时不写入、不递增、不通知', () => {
    const directory = stateDirectory()
    const store = ConfigStore.open({ directory })
    store.write({ ...store.read(), excluded: ['tool:bash'] }, 0)
    const before = readFileSync(configFile(directory), 'utf8')
    const listener = vi.fn()
    store.subscribe(listener)

    expect(store.write(store.read(), 1)).toEqual({ ok: true, revision: 1 })
    expect(store.revision).toBe(1)
    expect(listener).not.toHaveBeenCalled()
    expect(readFileSync(configFile(directory), 'utf8')).toBe(before)
  })

  it('取消订阅后不再收到通知', () => {
    const store = ConfigStore.open({ directory: stateDirectory() })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()

    store.write({ ...store.read(), resident: [] }, 0)

    expect(listener).not.toHaveBeenCalled()
  })

  it('一个订阅者抛错不影响其他订阅者，也不让已落盘的写入报失败', () => {
    const directory = stateDirectory()
    const log = vi.fn()
    const store = ConfigStore.open({ directory, log })
    const late = vi.fn()
    store.subscribe(() => {
      throw new Error('listener exploded')
    })
    store.subscribe(late)

    const result = store.write({ ...store.read(), excluded: ['tool:bash'] }, 0)

    expect(result).toEqual({ ok: true, revision: 1 })
    expect(late).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(ConfigStore.open({ directory }).read().excluded).toEqual(['tool:bash'])
  })
})
