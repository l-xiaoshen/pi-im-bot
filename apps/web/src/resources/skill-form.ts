import { element, field, showDialog } from "../dom"
import { SkillConfigSchema, type SkillConfig } from "@pi-im-bot/resources/skills/schema"
import type { SkillView } from "@pi-im-bot/resources/contracts"

export function editSkill(skill: SkillView | undefined, save: (skill: SkillConfig) => Promise<void>) {
  const id = element("input")
  id.required = true
  id.pattern = "[a-z][a-z0-9_-]{0,47}"
  id.value = skill?.id ?? ""
  id.disabled = Boolean(skill)
  const name = element("input")
  name.required = true
  name.value = skill?.name ?? ""
  const source = element("input")
  source.required = true
  source.value = skill?.sourceDir ?? ""
  source.placeholder = "skills/my-skill 或 Bot 机器上的目录绝对路径"
  const enabled = element("select")
  enabled.setAttribute("aria-label", "状态")
  for (const [value, label] of [
    ["false", "停用"],
    ["true", "启用"]
  ]) {
    const option = element("option", "", label)
    option.value = value
    enabled.append(option)
  }
  enabled.value = String(skill?.enabled ?? false)
  showDialog(
    "Skill 包",
    [
      field("Skill ID", id),
      field("名称", name),
      field("来源目录", source),
      field("状态", enabled),
      element("p", "muted", "目录根部需有 SKILL.md。导入保存固定版本；说明与文件按需提供给 Agent，脚本在现有沙盒执行。")
    ],
    "保存 Skill",
    async () => {
      await save(
        SkillConfigSchema.parse({
          id: id.value,
          name: name.value,
          sourceDir: source.value,
          enabled: enabled.value === "true"
        })
      )
    }
  )
}
