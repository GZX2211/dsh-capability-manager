// src/client/entry.ts
//
// Client 半区插件入口：注册左侧栏入口与主页面，并注入样式与文案。
//
// 两处注册缺一不可：`sidebar.panellist` 是侧栏那一行，`main` 是它打开的页面；
// 宿主按同一个 id 把两者连起来，只注册一处时点击会报「找不到页面」。

import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { PanelIcon } from './components/PanelIcon.tsx'
import type { ClientContext } from './context.ts'
import { PANEL_ID, PANEL_ORDER } from './definition.ts'
import { detectLanguage, text, type Translate } from './i18n.ts'
import { installStyles } from './style.ts'
import { Manager } from './views/Manager.tsx'

export const name = 'dsh-capability-manager'

/** 需要的浏览器服务：缺任何一个面板都不会出现。 */
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  // 语言由 locale 服务给出，文案由本包词典给出：某一份字典缺失时只有那一处回退，
  // 不会让整个面板消失。
  const currentLanguage = (): string => detectLanguage(ctx.locale.getLocale())

  // 注入面只在首次渲染时求值一次，而语言可能在此之后切换；
  // 因此翻译函数每次调用都重新读语言，宿主因 locale 变更重渲染时即可换成新文案。
  const translate = (): Translate => key => text(currentLanguage())[key]

  /**
   * 新建会话并预填创建能力的引导语。
   *
   * `uiWorkspace` 是宿主可选服务：没有它时返回 false，由面板提示这一环境没有入口，
   * 而不是把一个点了没反应的按钮留在页面上。
   *
   * @returns 是否已发起导航。
   */
  const createWithAgent = (): boolean => {
    const workspace = ctx.get('uiWorkspace')
    if (workspace === undefined) return false
    workspace.startSession(undefined, {
      prompt: translate()('createPrompt'),
      whenDraftExists: 'append',
    })
    return true
  }

  ctx.effect(() => installStyles(), 'capability-manager: styles')

  ctx.effect(
    () =>
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID as MainPanelId,
            inject: () => ({ t: translate(), currentLanguage, onCreateWithAgent: createWithAgent }),
          },
          Manager,
        ),
      ),
    'capability-manager: page',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID as MainPanelId,
            order: PANEL_ORDER,
            label: () => translate()('nav'),
          },
          PanelIcon,
        ),
      ),
    'capability-manager: sidebar entry',
  )
}

