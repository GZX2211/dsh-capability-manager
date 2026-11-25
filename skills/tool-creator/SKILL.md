---
name: tool-creator
description: 创建或更新自建工具：在声明式、Python、Node 三种形态里选一种。当需要把一段命令、脚本或 HTTP 调用固化成一个可复用工具时使用
---

# 工具创建助手

自建工具就是「一份参数表 + 一段执行代码」。

```
{{STATE_DIR}}/tools/<name>/
├── meta.json    # 名称、描述、参数 schema、形态；必需
└── main.py      # Python 形态的入口
    或 impl.mjs  # Node 形态的入口
```

## 流程

按顺序执行，缺信息就停下来问用户，并帮助梳理需求。

### 1. 探明需求

从对话里提炼：这个工具替模型省掉什么重复动作、典型的调用说法、输入是什么、期望输出什么形状。信息不足时向用户要一个具体例子（「你会怎么问、希望拿回什么」）。

推荐「一个动作一个工具」。不要把一个多步工作流塞进一个工具——那属于 Skill。

### 2. 探测 Python

**这一步不能省**：本机是否可用 Python 决定主路径能不能走。

在 `run_python` 可见时执行：

```python
import sys
print(sys.version_info >= (3, 11))
```

没有 `run_python` 时，用原生 shell 跑 `python --version`、`python3 --version`；Windows 上若输出来自 Microsoft Store 的占位提示，视为不可用。

判定：

- 输出 `True` 或版本 ≥ 3.11 → Python 可用，走 **Python 形态**
- 否则 → 走 **Node 形态**或**声明式**，并在交付时告诉用户「本机没有可用的 Python，因此写成了 Node/声明式」

### 3. 选形态

| 需求 | 形态 | 参考 |
|---|---|---|
| 固定命令 + 参数替换；单次 HTTP 请求 | 声明式 `shell` / `http` | `references/declarative.md` |
| 解析、计算、多步逻辑、处理 JSON/文本 | 脚本 `python`（首选） | `references/python.md` |
| 需要 Node 生态、或本机没有可用 Python | 脚本 `code`（Node） | `references/node.md` |

判断口径：能用声明式说清的，不要写脚本；需要写脚本的，Python 优先。声明式可审计、无进程、无脚本维护成本。

`meta.json` 的全部字段、名称规则、JSON Schema 允许的关键字见 `references/meta.md`——写文件前必须先读它，参数 schema 用错关键字会导致工具被静默跳过。

### 4. 写文件

1. 用 `meta_search` 的 `names` 通道确认名称未被占用；占用就换一个语义更具体的名字。
2. 建目录 `{{STATE_DIR}}/tools/<name>/`，目录名必须与 `meta.json` 的 `name` 完全一致。
3. 写 `meta.json`，再写入口文件（Python 形态写 `main.py`）。
4. 参数描述写给模型看：每个字段一句话说清「放什么」，别写无效的解释说明。

### 5. 冒烟验证

写完必须实际调用一次，用**无副作用**的参数（只读、只算、不写文件、不发写请求）。

- 调用成功且返回值符合 `output.schema` → 通过
- 报「找不到可用的 Python」→ 改写成 Node 形态（`impl.mjs`），或提示用户配置 `pythonPath`
- 报「stdout 不是合法 JSON」→ 脚本里有 `print` 调试输出，把日志改到 stderr
- 报「已跳过 / 缺少 kind」→ 回到 `references/meta.md` 核对字段

新建工具默认在能力池内、默认不常驻。当前会话看不到它时，用 `meta_search` 按名称召回后再调用。

### 6. 交付

告知用户：工具名、它做什么、什么时候会被召回、参数是什么。需要调整可见性时引导到「能力管理」界面。

## 硬约束

- 参数 schema 的根节点必须是 `type: "object"`；只使用官方支持的 JSON Schema 关键字子集。
- 脚本把结果 JSON 打到 stdout，日志一律走 stderr；stdout 混入任何非 JSON 文本都会被判失败。
- 不把访问凭据写进工具文件。需要密钥时让用户在配置里给，或从环境变量读。
- 工具与宿主同进程（Node）或同用户（Python），**没有沙箱**。删除、覆盖、外发数据这类操作要向用户阐述后果。
- 代码写进一个文件，不要分多文件引用，热更新只对入口文件生效。