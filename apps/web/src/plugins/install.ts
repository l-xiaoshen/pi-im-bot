import { z } from "zod"
import { node, button } from "./dom"
import { field, showDialog } from "../dom"
import { request } from "../api"
import { PluginInstallUrlSchema } from "@pi-im-bot/plugins/install/url"
import { InstallationSchema, InstallationListSchema, type Installation } from "@pi-im-bot/plugins/install/contracts"

export async function watchInstallation(
  container: HTMLElement,
  id: string,
  finished: (job: Installation) => Promise<void>,
  notify: (value: unknown) => void
) {
  const labels = {
    queued: "排队中",
    downloading: "解析并下载插件",
    verifying: "校验包与配置定义",
    applying: "应用固定版本",
    succeeded: "安装完成",
    failed: "安装失败",
    cancelled: "已取消",
    interrupted: "安装中断"
  }
  try {
    for (;;) {
      if (!container.isConnected) {
        return
      }
      const jobs = await request("/api/plugins/installations", InstallationListSchema)
      const job = jobs.find((job) => {
        return job.id === id
      })
      if (!job) {
        throw new Error("安装任务记录不存在")
      }
      container.replaceChildren(node("strong", "", job.name), node("span", "muted", labels[job.stage]))
      if (["succeeded", "failed", "cancelled", "interrupted"].includes(job.stage)) {
        if (job.error) {
          container.append(node("p", "form-error", job.error))
        }
        await finished(job)
        return
      }
      if (job.stage !== "applying") {
        container.append(
          button(
            "取消安装",
            () => {
              void request("/api/plugins/installations/" + id + "/cancel", InstallationSchema, {
                method: "POST"
              }).catch(notify)
            },
            "button secondary small"
          )
        )
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 500)
      })
    }
  } catch (error) {
    notify(error)
  }
}
export function installDialog(
  revision: string,
  installed: (job: Installation) => Promise<void>,
  notify: (error: unknown) => void
) {
  const method = node("select")
  for (const [value, title] of [
    ["url", "GitHub 仓库或发布包链接"],
    ["zip", "上传 ZIP 发布包"],
    ["directory", "开发者：本机已构建目录"]
  ]) {
    const option = node("option", "", title)
    option.value = value
    method.append(option)
  }
  const url = node("input")
  url.placeholder = "https://github.com/作者/仓库，可指定分支、标签或目录"
  const archive = node("input")
  archive.type = "file"
  archive.accept = ".zip,application/zip"
  const directory = node("input")
  directory.placeholder = "包含 plugin.json 的已构建目录"
  const controls = node("div")
  const hint = node(
    "p",
    "muted",
    "GitHub 仓库无需先发布 Release；支持 .git、分支/标签、commit、目录和 Release 链接。仓库需包含 plugin.json 与可运行的 JS/TS 入口，依赖须随包提供。首次安装保持停用。"
  )
  const feedback = node("div", "install-progress")
  let dialog: HTMLDialogElement
  function render() {
    controls.replaceChildren()
    if (method.value === "url") {
      controls.append(field("插件来源链接", url))
    }
    if (method.value === "zip") {
      controls.append(field("ZIP 发布包", archive))
    }
    if (method.value === "directory") {
      controls.append(field("开发目录", directory))
    }
  }
  method.addEventListener("change", render)
  render()
  dialog = showDialog("安装插件", [field("获取方式", method), controls, hint, feedback], "开始安装", async () => {
    let job: Installation
    if (method.value === "zip") {
      const file = archive.files?.[0]
      if (!file) {
        throw new Error("请选择 ZIP 文件")
      }
      const form = new FormData()
      form.set("revision", revision)
      form.set("archive", file)
      job = await request("/api/plugins/install/upload", InstallationSchema, { method: "POST", body: form })
    } else {
      const source: { revision: string; url?: string; directory?: string } = { revision }
      if (method.value === "url") {
        source.url = PluginInstallUrlSchema.parse(url.value)
      } else {
        source.directory = z.string().min(1).parse(directory.value)
      }
      job = await request("/api/plugins/install", InstallationSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(source)
      })
    }
    dialog.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = true
    })
    await watchInstallation(feedback, job.id, installed, notify)
  })
}
