/** Accept bounded, complete uncompressed PCM / IEEE float RIFF WAVE files. */
export function validateWav(bytes: Uint8Array) {
  const data = Buffer.from(bytes)
  if (
    data.length < 44 ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WAVE' ||
    data.readUInt32LE(4) + 8 !== data.length
  ) {
    throw new Error('无效的 WAV')
  }
  let format = false
  let audio = false
  let blockAlign = 0
  let offset = 12
  while (offset + 8 <= data.length) {
    const name = data.toString('ascii', offset, offset + 4)
    const size = data.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > data.length) {
      throw new Error('WAV 内容截断')
    }
    if (name === 'fmt ') {
      if (size < 16 || format) {
        throw new Error('WAV 格式错误')
      }
      const code = data.readUInt16LE(start)
      const channels = data.readUInt16LE(start + 2)
      const rate = data.readUInt32LE(start + 4)
      const bits = data.readUInt16LE(start + 14)
      blockAlign = data.readUInt16LE(start + 12)
      if (
        ![1, 3].includes(code) ||
        channels < 1 ||
        channels > 8 ||
        rate < 8000 ||
        rate > 192000 ||
        ![8, 16, 24, 32].includes(bits) ||
        (code === 3 && bits !== 32) ||
        blockAlign !== (channels * bits) / 8 ||
        data.readUInt32LE(start + 8) !== rate * blockAlign
      ) {
        throw new Error('不支持的 WAV 格式')
      }
      format = true
    }
    if (name === 'data') {
      if (!format || !size || size % blockAlign !== 0 || audio) {
        throw new Error('WAV 音频数据错误')
      }
      audio = true
    }
    offset = start + size + (size % 2)
  }
  if (!format || !audio || offset !== data.length) {
    throw new Error('WAV 缺少完整音频')
  }
}
