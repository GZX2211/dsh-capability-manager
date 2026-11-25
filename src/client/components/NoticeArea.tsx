// src/client/components/NoticeArea.tsx
//
// 页头提示区：轻提示在左，常驻提示收拢在右侧感叹号图标的悬浮气泡里。
// 两者共用同一处位置：消息出现时先在这里一闪，消失后仍需可读的内容
// 由图标承载，避免常驻文案挤占工具栏。

import { Button, IconWarningOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../i18n.ts'

export interface NoticeAreaProps {
  /** 当前轻提示；由页头计时收起。 */
  message?: string
  /** 已经归并去重、需要长期可读的提示行。 */
  lines: readonly string[]
  t: Translate
}

export function NoticeArea({ message, lines, t }: NoticeAreaProps) {
  if (message === undefined && lines.length === 0) return null

  return (
    <div className="cm-notice-area">
      {message !== undefined ? <span className="cm-toast" role="status">{message}</span> : null}
      {lines.length > 0 ? (
        <Tooltip label={lines.join('\n')} side="bottom" align="end" openOnClick portal maxWidth={420}>
          <Button
            className="cm-warning-hint"
            variant="ghost"
            size="sm"
            icon={<IconWarningOutlineRegular />}
            aria-label={t('warningTitle')}
          />
        </Tooltip>
      ) : null}
    </div>
  )
}
