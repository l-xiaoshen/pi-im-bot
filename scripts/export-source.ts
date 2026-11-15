import { copyFile, mkdir, lstat } from 'node:fs/promises'
import { resolve, join, dirname, relative, isAbsolute } from 'node:path'
import { z } from 'zod'
import { assertSharePath } from '@pi-im-bot/support/share-path'

const project = resolve(process.argv[2] ?? '.')
const output = resolve(z.string().min(1).parse(process.argv[3]))
const inside = relative(project, output)
if (inside === '' || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('../'))) {
  throw new Error('输出必须位于源码目录之外')
}
const result = Bun.spawnSync(
  ['git', '-C', project, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { stdout: 'pipe', stderr: 'pipe' }
)
if (result.exitCode !== 0) {
  throw new Error('无法读取 Git 源码文件清单；从仓库根目录运行')
}
const files = [...new Set(result.stdout.toString().split('\0').filter(Boolean))]
const selected: string[] = []
for (const path of files) {
  if (excluded(path)) {
    continue
  }
  assertSharePath(path)
  const source = join(project, path)
  if (!(await lstat(source)).isFile()) {
    throw new Error('源码导出只接受普通文件：' + path)
  }
  selected.push(path)
}
await mkdir(output)
for (const path of selected) {
  const target = join(output, path)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(join(project, path), target)
}
console.log('Exported ' + selected.length + ' source files to ' + output)

function excluded(path: string) {
  const parts = path.toLowerCase().split('/')
  for (const part of parts) {
    if (
      [
        '.git',
        '.codex',
        'agents.md',
        'agents.override.md',
        'private-review',
        'node_modules',
        '.dev-source'
      ].includes(part)
    ) {
      return true
    }
    if (part.startsWith('.env') && part !== '.env.example') {
      return true
    }
    if (/\.(?:key|pem|log|zip|tar|tar\.gz|tgz|7z|rar)$/u.test(part)) {
      return true
    }
  }
  if (/^(?:data|plugin-data|dist|artifacts)\//u.test(path)) {
    return true
  }
  if (path.startsWith('config/') && !/^config\/[^/]+\.example\.json$/u.test(path)) {
    return true
  }
  return false
}
