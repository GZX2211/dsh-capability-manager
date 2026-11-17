// src/host/selfmade/executors/scan.ts
//
// 代码工具的静态检查：只识别高危模块，不阻断注册（§12 的「可做静态检查」）。
//
// 自建工具与插件同进程运行，没有沙箱。命中高危导入时把风险写进日志，
// 让用户在校验阶段就能看到，而不是在工具真的删了文件之后。

/** 与宿主能力直接相关的高危内置模块（去掉 `node:` 前缀后的形式）。 */
const HIGH_RISK_MODULES = new Set([
  'child_process',
  'fs',
  'fs/promises',
  'net',
  'http',
  'https',
  'dns',
  'dns/promises',
  'tls',
  'vm',
  'module',
  'worker_threads',
  'cluster',
  'inspector',
])

/** `from 'x'`、`require('x')`、`import('x')`、`import 'x'` 四种引法。 */
const SPECIFIER = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g

/**
 * 扫描一段实现代码里的高危导入。
 *
 * @param source - impl.mjs 的源码文本。
 * @returns 每个高危模块一条说明；没有命中时为空数组。
 */
export function scanCodeWarnings(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[2] ?? ''
    const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier
    if (!HIGH_RISK_MODULES.has(bare)) continue
    found.add(`node:${bare}`)
  }
  return [...found].map(
    module => `impl.mjs 引用了高危模块 "${module}"：自建工具与宿主同进程运行，没有沙箱保护`,
  )
}
