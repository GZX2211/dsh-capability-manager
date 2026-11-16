// src/client/definition.ts
//
// 面板的静态身份：左侧栏入口与主页面共用同一个 id，宿主据此把它们连起来。

/** 侧栏入口 id 与主页面 key；两者必须一致。 */
export const PANEL_ID = 'capability-manager'

/**
 * 侧栏中的排序位置。
 *
 * 「插件」入口用 0，本面板排在它下面；数值只决定相对顺序。
 */
export const PANEL_ORDER = 21
