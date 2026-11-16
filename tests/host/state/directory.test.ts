import { afterEach, describe, expect, it } from 'vitest'
import { resolveStateDirectory } from '../../../src/host/state/directory.ts'

const original = process.env.DSH_HOME

afterEach(() => {
  if (original === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = original
})

describe('状态目录', () => {
  it('默认落在 DSH_HOME 的 state 下', () => {
    process.env.DSH_HOME = 'C:\\Users\\tester\\.dsh'

    expect(resolveStateDirectory()).toBe('C:\\Users\\tester\\.dsh\\state\\capability-manager')
  })

  it('配置给出的路径优先', () => {
    process.env.DSH_HOME = 'C:\\Users\\tester\\.dsh'

    expect(resolveStateDirectory('D:\\custom')).toBe('D:\\custom')
  })

  it('空白覆盖值视为未给出', () => {
    process.env.DSH_HOME = 'C:\\Users\\tester\\.dsh'

    expect(resolveStateDirectory('   ')).toBe('C:\\Users\\tester\\.dsh\\state\\capability-manager')
  })

  it('没有 DSH_HOME 时退回用户主目录下的 .dsh', () => {
    delete process.env.DSH_HOME

    expect(resolveStateDirectory().endsWith('capability-manager')).toBe(true)
    expect(resolveStateDirectory()).toContain('.dsh')
  })
})
