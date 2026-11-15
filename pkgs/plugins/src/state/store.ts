import { defineDocFamily, type Tx } from "@earendil-works/pi-durable"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { z } from "zod"
import { revision } from "@pi-im-bot/settings/resolve"
import type { DurableAgentRuntime } from "@pi-im-bot/agent/durable/runtime"
const EntrySchema = z.object({ version: z.number().int().nonnegative(), value: z.json() })
const NamespaceSchema = z.object({ entries: z.record(z.string(), EntrySchema) })
const PluginState = defineDocFamily<z.infer<typeof NamespaceSchema>, null>({
  kind: "bot.plugin-state",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ entries: {} }),
  checkpointWhen: () => true
})
export const StateKeySchema = z
  .object({ area: z.enum(["scope", "instance"]), key: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u) })
  .strict()
export const StateCompareSchema = StateKeySchema.extend({
  version: z.number().int().nonnegative(),
  value: z.json(),
  comfyReceipt: z
    .object({ alias: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/u), item: z.number().int().min(0).max(15) })
    .strict()
    .optional()
}).strict()
export class PluginStateStore {
  constructor(private readonly runtime: DurableAgentRuntime) {}
  private namespace(instance: string, room: string, area: "scope" | "instance") {
    if (area === "instance") {
      return revision([instance, area])
    }
    return revision([instance, area, room])
  }
  async read(instance: string, room: string, input: z.infer<typeof StateKeySchema>) {
    const stored = await this.runtime.native.snapshot(
      PluginState,
      this.namespace(instance, room, input.area),
      BACKGROUND_CONTEXT
    )
    const entry = stored?.entries[input.key]
    if (!entry) {
      return { version: 0, value: null }
    }
    return EntrySchema.parse(entry)
  }
  async compare(
    instance: string,
    room: string,
    input: z.infer<typeof StateCompareSchema>,
    authorize: () => void,
    record?: (tx: Tx) => Promise<boolean>
  ) {
    if (Buffer.byteLength(JSON.stringify(input.value)) > 32768) {
      throw new Error("状态值超过32KiB额度")
    }
    return this.runtime.native.commit(async (tx) => {
      authorize()
      const doc = await tx.doc(PluginState, this.namespace(instance, room, input.area), null)
      const current = doc.entries[input.key]
      let version = 0
      if (current) {
        version = current.version
      }
      if (version !== input.version) {
        return { applied: false, version }
      }
      if (record && !(await record(tx))) {
        return { applied: true, version, duplicate: true }
      }
      const entries = {
        ...NamespaceSchema.parse(doc).entries,
        [input.key]: { version: version + 1, value: input.value }
      }
      if (Object.keys(entries).length > 64 || Buffer.byteLength(JSON.stringify(entries)) > 131072) {
        throw new Error("状态命名空间超过64键/128KiB额度")
      }
      doc.entries = entries
      return { applied: true, version: version + 1 }
    }, BACKGROUND_CONTEXT)
  }
}
