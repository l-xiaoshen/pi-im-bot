import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { PluginInstanceSchema } from '@pi-im-bot/plugins/config'
import { PluginManifestSchema } from '@pi-im-bot/plugins/manifest'
import { importPlugin, pluginPackageRoot } from '@pi-im-bot/plugins/package'
import { pluginArchive, maxArchiveBytes } from '@pi-im-bot/plugins/install/archive'

const source = process.argv[2]
if (!source) {
  throw new Error('用法：bun run pack:plugin <已构建目录> [输出 ZIP 路径]')
}
const directory = resolve(source)
const manifest = PluginManifestSchema.parse(await Bun.file(join(directory, 'plugin.json')).json())
const root = await mkdtemp('/tmp/pi-plugin-pack-')
const instance = PluginInstanceSchema.parse({ id: manifest.id, name: manifest.name, sourceDir: directory })
const bundle = await importPlugin(instance, process.cwd(), join(root, 'packages'))
const files = new Map<string, Uint8Array>()
for (const file of bundle.files) {
  files.set(file.path, await readFile(join(pluginPackageRoot(join(root, 'packages'), bundle), file.path)))
}
const archive = pluginArchive(files)
if (archive.length > maxArchiveBytes) {
  throw new Error('未压缩 ZIP 超过 32 MiB；请精简或在发布阶段压缩资源')
}
let target = join(root, manifest.id + '-' + manifest.version + '.zip')
if (process.argv[3]) {
  target = resolve(process.argv[3])
}
await mkdir(dirname(target), { recursive: true })
await Bun.write(target, archive, { mode: 0o600 })
console.log(target)
