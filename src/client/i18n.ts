// src/client/i18n.ts
//
// 中英双语文案（覆盖全部 UI 界面文案）。新增文案必须同时补 zh / en。

export const NS = 'capability manager'

export const zh = {

}

export type Dict = typeof zh

/** 组件拿到的翻译函数：键受词典约束，语言每次渲染都取自 locale 服务。 */
export type Translate = (key: keyof Dict) => string

export const en: Dict = {

}

export function text(language: string | null | undefined): Dict {
  return String(language ?? '').toLowerCase().startsWith('zh') ? zh : en
}

/** 按语言码给出该语言的翻译函数。 */
export function translateFor(language: string | null | undefined): Translate {
  const dict = text(language)
  return key => dict[key]
}

/** 从 locale 服务取值中提取语言码 */
export function detectLanguage(locale: unknown, navigatorLanguage?: string): string {
  try {
    if (typeof locale === 'string') return locale
    if (locale && typeof locale === 'object') {
      const record = locale as {
        language?: unknown
        current?: unknown
        get?: (key: string) => unknown
        // DSH 官方 locale 服务（dsh-client-locale LocaleRuntime）形状：
        // getSnapshot() / getLocale() 均返回 { active, locales, revision }。
        getSnapshot?: () => { active?: unknown }
        getLocale?: () => { active?: unknown }
      }
      if (typeof record.language === 'string') return record.language
      if (typeof record.current === 'string') return record.current
      if (typeof record.get === 'function') {
        const value = record.get('language')
        if (typeof value === 'string') return value
      }
      // 官方 locale 服务：读 active 语言 id（'zh' / 'en'）
      if (typeof record.getSnapshot === 'function') {
        const snapshot = record.getSnapshot()
        if (snapshot && typeof snapshot.active === 'string') return snapshot.active
      }
      if (typeof record.getLocale === 'function') {
        const snapshot = record.getLocale()
        if (snapshot && typeof snapshot.active === 'string') return snapshot.active
      }
    }
  } catch {
    // 忽略
  }
  try {
    return typeof navigator !== 'undefined' ? (navigator.language ?? navigatorLanguage ?? 'en') : (navigatorLanguage ?? 'en')
  } catch {
    return navigatorLanguage ?? 'en'
  }
}
