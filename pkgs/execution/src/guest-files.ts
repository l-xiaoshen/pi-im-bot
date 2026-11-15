// This fixed helper is sent to Node in Shipyard, never executed by the Bot host.
// File payloads travel as a separate, shell-quoted argument. Large writes use upload.
const SCRIPT = `
import * as fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
const input = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'))
let path = input.path
if (path === '~') { path = homedir() }
if (path.startsWith('~/')) { path = resolve(homedir(), path.slice(2)) }
path = resolve('/workspace', path)
try {
  let result
  if (input.operation === 'resolve') {
    result = { path }
  } else if (input.operation === 'read') {
    const handle = await fs.open(path, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) { throw new Error('Not a regular file') }
      if (stat.size > input.maxBytes) { throw new Error('File exceeds transfer limit') }
      const buffer = Buffer.alloc(input.maxBytes + 1)
      let size = 0
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, null)
        if (read.bytesRead === 0) { break }
        size += read.bytesRead
      }
      if (size > input.maxBytes) { throw new Error('File exceeds transfer limit') }
      result = { data: buffer.subarray(0, size).toString('base64') }
    } finally { await handle.close() }
  } else if (input.operation === 'write') {
    try {
      await fs.mkdir(dirname(path), { recursive: true })
      await fs.copyFile(input.source, path)
      result = { ok: true }
    } finally { await fs.unlink(input.source).catch(() => {}) }
  } else if (input.operation === 'mkdir') {
    await fs.mkdir(path, { recursive: true })
    result = { ok: true }
  } else if (input.operation === 'stat') {
    const stat = await fs.stat(path)
    result = { directory: stat.isDirectory() }
  } else if (input.operation === 'list') {
    const entries = []
    for (const item of await fs.readdir(path, { withFileTypes: true })) {
      let directory = item.isDirectory()
      if (item.isSymbolicLink()) {
        const target = await fs.stat(resolve(path, item.name)).catch(() => null)
        if (target) { directory = target.isDirectory() }
      }
      entries.push({ name: item.name, directory })
    }
    result = { entries }
  } else { throw new Error('Unknown file operation') }
  console.log(JSON.stringify(result))
} catch (error) {
  console.log(JSON.stringify({ error: String(error.message), code: error.code }))
  process.exitCode = 1
}
`

type FileRequest =
  | {
      operation: 'resolve' | 'mkdir' | 'stat' | 'list'
      path: string
    }
  | {
      operation: 'read'
      path: string
      maxBytes: number
    }
  | {
      operation: 'write'
      path: string
      source: string
    }

export function fileCommand(input: FileRequest) {
  return (
    'node --input-type=module -e ' +
    shellQuote(SCRIPT) +
    ' ' +
    shellQuote(Buffer.from(JSON.stringify(input)).toString('base64'))
  )
}

export function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}
