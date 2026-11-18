// src/client/hooks/useSnapshot.ts
//
// 面板唯一的数据来源：挂载时拉一次快照，写入后重新拉取。
//
// 不做乐观更新：写操作落盘才改变服务端事实，界面提前变绿会让用户以为已生效。
// 代价是一次往返，换的是「看到的和实际的一致」。
//
// 不轮询：配置改动只会来自本面板或另一个窗口的同一个面板，手动刷新足够；
// 轮询会让悬停中的开关在脚下被重绘。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CapabilityEntry } from '../../shared/capability.ts'
import type { CapabilityConfig } from '../../shared/config.ts'
import type { ConfigPatch, ConfigPatchInput, SnapshotResponse } from '../../shared/api.ts'
import {
  ApiError,
  createSkill as requestCreateSkill,
  fetchSnapshot,
  revealCapability,
  writeConfig,
} from '../lib/http.ts'

export interface SnapshotState {
  snapshot?: SnapshotResponse
  /** 读取失败的可读原因；成功后清空。 */
  error?: string
  /** 写入进行中，控件应禁用。 */
  saving: boolean
  /** 写入失败的可读原因；下一次成功写入后清空。 */
  writeError?: string
  /** 非错误的提示，如 revision 冲突后已重新读取。 */
  notice?: string
}

export interface SnapshotHandle extends SnapshotState {
  /** 重新读取快照。 */
  refresh: () => void
  /** 提交一次配置改动；成功后自动刷新。 */
  mutate: (patch: ConfigPatchInput) => Promise<void>
  /** 手动创建一个自建 Skill；成功后刷新快照并返回新条目。 */
  createSkill: () => Promise<CapabilityEntry | undefined>
  /** 在系统文件管理器里打开某个自建能力的目录。 */
  reveal: (id: string) => Promise<void>
}

/**
 * 订阅快照并提供一个写入口。
 *
 * @param describe - 把稳定的失败分类翻成用户语言；由入口注入，避免 hook 依赖词典。
 * @returns 当前状态与两个动作。
 */
export function useSnapshot(describe: (error: unknown) => string): SnapshotHandle {
  const [state, setState] = useState<SnapshotState>({ saving: false })
  const disposed = useRef(false)
  const revision = useRef(0)
  /**
   * 读取代次：每次发起读取时自增，响应回来时只有仍是最新的那次可以落状态。
   *
   * 没有它时，写操作之前发出的读取可能晚于写操作之后的读取返回，
   * 用旧事实把刚创建出来的条目覆盖掉——表现就是创建后刷新也看不到新行。
   */
  const readSeq = useRef(0)
  const describeRef = useRef(describe)
  describeRef.current = describe

  /**
   * 读一次快照并落状态。
   *
   * describe 走 ref 而不是依赖：它随渲染变化，若作为依赖，挂载效应会在每次渲染
   * 后重跑，界面就变成「点一下就自动刷新一次」。
   *
   * @returns 写入状态的快照；本次读取已过期（卸载或有更新的读取）时为 undefined。
   */
  const read = useCallback(async (): Promise<SnapshotResponse | undefined> => {
    const seq = ++readSeq.current
    try {
      const snapshot = await fetchSnapshot()
      if (disposed.current || seq !== readSeq.current) return undefined
      revision.current = snapshot.revision
      setState(previous => ({ ...previous, snapshot, error: undefined }))
      return snapshot
    } catch (error) {
      if (disposed.current || seq !== readSeq.current) return undefined
      setState(previous => ({ ...previous, error: describeRef.current(error) }))
      return undefined
    }
  }, [])

  useEffect(() => {
    disposed.current = false
    void read()
    return () => {
      disposed.current = true
    }
  }, [read])

  const mutate = useCallback(
    async (patch: ConfigPatchInput): Promise<void> => {
      setState(previous => ({ ...previous, saving: true, writeError: undefined, notice: undefined }))
      try {
        // 类型上是联合类型，revision 由 hook 统一补齐：调用方不该自己记版本号。
        const result = await writeConfig({ ...patch, revision: revision.current } as ConfigPatch)
        revision.current = result.revision
        // 写成功后的读取顺带作废写之前发出的读取，避免旧快照覆盖新事实。
        await read()
        if (disposed.current) return
        setState(previous => ({ ...previous, saving: false }))
      } catch (error) {
        if (disposed.current) return
        if (error instanceof ApiError && error.code === 'revision-conflict') {
          // 别人改过了：重新读一次，让用户基于新状态重新决定。
          setState(previous => ({ ...previous, saving: false, notice: describeRef.current(error) }))
          await read()
          return
        }
        setState(previous => ({ ...previous, saving: false, writeError: describeRef.current(error) }))
      }
    },
    [read],
  )

  const createSkill = useCallback(async (): Promise<CapabilityEntry | undefined> => {
    setState(previous => ({ ...previous, saving: true, writeError: undefined, notice: undefined }))
    try {
      const created = await requestCreateSkill(revision.current)
      revision.current = created.revision
      // Skill 文件此刻才落盘：必须等创建返回后再读，快照里才可能有新条目。
      await read()
      if (disposed.current) return created.capability
      setState(previous => ({ ...previous, saving: false }))
      return created.capability
    } catch (error) {
      if (disposed.current) return undefined
      if (error instanceof ApiError && error.code === 'revision-conflict') {
        // 与写配置同一条恢复路径：重新读一次，让用户基于新状态重来。
        setState(previous => ({ ...previous, saving: false, notice: describeRef.current(error) }))
        await read()
        return undefined
      }
      setState(previous => ({ ...previous, saving: false, writeError: describeRef.current(error) }))
      return undefined
    }
  }, [read])

  const reveal = useCallback(async (id: string): Promise<void> => {
    try {
      await revealCapability(id)
    } catch (error) {
      if (disposed.current) return
      // 打开目录不改配置，因此不进入 saving 状态，只把失败摆到用户面前。
      setState(previous => ({ ...previous, writeError: describeRef.current(error) }))
    }
  }, [])

  return { ...state, refresh: () => void read(), mutate, createSkill, reveal }
}

/** 由 hook 结果推导界面可用的配置；快照尚未到达时返回 undefined。 */
export function configOf(snapshot: SnapshotResponse | undefined): CapabilityConfig | undefined {
  return snapshot?.config
}
