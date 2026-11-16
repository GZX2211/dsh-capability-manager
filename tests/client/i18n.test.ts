import { describe, expect, it } from 'vitest'
import { detectLanguage, en, text, translateFor, zh } from '../../src/client/i18n.ts'

describe('词典完整性', () => {
  const zhDict = zh as Record<string, string>
  const enDict = en as Record<string, string>

  it('中英词典的键完全一致', () => {
    expect(Object.keys(enDict).sort()).toEqual(Object.keys(zhDict).sort())
  })

  it('没有空文案', () => {
    for (const [key, value] of Object.entries(zhDict)) {
      expect(value.length, `zh.${key}`).toBeGreaterThan(0)
    }
    for (const [key, value] of Object.entries(enDict)) {
      expect(value.length, `en.${key}`).toBeGreaterThan(0)
    }
  })

  it('中英文案不同，避免漏译', () => {
    const identical = Object.keys(zhDict).filter(key => zhDict[key] === enDict[key])
    // 少数文案天然相同（如工具名），这里只要求绝大多数确实翻译过。
    expect(identical.length).toBeLessThan(Object.keys(zhDict).length / 2)
  })
})

describe('语言选择', () => {
  it('中文语言码走中文词典', () => {
    expect(text('zh')).toBe(zh)
    expect(text('zh-CN')).toBe(zh)
    expect(text('zh-Hant')).toBe(zh)
  })

  it('其他语言码走英文词典', () => {
    expect(text('en')).toBe(en)
    expect(text('en-US')).toBe(en)
    expect(text('fr')).toBe(en)
  })

  it('缺少语言码时走英文词典', () => {
    expect(text(undefined)).toBe(en)
    expect(text(null)).toBe(en)
    expect(text('')).toBe(en)
  })

  it('翻译函数按键取值', () => {
    expect(translateFor('zh')('nav')).toBe(zh.nav)
    expect(translateFor('en')('nav')).toBe(en.nav)
  })

  it('从 locale 服务的快照里取到语言', () => {
    expect(detectLanguage({ getSnapshot: () => ({ active: 'zh' }) })).toBe('zh')
    expect(detectLanguage({ getLocale: () => ({ active: 'en' }) })).toBe('en')
  })

  it('locale 服务取值抛错时仍然给出语言码', () => {
    const broken = {
      getSnapshot: () => {
        throw new Error('locale runtime is disposed')
      },
    }

    const language = detectLanguage(broken)

    expect(language.length).toBeGreaterThan(0)
  })
})
