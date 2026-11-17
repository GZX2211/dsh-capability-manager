# 代码自建工具

只有声明式表达不了逻辑时才写代码。目录：`<state>/tools/<name>/`
- `meta.json`：名称、描述、参数与输出 schema（不带 `kind`，或写 `"kind": "code"`）
- `impl.mjs`：实现文件

```js
// impl.mjs
export default async function (args, ctx) {
  return { ok: true, echo: args, workspace: ctx.workspace }
}
```

## 契约

- 必须**默认导出**一个函数；不是函数会报错
- 返回结果必须是 JSON 值：BigInt、函数、`undefined`、循环引用都会被拒绝
- 上下文 `ctx`：
  - `signal`：调用方取消信号，长任务应当观察它
  - `stateDir`：插件状态目录，可用来放缓存
  - `workspace`：当前会话工作目录，可能为 `undefined`

## 热更新

每次调用都按文件的修改时间与大小换模块 URL，改完文件**下一次调用即生效**，
不需要重启宿主。如果依赖了别的文件，那个文件不会自动失效——把逻辑放进
`impl.mjs` 本身，或自己 `import()` 时加版本参数。

## 风险

- 与宿主同进程运行，没有沙箱；`import 'node:child_process'`、`node:fs` 等高危模块
  会在日志里给出告警（不阻断注册）
- 不要在这里读取或写入访问凭据
- 抛出的错误会原样回传给模型；给出能指导下一步操作的信息，而不是堆栈
