// src/client/i18n.ts
//
// 中英双语文案（覆盖全部 UI 界面文案）。新增文案必须同时补 zh / en。

export const NS = 'capability manager'

export const zh = {
  nav: '能力管理',
  pageTitle: '能力管理',
  pageSubtitle: '管理工具与技能的可用范围与初始配置',
  refresh: '刷新',
  refreshTooltip: '重新读取当前配置',

  createCapability: '创建能力',
  createCapabilityMenu: '选择创建方式',
  createWithAgent: '让 Agent 创建能力',
  createSkillManually: '手动创建技能',
  createUnavailable: '当前环境没有可用的新会话入口',
  // 冒号后的空格是给用户续写的位置，不要删。
  createPrompt: '帮我创建一个 skill / 工具 / MCP: ',

  tabTools: '工具',
  tabSkills: '技能',
  tabSettings: '设置',

  filterAll: '全部',
  filterOfficial: '官方',
  filterCustom: '自建',
  filterMcp: 'MCP',

  searchPlaceholder: '搜索名称或用途',
  searchLabel: '搜索能力',

  helpTitle: '这个面板在做什么',
  helpTooltip: '查看说明',
  helpIntro: '它决定模型一开始能看到什么：默认只给两个入口，其余能力按需召回。',
  helpPoolTitle: '能力池与排出池',
  helpPoolBody: '中间的分界可以左右拖动。点右侧的减号把能力移出能力池，它便不可调用、不可召回、也不出现在索引里；点左侧的加号把它放回去。你在输入框用 /名称 直接加载技能时不受能力池限制，显式使用优先。',
  helpResidentTitle: '常驻',
  helpResidentBody: '能力池行内的开关控制常驻：开启后模型一开始就能直接使用；关闭后只能经 meta_search 按名字召回。',
  helpRecallTitle: '召回',
  helpRecallBody: 'meta_search 用名称或名称组取回能力的完整定义；召回的结果从下一步开始可调用。',
  helpRolesTitle: '角色黑名单',
  helpRolesBody: '检测到 Personal Agent 时，可以分别给 Router 与 Worker 配置禁用能力。黑名单优先级最高：它既排除池内能力，也排掉常驻能力，并且只作用于对应角色的会话。',
  helpBindingTitle: '会话角色',
  helpBindingBody: '角色优先由 Personal Agent 判定；手动绑定只补它没有判定的会话。PA 已给出角色时，手动绑定不会生效。',
  helpModeA: '当前模式：A（向量检索关闭）。面板会注入工具索引与技能目录，只含名称与用途摘要。',
  helpModeB: '当前模式：B（向量检索开启）。不注入索引，靠关键词做语义召回。',
  helpClose: '知道了',

  paneExcludedTitle: '排出池',
  panePoolTitle: '能力池',
  addToPool: '加入能力池',
  openFolder: '打开目录',
  openFolderFailed: '打开目录失败',
  createFailed: '创建失败',
  removeFromPool: '移出能力池',
  paneExcludedEmpty: '没有排出的能力',
  paneExcludedEmptyHint: '所有能力都在能力池内',
  panePoolEmpty: '能力池为空',
  panePoolEmptyHint: '模型将没有可用能力，从左侧把它加回来',
  splitterLabel: '拖动调整两栏宽度',
  residentLabel: '常驻',
  residentTooltipOff: '当前非常驻：打开后启动即可用',
  residentTooltipOn: '当前常驻：关闭后改由 meta_search 召回',

  sourceOfficial: '官方',
  sourceCustom: '自建',
  sourceMcp: 'MCP',

  loading: '正在加载…',
  loadFailed: '读取配置失败',
  retry: '重试',
  empty: '没有符合条件的能力',
  emptyHint: '换个筛选条件或清空搜索词试试',

  settingsNavLabel: '设置分区',
  sectionRoles: '角色黑名单',
  sectionSessions: '会话角色',
  sectionEmbedding: '向量检索',
  rolesUnavailable: '未检测到 Personal Agent（ctx.paRoles）。角色相关的设置只在该服务存在时可用。',
  kindTool: '工具',
  kindSkill: '技能',

  rolesTitle: '角色黑名单',
  // 「黑名单优先级最高」是 §1.4 的判定顺序，界面必须明确说出来。
  rolesIntro: '黑名单优先级最高：它既能排除池内能力，也能排掉常驻能力。两个角色各自独立，未识别角色的会话不受任何黑名单影响。',
  roleRouter: 'Router（路由）',
  roleWorker: 'Worker（执行）',
  roleRouterShort: '路由',
  roleWorkerShort: '执行',
  roleUnknown: '未知角色',
  blacklistDisabled: '已禁用',
  blacklistClear: '清空',
  blacklistClearTooltip: '移除该角色的全部禁用项',
  blacklistSwitchLabel: '对该角色禁用',
  blacklistSwitchTooltipOn: '当前对该角色禁用：关闭后恢复可用',
  blacklistSwitchTooltipOff: '当前对该角色可用：打开后禁用',
  blacklistExcludedTag: '池外',
  blacklistExcludedHint: '池外能力本来就不生效；放回能力池后黑名单立即起作用',

  sessionsTitle: '会话角色',
  sessionsIntro: '角色优先由 Personal Agent 判定；手动绑定只补它没有判定的会话。',
  sessionsEmpty: '当前没有活跃会话',
  sessionsEmptyHint: '打开一个会话后回到这里即可绑定角色',
  sessionEffective: '生效角色',
  sessionSourcePa: '来自 Personal Agent',
  sessionSourceBinding: '来自手动绑定',
  sessionSourceUnknown: '尚未判定',
  sessionBindingDormant: 'Personal Agent 已判定角色，手动绑定不会生效',
  sessionChoiceLabel: '手动绑定',
  sessionAuto: '自动',

  embeddingTitle: '向量检索',
  embeddingIntro: '开启后 meta_search 支持按关键词做语义召回；模型下载失败时会保持关闭并提示原因。',
  embeddingStateOff: '当前：关闭（模式 A，注入索引）',
  embeddingStateOn: '当前：开启（模式 B，按关键词语义召回）',
  embeddingComingSoon: '模型下载与开关将在后续里程碑提供；在此之前固定为关闭。',

  warningTitle: '注意',
  warningMetaSearchNotResident: 'meta_search 不在常驻里，池内那些非常驻能力将无法被召回。',
  warningMetaSearchExcluded: 'meta_search 已被排除出池，完全无法召回，模型只能用常驻能力工作。',
  warningSkillExcluded: 'skill 已被排除出池，所有技能都无法加载。',
  warningResidentEmpty: '常驻为空：模型启动时没有任何直接可用的能力。',
  warningBlacklistExcludesResident: '黑名单排除了常驻能力，这些能力对该角色将不可用。',

  writeFailed: '保存失败',
  revisionConflict: '配置已被其他窗口修改，已重新读取',
  writeForbidden: '这次改动被拒绝',
  saved: '已保存',
}

export type Dict = typeof zh

/** 组件拿到的翻译函数：键受词典约束，语言每次渲染都取自 locale 服务。 */
export type Translate = (key: keyof Dict) => string

export const en: Dict = {
  nav: 'Capabilities',
  pageTitle: 'Capabilities',
  pageSubtitle: 'Choose what tools and skills are available, and which start out enabled',
  refresh: 'Refresh',
  refreshTooltip: 'Reload the current configuration',

  createCapability: 'Create capability',
  createCapabilityMenu: 'Choose how to create',
  createWithAgent: 'Let the Agent create it',
  createSkillManually: 'Create a skill manually',
  createUnavailable: 'This environment has no new-session entry',
  // The space after the colon is where the user continues typing; keep it.
  createPrompt: 'Help me create a skill / tool / MCP: ',

  tabTools: 'Tools',
  tabSkills: 'Skills',
  tabSettings: 'Settings',

  filterAll: 'All',
  filterOfficial: 'Official',
  filterCustom: 'Custom',
  filterMcp: 'MCP',

  searchPlaceholder: 'Search by name or purpose',
  searchLabel: 'Search capabilities',

  helpTitle: 'What this panel does',
  helpTooltip: 'Read the explanation',
  helpIntro: 'It decides what the model sees at the start: two entry points by default, everything else on demand.',
  helpPoolTitle: 'Pool and excluded',
  helpPoolBody: 'The divider in the middle can be dragged. The minus button on the right moves a capability out of the pool, after which it cannot be called, recalled, or listed in the index; the plus button on the left puts it back. Typing /name in the composer loads a skill directly; an explicit request outranks the pool.',
  helpResidentTitle: 'Resident',
  helpResidentBody: 'The switch inside a pool row controls residency: switched on, the model can use it immediately; switched off, it must be recalled by name through meta_search.',
  helpRecallTitle: 'Recall',
  helpRecallBody: 'meta_search returns a capability’s full definition by name or name group; recalled capabilities can be called from the next step on.',
  helpRolesTitle: 'Role blacklists',
  helpRolesBody: 'When a Personal Agent is present, Router and Worker can each blacklist capabilities. A blacklist outranks everything: it excludes pooled and resident capabilities alike, and applies only to sessions of that role.',
  helpBindingTitle: 'Session roles',
  helpBindingBody: 'The Personal Agent decides roles first; a manual binding only fills in sessions it does not decide. When the Personal Agent names a role, the manual binding does not take effect.',
  helpModeA: 'Current mode: A (vector search off). A tool index and the skill catalog are injected; names and one-line summaries only.',
  helpModeB: 'Current mode: B (vector search on). No index is injected; keywords drive semantic recall.',
  helpClose: 'Got it',

  paneExcludedTitle: 'Excluded',
  panePoolTitle: 'Pool',
  addToPool: 'Move into the pool',
  openFolder: 'Open folder',
  openFolderFailed: 'Could not open that folder',
  createFailed: 'Could not create it',
  removeFromPool: 'Move out of the pool',
  paneExcludedEmpty: 'Nothing is excluded',
  paneExcludedEmptyHint: 'Every capability is in the pool',
  panePoolEmpty: 'The pool is empty',
  panePoolEmptyHint: 'The model would have nothing available; add capabilities back from the left',
  splitterLabel: 'Drag to resize the two columns',
  residentLabel: 'Resident',
  residentTooltipOff: 'Not resident: switch on to make it available from the start',
  residentTooltipOn: 'Resident: switch off to require recall through meta_search instead',

  sourceOfficial: 'Official',
  sourceCustom: 'Custom',
  sourceMcp: 'MCP',

  loading: 'Loading…',
  loadFailed: 'Could not read the configuration',
  retry: 'Retry',
  empty: 'No capability matches',
  emptyHint: 'Try another filter or clear the search',

  settingsNavLabel: 'Settings sections',
  sectionRoles: 'Role blacklists',
  sectionSessions: 'Session roles',
  sectionEmbedding: 'Vector search',
  rolesUnavailable: 'No Personal Agent (ctx.paRoles) detected. Role settings are available only when that service exists.',
  kindTool: 'Tool',
  kindSkill: 'Skill',

  rolesTitle: 'Role blacklists',
  rolesIntro: 'A blacklist outranks everything: it excludes pooled capabilities and resident ones alike. The two roles are independent, and a session whose role is unknown is not affected by either blacklist.',
  roleRouter: 'Router',
  roleWorker: 'Worker',
  roleRouterShort: 'Router',
  roleWorkerShort: 'Worker',
  roleUnknown: 'Unknown role',
  blacklistDisabled: 'disabled',
  blacklistClear: 'Clear',
  blacklistClearTooltip: 'Remove every entry from this role',
  blacklistSwitchLabel: 'disable for this role',
  blacklistSwitchTooltipOn: 'Disabled for this role: switch off to make it available again',
  blacklistSwitchTooltipOff: 'Available for this role: switch on to disable it',
  blacklistExcludedTag: 'Excluded',
  blacklistExcludedHint: 'An excluded capability is already unavailable; the blacklist takes effect as soon as it returns to the pool',

  sessionsTitle: 'Session roles',
  sessionsIntro: 'The Personal Agent decides roles first; a manual binding only fills in sessions it does not decide.',
  sessionsEmpty: 'No active session',
  sessionsEmptyHint: 'Open a session and come back here to bind its role',
  sessionEffective: 'Effective role',
  sessionSourcePa: 'from the Personal Agent',
  sessionSourceBinding: 'from a manual binding',
  sessionSourceUnknown: 'not determined yet',
  sessionBindingDormant: 'The Personal Agent already decided this role, so the manual binding is dormant',
  sessionChoiceLabel: 'Manual binding',
  sessionAuto: 'Automatic',

  embeddingTitle: 'Vector search',
  embeddingIntro: 'When enabled, meta_search can recall by keyword similarity; a failed model download keeps it off and reports why.',
  embeddingStateOff: 'Current: off (mode A, index injected)',
  embeddingStateOn: 'Current: on (mode B, semantic recall by keyword)',
  embeddingComingSoon: 'Model download and the switch arrive in a later milestone; until then it stays off.',

  warningTitle: 'Heads up',
  warningMetaSearchNotResident: 'meta_search is not resident, so non-resident pool capabilities cannot be recalled.',
  warningMetaSearchExcluded: 'meta_search is excluded, so nothing can be recalled and the model works with resident capabilities only.',
  warningSkillExcluded: 'The skill tool is excluded, so no skill can be loaded.',
  warningResidentEmpty: 'Nothing is resident: the model starts with no capability available.',
  warningBlacklistExcludesResident: 'The blacklist excludes resident capabilities, which become unavailable for that role.',

  writeFailed: 'Could not save',
  revisionConflict: 'The configuration changed in another window; reloaded',
  writeForbidden: 'That change was rejected',
  saved: 'Saved',
}

/** 语言码是否中文；词典选择与能力摘要本地化共用同一判定。 */
export function isChinese(language: string | null | undefined): boolean {
  return String(language ?? '').toLowerCase().startsWith('zh')
}

export function text(language: string | null | undefined): Dict {
  return isChinese(language) ? zh : en
}

/** 按语言码给出该语言的翻译函数。 */
export function translateFor(language: string | null | undefined): Translate {
  const dict = text(language)
  return key => dict[key]
}

/** 从 locale 服务取值中提取语言码 */
export function detectLanguage(locale: unknown, navigatorLanguage?: string): string {
  try {
    if (typeof locale === 'string') return locale
    if (locale && typeof locale === 'object') {
      const record = locale as {
        language?: unknown
        current?: unknown
        get?: (key: string) => unknown
        // DSH 官方 locale 服务（dsh-client-locale LocaleRuntime）形状：
        // getSnapshot() / getLocale() 均返回 { active, locales, revision }。
        getSnapshot?: () => { active?: unknown }
        getLocale?: () => { active?: unknown }
      }
      if (typeof record.language === 'string') return record.language
      if (typeof record.current === 'string') return record.current
      if (typeof record.get === 'function') {
        const value = record.get('language')
        if (typeof value === 'string') return value
      }
      // 官方 locale 服务：读 active 语言 id（'zh' / 'en'）
      if (typeof record.getSnapshot === 'function') {
        const snapshot = record.getSnapshot()
        if (snapshot && typeof snapshot.active === 'string') return snapshot.active
      }
      if (typeof record.getLocale === 'function') {
        const snapshot = record.getLocale()
        if (snapshot && typeof snapshot.active === 'string') return snapshot.active
      }
    }
  } catch {
    // 忽略
  }
  try {
    return typeof navigator !== 'undefined' ? (navigator.language ?? navigatorLanguage ?? 'en') : (navigatorLanguage ?? 'en')
  } catch {
    return navigatorLanguage ?? 'en'
  }
}
