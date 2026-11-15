import type { BotTool } from "@pi-im-bot/capabilities/tool"
import { isUtf8 } from "node:buffer"
import { z } from "zod"
import { obj, str, opt } from "@earendil-works/pi-schema"
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent"
import type { ResourceLibrary } from "../library"
import type { PreparedRunInput } from "@pi-im-bot/contracts/run"
import type { ArtifactStore } from "@pi-im-bot/artifacts/store"
import { SkillFilePathSchema } from "./schema"
import { requestedSkill } from "./invocation"
import { piSkill, skillCapabilityId, skillGuestRoot, skillToolName, readSkillFile } from "./package"

export type SkillUploader = (path: string, content: Uint8Array, signal?: AbortSignal) => Promise<void>
const SkillInputSchema = z.object({ path: SkillFilePathSchema.default("SKILL.md") })

export function createSkillTools(
  library: ResourceLibrary,
  dataDir: string,
  input: PreparedRunInput,
  artifacts: ArtifactStore,
  upload?: SkillUploader
) {
  const requested = requestedSkill(input.text)
  const manifests = library.skills(input.context.effective.settings).filter((manifest) => {
    return (
      input.context.authority.capabilities.includes(skillCapabilityId(manifest.id)) &&
      (!manifest.disableModelInvocation || requested === manifest.id)
    )
  })
  const names = new Map(
    manifests.map((manifest) => {
      return [skillToolName(manifest.id), skillCapabilityId(manifest.id)]
    })
  )
  const tools: BotTool[] = manifests.map((manifest) => {
    let installed: Promise<void> | undefined
    async function install(signal?: AbortSignal) {
      if (!upload) {
        return
      }
      for (const file of manifest.files) {
        signal?.throwIfAborted()
        const data = await readSkillFile(dataDir, manifest, file.path)
        const relative = skillGuestRoot(manifest).slice("/workspace/".length) + "/" + file.path
        await upload(relative, data, signal)
      }
    }
    return {
      name: skillToolName(manifest.id),
      label: "Skill · " + manifest.name,
      description: `Load skill ${manifest.name}: ${manifest.description}\nCall with {} to load SKILL.md and stage its package in the remote workspace. Set path to read another relative package file. Capability ID: ${skillCapabilityId(manifest.id)}`,
      namespace: { name: "skills", description: "可配置的技能说明与沙盒脚本" },
      parameters: obj({ path: opt(str()) }),
      async execute(_id, args, signal) {
        signal?.throwIfAborted()
        const { path } = SkillInputSchema.parse(args)
        installed ??= install(signal)
        await installed
        const data = await readSkillFile(dataDir, manifest, path)
        const details = { skillId: manifest.id, revision: manifest.revision, staged: Boolean(upload), path }
        let environment = "脚本执行未配置。资源文件可用本工具的 path 参数继续读取。"
        if (upload) {
          environment = `技能目录：${skillGuestRoot(manifest)}。相对引用和脚本都在这个容器目录下，使用容器文件/Shell 工具访问。`
        }
        if (!isUtf8(data) || data.includes(0)) {
          const artifact = await artifacts.save(path, "application/octet-stream", skillCapabilityId(manifest.id), data)
          return {
            content: [{ type: "text", text: `${environment}\n二进制资源已保存，产物 ID：${artifact.id}` }],
            details
          }
        }
        let text = data.toString("utf8")
        if (text.length > 16000) {
          const artifact = await artifacts.save(path, "text/plain", skillCapabilityId(manifest.id), text)
          text = text.slice(0, 16000) + `\n完整文件产物 ID：${artifact.id}，可通过 artifact_read 分页读取。`
        }
        return { content: [{ type: "text", text: `${environment}\n\n${text}` }], details }
      }
    }
  })
  const metadata = formatSkillsForPrompt(manifests.map(piSkill), "indirect")
  let prompt = metadata
  if (input.context.effective.settings.resources.toolExposure === "deferred") {
    prompt = `${manifests.length} Skill packages are available through tool_search. Search by task or skill name to load the matching skill__ tool.`
  }
  return {
    tools,
    prompt:
      prompt +
      "\nLoad a listed skill using its skill__ tool; the loader stages the package in the sandbox when execution is configured. Never try to open skill source paths on the Bot host.",
    capabilityFor(name: string) {
      return names.get(name) ?? name
    }
  }
}
