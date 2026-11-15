import { inflateRawSync } from "node:zlib"
import { mkdir, writeFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { PluginPathSchema } from "../manifest"
import { assertSharePath } from "@pi-im-bot/support/share-path"

export const maxArchiveBytes = 32 * 1024 * 1024
const maxFileBytes = 16 * 1024 * 1024
const maxTotalBytes = 64 * 1024 * 1024
interface ZipEntry {
  name: string
  offset: number
  compressed: number
  size: number
  method: number
  crc: number
  flags: number
}

function entries(data: Buffer) {
  if (data.length > maxArchiveBytes) {
    throw new Error("发布包超过 32 MiB")
  }
  let end = -1
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65557); index--) {
    if (data.readUInt32LE(index) === 0x06054b50 && index + 22 + data.readUInt16LE(index + 20) === data.length) {
      end = index
      break
    }
  }
  if (end < 0) {
    throw new Error("ZIP 目录不完整")
  }
  const count = data.readUInt16LE(end + 10)
  if (
    data.readUInt16LE(end + 4) !== 0 ||
    data.readUInt16LE(end + 6) !== 0 ||
    data.readUInt16LE(end + 8) !== count ||
    count > 2004
  ) {
    throw new Error("不支持分卷、ZIP64 或超过数量预算的 ZIP")
  }
  const start = data.readUInt32LE(end + 16)
  if (start + data.readUInt32LE(end + 12) !== end) {
    throw new Error("ZIP 目录偏移无效")
  }
  let cursor = start
  let bytes = 0
  const names = new Set<string>()
  const result: ZipEntry[] = []
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("ZIP 目录条目损坏")
    }
    const nameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > end) {
      throw new Error("ZIP 名称越界")
    }
    const name = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(cursor + 46, cursor + 46 + nameLength))
    let checked = name
    if (name.endsWith("/")) {
      checked = name.slice(0, -1)
    }
    PluginPathSchema.parse(checked)
    const mode = (data.readUInt32LE(cursor + 38) >>> 16) & 0xf000
    if (![0, 0x8000, 0x4000].includes(mode) || (mode === 0x4000 && !name.endsWith("/"))) {
      throw new Error("ZIP 不接受链接或特殊文件")
    }
    if (names.has(checked)) {
      throw new Error("ZIP 中存在重复路径")
    }
    names.add(checked)
    const entry = {
      name,
      flags: data.readUInt16LE(cursor + 8),
      method: data.readUInt16LE(cursor + 10),
      crc: data.readUInt32LE(cursor + 16),
      compressed: data.readUInt32LE(cursor + 20),
      size: data.readUInt32LE(cursor + 24),
      offset: data.readUInt32LE(cursor + 42)
    }
    if (
      entry.flags & 1 ||
      ![0, 8].includes(entry.method) ||
      entry.size > maxFileBytes ||
      entry.compressed > maxArchiveBytes ||
      entry.offset + 30 > start
    ) {
      throw new Error("ZIP 加密、压缩方式或文件大小不支持")
    }
    bytes += entry.size
    if (bytes > maxTotalBytes) {
      throw new Error("发布包展开后超过 64 MiB")
    }
    if (
      data.readUInt32LE(entry.offset) !== 0x04034b50 ||
      data.readUInt16LE(entry.offset + 8) !== entry.method ||
      data.readUInt16LE(entry.offset + 6) !== entry.flags
    ) {
      throw new Error("ZIP 文件头与目录不一致")
    }
    const localNameLength = data.readUInt16LE(entry.offset + 26)
    const payload = entry.offset + 30 + localNameLength + data.readUInt16LE(entry.offset + 28)
    if (
      payload + entry.compressed > start ||
      new TextDecoder("utf-8", { fatal: true }).decode(
        data.subarray(entry.offset + 30, entry.offset + 30 + localNameLength)
      ) !== name
    ) {
      throw new Error("ZIP 文件内容越界")
    }
    result.push({ ...entry, offset: payload })
    cursor = next
  }
  if (cursor !== end) {
    throw new Error("ZIP 目录长度不一致")
  }
  return result
}
export async function unpackPluginArchive(
  data: Uint8Array,
  directory: string,
  signal: AbortSignal,
  selectedDirectory?: string
) {
  const buffer = Buffer.from(data)
  let files = entries(buffer)
  let prefix = ""
  if (selectedDirectory !== undefined) {
    if (selectedDirectory) {
      PluginPathSchema.parse(selectedDirectory)
    }
    const root = files[0]?.name.split("/")[0]
    if (
      !root ||
      files.some((entry) => {
        return !entry.name.startsWith(root + "/")
      })
    ) {
      throw new Error("GitHub 源码包须包含单一仓库根目录")
    }
    prefix = root + "/"
    if (selectedDirectory) {
      prefix += selectedDirectory + "/"
    }
    if (
      !files.some((entry) => {
        return entry.name === prefix + "plugin.json"
      })
    ) {
      throw new Error("所选 GitHub 目录没有 plugin.json；请提供本框架插件的仓库或具体插件目录链接")
    }
    files = files.filter((entry) => {
      return entry.name.startsWith(prefix)
    })
  } else {
    const manifests = files.filter((entry) => {
      return entry.name === "plugin.json" || entry.name.endsWith("/plugin.json")
    })
    if (manifests.length !== 1) {
      throw new Error("发布包须包含唯一的 plugin.json")
    }
    prefix = manifests[0].name.slice(0, -"plugin.json".length)
    if (
      files.some((entry) => {
        return !entry.name.startsWith(prefix) && entry.name + "/" !== prefix
      })
    ) {
      throw new Error("发布包须使用单一插件根目录")
    }
  }
  let total = 0
  await mkdir(directory, { recursive: true, mode: 0o700 })
  for (const entry of files) {
    signal.throwIfAborted()
    if (entry.name.endsWith("/")) {
      continue
    }
    const relative = PluginPathSchema.parse(entry.name.slice(prefix.length))
    const compressed = buffer.subarray(entry.offset, entry.offset + entry.compressed)
    let content: Buffer = compressed
    if (entry.method === 8) {
      content = inflateRawSync(compressed, { maxOutputLength: maxFileBytes })
    }
    if (content.length !== entry.size || Bun.hash.crc32(content) >>> 0 !== entry.crc) {
      throw new Error("ZIP 文件长度或校验失败")
    }
    total += content.length
    if (total > maxTotalBytes) {
      throw new Error("解包超过存储预算")
    }
    const path = join(directory, relative)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, content, { flag: "wx", mode: 0o600 })
  }
}

export function pluginArchive(files: ReadonlyMap<string, Uint8Array>) {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [path, bytes] of files) {
    PluginPathSchema.parse(path)
    assertSharePath(path)
    const name = Buffer.from(path)
    const content = Buffer.from(bytes)
    const crc = Bun.hash.crc32(content) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(0x314, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(0x800, 8)
    record.writeUInt32LE(crc, 16)
    record.writeUInt32LE(content.length, 20)
    record.writeUInt32LE(content.length, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE(0x81a40000, 38)
    record.writeUInt32LE(offset, 42)
    central.push(record, name)
    parts.push(local, name, content)
    offset += local.length + name.length + content.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}
