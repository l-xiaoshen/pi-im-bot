import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { join } from "node:path"
import type { Configuration } from "@pi-im-bot/config/load"
import type { PluginRuntimeConfig } from "./config"
import { DockerPluginBackend } from "./docker"
import type { PluginEnvironment } from "./contracts"

async function executable(path: string) {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
export async function probePluginEnvironment(config: Configuration, runtime: PluginRuntimeConfig) {
  const checks: PluginEnvironment["checks"] = []
  for (const [id, name, path] of [
    ["format", "文件系统格式化工具", runtime.storage.formatCommand],
    ["check", "文件系统检查工具", runtime.storage.checkCommand],
    ["mount", "插件数据挂载工具", runtime.storage.mountCommand],
    ["unmount", "插件数据卸载工具", runtime.storage.unmountCommand]
  ]) {
    checks.push({ id, name, detail: path, ready: await executable(path) })
  }
  let fuse = false
  try {
    await access("/dev/fuse", constants.R_OK | constants.W_OK)
    fuse = process.platform === "linux"
  } catch {}
  checks.push({ id: "fuse", name: "FUSE 设备访问", detail: "/dev/fuse", ready: fuse })
  try {
    await new DockerPluginBackend(runtime.socketPath).image(runtime.image, AbortSignal.timeout(4000))
    checks.push({ id: "docker", name: "Docker 与 Worker 镜像", detail: runtime.image, ready: true })
  } catch {
    checks.push({
      id: "docker",
      name: "Docker 与 Worker 镜像",
      detail: "无法访问 Docker API 1.44+ 或本地镜像 " + runtime.image,
      ready: false
    })
  }
  let suggestedMountCommand: string | undefined
  if (!(await executable(runtime.storage.mountCommand))) {
    const prepared = join(config.dataDir, "tools/fuse2fs/1.47.2-3+b12/usr/bin/fuse2fs")
    if (await executable(prepared)) {
      suggestedMountCommand = prepared
    }
  }
  return {
    checks,
    suggestedMountCommand,
    ready: checks.every((check) => {
      return check.ready
    })
  }
}
