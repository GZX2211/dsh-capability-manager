# 脚本执行契约

只在技能确实需要 `scripts/` 时读本文。多数技能不写脚本，靠正文与 references 就够。

脚本由会话内的 `run_python` 工具执行，跑在 DSH 自带的 Python 上：`~/.dsh/dsh-runtimes/*/dependencies/python/`（3.11 及以上，带 pip，已装 numpy / pandas / openpyxl / lxml / Pillow / python-docx）。它与用户终端里的 `python` 不是同一个解释器，因此不能假设用户装过某个包。

## 如何调用

技能目录的绝对路径来自技能的 `resourceBase`，拼上 `scripts/<file>.py` 即得脚本路径。

单个脚本：

```python
import os, runpy, sys

script_dir = os.path.dirname(SCRIPT_PATH)
# 内核以 -P 启动，且 runpy 不会把脚本目录放进 sys.path[0]；
# 缺这一行，脚本里 import 同目录模块必然 ModuleNotFoundError。
sys.path.insert(0, script_dir)
runpy.run_path(SCRIPT_PATH, run_name="__main__")
```

多个脚本：在同一个 cell 里循环，每个用 `try/except` 单独兜住，避免一个失败中断整批。

```python
import json, os, runpy, sys

results = []
for name in ("a.py", "b.py"):
    path = os.path.join(script_dir, name)
    try:
        runpy.run_path(path, run_name="__main__")
        results.append({"script": name, "ok": True})
    except Exception as exc:
        results.append({"script": name, "ok": False, "error": f"{type(exc).__name__}: {exc}"})
print(json.dumps(results, ensure_ascii=False))
```

`run_name="__main__"` 不可省略，否则脚本里的 `if __name__ == "__main__":` 不会执行。

## 四条硬约束

| 约束 | 事实 | 应对 |
|---|---|---|
| 同目录导入失败 | 内核以 `-P -s` 启动，`runpy` 不设置 `sys.path[0]` | 执行前 `sys.path.insert(0, script_dir)` |
| `sys.argv` 不是脚本参数 | 脚本拿到的是内核自己的 argv | 需要入参时传 `runpy.run_path(path, run_name="__main__", init_globals={"ARGS": ...})`，或读环境变量 |
| 单个 cell 上限 120 秒 | 超时会被中断，进程可能被 kill | 批量控制在十几秒内；长任务拆分，或先落盘断点 |
| 输出上限 64KB | stdout/stderr 会被截断 | 只打印摘要，明细写文件 |

还有一个隐含约束：内核每个 agent 一个，多个 cell 串行排队。这里的「批量」是串行批处理，不是并行；真要并行只能在 Python 内用 `concurrent.futures`，但共用同一个 120 秒预算。

## 依赖策略

- 默认只用标准库。`requests` / `yaml` / `httpx` / `bs4` 在自带解释器里都**没有**。
- 需要 HTTP 时用 `urllib.request`；需要 JSON 直接用 `json`。
- 确认某个包已装后才 import。不要 `pip install`：装进的是 DSH 共享运行时，升级时会被覆盖，也会影响其他插件。
- 确实绕不开第三方包时，把依赖写进技能的正文说明，交付前告知用户需要预先安装。

## 脚本自身写法

- 路径从 `Path(__file__).parent` 推导，不假设调用方的 cwd。
- 入参用 `argparse` 时同样要能从 `init_globals` 读到；两种来源都接受，脚本才既能手跑也能被调用。
- 结果用 `json.dumps(..., ensure_ascii=False)` 输出，避免中文转义成 `\uXXXX`。
- 文本读写显式指定 `encoding="utf-8"`。Windows 默认编码不是 UTF-8。
- `if __name__ == "__main__": main()` 必须有，且 `main()` 内只做参数收集与调用。

## 交付前必须冒烟

用无副作用参数真实跑一次，确认：

1. 没有 `ModuleNotFoundError`（`sys.path` 是否补了）；
2. 没有把 `sys.argv` 当参数用；
3. 输出是可直接解析的 JSON；
4. 退出码为 0。

跑失败时按报错回改脚本，不要只改文档描述。
