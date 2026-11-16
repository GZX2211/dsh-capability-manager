// src/client/components/PanelIcon.tsx
//
// 左侧栏入口的图标。宿主传入尺寸与选中态，这里用同一个字形：
// 图形本身不随选中态变化，选中由侧栏自己的行背景表达。

import { IconPluginPinwheelOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

export function PanelIcon() {
  return <IconPluginPinwheelOutlineRegular />
}
