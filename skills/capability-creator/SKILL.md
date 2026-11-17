---
name: capability-creator
description: 创建一个自建工具、自建 Skill 或 MCP 连接：判断类型、给出文件写法，让它无需重启即可被 meta_search 召回。
---

# 能力创建

本插件里的「能力」只有两类：**工具**与 **Skill**；MCP 连接是工具的来源之一。
先判断类型，再按对应参考文件写文件。

## 先判断类型

- 需要执行命令、读写文件、调 HTTP → **自建工具**
- 需要一套可复用的任务指令 → **自建 Skill**
- 需要连接一个已有 MCP 端点并暴露它的能力 → **MCP**（连接是全局的，不在本插件里新建）

## 自建工具：先考虑声明式

声明式工具可审计、可序列化，且不需要运行任意代码；只有复杂逻辑才写 `impl.mjs`。

- 声明式（推荐）：`references/tool-declarative.md`
- 代码文件：`references/tool-code.md`

## 自建 Skill

写入 `{{STATE_DIR}}/skills/<name>/SKILL.md`，规则见 `references/skill.md`。

## MCP

不需要写文件；引导用户到官方 MCP 配置里添加，约束见 `references/mcp.md`。

## 步骤

1. 用 `meta_search` 的 `names` 通道确认名称未被占用
2. 写文件：`{{STATE_DIR}}/tools/<name>/meta.json`（工具）或 `{{STATE_DIR}}/skills/<name>/SKILL.md`（Skill）
3. 核对参数 schema 与 JSON 字段：写错时该条目会被跳过，日志里能看到具体原因
4. 告知用户「已生效，可用 meta_search 召回」；新建能力默认在能力池内、默认不常驻

## 安全

- 不要把访问凭据写进任何文件
- 代码工具避免 `import 'node:child_process'` 等；本插件与宿主同进程运行，没有沙箱
- 声明式 shell 的参数按 argv 逐个传递，不要试图在 `command` 里拼 shell 片段
