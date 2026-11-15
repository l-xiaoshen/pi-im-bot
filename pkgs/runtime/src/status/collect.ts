import { cpus, availableParallelism, freemem, totalmem, loadavg, uptime, platform, arch, release } from "node:os"
import { statfs, open } from "node:fs/promises"
import type { Configuration } from "@pi-im-bot/config/load"
import { RuntimeStatusSchema, type RuntimeStatus } from "./schema"
import packageInfo from "../../package.json"
import { probeNvidiaGpu } from "./gpu"

async function procText(path: string) {
  const file = await open(path, "r")
  try {
    const data = Buffer.alloc(512 * 1024)
    const read = await file.read(data, 0, data.length, 0)
    if (read.bytesRead === data.length) {
      throw new Error("Metric exceeds read budget")
    }
    return data.subarray(0, read.bytesRead).toString("utf8")
  } finally {
    await file.close()
  }
}
function cpuTimes() {
  const values = cpus()
  return {
    model: values[0]?.model ?? "CPU",
    count: values.length || availableParallelism(),
    idle: values.reduce((sum, cpu) => {
      return sum + cpu.times.idle
    }, 0),
    total: values.reduce((sum, cpu) => {
      return (
        sum +
        Object.values(cpu.times).reduce((sum, value) => {
          return sum + value
        }, 0)
      )
    }, 0)
  }
}
function percent(used: number, total: number) {
  if (!total) {
    return 0
  }
  return Math.max(0, Math.min(100, (used / total) * 100))
}
let cpuSample: { at: number; promise: Promise<RuntimeStatus["cpu"]> } | undefined
async function sampleCpu() {
  if (cpuSample && Date.now() - cpuSample.at < 1000) {
    return cpuSample.promise
  }
  const promise = (async () => {
    const before = cpuTimes()
    const started = performance.now()
    await Bun.sleep(100)
    const after = cpuTimes()
    const total = after.total - before.total
    let usagePercent: number | null = null
    if (total > 0) {
      usagePercent = percent(total - (after.idle - before.idle), total)
    }
    const loads = loadavg()
    return {
      model: after.model.slice(0, 300),
      logicalCpus: after.count,
      usagePercent,
      sampleMs: Math.max(1, performance.now() - started),
      loadAverage: [loads[0] ?? 0, loads[1] ?? 0, loads[2] ?? 0] as [number, number, number]
    }
  })()
  cpuSample = { at: Date.now(), promise }
  return promise
}
async function swap() {
  const data = await procText("/proc/meminfo")
  const total = /^SwapTotal:\s+(\d+) kB$/mu.exec(data)
  const free = /^SwapFree:\s+(\d+) kB$/mu.exec(data)
  const memory = /^MemAvailable:\s+(\d+) kB$/mu.exec(data)
  if (!total || !free) {
    throw new Error("Swap unavailable")
  }
  let availableMemoryBytes: number | undefined
  if (memory) {
    availableMemoryBytes = Number(memory[1]) * 1024
  }
  return { totalBytes: Number(total[1]) * 1024, availableBytes: Number(free[1]) * 1024, availableMemoryBytes }
}
async function network() {
  const data = await procText("/proc/net/dev")
  let receivedBytes = 0
  let sentBytes = 0
  let count = 0
  for (const line of data.split("\n")) {
    const entry = /^\s*([^:]+):\s*(.+)$/u.exec(line)
    if (!entry || entry[1].trim() === "lo") {
      continue
    }
    const columns = entry[2].trim().split(/\s+/u).map(Number)
    if (columns.length < 16 || !columns.every(Number.isFinite)) {
      continue
    }
    count += 1
    receivedBytes += columns[0]
    sentBytes += columns[8]
  }
  if (!count) {
    throw new Error("Network unavailable")
  }
  return { scope: "visible-interface-counters" as const, receivedBytes, sentBytes }
}

/** No caller-supplied paths, subprocesses, addresses, environment or credentials. */
export async function collectRuntimeStatus(config: Configuration): Promise<RuntimeStatus> {
  const results = await Promise.allSettled([sampleCpu(), swap(), statfs(config.dataDir), network(), probeNvidiaGpu()])
  const [cpu, swapping, disk, traffic, gpu] = results
  const warnings: RuntimeStatus["warnings"] = []
  let cpuValue: RuntimeStatus["cpu"] = {
    model: "CPU",
    logicalCpus: availableParallelism(),
    usagePercent: null,
    sampleMs: 100,
    loadAverage: [0, 0, 0]
  }
  if (cpu.status === "fulfilled") {
    cpuValue = cpu.value
  } else {
    warnings.push("cpu-unavailable")
  }
  let swapValue: RuntimeStatus["swap"] = null
  if (swapping.status === "fulfilled") {
    swapValue = { totalBytes: swapping.value.totalBytes, availableBytes: swapping.value.availableBytes }
  } else {
    warnings.push("swap-unavailable")
  }
  let diskValue: RuntimeStatus["disk"] = null
  if (disk.status === "fulfilled") {
    const stats = disk.value
    diskValue = {
      scope: "bot-data-filesystem",
      totalBytes: stats.blocks * stats.bsize,
      availableBytes: stats.bavail * stats.bsize,
      usedPercent: percent(stats.blocks - stats.bfree, stats.blocks)
    }
  } else {
    warnings.push("disk-unavailable")
  }
  let networkValue: RuntimeStatus["network"] = null
  if (traffic.status === "fulfilled") {
    networkValue = traffic.value
  } else {
    warnings.push("network-unavailable")
  }
  let gpuValue: Awaited<ReturnType<typeof probeNvidiaGpu>>
  if (gpu.status === "fulfilled") {
    gpuValue = gpu.value
  }
  if (!gpuValue) {
    warnings.push("gpu-unavailable")
  }
  const total = totalmem()
  let available = Math.min(total, freemem())
  if (swapping.status === "fulfilled" && swapping.value.availableMemoryBytes !== undefined) {
    available = Math.min(total, swapping.value.availableMemoryBytes)
  }
  const memory = process.memoryUsage()
  const providers = config.catalog.config.providers.filter((provider) => {
    return provider.enabled
  })
  return RuntimeStatusSchema.parse({
    version: 1,
    measuredAt: Date.now(),
    observer: "bot-control-plane",
    system: { platform: platform(), architecture: arch(), kernel: release(), uptimeSeconds: uptime() },
    cpu: cpuValue,
    memory: {
      totalBytes: total,
      availableBytes: available,
      usedBytes: total - available,
      usedPercent: percent(total - available, total)
    },
    swap: swapValue,
    disk: diskValue,
    network: networkValue,
    gpu: gpuValue ?? null,
    bot: {
      name: "Pi IM Bot",
      version: packageInfo.version,
      runtime: "bun",
      runtimeVersion: Bun.version,
      uptimeSeconds: process.uptime(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      pluginsInstalled: config.resources.config.plugins.length,
      pluginsEnabled: config.resources.config.plugins.filter((plugin) => {
        return plugin.enabled
      }).length,
      providersEnabled: providers.length,
      modelsEnabled: providers.flatMap((provider) => {
        return provider.models.filter((model) => {
          return model.enabled
        })
      }).length
    },
    warnings
  })
}
