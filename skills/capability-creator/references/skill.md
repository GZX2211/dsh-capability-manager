# 自建 Skill

目录结构：

```
<state>/skills/<name>/
├── SKILL.md
└── references/
```

## frontmatter

只接受 `key: value` 标量行：

```md
---
name: my-skill
description: 一句话说明什么时候该用这个 Skill
---
```

- `name` 必须是 kebab-case（`my-skill`），且与 `skill` 工具加载时使用的名字一致。
  目录名建议与它相同；不同也能工作，但会让排查变复杂。
- `description` 会出现在 Skill 目录里，决定模型会不会想到用它，务必写清「何时调用」。
- 可选键：
  - `whenToUse`：补充的路由说明
  - `disable-model-invocation: true`：不进模型目录、模型也加载不了；只允许用户用 `/名称` 显式调用
  - `user-invocable: false`：禁止用户 `/名称` 调用
- 旧键名 `disableModelInvocation` / `modelInvocable` / `userInvocable` 会被拒绝，用上面的新键。

## 正文

正文就是模型会读到的指令：写清何时使用、步骤、输出形态与失败时的处理。
补充资料放进 `references/`，在正文里按相对路径引用；不要把大段资料直接塞进 SKILL.md。

## 生效与撤销

写入后无需重启：目录变化会让 Skill 目录刷新。新建 Skill 默认在「排出池」，
用户在界面点加号把它移入能力池之后，模型才能加载。删除目录即从目录里消失。
