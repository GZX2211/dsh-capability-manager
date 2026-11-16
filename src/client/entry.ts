// src/client/entry.ts
//
// Client 半区插件入口：注册左侧栏入口与主页面。骨架阶段只声明身份与
// 必需服务，注册内容按里程碑逐步补齐。

export const name = 'dsh-capability-manager'

/** 需要的浏览器服务：缺任何一个面板都不会出现。 */
export const inject = ['slots', 'locale']
