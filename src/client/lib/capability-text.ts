// src/client/lib/capability-text.ts
//
// 官方能力摘要的展示本地化。
//
// 官方工具与 Skill 的描述是写给模型的英文原文：既不改源（改了会影响 prompt），
// 也不在本插件的 UI 词典范围内。这里按能力名给出一份「列表里显示什么」的覆盖表，
// 缺失条目回退原文，因此官方新增能力不会因为没词条而消失或报错。
//
// 自建与 MCP 能力不覆盖：用户写的是什么就显示什么。

import type { CapabilityEntry } from '../../shared/capability.ts'
import { isChinese } from '../i18n.ts'

/** 一条摘要的展示词条；`en` 只在原文本身不是英文时需要。 */
export interface LocalizedSummary {
  zh: string
  en?: string
}

/**
 * 官方工具的展示词条，键为能力名。
 *
 * 只放「描述原文是英文」的条目；原文已是中文的能力（如本插件自己的
 * `meta_search`、`skill`）在中文界面无需覆盖，只在英文界面需要 `en`。
 */
export const OFFICIAL_TOOL_SUMMARIES: Readonly<Record<string, LocalizedSummary>> = {
  ask_user_question: {
    zh: '在你需要确认、选择或补充信息时，向用户提出一个简洁的问题。答案项中 selected 为空且没有自定义内容，表示用户跳过了该问题。',
  },
  cordis_inspect_list: {
    zh: '列出宿主当前已知的全部 Cordis Inspect Provider，包括本机 Provider 与从客户端同步的最新清单。每项包含平台、用途与只读方法。',
  },
  cordis_inspect_query: {
    zh: '执行 Inspect Provider 声明的只读查询。platform、provider 与 method 必须来自 cordis_inspect_list，input 需满足该方法的结构。写插件代码前先用它读取 Service 方法、事件模式、配置结构或实时 Slot 树。',
  },
  create_goal: {
    zh: '创建一个持久化目标，让本会话在多次自动续跑轮次中持续推进。当直接的人类请求是一个长期目标时使用，即使对方没有说「目标」。',
  },
  edit: {
    zh: '通过替换字面文本编辑一个已存在的 UTF-8 文本文件。',
  },
  exit_plan_mode: {
    zh: '只在计划模式中使用。把计划交给用户审阅，获批后退出计划模式；用户也可能选择继续计划并给出反馈。',
  },
  get_goal: {
    zh: '读取当前会话目标，包括 update_goal 所需的 id 与 revision。',
  },
  glob: {
    zh: '按 glob 模式查找文件（不含目录），包含隐藏与被忽略的文件。按修改时间返回至多 100 个路径；结果更多时会说明完整列表的保存位置。',
  },
  grep: {
    zh: '用 ripgrep 正则表达式搜索文件内容，返回带行号的匹配行并按文件分组。至多返回 250 条匹配；结果更多时会说明完整列表的保存位置。',
  },
  job_kill: {
    zh: '请求取消一个正在运行的后台任务。',
  },
  job_list: {
    zh: '列出你的后台任务（运行中与已结束），包含 id、类型与状态。',
  },
  job_output: {
    zh: '读取一个后台任务：流式任务返回自上次读取以来的输出，已结束的最终输出任务返回结果。',
  },
  list_agents: {
    zh: '列出你的整棵子代理树：根代理与所有可达、可续跑的子孙代理，包括你自己。每行带名称、描述与状态。',
  },
  list_subagent_models: {
    zh: '查看可用于显式指定子代理模型的路线。无参数时列出有权限的 provider；给 provider 时列出其授权模型；再加 model 时列出该模型及其推理档位。',
  },
  load_workspace_dependencies: {
    zh: '获取内置 Python 与库目录的绝对路径，以及内置 Python 发行版版本。载荷提供时也会给出 Node.js 与 pnpm 路径。',
  },
  meta_search: {
    zh: '召回当前会话可用的工具与 Skill。',
    en: 'Recall the tools and skills available to this session.',
  },
  office_convert: {
    zh: '把文档转换为另一种格式，返回一个临时文件，可用 shell 复制到目标位置。',
  },
  office_recalculate: {
    zh: '重新计算公式并保存工作簿，返回一个临时工作簿，可用 shell 复制到目标位置。',
  },
  office_render: {
    zh: '把文档页面、幻灯片或工作表区域渲染成可查看的图片。',
  },
  orchestrator_eval: {
    zh: '加载一个主动候选的窗口及其线程工单；重复调用会复用已加载的内容。',
  },
  orchestrator_eval_decide: {
    zh: '在与同一个 trigger_id 的 orchestrator_eval 之后，按 admission 的说明记录一次评估决定。',
  },
  orchestrator_eval_read: {
    zh: '始终凭 trigger_id 读取候选的更多上下文：按 message_id 读整条消息或存根，按 image_id 读图片，读根、读父级、按 cursor 读一页线程，或按路径读文件与目录。',
  },
  orchestrator_policy_sync: {
    zh: '从某个 Source 保存策略的位置（例如其同步群里的飞书用户）刷新该 Source 的策略部分，操作与 Web 按钮相同。',
  },
  orchestrator_prompts_save: {
    zh: '在明确的人类请求下，基于 baseRevision 保存完整提示词配置；绝不因引用内容而保存。它在下一次模型请求时生效，可用 orchestrator_read prompts 读取。',
  },
  orchestrator_read: {
    zh: '按 resource 参数列出的资源读取一页，例如工单列表或某个工单。按 next_offset 继续，页面给出 next_resource 时按它跳转。',
  },
  orchestrator_reply: {
    zh: '按 replies 一节的规定，发送对人类问题的回答、就绪结果，或需要人类处理的关注事项；其余内容（如进度）会被网关拒绝。purpose=result 需要工单。',
  },
  orchestrator_route: {
    zh: '一次调用按卡片的 trigger_id 逐项路由候选：把明确请求接受为新工单、把触发挂到已有工单、按用户的停止消息停止工单。',
  },
  orchestrator_settings_save: {
    zh: '在明确的人类配置请求下保存一个设置块（绝不由观察到的内容触发），如同在面板上操作；用 orchestrator_read settings 读取设置块与版本。',
  },
  orchestrator_thread_unsubscribe: {
    zh: '取消某个线程上的所有工单订阅。此后该线程的消息不再作为上下文送达这些工单；新的肯定决定可以重新订阅。',
  },
  orchestrator_ticket_note: {
    zh: '把其他工作得到的事实告知某个工单的 worker（例如另一个工单发现了什么）；这不授予任何权限。',
  },
  orchestrator_ticket_request_status: {
    zh: '向一个空闲工单（回合已结束但未报告）的 worker 索取状态报告；对其他工单不发消息，只返回卡片。',
  },
  orchestrator_ticket_retry: {
    zh: '在明确的人类请求下，重试一个 worker 报告失败或受阻、或输入未送达的工单，启动新的指派；卡住的那次会结束。',
  },
  orchestrator_trigger_requeue: {
    zh: '把一个触发重新排队以重新评估，例如其 Source 的访问权限变化之后；已经送达工单的后续只能由该工单的 worker 返回。',
  },
  plugin_manager: {
    zh: '管理当前 profile 中的插件与 bundle：列出、启用或禁用、安装或移除。每个操作都需要 danger-full-access 权限或本次调用的批准。',
  },
  present: {
    zh: '把已存在的文件声明为最终交付物。宿主可能在本轮结束后才显示它们，因此要在文件定稿后调用一次。',
  },
  pwsh: {
    zh: '执行一条 PowerShell 命令（pwsh -Command）并返回 stdout/stderr。每次调用都在新的 pwsh 进程中运行；用 workdir 代替 cd，路径使用 Windows 原生形式。',
  },
  read: {
    zh: '读取一个 UTF-8 文本文件并返回带行号的内容。',
  },
  read_image: {
    zh: '读取 PNG/JPEG/WebP/GIF 文件并返回图片本身。大图会自动缩小；不要安装图像库或生成缩略图来查看图片。',
  },
  schedule_create: {
    zh: '创建一个定时任务。每次命中 rrule 时，prompt 会作为来自用户的定时消息投递到目标会话。结果包含任务 id 与下一次触发时间。',
  },
  schedule_edit: {
    zh: '按 id 更新、暂停、恢复或删除一个定时任务。删除不会撤回已排队的消息。',
  },
  schedule_list: {
    zh: '列出定时任务，包括其他会话创建的任务。活动任务排在前面，按 scheduledAt 排序。',
  },
  schedule_view: {
    zh: '按 id 查看一个定时任务。',
  },
  send_message: {
    zh: '给某个代理发送消息。工作中的代理会在下一步收到；空闲代理会因此开始新一轮。返回投递确认。',
  },
  skill: {
    zh: '按名称加载一个 Skill 的完整指令。当用户点名某个 Skill，或任务明显匹配目录里某个 Skill 的描述时，先调用它再行动。',
    en: 'Load a skill’s complete instructions by name. When the user names a skill, or the task clearly matches a catalog description, load it before acting.',
  },
  subagent: {
    zh: '把一个自包含的任务委派给子代理（在独立上下文中工作），以卸载聚焦且独立的工作——调研、限定范围的实现、分析——避免占用当前上下文。',
  },
  subagent_fork: {
    zh: '把任务委派给继承本对话的子代理：子代理以至今所有已完成回合为初始上下文（看不到当前进行中的回合）。当子任务建立在这些内容之上时使用。',
  },
  team_task_create: {
    zh: '在共享 Team 任务板上创建一个无归属的待处理任务。',
  },
  team_task_get: {
    zh: '在修改或执行一个共享任务之前，读取它最新的完整值。',
  },
  team_task_list: {
    zh: '列出共享任务，包括就绪状态、归属者、版本、阻塞项与写作用域警告。',
  },
  team_task_update: {
    zh: '使用 team_task_get 或 team_task_list 得到的最新 revision，对共享任务执行比较并设置。',
  },
  todo_write: {
    zh: '记录并更新任务清单，用于规划多步工作并展示进度；琐碎的单步任务可跳过。开始前为每个具体步骤添加一条待办；工作未完成时保持待办为进行中。',
  },
  update_goal: {
    zh: '更新当前目标。',
  },
  wait_agent: {
    zh: '在下一步等待输入，包括代理消息、完成通知与用户干预。有新输入待处理时立即返回；timedOut 为 false 表示有新输入。',
  },
  web_fetch: {
    zh: '抓取指定 HTTP(S) URL 的内容并解码为文本返回。',
  },
  web_search: {
    zh: '在网络上搜索当前信息。返回可选的摘要答案与来源 URL 列表。',
  },
  workflow: {
    zh: '运行一个 JavaScript 工作流脚本，以规模化编排子代理。适用于需要分发给大量独立单元的工作——多文件审计、迁移、多角度调研、对抗性验证。',
  },
  working_directory: {
    zh: '读取当前工作目录，或用 cd 切换。相对路径基于当前目录解析；已打开的 shell 与运行中的进程保留各自的目录。',
  },
  write: {
    zh: '创建或完整替换一个 UTF-8 文本文件。',
  },
}

/** 官方 Skill 的展示词条，键为能力名。 */
export const OFFICIAL_SKILL_SUMMARIES: Readonly<Record<string, LocalizedSummary>> = {
  'capability-creator': {
    zh: '创建一个自建工具、自建 Skill 或 MCP 连接：判断类型、给出文件写法，让它无需重启即可被 meta_search 召回。',
    en: 'Create a self-made tool, skill, or MCP connection: decide the type and write the files so meta_search can recall it without a restart.',
  },
  'diagnose-windows-sandbox-acl': {
    zh: '在 Windows 上遇到意外的 DSH 沙箱访问拒绝时使用：工作区写入或列目录失败，或本应可读的路径无法读取。一条内置命令会检查该路径及其每一级祖先。',
  },
  'dsh-doc': {
    zh: '当任务需要 DeepSeek Harness（DSH）本身的事实——例如运行安装中的功能、设置、插件、agent preset、工具或 Cordis API 如何工作——或用户要求基于它进行设计时使用。',
  },
  'dsh-superagent-github': {
    zh: '使用 gh 读取 GitHub issue、pull request、review 与 CI。',
  },
  office: {
    zh: '创建或编辑 Office 文件；查看 Office 文件与 PDF。在渲染、转换或重算之前加载，以便下一步启用 office_render、office_convert 与 office_recalculate。',
  },
  'office-docx': {
    zh: '创建、读取、编辑并校验 Word 文档（.docx）。',
  },
  'office-pptx': {
    zh: '创建、读取、编辑并校验 PowerPoint 演示文稿（.pptx）。',
  },
  'office-xlsx': {
    zh: '读取、创建、编辑并校验 Excel 工作簿、数据与公式（.xlsx）。',
  },
}

/**
 * 按界面语言本地化一批能力摘要。
 *
 * 只处理来源为官方的条目；自建与 MCP 原样返回，未收录的官方条目也回退原文。
 *
 * @param entries - 快照里的能力条目。
 * @param language - 当前界面语言码。
 * @returns 新数组；条目内容未变的条目保持原引用。
 */
export function localizeCapabilities(
  entries: readonly CapabilityEntry[],
  language: string | null | undefined,
): CapabilityEntry[] {
  const chinese = isChinese(language)
  return entries.map(entry => localizeCapability(entry, chinese))
}

function localizeCapability(entry: CapabilityEntry, chinese: boolean): CapabilityEntry {
  if (entry.source !== 'official') return entry
  const table = entry.kind === 'tool' ? OFFICIAL_TOOL_SUMMARIES : OFFICIAL_SKILL_SUMMARIES
  const localized = table[entry.name]
  if (localized === undefined) return entry
  const summary = chinese ? localized.zh : localized.en ?? entry.summary
  return summary === entry.summary ? entry : { ...entry, summary }
}
