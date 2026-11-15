import { createNodePhotonImages } from '@earendil-works/pi-durable/images/node'
import type { ImageProcessor } from '@earendil-works/pi-durable/tools'

export interface ProjectedImage {
  data: string
  mimeType: string
  originalWidth: number
  originalHeight: number
  width: number
  height: number
  wasResized: boolean
}

let processor: Promise<ImageProcessor> | undefined

function images() {
  processor ??= createNodePhotonImages().catch((error) => {
    processor = undefined
    throw error
  })
  return processor
}

function dimensions(data: Buffer) {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: 'image/png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  if (data.length >= 10 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) {
    return { mimeType: 'image/gif', width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  }
  if (
    data.length >= 30 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    const format = data.subarray(12, 16).toString('ascii')
    if (format === 'VP8X') {
      return { mimeType: 'image/webp', width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 }
    }
    if (format === 'VP8 ' && data.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) {
      return {
        mimeType: 'image/webp',
        width: data.readUInt16LE(26) & 0x3fff,
        height: data.readUInt16LE(28) & 0x3fff
      }
    }
    if (format === 'VP8L' && data[20] === 47) {
      const value = data.readUInt32LE(21)
      return { mimeType: 'image/webp', width: (value & 0x3fff) + 1, height: ((value >>> 14) & 0x3fff) + 1 }
    }
  }
  if (data[0] === 255 && data[1] === 216) {
    let offset = 2
    while (offset + 4 <= data.length) {
      if (data[offset] !== 255) {
        break
      }
      while (data[offset] === 255) {
        offset += 1
      }
      const marker = data[offset++]
      if (marker === 217 || marker === 218) {
        break
      }
      if (marker === 1 || (marker >= 208 && marker <= 215)) {
        continue
      }
      if (offset + 2 > data.length) {
        break
      }
      const length = data.readUInt16BE(offset)
      if (length < 2 || offset + length > data.length) {
        break
      }
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        return {
          mimeType: 'image/jpeg',
          height: data.readUInt16BE(offset + 3),
          width: data.readUInt16BE(offset + 5)
        }
      }
      offset += length
    }
  }
  throw new Error('只支持有效的 PNG、JPEG、GIF 或 WebP 图片')
}

export function inspectImage(bytes: Uint8Array) {
  const image = dimensions(Buffer.from(bytes))
  if (
    !image.width ||
    !image.height ||
    image.width > 16384 ||
    image.height > 16384 ||
    image.width * image.height > 32000000
  ) {
    throw new Error('图片尺寸超过解码预算（单边 16384、3200 万像素）')
  }
  return image
}

export async function projectImage(
  bytes: Uint8Array,
  maxSide: number,
  maxBytes: number
): Promise<ProjectedImage> {
  const image = inspectImage(bytes)
  const imageProcessor = await images()
  const prepared = await imageProcessor.prepare(bytes, image.mimeType, {
    maxWidth: maxSide,
    maxHeight: maxSide,
    maxBytes
  })
  if (!prepared) {
    throw new Error('图片无法在当前像素预算内解码')
  }
  const from = prepared.resized?.from ?? image
  const to = prepared.resized?.to ?? image
  return {
    data: prepared.data,
    mimeType: prepared.mimeType,
    originalWidth: from.width,
    originalHeight: from.height,
    width: to.width,
    height: to.height,
    wasResized: prepared.resized !== undefined
  }
}

export function formatDimensionNote(image: ProjectedImage) {
  if (!image.wasResized) {
    return undefined
  }
  const scale = image.originalWidth / image.width
  return `[Image: original ${image.originalWidth}x${image.originalHeight}, displayed at ${image.width}x${image.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`
}
