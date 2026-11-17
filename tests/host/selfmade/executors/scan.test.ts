// tests/host/selfmade/executors/scan.test.ts

import { describe, expect, it } from 'vitest'
import { scanCodeWarnings } from '../../../../src/host/selfmade/executors/scan.ts'

describe('代码工具静态检查', () => {
  it('无高危导入时不产生提示', () => {
    const source = ['export default async args => ({ ok: true, echo: args })'].join('\n')

    expect(scanCodeWarnings(source)).toEqual([])
  })

  it('检出静态 import 的高危模块', () => {
    const warnings = scanCodeWarnings("import { exec } from 'node:child_process'\nexport default async () => ({})")

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('node:child_process')
  })

  it('检出 require 与动态 import 的高危模块', () => {
    const required = scanCodeWarnings("const fs = require('fs')\nexport default async () => ({})")
    const dynamic = scanCodeWarnings("export default async () => (await import('node:net'))")

    expect(required[0]).toContain('fs')
    expect(dynamic[0]).toContain('node:net')
  })

  it('同一个模块只提示一次，多个模块各一条', () => {
    const source = [
      "import a from 'node:fs'",
      "import b from 'node:fs'",
      "import c from 'node:vm'",
      'export default async () => ({})',
    ].join('\n')

    const warnings = scanCodeWarnings(source)

    expect(warnings).toHaveLength(2)
    expect(warnings.join('\n')).toContain('node:fs')
    expect(warnings.join('\n')).toContain('node:vm')
  })

  it('普通相对导入与安全内置模块不被误判', () => {
    const source = ["import x from './x.mjs'", "import y from 'node:util'", 'export default async () => ({})'].join('\n')

    expect(scanCodeWarnings(source)).toEqual([])
  })
})
