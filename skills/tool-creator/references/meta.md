# meta.json 与目录约定

## 目录

```
<state>/tools/<name>/
├── meta.json    # 必需
├── main.py      # kind=python 的入口
└── impl.mjs     # kind=code 的入口
```

- 目录名必须**完全等于** `meta.name`，否则条目被拒绝。
- 一个工具一个目录；目录内可以再放自己的数据文件，用相对路径引用。
- 扫描是递归监听的：改完 `meta.json` 或入口文件，**下一次调用即生效**，不需要重启宿主。

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 小写 kebab 或 snake：`^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$`，≤64 字符，等于目录名 |
| `description` | 是 | 给模型看的用途说明，一句话说清「做什么 + 什么时候用」 |
| `parameters` | 是 | JSON Schema，**根节点必须是 `type: "object"`** |
| `output` | 否 | `{ "schema": {...} }`，缺省 `{ "type": "object" }` |
| `kind` | 否 | `python` / `code` / `shell` / `http`；缺省时同目录有 `main.py` 判为 `python`，否则有 `impl.mjs` 判为 `code` |
| `python` | kind=python | `{ entry?: "main.py", timeoutMs?: 30000 }`；`entry` 只能是目录内的 `.py` 文件名 |
| `shell` | kind=shell | `{ command, args?: [], timeoutMs?: 30000 }` |
| `http` | kind=http | `{ url, method?, headers?, timeoutMs?: 30000 }` |

`timeoutMs` 是作者声明的执行预算：1–600000 的整数，缺省 30000。

## parameters 的 JSON Schema 子集

只允许这些关键字，写别的会在加载时被拒绝，日志里给出原因、工具被跳过：

- 结构：`type`、`oneOf`、`properties`、`required`、`additionalProperties`、`items`
- 取值：`enum`、`const`
- 注解：`description`、`title`、`default`、`examples`

规则：

- `type` 只能写单值（`"object"`、`"string"`、`"integer"`、`"number"`、`"boolean"`、`"array"`、`"null"`），**不能写数组形式**。
- `type` 与 `oneOf` 只能二选一；`oneOf` 至少两项。
- `properties` / `required` / `additionalProperties` 只能出现在 `type: "object"` 上；`items` 只能出现在 `type: "array"` 上。
- 不要用 `minimum`、`maxLength`、`pattern`、`format` 这些约束——它们不在子集里。取值范围写进 `description`。
- 默认写 `"additionalProperties": false`，多余字段会被明确拒绝，模型能据此改正。

## 最小可用示例

```json
{
  "name": "word_count",
  "description": "统计一段文本的字符数与词数",
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "required": ["text"],
    "properties": {
      "text": { "type": "string", "description": "要统计的文本" }
    }
  },
  "output": {
    "schema": {
      "type": "object",
      "properties": { "chars": { "type": "integer" }, "words": { "type": "integer" } }
    }
  },
  "kind": "python"
}
```

## 排错

日志里出现下面这些，说明条目被跳过了（`<state>` 是插件状态目录）：

| 日志 | 原因 | 修法 |
|---|---|---|
| 缺少 `meta.json` | 只建了目录 | 补 `meta.json` |
| `meta.json` 不是合法 JSON | 尾逗号、注释、单引号 | 用严格 JSON |
| 目录名与 `meta.name` 不一致 | 改名后没同步 | 让两者完全一致 |
| `parameters` 不在工具支持的 JSON Schema 子集内 | 用了 `minimum`、`format`，或 `type` 写了数组 | 按上面的子集重写 |
| 缺少 `kind` | 没有 `main.py` / `impl.mjs`，也没声明形态 | 补入口文件或写 `kind` |
| 与已有工具同名，已跳过注册 | 与内置/第三方工具重名 | 换一个名字 |

工具创建后若当前会话看不到它，用 `meta_search` 按名称召回；新建工具默认在能力池内、默认不常驻。
