import type { PluginAction } from "./rpc/protocol"
import type { PluginInvocation } from "./invocation"
import type { PluginBinding } from "./registry"
import type { PluginHostServices } from "./rpc/services"
import type { ArtifactStore } from "@pi-im-bot/artifacts/store"
import { GsviInputSchema } from "@pi-im-bot/integrations/gsvi/schema"
import { callGsvi } from "@pi-im-bot/integrations/gsvi/client"
import { catalogueReference, readCatalogue } from "@pi-im-bot/integrations/gsvi/catalogue"
import { GsviCatalogueReadSchema } from "@pi-im-bot/integrations/gsvi/catalogue-contract"

export function registerPluginServices(
  host: PluginHostServices,
  invocation: PluginInvocation,
  binding: PluginBinding,
  artifacts: ArtifactStore,
  authorizeGrant: (grant: string) => void,
  used: Set<string>,
  phase: PluginAction["phase"] = "execute"
) {
  let calls = 0
  let syntheses = 0
  for (const connection of binding.bundle.manifest.connections) {
    if (connection.kind !== "service" || connection.service !== "gsvi@1") {
      continue
    }
    const alias = connection.alias
    host.register("service:" + alias, "service:" + alias, GsviInputSchema, async (input, context) => {
      if (input.action === "synthesize" && phase !== "execute") {
        throw new Error("恢复/轮询阶段禁止重新合成")
      }
      if (invocation.readOnly) {
        throw new Error("此切入点不能调用语音服务")
      }
      const id = binding.instance.services[alias]
      const service = invocation.config.resources.config.services.find((entry) => {
        return entry.id === id
      })
      if (!service?.enabled || connection.service !== "gsvi@1") {
        throw new Error("具名语音服务未绑定或不可用")
      }
      const capability = "tts_" + input.action
      const authorize = () => {
        context.signal.throwIfAborted()
        authorizeGrant("service:" + alias)
        invocation.services.authorize(capability)
        if (input.action === "synthesize") {
          authorizeGrant("artifact.write")
        }
      }
      authorize()
      calls += 1
      if (input.action === "synthesize") {
        syntheses += 1
      }
      if (calls > 4 || syntheses > 1) {
        throw new Error("本次具名语音服务调用额度已用完")
      }
      used.add(capability)
      const result = await callGsvi(structuredClone(service), input, artifacts, context.signal, authorize)
      if (result.status === "voices" && input.action === "voices") {
        return catalogueReference(artifacts, binding.instance.id, service, input.version, result.models, authorize)
      }
      return result
    })
    host.register(
      "service:" + alias + "/catalogue",
      "service:" + alias,
      GsviCatalogueReadSchema,
      async (input, context) => {
        if (invocation.readOnly) {
          throw new Error("此切入点不能读取语音目录")
        }
        const service = invocation.config.resources.config.services.find(
          (entry) => entry.id === binding.instance.services[alias]
        )
        if (!service?.enabled) {
          throw new Error("目录原服务不可用")
        }
        const authorize = () => {
          context.signal.throwIfAborted()
          authorizeGrant("service:" + alias)
          invocation.services.authorize("tts_voices")
          used.add("tts_voices")
        }
        return readCatalogue(artifacts, binding.instance.id, service, input, context.signal, authorize)
      }
    )
  }
}
