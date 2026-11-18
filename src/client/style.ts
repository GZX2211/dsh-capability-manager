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
//
// 双栏宽度由内联 CSS 变量 `--cm-split` 提供：分栏比例是状态，媒体查询需要
// 覆盖它时只写 CSS 就够，不把布局决策散到两个地方。

const CSS = `
.cm-page { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-surface-primary, transparent); }
.cm-header { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 12px; }
.cm-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.cm-header-actions > button { height: 32px; font-size: 13px; line-height: 20px; border-radius: var(--dsw-radius-md); }
.cm-create-group { display: inline-flex; align-items: stretch; flex: none; }
.cm-create-primary { height: 32px; padding: 0 12px; font-size: 13px; line-height: 20px; border-top-right-radius: 0; border-bottom-right-radius: 0; }
.cm-create-more { width: 32px; height: 32px; padding: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; border-left: 0.5px solid color-mix(in srgb, var(--dsw-alias-label-primary-foreground) 30%, transparent); }
.cm-heading { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.cm-title-row { display: flex; align-items: center; gap: 4px; }
.cm-title { font-size: 16px; line-height: 24px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
.cm-subtitle { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }

.cm-tabbar { display: flex; align-items: center; gap: 8px; padding: 0 20px 12px; }
.cm-tabs { flex: 1; min-width: 0; }
.cm-help-button { flex-shrink: 0; color: var(--dsw-alias-label-secondary, inherit); }

.cm-toolbar { display: flex; align-items: center; gap: 8px; padding: 0 20px 12px; flex-wrap: wrap; }
.cm-filters { display: flex; align-items: center; gap: 6px; }
.cm-search { margin-left: auto; width: 260px; }

.cm-content { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 20px 18px; }
.cm-content--dragging { user-select: none; }

.cm-transfer { flex: 1; min-height: 0; display: grid; grid-template-columns: var(--cm-split, 50%) 16px minmax(0, 1fr); }

.cm-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border: 0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.28)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.05)); }
.cm-pane-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; padding: 10px 14px; border-bottom: 0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.28)); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08)); }
.cm-pane-title { font-size: 13px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
.cm-pane-count { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.9)); font-variant-numeric: tabular-nums; }
.cm-pane-body { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cm-pane-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 6px; }
.cm-pane-empty { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 32px 16px; text-align: center; }
.cm-pane-empty-title { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-pane-empty-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.9)); }

.cm-splitter { position: relative; cursor: col-resize; touch-action: none; }
.cm-splitter::after { content: ''; position: absolute; top: 12px; bottom: 12px; left: 50%; width: 1px; border-radius: 1px; background: var(--dsw-alias-border-l3, rgba(128,128,128,.3)); transition: background-color 120ms ease, width 120ms ease; transform: translateX(-50%); }
@media (hover: hover) {
  .cm-splitter:hover::after { width: 2px; background: var(--dsw-alias-state-business-primary, rgba(64,128,255,.8)); }
}
.cm-splitter:focus-visible { outline: none; }
.cm-splitter:focus-visible::after, .cm-splitter:active::after { width: 2px; background: var(--dsw-alias-state-business-primary, rgba(64,128,255,.8)); }

.cm-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 8px; }
.cm-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); }
.cm-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.cm-row-name { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary, inherit); overflow-wrap: anywhere; }
.cm-row-summary { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-row-tags { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.cm-row-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.cm-row-action { width: 28px; padding: 0; color: var(--dsw-alias-label-secondary, inherit); }

.cm-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 0; justify-content: center; flex: 1; font-size: 13px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }

/* ---- 设置页：左侧分区导航 + 右侧内容 ---- */
.cm-settings { flex: 1; min-height: 0; display: flex; gap: 16px; }
.cm-settings-nav { display: flex; flex-direction: column; gap: 2px; width: 168px; flex-shrink: 0; }
.cm-settings-nav-item { justify-content: flex-start; height: 30px; padding: 0 10px; font-size: 13px; line-height: 20px; border-radius: 8px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-settings-nav-item--active { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); color: var(--dsw-alias-label-primary, inherit); font-weight: 600; }
.cm-settings-body { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.cm-settings-section { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.cm-settings-title { margin: 0; font-size: 14px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
.cm-settings-intro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-settings-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cm-settings-state { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary, inherit); }
.cm-settings-notice { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.9)); }
.cm-settings-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border: 0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.28)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.05)); }
.cm-blacklist-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
/* 清空在池标题栏里：它与「已禁用 n/m」回答同一件事，放在列表上方会多占一行高度。 */
.cm-pane-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.cm-pane-clear { height: 24px; padding: 0 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-pane-clear:hover:not(:disabled) { color: var(--dsw-alias-label-primary, inherit); }
.cm-tag-anchor { display: inline-flex; }
.cm-session-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 6px; }
.cm-session-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; }
.cm-session-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); }
.cm-session-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.cm-session-id { font-size: 13px; line-height: 20px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary, inherit); }
.cm-session-effective { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-session-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-text-warning, #b45309); }
.cm-session-choice { flex-shrink: 0; }
.cm-warnings { display: flex; flex-direction: column; gap: 6px; margin: 0 20px 12px; }
.cm-warning { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-surface-raised, rgba(128,128,128,.08)); }
.cm-warning-icon { flex-shrink: 0; margin-top: 2px; color: var(--dsw-alias-text-warning, #b45309); }
.cm-help { display: flex; flex-direction: column; gap: 14px; font-size: 13px; line-height: 21px; }
.cm-help-section { display: flex; flex-direction: column; gap: 2px; }
.cm-help-term { font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
.cm-help-mode { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-notice { margin: 0 20px 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-text-warning, #b45309); }

@media (max-width: 900px) {
  .cm-transfer { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); row-gap: 12px; }
  .cm-splitter { display: none; }
  .cm-search { width: 100%; }
  .cm-settings { flex-direction: column; gap: 12px; }
  .cm-settings-nav { flex-direction: row; width: auto; overflow-x: auto; }
  .cm-blacklist-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
}
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
