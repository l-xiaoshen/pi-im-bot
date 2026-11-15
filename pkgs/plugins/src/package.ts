import { constants } from "node:fs"
import { lstat, realpath, open, readlink, mkdir, rename, rm } from "node:fs/promises"
import { resolve, join, dirname, relative, sep } from "node:path"
import { createHash } from "node:crypto"
import { PluginManifestSchema, type PluginManifest } from "./manifest"
import { PluginPackageSchema, type PluginInstance, type PluginPackage } from "./config"
import { pluginSourceRevision } from "./identity"
import { revision } from "@pi-im-bot/settings/resolve"
import { parseConfigDefinition, type ConfigDefinition } from "./configuration/schema"
import type { PluginOrigin } from "./install/origin"

const maxPackageBytes = 64 * 1024 * 1024
const maxFileBytes = 16 * 1024 * 1024

async function packageFile(root: string, path: string) {
  const target = join(root, path)
  const parts = path.split("/")
  let cursor = root
  for (const part of parts) {
    cursor = join(cursor, part)
    const info = await lstat(cursor)
    if (info.isSymbolicLink()) {
      throw new Error("插件包不接受符号链接：" + path)
    }
    if (cursor === target && !info.isFile()) {
      throw new Error("插件包只接受普通文件：" + path)
    }
  }
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxFileBytes) {
      throw new Error("插件文件类型或大小不支持：" + path)
    }
    if (process.platform === "linux") {
      const actual = await readlink("/proc/self/fd/" + handle.fd)
      const within = relative(root, actual)
      if (within === ".." || within.startsWith(".." + sep) || resolve(root, within) !== actual) {
        throw new Error("插件文件离开了包目录")
      }
    }
    const buffer = Buffer.alloc(info.size + 1)
    let bytes = 0
    while (bytes < buffer.length) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, bytes)
      if (result.bytesRead === 0) {
        break
      }
      bytes += result.bytesRead
    }
    if (bytes > info.size) {
      throw new Error("插件文件在读取时变大，未导入不完整快照")
    }
    return buffer.subarray(0, bytes)
  } finally {
    await handle.close()
  }
}

export function pluginPackageRoot(pluginRoot: string, descriptor: Pick<PluginPackage, "instanceId" | "revision">) {
  return join(pluginRoot, descriptor.instanceId, descriptor.revision)
}

export async function importPlugin(
  instance: PluginInstance,
  projectDir: string,
  pluginRoot: string,
  origin?: PluginOrigin
): Promise<PluginPackage> {
  const source = await realpath(resolve(projectDir, instance.sourceDir))
  if (!(await lstat(source)).isDirectory()) {
    throw new Error("插件来源不是目录")
  }
  const manifestBytes = await packageFile(source, "plugin.json")
  if (manifestBytes.length > 1024 * 1024) {
    throw new Error("插件声明超过 1 MiB")
  }
  const manifest = PluginManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")))
  if (!/\.(?:[cm]?js|[cm]?ts)$/u.test(manifest.entry)) {
    throw new Error("插件入口须为 JavaScript 或 TypeScript；依赖须随包提供，安装不会执行构建脚本")
  }
  const contents = new Map<string, Buffer>([["plugin.json", manifestBytes]])
  let bytes = manifestBytes.length
  const paths = new Set(manifest.files)
  for (const path of ["_conf_schema.json", "README.md", "CHANGELOG.md"]) {
    try {
      await lstat(join(source, path))
      paths.add(path)
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error
      }
    }
  }
  for (const path of paths) {
    if (path === "plugin.json") {
      continue
    }
    const data = await packageFile(source, path)
    if (path === "_conf_schema.json" && data.length > 256 * 1024) {
      throw new Error("配置 schema 超过 256 KiB")
    }
    bytes += data.length
    if (bytes > maxPackageBytes) {
      throw new Error("插件包超过 64 MiB")
    }
    contents.set(path, data)
  }
  let configuration: ConfigDefinition | undefined
  const schema = contents.get("_conf_schema.json")
  if (schema) {
    configuration = parseConfigDefinition(JSON.parse(schema.toString("utf8")))
  }
  const files = [...contents]
    .map(([path, data]) => {
      return { path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") }
    })
    .sort((a, b) => {
      return a.path.localeCompare(b.path)
    })
  const descriptor = PluginPackageSchema.parse({
    instanceId: instance.id,
    configRevision: pluginSourceRevision(instance),
    revision: revision(files),
    importedAt: Date.now(),
    manifest,
    configuration,
    origin,
    files
  })
  const target = pluginPackageRoot(pluginRoot, descriptor)
  const temporary = target + "." + crypto.randomUUID() + ".tmp"
  await mkdir(temporary, { recursive: true })
  try {
    for (const [path, data] of contents) {
      await mkdir(dirname(join(temporary, path)), { recursive: true })
      await Bun.write(join(temporary, path), data, { mode: 0o600 })
    }
    await Bun.write(join(temporary, "package-index.json"), JSON.stringify(descriptor), { mode: 0o600 })
    await mkdir(dirname(target), { recursive: true })
    if (await Bun.file(join(target, "package-index.json")).exists()) {
      await verifyPlugin(pluginRoot, descriptor)
    } else {
      await rename(temporary, target)
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  return descriptor
}

export async function verifyPlugin(
  pluginRoot: string,
  descriptor: PluginPackage,
  signal?: AbortSignal
): Promise<PluginManifest> {
  descriptor = PluginPackageSchema.parse(descriptor)
  const root = await realpath(pluginPackageRoot(pluginRoot, descriptor))
  let manifest: PluginManifest | undefined
  for (const file of descriptor.files) {
    signal?.throwIfAborted()
    const data = await packageFile(root, file.path)
    if (data.length !== file.bytes || createHash("sha256").update(data).digest("hex") !== file.sha256) {
      throw new Error("插件快照内容已变化，拒绝执行：" + file.path)
    }
    if (file.path === "plugin.json") {
      manifest = PluginManifestSchema.parse(JSON.parse(data.toString("utf8")))
    }
    if (
      file.path === "_conf_schema.json" &&
      revision(parseConfigDefinition(JSON.parse(data.toString("utf8")))) !== revision(descriptor.configuration)
    ) {
      throw new Error("插件配置 schema 与快照不一致")
    }
  }
  if (revision(descriptor.files) !== descriptor.revision) {
    throw new Error("插件版本摘要不匹配")
  }
  if (!manifest || revision(manifest) !== revision(descriptor.manifest)) {
    throw new Error("插件声明与快照不一致")
  }
  return manifest
}
