// tests/client/style.test.ts
//
// 样式表是注入到 <head> 的一段模板字符串。这里保护两件事：
//   1. 关键规则确实进到了注入文本里（模板字符串被提前结束时，后面的规则会丢失）；
//   2. 文本以 `}` 收尾，说明整段 CSS 完整、没有被截断。

import { afterEach, describe, expect, it } from 'vitest'
import { installStyles } from '../../src/client/style.ts'

interface FakeElement {
  dataset: Record<string, string>
  textContent: string
  remove(): void
}

function installFakeDocument(): FakeElement[] {
  const appended: FakeElement[] = []
  const document = {
    createElement: (): FakeElement => ({
      dataset: {},
      textContent: '',
      remove() {},
    }),
    head: {
      append: (element: FakeElement) => {
        appended.push(element)
      },
    },
  }
  ;(globalThis as { document?: unknown }).document = document
  return appended
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document
})

function injectedCss(): string {
  const appended = installFakeDocument()
  const cleanup = installStyles()
  const css = appended[0]?.textContent ?? ''
  cleanup()
  return css
}

describe('注入的样式表', () => {
  it('包含面板自身的骨架规则', () => {
    const css = injectedCss()

    expect(css).toContain('.cm-page')
    expect(css).toContain('.cm-toolbar')
  })

  it('包含 MCP 分区与弹窗尺寸规则', () => {
    const css = injectedCss()

    expect(css).toContain('.cm-mcp-list')
    expect(css).toContain('.cm-mcp-grid')
    expect(css).toContain('.cm-dialog.cm-dialog')
    expect(css).toContain('.cm-dialog__scroll')
  })

  it('整段规则完整收尾，没有被提前截断', () => {
    const css = injectedCss()

    expect(css.trimEnd().endsWith('}')).toBe(true)
    // 模板字符串提前结束时，收尾的 @media 块与最后一条规则都会消失。
    expect(css).toContain('@media (max-width: 900px)')
    expect(css).toContain('.cm-mcp-dialog-delete')
  })
})
