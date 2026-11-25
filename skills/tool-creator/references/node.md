# Node 形态（kind: code）

入口是 `impl.mjs`，用 ESM 默认导出一个函数。**它在宿主进程内运行**，没有沙箱，也没有进程隔离——这是它和 Python 形态最实质的差别。

什么时候用：本机没有可用的 Python；或者逻辑依赖只在 Node 侧存在的模块（例如宿主自己的解析器）。

## 契约

```js
// impl.mjs
export default async function (args, ctx) {
  return { ok: true, echo: args, workspace: ctx.workspace }
}
```

- 必须**默认导出**一个函数。导出别的东西会在调用时报错。
- 返回值必须是 JSON 值：`undefined`、`BigInt`、函数、循环引用都会被拒绝。
- 参数 `args` 是 `meta.parameters` 描述的那个对象。
- 上下文 `ctx`：

| 字段 | 说明 |
|---|---|
| `signal` | 调用方取消信号；长任务要观察它 |
| `stateDir` | 插件状态目录，用来放缓存 |
| `workspace` | 该会话的工作目录，可能为 `undefined` |

- 抛出的错误会原样回传给模型。给能指导下一步的说明，不要只丢一个堆栈。

限制：`impl.mjs` 里 `import` 的其它文件**不会**跟着失效（Node 按 URL 缓存模块）。逻辑放进 `impl.mjs` 本身；确实要拆分时，自己 `import()` 时加版本参数。

## 风险

- 与宿主同进程：未捕获的异常、死循环、内存爆掉会直接影响宿主体感，不像 Python 形态那样只是子进程退出。
- `node:child_process`、`node:fs` 等高危导入会在日志里产生告警，但不阻断注册。

## 模板

```js
import { readFile } from 'node:fs/promises'

export default async function (args, ctx) {
  const path = args.path
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('path 必须是非空字符串：请传要读取的文件绝对路径')
  }
  const text = await readFile(path, 'utf8')
  return { chars: text.length, lines: text.split('\n').length }
}
```