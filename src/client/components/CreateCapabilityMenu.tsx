// src/client/components/CreateCapabilityMenu.tsx
//
// 页头右上角的「创建能力」分裂按钮：主按钮与右侧箭头都打开同一个菜单。
//
// 与官方「添加插件」不同，主按钮没有独立的默认动作——创建能力只有「让 Agent 创建」
// 与「手动创建 Skill」两条路径，所以点击主按钮也展开菜单，避免一个点了没反应的按钮。
// 菜单项由官方 Menu / MenuItemButton 渲染，键盘走读、Escape 关闭、焦点归位都由它负责。

import {
  Button,
  IconChevronDownOutlineRegular,
  IconPlusOutlineRegular,
  IconSkillOutlineRegular,
  IconSparkleRegular,
  Menu,
  MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useState, type KeyboardEvent } from 'react'
import type { Translate } from '../i18n.ts'

export interface CreateCapabilityMenuProps {
  /** 写入进行中：整个分裂按钮禁用，避免把用户带离当前页面。 */
  disabled: boolean
  onCreateWithAgent: () => void
  t: Translate
}

export function CreateCapabilityMenu({ disabled, onCreateWithAgent, t }: CreateCapabilityMenuProps) {
  const [open, setOpen] = useState(false)
  const dismiss = () => { setOpen(false) }
  const toggle = () => { setOpen(value => !value) }
  const openOnArrowDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open && event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
    }
  }

  return (
    <span className="cm-create-group" role="group" aria-label={t('createCapability')}>
      <Button
        variant="primary"
        size="sm"
        className="cm-create-primary"
        icon={<IconPlusOutlineRegular />}
        aria-label={t('createCapability')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={openOnArrowDown}
      >
        {t('createCapability')}
      </Button>
      <Menu
        open={open}
        onClose={dismiss}
        align="end"
        portal
        autoFocus
        anchor={(
          <Button
            variant="primary"
            size="sm"
            className="cm-create-more"
            aria-label={t('createCapabilityMenu')}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={disabled}
            onClick={toggle}
            onKeyDown={openOnArrowDown}
          >
            <IconChevronDownOutlineRegular size={12} aria-hidden="true" />
          </Button>
        )}
      >
        <MenuItemButton
          icon={<IconSparkleRegular size={14} />}
          onSelect={() => { dismiss(); onCreateWithAgent() }}
        >
          {t('createWithAgent')}
        </MenuItemButton>
        <MenuItemButton
          icon={<IconSkillOutlineRegular size={14} />}
          disabled
          disabledReason={t('createSkillDisabledReason')}
          onSelect={() => {}}
        >
          {t('createSkillManually')}
        </MenuItemButton>
      </Menu>
    </span>
  )
}
