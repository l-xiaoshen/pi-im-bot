import { constants } from 'node:fs'
import { lstat, readdir, realpath, open, mkdir } from 'node:fs/promises'
import { resolve, join, dirname, posix } from 'node:path'
import { createHash } from 'node:crypto'
import { loadSkillsFromDir, type Skill } from '@earendil-works/pi-coding-agent'
import { revision } from '@pi-im-bot/settings/resolve'
import { SkillFilePathSchema, SkillManifestSchema, type SkillConfig, type SkillManifest } from './schema'

const maximumBytes = 32 * 1024 * 1024
const maximumFileBytes = 5 * 1024 * 1024
const ignored = new Set(['.git', 'node_modules', '.venv', '__pycache__'])

export function skillConfigRevision(config: SkillConfig) {
  return revision({ id: config.id, sourceDir: config.sourceDir })
}
export function skillCapabilityId(id: string) {
  return 'skill:' + id
}
export function skillToolName(id: string) {
  return 'skill__' + id.replaceAll('-', '_') + '_' + revision(id).slice(0, 6)
}
export function skillGuestRoot(manifest: SkillManifest) {
  return `/workspace/.bot-skills/${manifest.id}/${manifest.revision}`
}
export function skillPackageRoot(dataDir: string, manifest: SkillManifest) {
  return join(dataDir, 'skill-packages', manifest.id, manifest.revision)
}

export async function importSkill(
  config: SkillConfig,
  projectDir: string,
  dataDir: string
): Promise<SkillManifest> {
  const source = await realpath(resolve(projectDir, config.sourceDir))
  if (!(await lstat(source)).isDirectory()) {
    throw new Error('技能来源不是目录')
  }
  if (!(await Bun.file(join(source, 'SKILL.md')).exists())) {
    throw new Error('技能包根目录必须包含 SKILL.md')
  }
  const contents = new Map<string, Buffer>()
  let bytes = 0
  let entries = 0
  async function scan(directory: string, prefix: string) {
    for (const name of await readdir(directory)) {
      if (ignored.has(name)) {
        continue
      }
      entries += 1
      if (entries > 1000) {
        throw new Error('技能包目录项过多')
      }
      const path = join(directory, name)
      const relative = SkillFilePathSchema.parse(posix.join(prefix, name))
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) {
        throw new Error(`技能包包含符号链接：${relative}`)
      }
      if (stat.isDirectory()) {
        await scan(path, relative)
        continue
      }
      if (!stat.isFile() || stat.size > maximumFileBytes) {
        throw new Error(`技能文件类型或大小不支持：${relative}`)
      }
      if (contents.size >= 200 || bytes + stat.size > maximumBytes) {
        throw new Error('技能包超过 200 个文件或 32 MiB')
      }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const data = await handle.readFile()
        bytes += data.byteLength
        if (data.byteLength > maximumFileBytes || bytes > maximumBytes) {
          throw new Error('技能文件在读取时超出大小限制')
        }
        contents.set(relative, data)
      } finally {
        await handle.close()
      }
    }
  }
  await scan(source, '')
  if (!contents.has('SKILL.md')) {
    throw new Error('技能包根目录必须包含 SKILL.md')
  }
  // Parse the snapshotted file, so metadata and content always describe the same revision.
  const files = [...contents.entries()]
    .sort(([a], [b]) => {
      return a.localeCompare(b)
    })
    .map(([path, data]) => {
      return { path, bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') }
    })
  const version = revision(files)
  const directory = join(dataDir, 'skill-packages', config.id, version)
  for (const [path, data] of contents) {
    const destination = join(directory, path)
    await mkdir(dirname(destination), { recursive: true })
    await Bun.write(destination, data)
  }
  const parsed = loadSkillsFromDir({ dir: directory, source: 'bot-skill' })
  const skill = parsed.skills.find((item) => {
    return item.filePath === join(directory, 'SKILL.md')
  })
  if (!skill) {
    throw new Error('Pi 无法读取此技能的名称与说明，请检查 SKILL.md frontmatter')
  }
  return SkillManifestSchema.parse({
    id: config.id,
    configRevision: skillConfigRevision(config),
    revision: version,
    importedAt: Date.now(),
    name: skill.name,
    description: skill.description,
    disableModelInvocation: skill.disableModelInvocation,
    files
  })
}

export async function readSkillFile(dataDir: string, manifest: SkillManifest, path: string) {
  SkillFilePathSchema.parse(path)
  const file = manifest.files.find((item) => {
    return item.path === path
  })
  if (!file) {
    throw new Error('该文件不在已登记的技能包中')
  }
  let content: ArrayBuffer
  try {
    content = await Bun.file(join(skillPackageRoot(dataDir, manifest), path)).arrayBuffer()
  } catch {
    throw new Error('技能快照文件不可读取，请重新导入技能')
  }
  const bytes = Buffer.from(content)
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error('技能快照文件已被修改，请重新导入技能')
  }
  return bytes
}

export function piSkill(manifest: SkillManifest): Skill {
  const baseDir = skillGuestRoot(manifest)
  const filePath = baseDir + '/SKILL.md'
  return {
    name: manifest.name,
    description: manifest.description,
    filePath,
    baseDir,
    disableModelInvocation: manifest.disableModelInvocation,
    sourceInfo: {
      path: filePath,
      source: 'bot-skill:' + manifest.id,
      scope: 'project',
      origin: 'package',
      baseDir
    }
  }
}
