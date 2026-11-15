import { chmodSync, existsSync } from 'node:fs'

export function privateSqliteFiles(path: string) {
  if (path === ':memory:') {
    return
  }
  for (const name of [path, path + '-wal', path + '-shm']) {
    if (existsSync(name)) {
      chmodSync(name, 0o600)
    }
  }
}
