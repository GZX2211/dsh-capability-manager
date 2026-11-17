// tests/shared/api.test.ts
//
// 管理面协议的稳定性约束。这些值同时被 Host 的路由注册与 Client 的请求边界读取，
// 任何一处写错都会表现为「请求打到了别的地方」而不是编译错误。

import { describe, expect, it } from 'vitest'
import { API_PREFIX, ERROR_CODES, REQUEST_HEADER, ROUTES } from '../../src/shared/api.ts'

describe('路由契约', () => {
  it('每个路由都在 API 前缀之下', () => {
    for (const [name, path] of Object.entries(ROUTES)) {
      expect(path.startsWith(`${API_PREFIX}/`), `${name}: ${path}`).toBe(true)
    }
  })

  it('路由互不重复', () => {
    const paths = Object.values(ROUTES)

    expect(new Set(paths).size).toBe(paths.length)
  })

  it('手动创建 Skill 与打开目录各有端点', () => {
    expect(ROUTES.createSkill).toBe(`${API_PREFIX}/skills`)
    expect(ROUTES.reveal).toBe(`${API_PREFIX}/reveal`)
  })
})

describe('错误码契约', () => {
  it('错误码互不重复', () => {
    const codes = Object.values(ERROR_CODES)

    expect(new Set(codes).size).toBe(codes.length)
  })

  it('能力不存在与打开目录失败各有稳定错误码', () => {
    expect(ERROR_CODES.unknownCapability).toBe('unknown-capability')
    expect(ERROR_CODES.notOwned).toBe('not-owned')
    expect(ERROR_CODES.revealFailed).toBe('reveal-failed')
    expect(ERROR_CODES.createFailed).toBe('create-failed')
  })

  it('自定义请求头是显式调用约定的一部分', () => {
    expect(REQUEST_HEADER).toBe('x-capability-manager-request')
  })
})
