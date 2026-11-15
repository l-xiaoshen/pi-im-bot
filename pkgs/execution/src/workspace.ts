import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SandboxSchema, ShipyardClient, type Sandbox } from './shipyard-client'

const BindingSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('creating'),
    endpoint: z.string(),
    profile: z.string(),
    requestId: z.string()
  }),
  z.object({ state: z.literal('ready'), endpoint: z.string(), profile: z.string(), sandbox: SandboxSchema })
])
type Binding = z.infer<typeof BindingSchema>
const pending = new Map<string, Promise<Sandbox>>()

export async function openWorkspace(client: ShipyardClient, dataDir: string, scope: string) {
  const id = createHash('sha256').update(scope).digest('hex').slice(0, 32)
  const directory = join(dataDir, 'shipyard-workspaces')
  const path = join(directory, id + '.json')
  const existing = pending.get(path)
  if (existing) {
    return existing
  }
  const task = bindWorkspace(client, directory, path)
  pending.set(path, task)
  try {
    return await task
  } finally {
    pending.delete(path)
  }
}

async function bindWorkspace(client: ShipyardClient, directory: string, path: string) {
  await mkdir(directory, { recursive: true })
  let binding: Binding | undefined
  try {
    binding = BindingSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    const missing = z.object({ code: z.literal('ENOENT') }).safeParse(error)
    if (!missing.success) {
      throw new Error('沙盒工作区绑定文件不可读，已停止文件操作：' + path)
    }
  }
  if (binding) {
    if (binding.endpoint !== client.endpoint || binding.profile !== client.config.profile) {
      throw new Error('当前会话已绑定其他 Shipyard endpoint/profile，请恢复原配置以保留工作区')
    }
    if (binding.state === 'creating') {
      throw new Error('上次沙盒创建结果未确认，请核对工作区绑定后恢复；不会自动创建空工作区')
    }
    const sandbox = await client.get(binding.sandbox.id)
    if (sandbox.cargo_id !== binding.sandbox.cargo_id || sandbox.profile !== binding.profile) {
      throw new Error('沙盒工作区身份不匹配，已停止文件操作')
    }
    assertUsable(sandbox)
    return sandbox
  }
  const requestId = 'pi-im-bot-' + crypto.randomUUID()
  await saveBinding(path, {
    state: 'creating',
    endpoint: client.endpoint,
    profile: client.config.profile,
    requestId
  })
  // Complete and persist allocation even if the requesting run is cancelled.
  // A lost reply remains pending, rather than silently allocating another persistent volume.
  const sandbox = await client.create(client.config.profile, requestId)
  await saveBinding(path, {
    state: 'ready',
    endpoint: client.endpoint,
    profile: client.config.profile,
    sandbox
  })
  assertUsable(sandbox)
  return sandbox
}

function assertUsable(sandbox: Sandbox) {
  if (!sandbox.capabilities.includes('shell') || ['failed', 'expired'].includes(sandbox.status)) {
    throw new Error('Shipyard 工作区不可用：' + sandbox.status)
  }
}

async function saveBinding(path: string, binding: Binding) {
  const temporary = path + '.' + crypto.randomUUID() + '.tmp'
  await writeFile(temporary, JSON.stringify(binding, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, path)
}
