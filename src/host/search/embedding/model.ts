// src/host/search/embedding/model.ts
//
// 向量模型清单：固定仓库、固定 revision、每个文件的落盘名与校验值。
//
// 校验值是契约的一部分：下载后必须逐字节对上 size 与 sha256，否则删掉重下。
// revision 写成提交号而不是分支名——分支会移动，模型会悄悄换掉，而向量缓存
// 与召回阈值都是针对这一版权重调过的。

import { join } from 'node:path'

/** 模型仓库。 */
export const MODEL_REPO = 'Xenova/bge-small-zh-v1.5'

/** 固定 revision；换模型必须同时换缓存与清单。 */
export const MODEL_REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781'

/** 下载源，按顺序探测；首个 2xx 生效。 */
export const MODEL_SOURCES: readonly string[] = ['https://huggingface.co', 'https://hf-mirror.com']

/** 模型目录里的清单文件名。 */
export const MODEL_MANIFEST_NAME = 'manifest.json'

/** 模型目录名（`<state>/models/<name>`）。 */
export const MODEL_DIRECTORY_NAME = 'bge-small-zh-v1.5'

/** 一个需要下载并校验的文件。 */
export interface ModelFile {
  /** 仓库内路径，用于拼下载地址。 */
  path: string
  /** 落盘名：模型目录是扁平的，源路径里的 `onnx/` 前缀不保留。 */
  fileName: string
  /** 字节数。 */
  size: number
  /** 小写十六进制 sha256。 */
  sha256: string
}

/** 模型文件清单；大小与哈希取自 HF 仓库对该 revision 的元数据。 */
export const MODEL_FILES: readonly ModelFile[] = [
  {
    path: 'onnx/model_quantized.onnx',
    fileName: 'model_quantized.onnx',
    size: 24010842,
    sha256: '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc',
  },
  {
    path: 'tokenizer.json',
    fileName: 'tokenizer.json',
    size: 439125,
    sha256: '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26',
  },
  {
    path: 'config.json',
    fileName: 'config.json',
    size: 716,
    sha256: 'd4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f',
  },
]

/** 落盘后的清单：记录这目录里的文件对应哪个 revision。 */
export interface ModelManifest {
  repo: string
  revision: string
  files: ModelFile[]
}

/**
 * 模型目录路径。
 *
 * @param stateDir - 插件状态目录。
 * @returns `<state>/models/bge-small-zh-v1.5`。
 */
export function modelDirOf(stateDir: string): string {
  return join(stateDir, 'models', MODEL_DIRECTORY_NAME)
}

/**
 * 某个文件的下载地址。
 *
 * @param origin - 源站（不含尾斜杠）。
 * @param file - 清单项。
 * @returns `<origin>/<repo>/resolve/<revision>/<path>`。
 */
export function sourceUrl(origin: string, file: ModelFile): string {
  return `${origin}/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file.path}`
}
