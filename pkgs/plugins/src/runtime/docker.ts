import { z } from 'zod'

interface PluginBindMount {
  Type: 'bind'
  Source: string
  Target: string
  ReadOnly: boolean
  BindOptions?: { ReadOnlyNonRecursive: true }
}

interface PluginContainerReference {
  id: string
  name: string
}

export interface PluginContainerSpec {
  Image: string
  Cmd: string[]
  Entrypoint: string[]
  User: string
  WorkingDir: string
  Env: string[]
  Labels: Record<string, string>
  HostConfig: {
    NetworkMode: 'none'
    ReadonlyRootfs: true
    Privileged: false
    CapDrop: ['ALL']
    SecurityOpt: ['no-new-privileges:true']
    Init: true
    Memory: number
    MemorySwap: number
    NanoCpus: number
    PidsLimit: number
    Tmpfs: Record<string, string>
    Mounts: PluginBindMount[]
    LogConfig: {
      Type: 'json-file'
      Config: {
        'max-size': string
        'max-file': string
      }
    }
  }
}
export interface PluginContainerBackend {
  image(reference: string, signal: AbortSignal): Promise<string>
  create(name: string, spec: PluginContainerSpec, signal: AbortSignal): Promise<string>
  start(id: string, name: string, signal: AbortSignal): Promise<void>
  destroy(id: string, name: string, owner: string): Promise<void>
  owned(owner: string): Promise<PluginContainerReference[]>
}
const ContainerSchema = z.object({
  Id: z.string(),
  Name: z.string(),
  Config: z.object({ Labels: z.record(z.string(), z.string()).nullable() })
})

export class DockerPluginBackend implements PluginContainerBackend {
  constructor(private readonly socketPath: string) {}

  private async request(path: string, method: string, body?: object, signal?: AbortSignal) {
    const response = await fetch('http://localhost' + path, {
      unix: this.socketPath,
      method,
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      const content = await response.text()
      throw new Error(`Docker ${response.status}: ${content.slice(0, 1500)}`)
    }
    return response
  }
  async image(reference: string, signal: AbortSignal) {
    const version = z
      .object({ ApiVersion: z.string().regex(/^\d+\.\d+$/u) })
      .parse(await (await this.request('/version', 'GET', undefined, signal)).json())
    const [major, minor] = version.ApiVersion.split('.').map(Number)
    if (major < 1 || (major === 1 && minor < 44)) {
      throw new Error('插件数据隔离需要 Docker API 1.44 或更高版本')
    }
    const response = await this.request(
      '/images/' + encodeURIComponent(reference) + '/json',
      'GET',
      undefined,
      signal
    )
    return z.object({ Id: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).parse(await response.json()).Id
  }
  async create(name: string, spec: PluginContainerSpec, signal: AbortSignal) {
    console.info(`Container Change Notice: ${name} — create isolated plugin worker`)
    const response = await this.request(
      '/containers/create?name=' + encodeURIComponent(name),
      'POST',
      spec,
      signal
    )
    return z.object({ Id: z.string() }).parse(await response.json()).Id
  }
  async start(id: string, name: string, signal: AbortSignal) {
    console.info(`Container Change Notice: ${name} — start plugin worker`)
    await this.request('/containers/' + encodeURIComponent(id) + '/start', 'POST', undefined, signal)
  }
  async destroy(id: string, name: string, owner: string) {
    const response = await fetch('http://localhost/containers/' + encodeURIComponent(id) + '/json', {
      unix: this.socketPath,
      signal: AbortSignal.timeout(10000)
    })
    if (response.status === 404) {
      return
    }
    if (!response.ok) {
      throw new Error('无法核对插件容器归属')
    }
    const container = ContainerSchema.parse(await response.json())
    if (container.Config.Labels?.['io.pi-im.plugin-owner'] !== owner || container.Name !== '/' + name) {
      throw new Error('拒绝修改非本实例持有的容器')
    }
    console.info(`Container Change Notice: ${name} — stop and remove owned plugin worker`)
    await this.request('/containers/' + encodeURIComponent(id) + '?force=1&v=1', 'DELETE')
  }
  async owned(owner: string) {
    const filters = encodeURIComponent(JSON.stringify({ label: ['io.pi-im.plugin-owner=' + owner] }))
    const response = await this.request('/containers/json?all=1&filters=' + filters, 'GET')
    const rows = z
      .array(
        z.object({ Id: z.string(), Names: z.array(z.string()), Labels: z.record(z.string(), z.string()) })
      )
      .parse(await response.json())
    return rows
      .filter((row) => {
        return row.Labels['io.pi-im.plugin-owner'] === owner
      })
      .map((row) => {
        return { id: row.Id, name: (row.Names[0] ?? '').replace(/^\//u, '') }
      })
  }
}
