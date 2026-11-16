// src/host/index.ts
//
// 插件宿主入口：装配与生命周期。骨架阶段只声明身份与必需服务，
// 装配内容按里程碑逐步补齐。

export const name = 'dsh-capability-manager'

/** 需要的宿主服务：缺任何一个都不该沉默地半启动。 */
export const inject = ['tools', 'systemPrompt', 'webServer']
