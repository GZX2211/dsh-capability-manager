// src/client/style.ts
//
// 面板样式：颜色/圆角/字号/阴影一律取宿主 design token，不复制设计变量。
//
// 排版跟宿主主界面同一套刻度，这是本文件的第一原则：
//   · 字号：14 正文 / 13 次要 / 12 小字 / 11 徽标
//   · 行高：22 正文 / 20 次要 / 16 小字与徽标
//   · 间距：4 / 8 / 12 / 14，全部沿同一条左基线（卡片内边距 14px）
//
// 构建链路没有 CSS Module 管线（客户端产物是单个 CJS 文件），因此样式集中
// 在本文件；类名用 `cm-` 前缀隔离，避免与宿主样式串味。

const CSS = `
.cm-page { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-surface-primary, transparent); }
.cm-header { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 12px; }
.cm-heading { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.cm-title { font-size: 16px; line-height: 24px; font-weight: 600; color: var(--dsw-alias-text-primary, inherit); }
.cm-subtitle { font-size: 13px; line-height: 20px; color: var(--dsw-alias-text-secondary, rgba(128,128,128,.95)); }
.cm-tabs { padding: 0 20px 12px; }
.cm-toolbar { display: flex; align-items: center; gap: 8px; padding: 0 20px 12px; flex-wrap: wrap; }
.cm-filters { display: flex; align-items: center; gap: 6px; }
.cm-search { margin-left: auto; width: 220px; }
.cm-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 20px 24px; }
.cm-list { display: flex; flex-direction: column; gap: 2px; }
.cm-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px; }
.cm-row:hover { background: var(--dsw-alias-surface-raised, rgba(128,128,128,.08)); }
.cm-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.cm-row-name { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-text-primary, inherit); overflow-wrap: anywhere; }
.cm-row-summary { font-size: 13px; line-height: 20px; color: var(--dsw-alias-text-secondary, rgba(128,128,128,.95)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-row-tags { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.cm-row-toggles { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.cm-toggle { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.cm-toggle-label { font-size: 11px; line-height: 16px; color: var(--dsw-alias-text-secondary, rgba(128,128,128,.95)); }
.cm-state { display: flex; align-items: center; gap: 8px; padding: 40px 0; justify-content: center; font-size: 13px; color: var(--dsw-alias-text-secondary, rgba(128,128,128,.95)); }
.cm-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 48px 0; }
.cm-empty-title { font-size: 14px; line-height: 22px; color: var(--dsw-alias-text-primary, inherit); }
.cm-empty-hint { font-size: 13px; line-height: 20px; color: var(--dsw-alias-text-secondary, rgba(128,128,128,.95)); }
.cm-warnings { display: flex; flex-direction: column; gap: 6px; margin: 0 20px 12px; }
.cm-warning { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-text-primary, inherit); background: var(--dsw-alias-surface-raised, rgba(128,128,128,.08)); }
.cm-warning-icon { flex-shrink: 0; margin-top: 2px; color: var(--dsw-alias-text-warning, #b45309); }
.cm-placeholder { padding: 40px 0; text-align: center; font-size: 13px; line-height: 22px; color: var(--dsw-alias-text-secondary, rgba(128,128,128,.95)); }
.cm-help { display: flex; flex-direction: column; gap: 14px; font-size: 13px; line-height: 21px; }
.cm-help-section { display: flex; flex-direction: column; gap: 2px; }
.cm-help-term { font-weight: 600; color: var(--dsw-alias-text-primary, inherit); }
.cm-help-mode { font-size: 12px; line-height: 18px; color: var(--dsw-alias-text-secondary, rgba(128,128,128,.95)); }
.cm-notice { margin: 0 20px 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-text-warning, #b45309); }
`

/** 已注入的样式表；重复调用不重复插入。 */
let installed: HTMLStyleElement | undefined

/**
 * 注入面板样式。
 *
 * @returns 卸载时移除样式表；未注入时返回空操作。
 */
export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (installed !== undefined) return () => {}

  const element = document.createElement('style')
  element.dataset.capabilityManager = 'styles'
  element.textContent = CSS
  document.head.append(element)
  installed = element
  return () => {
    if (installed !== element) return
    element.remove()
    installed = undefined
  }
}
