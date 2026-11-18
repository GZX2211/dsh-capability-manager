// src/client/components/HelpDialog.tsx
//
// 问号弹窗：解释两个开关与召回机制，并说明当前处于哪种模式。
//
// 模式由服务端的 `embedding.enabled` 决定，客户端不自己推断：
// 两处各推断一次，迟早会出现「弹窗说的和索引实际行为不一致」。

import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../i18n.ts'

export interface HelpDialogProps {
  open: boolean
  /** 向量检索是否开启；决定说明里讲模式 A 还是模式 B。 */
  embeddingEnabled: boolean
  /** 检测到 `ctx.paRoles` 时才解释角色黑名单：没有服务时那两个分区根本不存在。 */
  rolesAvailable: boolean
  onClose: () => void
  t: Translate
}

export function HelpDialog({ open, embeddingEnabled, rolesAvailable, onClose, t }: HelpDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('helpTitle')}
      closeLabel={t('helpClose')}
      className="cm-dialog"
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('helpClose')}
        </Button>
      }
    >
      <div className="cm-help cm-dialog__scroll">
        <p>{t('helpIntro')}</p>

        <div className="cm-help-section">
          <span className="cm-help-term">{t('helpPoolTitle')}</span>
          <span>{t('helpPoolBody')}</span>
        </div>

        <div className="cm-help-section">
          <span className="cm-help-term">{t('helpResidentTitle')}</span>
          <span>{t('helpResidentBody')}</span>
        </div>

        <div className="cm-help-section">
          <span className="cm-help-term">{t('helpRecallTitle')}</span>
          <span>{t('helpRecallBody')}</span>
        </div>

        {rolesAvailable ? (
          <>
            <div className="cm-help-section">
              <span className="cm-help-term">{t('helpRolesTitle')}</span>
              <span>{t('helpRolesBody')}</span>
            </div>

            <div className="cm-help-section">
              <span className="cm-help-term">{t('helpBindingTitle')}</span>
              <span>{t('helpBindingBody')}</span>
            </div>
          </>
        ) : null}

        <p className="cm-help-mode">{t(embeddingEnabled ? 'helpModeB' : 'helpModeA')}</p>
      </div>
    </Modal>
  )
}
