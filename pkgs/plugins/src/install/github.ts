import { z } from 'zod'
import { PluginPathSchema } from '../manifest'
import { PluginUrlSchema } from './url'
import { downloadPluginFile, PluginDownloadError, type PluginSourceReader } from './download'
import type { PluginOrigin } from './origin'

export interface ResolvedPluginSource {
  url: string
  origin: PluginOrigin
}
const CommitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/u) })
const RepositorySchema = z.object({ default_branch: z.string().min(1).max(1000) })
const ReleaseSchema = z.object({
  tag_name: z.string().min(1).max(1000),
  assets: z.array(z.object({ name: z.string(), browser_download_url: PluginUrlSchema }))
})

export async function resolveGitHubSource(
  url: URL,
  signal: AbortSignal,
  read: PluginSourceReader = downloadPluginFile
): Promise<ResolvedPluginSource> {
  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      return decodeURIComponent(part)
    })
  const owner = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/u)
    .parse(parts[0])
  const name = z
    .string()
    .regex(/^[a-zA-Z0-9_.-]+$/u)
    .parse(parts[1]?.replace(/\.git$/iu, ''))
  const repository = 'https://github.com/' + owner + '/' + name
  const api = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(name)
  const tail = parts.slice(2)
  async function json(path: string) {
    signal.throwIfAborted()
    return JSON.parse((await read(api + path, signal, 1024 * 1024)).toString('utf8')) as unknown
  }
  async function commit(ref: string) {
    return CommitSchema.parse(await json('/commits/' + encodeURIComponent(ref))).sha
  }
  async function snapshot(ref: string, directory = ''): Promise<ResolvedPluginSource> {
    if (directory) {
      PluginPathSchema.parse(directory)
    }
    const sha = await commit(ref)
    const origin: PluginOrigin = { kind: 'github-source', repository, ref, commit: sha }
    if (directory) {
      origin.directory = directory
    }
    return { url: 'https://codeload.github.com/' + owner + '/' + name + '/zip/' + sha, origin }
  }
  async function release(path: string, fallback: boolean): Promise<ResolvedPluginSource> {
    let data: z.infer<typeof ReleaseSchema>
    try {
      data = ReleaseSchema.parse(await json(path))
    } catch (error) {
      if (fallback && error instanceof PluginDownloadError && error.status === 404) {
        const info = RepositorySchema.parse(await json(''))
        return snapshot(info.default_branch)
      }
      throw error
    }
    const assets = data.assets.filter((asset) => {
      return asset.name.toLowerCase().endsWith('.zip')
    })
    let selected = assets.find((asset) => {
      return asset.name.toLowerCase() === 'plugin.zip'
    })
    if (!selected && assets.length === 1) {
      selected = assets[0]
    }
    if (selected) {
      return {
        url: selected.browser_download_url,
        origin: { kind: 'github-release', repository, ref: data.tag_name }
      }
    }
    if (assets.length > 1) {
      throw new Error('此 Release 有多个 ZIP，请使用具体下载链接或 /tree/分支 链接')
    }
    return snapshot(data.tag_name)
  }
  if (!tail.length) {
    return release('/releases/latest', true)
  }
  if (tail[0] === 'releases') {
    if (!tail[1] || (tail[1] === 'latest' && tail.length === 2)) {
      return release('/releases/latest', true)
    }
    if (
      (tail[1] === 'download' && tail.length >= 4) ||
      (tail[1] === 'latest' && tail[2] === 'download' && tail.length >= 4)
    ) {
      return { url: url.href, origin: { kind: 'github-release', repository } }
    }
    if (tail[1] === 'tag' && tail.length > 2) {
      return release('/releases/tags/' + encodeURIComponent(tail.slice(2).join('/')), false)
    }
    throw new Error('GitHub Release 链接不完整')
  }
  if (tail[0] === 'commit' && tail.length === 2) {
    return snapshot(tail[1])
  }
  if (tail[0] === 'archive' && tail.length >= 2 && tail.at(-1)!.endsWith('.zip')) {
    return snapshot(tail.slice(1).join('/').slice(0, -4))
  }
  if ((tail[0] === 'tree' || tail[0] === 'blob') && tail.length > 1) {
    let segments = tail.slice(1)
    if (tail[0] === 'blob') {
      if (segments.at(-1) !== 'plugin.json') {
        throw new Error('请提供仓库、目录或 plugin.json 的 GitHub 链接')
      }
      segments = segments.slice(0, -1)
    }
    for (let count = Math.min(segments.length, 12); count >= 1; count--) {
      signal.throwIfAborted()
      const ref = segments.slice(0, count).join('/')
      const directory = segments.slice(count).join('/')
      try {
        return await snapshot(ref, directory)
      } catch (error) {
        if (!(error instanceof PluginDownloadError && [404, 422].includes(error.status))) {
          throw error
        }
      }
    }
    throw new Error('找不到 GitHub 分支、标签、commit 或插件目录')
  }
  throw new Error('请提供 GitHub 仓库、分支/标签、commit、目录或 Release 下载链接')
}
