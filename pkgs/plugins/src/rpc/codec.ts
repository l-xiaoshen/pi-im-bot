export const maximumPluginFrameBytes = 512 * 1024

export function encodePluginFrame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value))
  if (body.length > maximumPluginFrameBytes) {
    throw new Error('插件 RPC 帧超过 512 KiB')
  }
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length)
  return Buffer.concat([header, body])
}

/** Length framing copies each byte once and rejects an oversized allocation before reading its body. */
export class PluginFrameReader {
  private readonly header = Buffer.alloc(4)
  private headerBytes = 0
  private body?: Buffer
  private bodyBytes = 0
  feed(chunk: Uint8Array, receive: (value: unknown, bytes: number) => void) {
    let offset = 0
    while (offset < chunk.byteLength) {
      if (!this.body) {
        const count = Math.min(4 - this.headerBytes, chunk.byteLength - offset)
        this.header.set(chunk.subarray(offset, offset + count), this.headerBytes)
        offset += count
        this.headerBytes += count
        if (this.headerBytes < 4) {
          continue
        }
        const length = this.header.readUInt32BE(0)
        if (length < 2 || length > maximumPluginFrameBytes) {
          throw new Error('插件 RPC 帧长度无效')
        }
        this.body = Buffer.alloc(length)
      }
      const count = Math.min(this.body.length - this.bodyBytes, chunk.byteLength - offset)
      this.body.set(chunk.subarray(offset, offset + count), this.bodyBytes)
      this.bodyBytes += count
      offset += count
      if (this.bodyBytes === this.body.length) {
        const text = this.body.toString('utf8')
        const bytes = this.body.length + 4
        this.body = undefined
        this.bodyBytes = 0
        this.headerBytes = 0
        receive(JSON.parse(text), bytes)
      }
    }
  }
}
