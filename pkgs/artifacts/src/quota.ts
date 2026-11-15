import { z } from "zod"
import { mkdir, readdir, lstat, open, rename, unlink } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { RunLimiter } from "@pi-im-bot/support/limiter"
import { ArtifactLimitsSchema, type ArtifactLimits } from "./limits"

const EntrySchema = z
  .object({
    id: z.uuid(),
    scope: z.string().regex(/^[a-f0-9]{24}$/u),
    producer: z.string().max(100).default("core"),
    bytes: z.number().int().nonnegative(),
    state: z.enum(["pending", "ready", "orphan"]),
    owner: z.string().max(512).optional()
  })
  .strict()
const LedgerSchema = z
  .object({ version: z.literal(1), entries: z.array(EntrySchema) })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(
        value.entries.map((entry) => {
          return entry.id
        })
      ).size !== value.entries.length
    ) {
      context.addIssue({ code: "custom", message: "产物额度账本包含重复 ID" })
    }
  })
type Entry = z.infer<typeof EntrySchema>
const budgets = new Map<string, ArtifactBudget>()

export function artifactBudget(dataDir: string) {
  const root = resolve(dataDir, "artifacts")
  let budget = budgets.get(root)
  if (!budget) {
    budget = new ArtifactBudget(root, ArtifactLimitsSchema.parse({}))
    budgets.set(root, budget)
  }
  return budget
}
export function configureArtifacts(dataDir: string, limits: ArtifactLimits) {
  artifactBudget(dataDir).configure(limits)
}

export class ArtifactBudget {
  get maximumFileBytes() {
    return this.limits.maxFileBytes
  }
  private readonly lock = new RunLimiter(1)
  private entries?: Entry[]
  constructor(
    private readonly root: string,
    private limits: ArtifactLimits
  ) {}
  configure(limits: ArtifactLimits) {
    this.limits = ArtifactLimitsSchema.parse(limits)
  }

  private async save(entries: readonly Entry[]) {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const target = join(this.root, "quota.json")
    const temporary = target + "." + crypto.randomUUID() + ".tmp"
    const file = await open(temporary, "wx", 0o600)
    try {
      await file.writeFile(JSON.stringify({ version: 1, entries }))
      await file.sync()
    } finally {
      await file.close()
    }
    try {
      await rename(temporary, target)
    } finally {
      await unlink(temporary).catch(() => {})
    }
    const directory = await open(this.root, "r")
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }
  private async initialize() {
    if (this.entries) {
      return
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const file = Bun.file(join(this.root, "quota.json"))
    if (await file.exists()) {
      let entries = LedgerSchema.parse(await file.json()).entries
      for (const entry of entries) {
        if (entry.state !== "pending") {
          continue
        }
        const base = join(this.root, entry.scope, entry.id)
        const metadata = Bun.file(base + ".json")
        const binary = Bun.file(base + ".bin")
        if ((await metadata.exists()) && (await binary.exists())) {
          const info = await lstat(base + ".bin")
          if (!info.isFile() || info.isSymbolicLink()) {
            throw new Error("产物目录存在异常文件")
          }
          const saved = z
            .object({ id: z.uuid(), roomId: z.string(), bytes: z.number().int().nonnegative() })
            .parse(await metadata.json())
          if (
            saved.id !== entry.id ||
            createHash("sha256").update(saved.roomId).digest("hex").slice(0, 24) !== entry.scope ||
            saved.bytes !== info.size
          ) {
            throw new Error("未完成产物元数据不一致，未自动释放或重建")
          }
          entry.state = "ready"
          entry.bytes = info.size
          continue
        }
        for (const suffix of [".tmp", ".bin", ".json.tmp"]) {
          await unlink(base + suffix).catch((error) => {
            if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) {
              throw error
            }
          })
        }
        if (entry.owner) {
          const directory = join(
            this.root,
            entry.scope,
            "owners",
            createHash("sha256").update(entry.owner).digest("hex")
          )
          for (const suffix of [".json", ".json.tmp"]) {
            await unlink(join(directory, entry.id + suffix)).catch((error) => {
              if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) {
                throw error
              }
            })
          }
        }
      }
      entries = entries.filter((entry) => {
        return entry.state !== "pending"
      })
      await this.save(entries)
      this.entries = entries
      return
    }
    const entries: Entry[] = []
    for (const directory of await readdir(this.root, { withFileTypes: true })) {
      if (!directory.isDirectory() || !/^[a-f0-9]{24}$/u.test(directory.name)) {
        continue
      }
      for (const name of await readdir(join(this.root, directory.name))) {
        const parsed = z.uuid().safeParse(name.replace(/\.bin$/u, ""))
        if (!name.endsWith(".bin") || !parsed.success) {
          continue
        }
        const info = await lstat(join(this.root, directory.name, name))
        if (!info.isFile() || info.isSymbolicLink()) {
          throw new Error("产物目录存在异常文件，额度初始化已停止")
        }
        let state: Entry["state"] = "orphan"
        if (await Bun.file(join(this.root, directory.name, parsed.data + ".json")).exists()) {
          state = "ready"
        }
        entries.push({ id: parsed.data, scope: directory.name, producer: "core", bytes: info.size, state })
      }
    }
    await this.save(entries)
    this.entries = entries
  }

  async reserve(scope: string, id: string, bytes: number, owner?: string, producer = "core", signal?: AbortSignal) {
    const release = await this.lock.acquire(signal)
    try {
      await this.initialize()
      const entries = this.entries!
      const own = entries.filter((entry) => {
        return entry.scope === scope
      })
      const produced = entries.filter((entry) => {
        return entry.producer === producer
      })
      if (
        entries.some((entry) => {
          return entry.id === id
        })
      ) {
        throw new Error("产物 ID 已登记")
      }
      if (
        bytes > this.limits.maxFileBytes ||
        own.reduce((sum, entry) => {
          return sum + entry.bytes
        }, 0) +
          bytes >
          this.limits.maxScopeBytes ||
        produced.reduce((sum, entry) => {
          return sum + entry.bytes
        }, 0) +
          bytes >
          this.limits.maxProducerBytes ||
        entries.reduce((sum, entry) => {
          return sum + entry.bytes
        }, 0) +
          bytes >
          this.limits.maxTotalBytes ||
        own.length >= this.limits.maxScopeItems ||
        produced.length >= this.limits.maxProducerItems ||
        entries.length >= this.limits.maxTotalItems
      ) {
        throw new Error("产物存储额度已满或文件超过上限")
      }
      if (
        entries.filter((entry) => {
          return entry.state === "pending"
        }).length >= this.limits.maxPending
      ) {
        throw new Error("产物写入并发额度已满")
      }
      const entry = EntrySchema.parse({ scope, id, bytes, state: "pending", owner, producer })
      signal?.throwIfAborted()
      const next = [...entries, entry]
      await this.save(next)
      this.entries = next
      return {
        commit: () => {
          return this.finish(id, true)
        },
        cancel: () => {
          return this.finish(id, false)
        }
      }
    } finally {
      release()
    }
  }
  private async finish(id: string, committed: boolean) {
    const release = await this.lock.acquire()
    try {
      const entry = this.entries!.find((entry) => {
        return entry.id === id
      })
      if (!entry) {
        return
      }
      let next = this.entries!.filter((entry) => {
        return entry.id !== id
      })
      if (committed) {
        next = this.entries!.map((entry) => {
          if (entry.id === id) {
            return { ...entry, state: "ready" as const }
          }
          return entry
        })
      }
      await this.save(next)
      this.entries = next
    } finally {
      release()
    }
  }
  async status() {
    const release = await this.lock.acquire()
    try {
      await this.initialize()
      return {
        limits: this.limits,
        bytes: this.entries!.reduce((sum, entry) => {
          return sum + entry.bytes
        }, 0),
        items: this.entries!.length,
        pending: this.entries!.filter((entry) => {
          return entry.state === "pending"
        }).length
      }
    } finally {
      release()
    }
  }
  async reconcile() {
    const release = await this.lock.acquire()
    try {
      await this.initialize()
      if (
        this.entries!.some((entry) => {
          return entry.state === "pending"
        })
      ) {
        throw new Error("仍有正在发布的产物，请稍后核对")
      }
      const next: Entry[] = []
      for (const entry of this.entries!) {
        try {
          const info = await lstat(join(this.root, entry.scope, entry.id + ".bin"))
          if (!info.isFile() || info.isSymbolicLink()) {
            throw new Error("产物目录包含异常文件，未释放额度")
          }
          next.push({ ...entry, bytes: info.size })
        } catch (error) {
          if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) {
            throw error
          }
        }
      }
      await this.save(next)
      this.entries = next
    } finally {
      release()
    }
    return this.status()
  }
}
