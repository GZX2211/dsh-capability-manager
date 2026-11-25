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
// 模板字符串内不得出现反引号或 `${`：它们会提前结束 CSS 字面量，构建仍然成功，
// 但客户端模块会在加载时抛错、整个面板（含侧栏入口）都不会注册。
// tests/client/style.test.ts 用注入文本兜底这条约束。
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
/* 单个设置项不需要面板撑满高度：内容决定卡片高度。 */
.cm-settings-panel--flush { flex: 0 0 auto; }
.cm-settings-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
.cm-settings-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.cm-settings-row-title { font-size: 13px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
.cm-settings-switch { flex-shrink: 0; }
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
/* 页头提示区：Toast 在左，永久提示收拢到右侧感叹号图标；两者无内容时不占位。 */
.cm-notice-area { display: flex; align-items: center; gap: 8px; flex-shrink: 1; min-width: 0; }
.cm-toast { max-width: 420px; white-space: pre-line; overflow-wrap: anywhere; font-size: 12px; line-height: 18px; color: var(--dsw-alias-text-warning, #b45309); }
.cm-warning-hint { flex-shrink: 0; width: 28px; padding: 0; color: var(--dsw-alias-text-warning, #b45309); }
.cm-help { display: flex; flex-direction: column; gap: 14px; font-size: 13px; line-height: 21px; }
.cm-help-section { display: flex; flex-direction: column; gap: 2px; }
.cm-help-term { font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
.cm-help-mode { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-notice { margin: 0 20px 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-text-warning, #b45309); }

/* ---- 本插件的弹窗尺寸：官方 Modal 默认 min(380px, 100%)，会把命令与说明压成多行。
   本插件的两个弹窗（帮助 / MCP 配置）统一成同一宽度与同一套滚动边界。
   双写类名是为了在宿主样式表后加载时仍压过它自己的 dialog 宽度。 ---- */
.cm-dialog.cm-dialog { width: min(640px, 100%); }
/* 弹窗内容超过视口时在卡片内部滚动：标题与底部操作始终留在视野里。 */
.cm-dialog__scroll { max-height: min(60vh, 560px); overflow-y: auto; overscroll-behavior: contain; padding-right: 4px; }

/* ---- MCP 分区：工具栏 + 单栏列表 + 配置弹窗 ---- */
.cm-mcp { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* 「配置 MCP」与搜索框成组推到右侧；按钮在前，因为它是这一页的主操作。 */
.cm-mcp-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.cm-mcp-actions .cm-search { margin-left: 0; }
.cm-mcp-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 6px; border: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28)); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.05)); }
.cm-mcp-state { display: inline-flex; align-items: center; justify-content: center; width: 14px; flex-shrink: 0; }
.cm-mcp-empty-title { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-mcp-empty-hint { max-width: 520px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.9)); }
.cm-mcp-state-detail { max-width: 560px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.9)); overflow-wrap: anywhere; }
/* 计数在主操作左侧，和筛选胶囊一起回答「有几台、连上几台」。 */
.cm-mcp-counts { flex-shrink: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.9)); font-variant-numeric: tabular-nums; }

.cm-mcp-dialog { display: flex; flex-direction: column; gap: 12px; }
.cm-mcp-dialog-intro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-mcp-dialog-modes { align-self: flex-start; }
/* 名称与连接方式并排：两者都短，纵向堆叠只会把弹窗拉长。 */
.cm-mcp-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
.cm-mcp-field { display: flex; flex-direction: column; gap: 4px; }
.cm-mcp-field-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-mcp-field-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.85)); }
/* 原生 textarea：官方原子包没有多行输入，这里只借宿主的输入材质。 */
.cm-mcp-import-input { box-sizing: border-box; width: 100%; min-height: 120px; padding: 8px 10px; font: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08)); border: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28)); border-radius: 8px; resize: vertical; }
.cm-mcp-import-input:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary, rgba(64,128,255,.8)); }
.cm-mcp-import-preview { display: flex; flex-direction: column; gap: 4px; }
.cm-mcp-import-count { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, rgba(128,128,128,.95)); }
.cm-mcp-import-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; max-height: 160px; overflow-y: auto; }
.cm-mcp-import-row { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 18px; }
.cm-mcp-import-name { flex-shrink: 0; font-weight: 500; color: var(--dsw-alias-label-primary, inherit); }
.cm-mcp-import-target { color: var(--dsw-alias-label-secondary, rgba(128,128,128,.9)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-mcp-issues { margin: 0; padding: 0 0 0 16px; display: flex; flex-direction: column; gap: 2px; }
.cm-mcp-issue { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary, #d33); }
.cm-mcp-dialog-footer { display: flex; align-items: center; gap: 8px; width: 100%; }
.cm-mcp-dialog-spacer { flex: 1; }
/* 删除是危险操作：用错误色描边，与主保存按钮明确区分。 */
.cm-mcp-dialog-delete { color: var(--dsw-alias-state-error-primary, #d33); }

@media (max-width: 900px) {
  .cm-transfer { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); row-gap: 12px; }
  .cm-splitter { display: none; }
  .cm-search { width: 100%; }
  .cm-settings { flex-direction: column; gap: 12px; }
  .cm-settings-nav { flex-direction: row; width: auto; overflow-x: auto; }
  .cm-blacklist-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
  /* 窄屏时主操作与搜索各占一行，避免搜索框被压到不可用宽度。 */
  .cm-mcp-actions { margin-left: 0; width: 100%; }
  .cm-mcp-actions .cm-search { flex: 1; width: auto; }
  .cm-mcp-grid { grid-template-columns: minmax(0, 1fr); }
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
