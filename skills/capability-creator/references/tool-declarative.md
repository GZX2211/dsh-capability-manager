# 声明式自建工具

目录：`<state>/tools/<name>/meta.json`。目录名必须等于 `meta.name`，否则条目会被拒绝。

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 小写 kebab 或 snake（`my_tool`、`my-tool`），≤64 字符，且等于目录名 |
| `description` | 是 | 给模型看的用途说明，建议单行 |
| `parameters` | 是 | JSON Schema，**根节点必须是 `type: "object"`** |
| `output` | 否 | `{ "schema": { ... } }`；缺省为 `{ "type": "object" }` |
| `kind` | 否 | `shell` / `http` / `code`；缺省时同目录有 `impl.mjs` 即为 `code` |
| `shell` | kind=shell | `{ command, args?, timeoutMs? }` |
| `http` | kind=http | `{ url, method?, headers?, timeoutMs? }` |

只支持这些 JSON Schema 关键字：`type`、`oneOf`、`properties`、`required`、
`additionalProperties`、`items`、`enum`、`const`、`description`、`title`、
`default`、`examples`。用了别的关键字会在加载时被拒绝，条目被跳过。

`type` 只能取单值（`"object"`、`"string"`、`"integer"` 等），不要写 `["integer","null"]`。

## 占位符

`{{参数名}}` 可出现在 `shell.args`、`http.url`、`http.headers.<name>` 里：

- 字符串原样展开；对象与数组按 JSON 文本展开
- 参数缺失时展开为空串
- 写进 URL 的值会做百分号编码，写进 argv 与请求头的值保持原样

## shell 示例

```json
{
  "name": "disk_free",
  "description": "查询磁盘剩余空间",
  "parameters": {
    "type": "object",
    "properties": { "drive": { "type": "string", "description": "盘符，如 C" } },
    "additionalProperties": false
  },
  "output": { "schema": { "type": "object" } },
  "kind": "shell",
  "shell": { "command": "powershell", "args": ["-NoProfile", "-Command", "Get-PSDrive {{drive}}"] }
}
```

返回 `{ "exitCode": number|null, "stdout": string, "stderr": string }`。
非零退出码也是正常结果；只有启动失败、超时或取消才抛错。

## http 示例

```json
{
  "name": "ping_api",
  "description": "按资源名查询接口状态",
  "parameters": {
    "type": "object",
    "properties": { "resource": { "type": "string" }, "token": { "type": "string" } },
    "additionalProperties": false
  },
  "output": { "schema": { "type": "object" } },
  "kind": "http",
  "http": {
    "url": "https://example.com/api/{{resource}}",
    "method": "GET",
    "headers": { "authorization": "Bearer {{token}}" },
    "timeoutMs": 10000
  }
}
```

- 非 `GET` 时把全部参数作为 JSON 请求体，并自动补 `content-type: application/json`
- 返回 `{ "status": number, "body": unknown }`；4xx / 5xx 不抛错，错误体原样交给模型
- `timeoutMs` 默认 `30000`，上限 `600000`，必须是整数（毫秒）

## 生效与撤销

写入后自动注册，无需重启；删除目录即注销。同名工具已被其他来源占用时不会覆盖，
只在日志里提示。新建工具默认在能力池内、默认不常驻，需经 `meta_search` 召回后使用。
