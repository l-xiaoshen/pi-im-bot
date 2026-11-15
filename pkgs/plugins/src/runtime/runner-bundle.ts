import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const workerEntry = Bun.fileURLToPath(import.meta.resolve('@pi-im-bot/plugin-sdk/worker'))

export async function buildPluginRunner(runtimeRoot: string) {
  const result = await Bun.build({
    entrypoints: [workerEntry],
    target: 'bun',
    minify: true
  })
  if (!result.success || result.outputs.length !== 1) {
    throw new Error('插件受管入口构建失败')
  }
  const data = new Uint8Array(await result.outputs[0].arrayBuffer())
  const revision = createHash('sha256').update(data).digest('hex').slice(0, 16)
  const directory = join(runtimeRoot, 'runner', revision)
  await mkdir(directory, { recursive: true })
  await Bun.write(join(directory, 'worker.mjs'), data, { mode: 0o600 })
  return directory
}
