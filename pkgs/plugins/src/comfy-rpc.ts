import { comfyCatalog } from "@pi-im-bot/integrations/comfy/catalog"
import type { PluginHostServices } from "./rpc/services"
import type { PluginInvocation } from "./invocation"
import type { PluginBinding } from "./registry"
import type { ArtifactStore } from "@pi-im-bot/artifacts/store"
import type { PluginManagedServices } from "./managed"
import { ComfyInputSchema } from "@pi-im-bot/integrations/comfy/protocol"
import { comfyRevision, workflowDigest } from "@pi-im-bot/integrations/comfy/resources"
import type { Receipt } from "@pi-im-bot/integrations/comfy/documents"
import type { PluginAction } from "./rpc/protocol"

export function registerComfy(
  host: PluginHostServices,
  invocation: PluginInvocation,
  binding: PluginBinding,
  artifacts: ArtifactStore,
  authorizeGrant: (grant: string) => void,
  used: Set<string>,
  managed: PluginManagedServices | undefined,
  phase: PluginAction["phase"]
) {
  for (const connection of binding.bundle.manifest.connections) {
    if (connection.kind !== "service" || connection.service !== "comfy@1") {
      continue
    }
    const alias = connection.alias
    host.register("service:" + alias, "service:" + alias, ComfyInputSchema, async (input, context) => {
      const id = binding.instance.services[alias]
      const service = invocation.config.resources.config.comfyServices.find((entry) => {
        return entry.id === id
      })
      if (!service?.enabled) {
        throw new Error("Comfy服务未绑定或停用")
      }
      const check = () => {
        authorizeGrant("service:" + alias)
        invocation.services.authorize("comfy_generate")
      }
      authorizeGrant("service:" + alias)
      if (input.action === "catalog") {
        invocation.services.authorize("comfy_catalog")
        used.add("comfy_catalog")
        return comfyCatalog(
          invocation.config.resources.config.workflows.filter((workflow) => {
            return service.workflows.includes(workflow.id)
          }),
          input
        )
      }
      if (!managed || !invocation.input.context.jobId || !invocation.input.context.jobRevision) {
        throw new Error("Comfy提交/核对必须属于受管Job")
      }
      if (invocation.readOnly) {
        throw new Error("只读Hook不能提交或下载Comfy结果")
      }
      const owner = {
        instance: binding.instance.id,
        room: invocation.room.id,
        job: invocation.input.context.jobId,
        revision: invocation.input.context.jobRevision
      }
      check()
      used.add("comfy_generate")
      authorizeGrant("artifact.write")
      if (input.action === "submit") {
        if (phase !== "execute") {
          throw new Error("recover/poll/cancel阶段不能重新提交")
        }
        const workflow = invocation.config.resources.config.workflows.find((entry) => {
          return entry.id === input.workflow && service.workflows.includes(entry.id)
        })
        if (!workflow) {
          throw new Error("工作流未绑定到此服务")
        }
        return managed.comfy.submit(
          owner,
          alias,
          input.item,
          service,
          workflow,
          input.parameters,
          artifacts,
          context.signal,
          check
        )
      }
      return managed.comfy.inspect(
        owner,
        alias,
        input.item,
        input.action,
        artifacts,
        context.signal,
        (receipt: Receipt) => {
          check()
          if (receipt.service.id !== id || receipt.serviceRevision !== comfyRevision(service)) {
            throw new Error("原服务执行快照与绑定不匹配，未跨服务核对")
          }
        },
        phase === "reconcile" || input.action === "reconcile"
      )
    })
  }
}
