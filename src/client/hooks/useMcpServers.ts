// src/client/hooks/useMcpServers.ts
//
// MCP 分区的数据来源：挂载时读一次，之后定时重读，写操作后立即重读。
//
// 与其他分区不同，MCP 列表里有一半是**运行时状态**（连接是否成功），而它只会由
// 官方管理器异步推进。不轮询的话，打开开关后状态点永远停在灰点，用户只能反复点刷新。
// 轮询只在分区挂载期间进行，离开即停，不影响能力快照的读写节奏。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { McpForm, McpServersResponse, McpWriteResponse } from '../../shared/mcp.ts'
import {
  ApiError,
  deleteMcpServer,
  fetchMcpServers,
  importMcpServers,
  saveMcpServer,
  toggleMcpServer,
} from '../lib/http.ts'

/** 连接状态的刷新间隔：连接通常在 1–3 秒内落定，2.5 秒足以跟进且不吵。 */
const POLL_INTERVAL_MS = 2500

/** 一次写操作的结果：失败时带出可行动的细节，调用方就地展示。 */
export type McpWriteReply =
  | { ok: true }
  | { ok: false; message: string; issues?: string[]; reason?: string }

export interface McpHandle {
  /** 最近一次读取的结果；尚未读到时为 undefined。 */
  data?: McpServersResponse
  /** 读取失败的可读原因；成功后清空。 */
  error?: string
  /** 写操作进行中：控件应禁用，避免同一动作连发。 */
  saving: boolean
  /** 立即重读一次。 */
  refresh: () => void
  save: (form: McpForm) => Promise<McpWriteReply>
  importJson: (json: string) => Promise<McpWriteReply>
  toggle: (name: string, enabled: boolean) => Promise<McpWriteReply>
  remove: (name: string) => Promise<McpWriteReply>
}

/**
 * 订阅 MCP 列表。
 *
 * @param describe - 把稳定错误码翻成用户语言；由入口注入，hook 不依赖词典。
 * @returns 当前状态与四个写动作。
 */
export function useMcpServers(describe: (error: unknown) => string): McpHandle {
  const [data, setData] = useState<McpServersResponse | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const disposed = useRef(false)
  /** 读取代次：只让最新一次读取落状态，避免旧响应覆盖新事实。 */
  const readSeq = useRef(0)
  const describeRef = useRef(describe)
  describeRef.current = describe

  const read = useCallback(async (): Promise<McpServersResponse | undefined> => {
    const seq = ++readSeq.current
    try {
      const next = await fetchMcpServers()
      if (disposed.current || seq !== readSeq.current) return undefined
      setData(next)
      setError(undefined)
      return next
    } catch (caught) {
      if (disposed.current || seq !== readSeq.current) return undefined
      setError(describeRef.current(caught))
      return undefined
    }
  }, [])

  /** 定时器闭包读的是最新写入状态；把 saving 放进依赖会把轮询重建到每次写操作。 */
  const savingRef = useRef(false)
  savingRef.current = saving

  useEffect(() => {
    disposed.current = false
    void read()
    const timer = setInterval(() => {
      // 写入进行中不重读：此刻拿到的是变更前的快照，会让状态点闪回。
      if (!savingRef.current) void read()
    }, POLL_INTERVAL_MS)
    return () => {
      disposed.current = true
      clearInterval(timer)
    }
  }, [read])

  /**
   * 执行一次写操作并重读。
   *
   * 失败不抛给调用方吞掉：返回结构化结果，由弹窗或列表就地显示，
   * 因为一次失败的原因（字段不对 / 服务器已被删除 / 写盘失败）需要不同的提示位置。
   */
  const write = useCallback(async (
    action: () => Promise<McpWriteResponse>,
  ): Promise<McpWriteReply> => {
    setSaving(true)
    try {
      await action()
      await read()
      return { ok: true }
    } catch (caught) {
      if (caught instanceof ApiError) {
        return { ok: false, message: describeRef.current(caught), issues: caught.issues, reason: caught.reason }
      }
      return { ok: false, message: describeRef.current(caught) }
    } finally {
      if (!disposed.current) setSaving(false)
    }
  }, [read])

  const save = useCallback((form: McpForm) => write(() => saveMcpServer(form)), [write])
  const importJson = useCallback((json: string) => write(() => importMcpServers(json)), [write])
  const toggle = useCallback((name: string, enabled: boolean) => write(() => toggleMcpServer(name, enabled)), [write])
  const remove = useCallback((name: string) => write(() => deleteMcpServer(name)), [write])

  return { data, error, saving, refresh: () => void read(), save, importJson, toggle, remove }
}
