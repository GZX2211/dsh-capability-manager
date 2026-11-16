// src/host/search/lexical.ts
//
// 名称通道召回：把用户给的名称片段当正则，在候选名称上做未锚定、大小写不敏感匹配。
//
// 契约要求「用户给的串直接作为片段」，所以元字符不转义——用户写 "read|write"
// 就是要两条分支。代价是 "read" 也会命中 "already_read"，这是刻意的超集匹配：
// 召回结果自带完整 schema，模型自己会判断该不该用。

/** 编译失败的原因由调用方转成 note，模块内不抛错。 */
export type CompiledPattern = RegExp | undefined

/**
 * 编译名称片段。
 *
 * @param input - 用户给的名称或名称组；正则元字符按正则解释。
 * @returns 大小写不敏感、未锚定的正则；非法或空白输入为 `undefined`。
 */
export function compileNamePattern(input: string): CompiledPattern {
  const trimmed = input.trim()
  if (trimmed.length === 0) return undefined
  try {
    return new RegExp(trimmed, 'i')
  } catch {
    // 非法的正则片段只让这条通道失效，不影响调用方继续用其他通道召回。
    return undefined
  }
}

/**
 * 在候选名称里找出命中片段的那些。
 *
 * @param names - 候选名称，按期望的输出顺序给出。
 * @param pattern - 已编译的片段。
 * @returns 命中的名称；保持候选顺序。
 */
export function matchNames(names: Iterable<string>, pattern: RegExp): Set<string> {
  const matched = new Set<string>()
  for (const name of names) {
    // lastIndex 只对带 g/y 的正则有意义，这里统一重置以免调用方传入复用中的正则。
    pattern.lastIndex = 0
    if (pattern.test(name)) matched.add(name)
  }
  return matched
}
