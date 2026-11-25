# 脚本执行契约

脚本由会话内的 `run_python` 工具执行，跑在 DSH 自带的 Python 上：`~/.dsh/dsh-runtimes/*/dependencies/python/`。

## 依赖策略

- 默认只用标准库，不自动安装依赖。`requests` / `yaml` / `httpx` / `bs4` 在自带解释器里都**没有**。
- 需要 HTTP 时用 `urllib.request`；需要 JSON 直接用 `json`。
- 如果 Python 无法满足需求，可考虑使用其他脚本语言。

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