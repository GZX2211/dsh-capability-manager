// src/client/i18n.ts
//
// 中英双语文案（覆盖全部 UI 界面文案）。新增文案必须同时补 zh / en。

export const NS = 'capability manager'

export const zh = {
  nav: '能力管理',
  pageTitle: '能力管理',
  pageSubtitle: '管理工具与 Skill 的可用范围与初始配置',
  refresh: '刷新',
  refreshTooltip: '重新读取当前配置',

  tabTools: '工具',
  tabSkills: 'Skill',
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
  helpPoolTitle: '池',
  helpPoolBody: '控制能不能用。关掉之后，这个能力调不到、召不回，也不会出现在索引里。',
  helpResidentTitle: '常',
  helpResidentBody: '控制是否直接可用。开启后模型一开始就能用；否则只能经 meta_search 按名字召回。',
  helpRecallTitle: '召回',
  helpRecallBody: 'meta_search 用名称或名称组取回能力的完整定义；召回的结果从下一步开始可调用。',
  helpModeA: '当前模式：A（向量检索关闭）。面板会注入一份能力索引，只含名称与用途摘要。',
  helpModeB: '当前模式：B（向量检索开启）。不注入索引，靠关键词做语义召回。',
  helpClose: '知道了',

  poolLabel: '池',
  residentLabel: '常',
  poolTooltipOff: '当前在池内：点击把它移出能力池，此后不可调用、不可召回',
  poolTooltipOn: '当前在池外：点击把它放回能力池',
  residentTooltipOff: '当前非常驻：点击让它启动即可用',
  residentTooltipOn: '当前常驻：点击取消，改由 meta_search 召回',
  residentDisabledTooltip: '该能力不在池内，不能设为常驻',

  sourceOfficial: '官方',
  sourceCustom: '自建',
  sourceMcp: 'MCP',

  loading: '正在加载…',
  loadFailed: '读取配置失败',
  retry: '重试',
  empty: '没有符合条件的能力',
  emptyHint: '换个筛选条件或清空搜索词试试',

  settingsPlaceholder: '设置项（向量检索开关、Router / Worker 黑名单）将在后续里程碑提供。',
  skillsPlaceholder: 'Skill 的池与常驻控制将在下一个里程碑提供。',

  warningTitle: '注意',
  warningMetaSearchNotResident: 'meta_search 不在常驻里，池内那些非常驻能力将无法被召回。',
  warningMetaSearchExcluded: 'meta_search 已被排除出池，完全无法召回，模型只能用常驻能力工作。',
  warningSkillExcluded: 'skill 已被排除出池，所有 Skill 都无法加载。',
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
  helpPoolTitle: 'Pool',
  helpPoolBody: 'Controls whether a capability may be used. Switched off, it cannot be called, recalled, or listed in the index.',
  helpResidentTitle: 'Resident',
  helpResidentBody: 'Controls whether it is available immediately. Otherwise it must be recalled by name through meta_search.',
  helpRecallTitle: 'Recall',
  helpRecallBody: 'meta_search returns a capability’s full definition by name or name group; recalled capabilities can be called from the next step on.',
  helpModeA: 'Current mode: A (vector search off). An index of names and one-line summaries is injected.',
  helpModeB: 'Current mode: B (vector search on). No index is injected; keywords drive semantic recall.',
  helpClose: 'Got it',

  poolLabel: 'Pool',
  residentLabel: 'Always',
  poolTooltipOff: 'In the pool: click to exclude it, after which it cannot be called or recalled',
  poolTooltipOn: 'Excluded: click to put it back in the pool',
  residentTooltipOff: 'Not resident: click to make it available from the start',
  residentTooltipOn: 'Resident: click to require recall through meta_search instead',
  residentDisabledTooltip: 'Not in the pool, so it cannot be resident',

  sourceOfficial: 'Official',
  sourceCustom: 'Custom',
  sourceMcp: 'MCP',

  loading: 'Loading…',
  loadFailed: 'Could not read the configuration',
  retry: 'Retry',
  empty: 'No capability matches',
  emptyHint: 'Try another filter or clear the search',

  settingsPlaceholder: 'Settings (vector search, Router / Worker blacklists) arrive in a later milestone.',
  skillsPlaceholder: 'Pool and resident control for skills arrive in the next milestone.',

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

export function text(language: string | null | undefined): Dict {
  return String(language ?? '').toLowerCase().startsWith('zh') ? zh : en
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
