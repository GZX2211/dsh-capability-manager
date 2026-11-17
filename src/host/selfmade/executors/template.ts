// src/host/selfmade/executors/template.ts
//
// 声明式工具的占位符展开：`{{参数名}}` → 调用参数的 JSON 文本。
//
// 展开结果永远是一个「值」，不是一段拼接后的脚本：shell 场景下每个元素是独立的
// argv 项，http 场景下 URL 位置还要再过一层百分号编码。因此这里只做值替换，
// 由调用方决定如何转义。

/** 占位符语法：字母数字下划线，避免与 JSON 的 `{{` 花括号混淆。 */
const PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g

/**
 * 展开模板中的占位符。
 *
 * 参数缺失时展开为空串而不是保留占位符：工具参数大多是可选的，留下 `{{x}}`
 * 会把一个语法残片交给 shell 或 URL。对象与数组按 JSON 文本展开。
 *
 * @param template - 含零到多个占位符的文本。
 * @param args - 模型给出的调用参数。
 * @param encode - 可选的逐值编码（URL 位置传 `encodeURIComponent`）。
 * @returns 展开后的文本。
 */
export function fillTemplate(
  template: string,
  args: Record<string, unknown>,
  encode: (value: string) => string = value => value,
): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => encode(renderValue(args[key])))
}

/** 字符串原样、其余 JSON 值用 JSON 文本；`undefined` 视为未提供。 */
function renderValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return JSON.stringify(value) ?? ''
}
