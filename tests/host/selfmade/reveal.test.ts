// tests/host/selfmade/reveal.test.ts
//
// 打开自建能力目录：路径解析与跨平台命令选择。真正调起文件管理器的那一步
// 由注入的 spawn 替身观察，测试不启动外部程序。

import { describe, expect, it } from 'vitest'
import { revealInFileManager } from '../../../src/host/selfmade/reveal.ts'

interface Spawned {
  command: string
  args: string[]
}

function spawnRecorder(unref = true): {
  spawn: (command: string, args: string[]) => { unref: () => void }
  calls: Spawned[]
  unrefCalled: () => boolean
} {
  const calls: Spawned[] = []
  let unrefCalled = false
  return {
    spawn: (command, args) => {
      calls.push({ command, args })
      return {
        unref: () => { unrefCalled = unref },
      }
    },
    calls,
    unrefCalled: () => unrefCalled,
  }
}

describe('打开目录', () => {
  it('Windows 用资源管理器打开该路径', () => {
    const recorder = spawnRecorder()

    revealInFileManager('C:\\state\\skills\\my-skill', {
      platform: 'win32',
      spawn: recorder.spawn,
      exists: () => true,
    })

    expect(recorder.calls[0]).toEqual({ command: 'explorer.exe', args: ['C:\\state\\skills\\my-skill'] })
  })

  it('macOS 用 open，其他平台用 xdg-open', () => {
    const mac = spawnRecorder()
    const linux = spawnRecorder()

    revealInFileManager('/state/skills/my-skill', { platform: 'darwin', spawn: mac.spawn, exists: () => true })
    revealInFileManager('/state/skills/my-skill', { platform: 'linux', spawn: linux.spawn, exists: () => true })

    expect(mac.calls[0]?.command).toBe('open')
    expect(linux.calls[0]?.command).toBe('xdg-open')
  })

  it('目录不存在时抛出带路径的错误', () => {
    const recorder = spawnRecorder()

    expect(() =>
      revealInFileManager('/state/skills/missing', { platform: 'linux', spawn: recorder.spawn, exists: () => false }),
    ).toThrow('/state/skills/missing')
    expect(recorder.calls).toEqual([])
  })

  it('spawn 失败时包装成可行动的错误', () => {
    const spawn = (() => {
      throw new Error('ENOENT')
    }) as never

    expect(() => revealInFileManager('/state/x', { platform: 'linux', spawn, exists: () => true })).toThrow(/打开目录/)
  })

  it('子进程与宿主解耦：调用 unref', () => {
    const recorder = spawnRecorder()

    revealInFileManager('/state/x', { platform: 'linux', spawn: recorder.spawn, exists: () => true })

    expect(recorder.unrefCalled()).toBe(true)
  })
})
