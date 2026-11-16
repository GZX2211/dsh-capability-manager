import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { guardRequest } from '../../../src/host/admin/guard.ts'
import { REQUEST_HEADER, REQUEST_HEADER_VALUE } from '../../../src/shared/api.ts'

const ORIGIN = 'http://127.0.0.1:59215'

function request(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

const header = { [REQUEST_HEADER]: REQUEST_HEADER_VALUE }

describe('同源守卫', () => {
  it('缺少自定义头时拒绝', () => {
    expect(guardRequest(ORIGIN, request({}))).toMatchObject({ ok: false, code: 'missing-request-header' })
  })

  it('自定义头值不对时拒绝', () => {
    expect(guardRequest(ORIGIN, request({ [REQUEST_HEADER]: '0' }))).toMatchObject({
      ok: false,
      code: 'missing-request-header',
    })
  })

  it('只有自定义头、没有任何来源证据时放行', () => {
    // 桌面端转发会剥掉 Origin/Referer/Sec-Fetch-Site，此时没有可判定的证据。
    expect(guardRequest(ORIGIN, request(header))).toEqual({ ok: true })
  })

  it('同源 Origin 放行', () => {
    expect(guardRequest(ORIGIN, request({ ...header, origin: ORIGIN }))).toEqual({ ok: true })
  })

  it('异源 Origin 拒绝', () => {
    expect(guardRequest(ORIGIN, request({ ...header, origin: 'http://evil.example' }))).toMatchObject({
      ok: false,
      code: 'wrong-origin',
    })
  })

  it('同源 Referer 放行', () => {
    expect(guardRequest(ORIGIN, request({ ...header, referer: `${ORIGIN}/session/x` }))).toEqual({ ok: true })
  })

  it('异源 Referer 拒绝', () => {
    expect(guardRequest(ORIGIN, request({ ...header, referer: 'http://evil.example/x' }))).toMatchObject({
      ok: false,
      code: 'wrong-origin',
    })
  })

  it('桌面页面来源的 Referer 放行', () => {
    expect(guardRequest(ORIGIN, request({ ...header, referer: 'dsh-app://app/index.html' }))).toEqual({ ok: true })
  })

  it('Sec-Fetch-Site 为 same-origin 时放行', () => {
    expect(guardRequest(ORIGIN, request({ ...header, 'sec-fetch-site': 'same-origin' }))).toEqual({ ok: true })
  })

  it('Sec-Fetch-Site 为 cross-site 时拒绝', () => {
    expect(guardRequest(ORIGIN, request({ ...header, 'sec-fetch-site': 'cross-site' }))).toMatchObject({
      ok: false,
      code: 'wrong-origin',
    })
  })

  it('多个证据里只要有一个不合格就拒绝', () => {
    expect(
      guardRequest(ORIGIN, request({ ...header, origin: ORIGIN, referer: 'http://evil.example/' })),
    ).toMatchObject({ ok: false, code: 'wrong-origin' })
  })
})
