// src/host/admin/selfmade.ts
//
// 管理面里与自建能力相关的两个动作：手动创建 Skill、在文件管理器里打开目录。
//
// 创建是「先建目录、再落配置」：配置写入成功之前的能力事实上还不存在，
// 因此任何一步失败都朝「什么都没发生」降级——失败时把刚建的目录删掉。

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { conflictOutcome, notOwnedOutcome, unknownCapabilityOutcome } from './errors.ts'
import { ERROR_CODES } from '../../shared/api.ts'
import type { ConfigOutcome } from './server.ts'
import { parseId, skillId, type CapabilityEntry } from '../../shared/capability.ts'
import type { CapabilityConfig } from '../../shared/config.ts'
import type { ConfigWriteResult } from '../config/store.ts'
import { summarize } from '../catalog/collect.ts'
import { createSelfmadeSkill } from '../selfmade/create.ts'
import { revealInFileManager } from '../selfmade/reveal.ts'

/** 手动创建时的默认名称、描述与序号策略。 */
export const DEFAULT_SKILL_BASE_NAME = 'my-skill'
export const DEFAULT_SKILL_DESCRIPTION = '自建 Skill，用途待填写'

/** 只依赖 ConfigStore 的读写面，便于在测试里注入失败。 */
export interface SelfmadeConfigStoreLike {
  readonly revision: number
  read(): CapabilityConfig
  write(config: CapabilityConfig, expectedRevision: number): ConfigWriteResult
}

export interface CreateSkillActionDeps {
  store: SelfmadeConfigStoreLike
  stateDir: string
  /** 基名；缺省 {@link DEFAULT_SKILL_BASE_NAME}。 */
  baseName?: string
  /** 初始描述；缺省 {@link DEFAULT_SKILL_DESCRIPTION}。 */
  description?: string
  /**
   * 创建成功后立即通知技能注册表丢缓存。
   *
   * 目录监听是去抖的：创建请求返回时注册表缓存里仍是创建前的目录，
   * 界面紧接着发出的刷新会命中旧缓存，看不到刚建好的条目。
   */
  onCreated?: () => void
  log?: (message: string) => void
}

/**
 * 处理一次「手动创建 Skill」。
 *
 * @param deps - 配置存储与状态目录。
 * @param body - 未经校验的请求体，形如 `{ revision }`。
 * @returns HTTP 状态与响应体。
 */
export function createSkillAction(deps: CreateSkillActionDeps, body: unknown): ConfigOutcome {
  const revision = revisionOf(body)
  if (revision === undefined) {
    return { status: 400, body: { ok: false, code: 'bad-request', message: 'revision 必须是数字：创建会改变配置' } }
  }
  if (revision !== deps.store.revision) return conflictOutcome(deps.store.revision)

  const description = deps.description ?? DEFAULT_SKILL_DESCRIPTION
  let created
  try {
    created = createSelfmadeSkill({
      stateDir: deps.stateDir,
      baseName: deps.baseName ?? DEFAULT_SKILL_BASE_NAME,
      description,
    })
  } catch (error) {
    const message = `无法创建 Skill 骨架：${describe(error)}`
    deps.log?.(message)
    return { status: 500, body: { ok: false, code: ERROR_CODES.createFailed, message } }
  }

  const config = deps.store.read()
  const id = skillId(created.name)
  // 新建能力默认进池、默认不常驻；这里只把它移出池，等用户填完再手动加回。
  const next: CapabilityConfig = config.excluded.includes(id)
    ? config
    : { ...config, excluded: [...config.excluded, id] }

  const result = deps.store.write(next, revision)
  if (result.ok) {
    // 文件与配置都已落盘，注册表缓存里却还是创建前的目录；在这里同步失效，
    // 之后到达的刷新才读得到新条目。
    deps.onCreated?.()
    const capability: CapabilityEntry = {
      id,
      kind: 'skill',
      name: created.name,
      summary: summarize(description),
      source: 'custom',
      owned: true,
      // 刚创建即被排除出池，因此此刻不可被模型加载。
      available: false,
    }
    return { status: 200, body: { ok: true, revision: result.revision, capability } }
  }

  // 配置没落盘：把骨架删掉，避免出现「目录存在但能力管理不认识」的半截状态。
  try {
    rmSync(created.dir, { recursive: true, force: true })
  } catch (error) {
    deps.log?.(`无法回滚刚创建的目录 ${created.dir}：${describe(error)}`)
  }
  if (result.code === 'revision-conflict') return conflictOutcome(result.revision)
  return { status: 500, body: { ok: false, code: 'internal', message: result.message } }
}

export interface RevealActionDeps {
  stateDir: string
  /** 该工具名是否由本插件的自建目录注册。 */
  ownsTool: (name: string) => boolean
  /** 该 Skill 名对应的包目录；非自建时为 undefined。 */
  directoryOfSkill: (name: string) => string | undefined
  /** 调起文件管理器；缺省用平台命令，测试注入替身。 */
  reveal?: (path: string) => void
}

/**
 * 处理一次「打开自建能力目录」。
 *
 * @param deps - 自建能力的归属判定与目录解析。
 * @param body - 未经校验的请求体，形如 `{ id }`。
 * @returns HTTP 状态与响应体。
 */
export function revealAction(deps: RevealActionDeps, body: unknown): ConfigOutcome {
  const id = idOf(body)
  const parsed = id === undefined ? undefined : parseId(id)
  if (parsed === undefined) return unknownCapabilityOutcome(id)

  const path = parsed.kind === 'tool'
    ? deps.ownsTool(parsed.name) ? join(deps.stateDir, 'tools', parsed.name) : undefined
    : deps.directoryOfSkill(parsed.name)

  if (path === undefined) return notOwnedOutcome(id ?? '')

  try {
    ;(deps.reveal ?? (target => revealInFileManager(target)))(path)
  } catch (error) {
    return {
      status: 500,
      body: { ok: false, code: 'reveal-failed', message: `无法打开 ${path}：${describe(error)}` },
    }
  }
  return { status: 200, body: { ok: true } }
}

function revisionOf(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const value = (body as { revision?: unknown }).revision
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function idOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const value = (body as { id?: unknown }).id
  return typeof value === 'string' ? value : undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
