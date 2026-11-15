import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { PluginPathSchema } from '../manifest'

/** Every component is opened relative to an existing directory descriptor. */
export async function openPluginDataFile(root: string, relative: string) {
  const parts = PluginPathSchema.parse(relative).split('/')
  let directory: FileHandle = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  try {
    for (const part of parts.slice(0, -1)) {
      const next = await open(
        '/proc/self/fd/' + directory.fd + '/' + part,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      )
      await directory.close()
      directory = next
    }
    const file = await open(
      '/proc/self/fd/' + directory.fd + '/' + parts.at(-1),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      if (!(await file.stat()).isFile()) {
        throw new Error('插件产物来源不是普通文件')
      }
      return file
    } catch (error) {
      await file.close()
      throw error
    }
  } finally {
    await directory.close()
  }
}
