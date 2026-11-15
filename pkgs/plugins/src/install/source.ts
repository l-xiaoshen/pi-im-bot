import { PluginInstallUrlSchema } from './url'
import { resolveGitHubSource, type ResolvedPluginSource } from './github'
import { downloadPluginFile, type PluginSourceReader } from './download'

export { downloadPluginFile } from './download'
export async function resolvePluginSource(
  input: string,
  signal: AbortSignal,
  read: PluginSourceReader = downloadPluginFile
): Promise<ResolvedPluginSource> {
  const url = new URL(PluginInstallUrlSchema.parse(input))
  if (['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
    url.protocol = 'https:'
    url.hostname = 'github.com'
    return resolveGitHubSource(url, signal, read)
  }
  return { url: url.href, origin: { kind: 'url' } }
}
