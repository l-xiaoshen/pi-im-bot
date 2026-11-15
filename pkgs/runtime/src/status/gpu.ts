import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { GpuStatusSchema, type GpuStatus } from './schema'

const nvidiaSmi = '/usr/bin/nvidia-smi'
const nvidiaQuery = [
  '--query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw',
  '--format=csv,noheader,nounits'
]

function numeric(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'N/A' || trimmed === '[Not Supported]') {
    return null
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseNvidiaSmiCsv(text: string): GpuStatus | undefined {
  const devices = text
    .split('\n')
    .map((line) => {
      const fields = line.split(',').map((field) => field.trim())
      if (fields.length < 7) {
        return undefined
      }
      const nameEnd = fields.length - 5
      const index = numeric(fields[0])
      const totalMiB = numeric(fields[nameEnd])
      const usedMiB = numeric(fields[nameEnd + 1])
      if (index === null || totalMiB === null || usedMiB === null) {
        return undefined
      }
      return {
        index,
        name: fields.slice(1, nameEnd).join(', ').slice(0, 300),
        memoryTotalBytes: Math.max(0, Math.round(totalMiB * 1024 * 1024)),
        memoryUsedBytes: Math.max(0, Math.round(usedMiB * 1024 * 1024)),
        utilizationPercent: numeric(fields[nameEnd + 2]),
        temperatureC: numeric(fields[nameEnd + 3]),
        powerWatts: numeric(fields[nameEnd + 4])
      }
    })
    .filter((device): device is NonNullable<typeof device> => {
      return device !== undefined
    })
  if (devices.length === 0) {
    return undefined
  }
  return GpuStatusSchema.parse({ provider: 'nvidia', source: 'nvidia-smi', devices })
}

/**
 * Probe the Bot control plane's NVIDIA runtime with fixed arguments.
 * The plugin Worker never receives a GPU device, socket, command or raw output.
 */
export async function probeNvidiaGpu(): Promise<GpuStatus | undefined> {
  try {
    await access(nvidiaSmi, constants.X_OK)
  } catch {
    return undefined
  }
  const child = Bun.spawn([nvidiaSmi, ...nvidiaQuery], {
    cwd: '/',
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore'
  })
  const output = new Response(child.stdout).text()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, 1500)
  try {
    const [code, text] = await Promise.race([
      Promise.all([child.exited, output]),
      Bun.sleep(1600).then(() => {
        return [-1, ''] as const
      })
    ])
    if (timedOut || code !== 0 || text.length > 64 * 1024) {
      return undefined
    }
    return parseNvidiaSmiCsv(text)
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
    if (timedOut) {
      await child.exited.catch(() => {})
    }
  }
}
