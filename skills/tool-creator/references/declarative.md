# 声明式形态（kind: shell / http）

不写代码，只在 `meta.json` 里声明一条命令或一个请求。可审计、无脚本维护成本，能用它就优先用它。

## shell

```json
{
  "name": "disk_free",
  "description": "查询某个盘的剩余空间",
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "required": ["drive"],
    "properties": { "drive": { "type": "string", "description": "盘符，如 C" } }
  },
  "kind": "shell",
  "shell": {
    "command": "powershell",
    "args": ["-NoProfile", "-Command", "Get-PSDrive {{drive}}"],
    "timeoutMs": 15000
  }
}
```

- `command` 是要执行的程序，`args` 是它的 argv 数组。
- **不经过 shell**：`args` 的每一项是一个独立参数，参数里的 `;`、`|`、`&` 只是普通字符。命令本身由 `meta.json` 的作者固定，模型改不了。
- 返回值固定为 `{ "exitCode": number|null, "stdout": string, "stderr": string }`。非零退出码是正常结果，不是错误；只有启动失败、超时、取消才抛错。

## http

```json
{
  "name": "ping_api",
  "description": "按资源名查询接口状态",
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "required": ["resource"],
    "properties": { "resource": { "type": "string", "description": "资源名" } }
  },
  "kind": "http",
  "http": {
    "url": "https://example.com/api/{{resource}}",
    "method": "GET",
    "headers": { "accept": "application/json" },
    "timeoutMs": 10000
  }
}
```

- `method` 只能是 `GET` / `POST` / `PUT` / `PATCH` / `DELETE`，缺省 `GET`。
- 返回值是响应体（JSON 响应直接解析成对象，其余按文本返回）。

## 占位符

`{{参数名}}` 可以出现在 `shell.args`、`http.url`、`http.headers.<名字>` 里：

- 字符串原样展开；对象与数组按 JSON 文本展开。
- 参数缺失时展开为空串（不是保留占位符）。
- 写进 URL 的值会做百分号编码；写进 argv 与请求头的值保持原样。

占位符只能引用 `parameters.properties` 里的键名，不要在里面写表达式。

## 适用边界

用声明式：固定的系统命令、固定端点的 HTTP 查询、把已有 CLI 包一层。

不要用声明式：需要解析输出、做条件判断、多步串联、处理 JSON 结构——那些写成 Python 形态更清楚，也不会把逻辑藏进命令字符串里。
