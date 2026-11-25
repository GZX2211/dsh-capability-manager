# Python 形态（kind: python）

每次调用起一个独立 Python 进程跑 `main.py`。脚本崩溃、死循环、内存爆掉都不会影响宿主——这是它相对 Node 形态的主要优势。

## 契约

### 输入：stdin 上的一个 JSON 信封

```json
{
  "args": { "调用参数": "按 meta.parameters 的键" },
  "workspace": "该会话的工作目录（可能缺省）",
  "stateDir": "插件状态目录（可能缺省）"
}
```

参数不走命令行，所以字符串里的引号、分号、换行都只是数据，不存在注入问题，也不受 Windows 约 32K 的命令行长度限制。

### 输出：stdout 上的一个 JSON 值

- stdout 必须是**唯一一个** JSON 值；多打一行日志就会解析失败。
- 调试信息写 stderr（`print(..., file=sys.stderr)`），它会作为错误详情回传。
- 退出码非 0 视为失败，错误信息里带 stderr 尾部。
- stdout 为空也视为失败——至少返回 `{}`。

### 运行环境

- 工作目录：会话工作目录；取不到时是工具目录。
- 环境变量：白名单透传 `PATH`、`SystemRoot`、`TEMP`、`HOME`、`PYTHONPATH` 等，强制 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`、`NO_COLOR=1`。宿主的 API key、token 不会进子进程。
- 解释器：≥ 3.11。顺序为「配置的 `pythonPath` → DSH 自带运行时 → `python3` → `python` → Windows 的 `py -3`」。
- 单次输出上限 4M 字符，超出即终止。

## 模板

```python
import json
import sys


def run(args):
    # 只返回 JSON 可序列化的值
    return {"echo": args}


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    result = run(payload["args"])
    print(json.dumps(result, ensure_ascii=False))
```

常用写法的取舍：

- **要读会话里的文件**：用 `payload.get("workspace")` 拼路径，不要假设 cwd。
- **要落缓存**：用 `payload.get("stateDir")` 下的子目录，不要写到用户主目录。
- **要调外部程序**：用 `subprocess.run([...], shell=False)` 传 argv 列表；拼接 shell 字符串会把参数变成可执行片段。
- **依赖第三方包**：执行器不会 `pip install`。先确认环境里已装；缺依赖会以 stderr 报错回传。

## 超时

`meta.python.timeoutMs`，缺省 30 秒，上限 600 秒。进程到点被终止，返回「超时并被终止」的说明。

长任务不要靠调大超时硬撑：把工作拆成多个工具调用，或返回任务 id 让后续调用查询进度。

## 热更新

改 `main.py` 后下一次调用即生效——内容签名包含入口文件的修改时间与大小，宿主会自动重新注册同名工具。

注意：如果 `main.py` 依赖同目录的其它文件，那些文件的变化**不**触发重新注册。逻辑要么放进 `main.py`，要么用 `importlib.reload` 之类自己处理，别指望宿主替你感知。
