// tsdown.config.ts
//
// 两个半区分别构建：Host 走 ESM（Node 进程内加载），Client 走 lazy-CJS
// （浏览器模块表通过 `factory(require)` 提供 react），后者再由
// scripts/wrap-client.mjs 包成 `window.__ModuleLoader__.load({...})`。
//
// `@deepseek-ai/*` 一律不打包：宿主安装目录里这些包在运行时按名字解析，
// 打进来会出现两份实例（Context 类型不认、样式重复注入）。客户端尤其如此——
// 界面原子来自宿主前端的 staticModules，本插件的产物只留一个
// `require("@deepseek-ai/dsh-client-ui-primitives")`。

import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    name: 'host',
    entry: ['src/host/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: false,
    outExtensions: () => ({ js: '.js' }),
    // onnxruntime-node 是原生模块（含平台二进制），只能外部引用：
    // 打进产物既无法执行，也会把 lib 撑到几百 MB。
    deps: { neverBundle: [/^@deepseek-ai\//, 'onnxruntime-node'] },
  },
  {
    name: 'client',
    entry: { 'client.body': 'src/client/entry.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    outExtensions: () => ({ js: '.js' }),
    deps: { neverBundle: ['react', 'react-dom', 'react/jsx-runtime', /^@deepseek-ai\//] },
  },
])
