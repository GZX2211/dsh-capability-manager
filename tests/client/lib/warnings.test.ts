// tests/client/lib/warnings.test.ts
//
// 警告文案归并：同码多角色合并成一行，是「不重复显示」这条要求的核心。

import { describe, expect, it } from 'vitest'
import type { SnapshotWarning, WarningCode } from '../../../src/shared/api.ts'
import { zh } from '../../../src/client/i18n.ts'
import { describeWarnings, unseenLines } from '../../../src/client/lib/warnings.ts'
import type { Translate } from '../../../src/client/i18n.ts'

const t: Translate = key => zh[key]

const warning = (code: WarningCode, roles?: SnapshotWarning['roles']): SnapshotWarning => ({ code, roles })

describe('describeWarnings', () => {
  it('不同码各出一行，保持首次出现顺序', () => {
    const lines = describeWarnings([
      warning('resident-empty'),
      warning('meta-search-excluded'),
    ], t)

    expect(lines).toEqual([zh.warningResidentEmpty, zh.warningMetaSearchExcluded])
  })

  it('同码多角色合并成一行，角色按 router / worker 顺序', () => {
    const lines = describeWarnings([
      warning('blacklist-excludes-resident', ['worker']),
      warning('blacklist-excludes-resident', ['router']),
    ], t)

    expect(lines).toEqual([`${zh.warningBlacklistExcludesResident} · ${zh.roleRouterShort} / ${zh.roleWorkerShort}`])
  })

  it('同码同角色重复出现时角色不重复', () => {
    const lines = describeWarnings([
      warning('blacklist-excludes-resident', ['router']),
      warning('blacklist-excludes-resident', ['router', 'worker']),
    ], t)

    expect(lines).toEqual([`${zh.warningBlacklistExcludesResident} · ${zh.roleRouterShort} / ${zh.roleWorkerShort}`])
  })

  it('没有角色的提示不带角色后缀', () => {
    const lines = describeWarnings([warning('skill-excluded', [])], t)

    expect(lines).toEqual([zh.warningSkillExcluded])
  })

  it('没有提示时返回空数组', () => {
    expect(describeWarnings([], t)).toEqual([])
  })
})

describe('unseenLines', () => {
  it('只挑出尚未提示过的行', () => {
    const lines = [zh.warningResidentEmpty, zh.warningSkillExcluded, zh.warningMetaSearchExcluded]

    expect(unseenLines(lines, new Set([zh.warningSkillExcluded]))).toEqual([
      zh.warningResidentEmpty,
      zh.warningMetaSearchExcluded,
    ])
  })

  it('全部已提示过时返回空数组', () => {
    const lines = [zh.warningResidentEmpty, zh.warningSkillExcluded]

    expect(unseenLines(lines, new Set(lines))).toEqual([])
  })
})
