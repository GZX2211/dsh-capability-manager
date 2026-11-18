// tests/host/search/embedding/model.test.ts
//
// 模型清单与下载地址：固定 revision、三类文件的落盘名、多源 URL 构造。

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MODEL_FILES,
  MODEL_MANIFEST_NAME,
  MODEL_REPO,
  MODEL_REVISION,
  MODEL_SOURCES,
  modelDirOf,
  sourceUrl,
} from '../../../../src/host/search/embedding/model.ts'

describe('模型清单', () => {
  it('每个文件都有源路径、落盘名、大小与 sha256', () => {
    for (const file of MODEL_FILES) {
      expect(file.path.length).toBeGreaterThan(0)
      expect(file.fileName.length).toBeGreaterThan(0)
      expect(file.size).toBeGreaterThan(0)
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('落盘名不含目录：模型目录是扁平的', () => {
    for (const file of MODEL_FILES) {
      expect(file.fileName).not.toContain('/')
    }
  })

  it('落盘名互不重复', () => {
    const names = MODEL_FILES.map(file => file.fileName)

    expect(new Set(names).size).toBe(names.length)
  })

  it('恰好是方案要求的三个文件', () => {
    expect(MODEL_FILES.map(file => file.fileName).sort()).toEqual(['config.json', 'model_quantized.onnx', 'tokenizer.json'])
  })

  it('revision 是固定提交号而不是分支名', () => {
    expect(MODEL_REVISION).toMatch(/^[0-9a-f]{40}$/)
  })

  it('清单同名文件记录在 manifest 文件名上', () => {
    expect(MODEL_MANIFEST_NAME).toBe('manifest.json')
  })
})

describe('下载地址', () => {
  const [primary, mirror] = MODEL_SOURCES
  const [weights] = MODEL_FILES
  if (primary === undefined || mirror === undefined || weights === undefined) {
    throw new Error('模型清单缺少主源、镜像或第一个文件')
  }

  it('按 <origin>/<repo>/resolve/<revision>/<path> 拼接', () => {
    expect(sourceUrl(primary, weights)).toBe(`${primary}/${MODEL_REPO}/resolve/${MODEL_REVISION}/${weights.path}`)
  })

  it('两个源都能构造出同一个文件的地址', () => {
    const urls = [primary, mirror].map(origin => sourceUrl(origin, weights))

    expect(new Set(urls).size).toBe(2)
  })

  it('主源是 huggingface，镜像兜底', () => {
    expect(primary).toContain('huggingface.co')
    expect(mirror).toContain('hf-mirror.com')
  })
})

describe('模型目录', () => {
  it('放在状态目录的 models/<model> 下', () => {
    expect(modelDirOf(join('/state', 'capability-manager'))).toBe(
      join('/state', 'capability-manager', 'models', 'bge-small-zh-v1.5'),
    )
  })
})
