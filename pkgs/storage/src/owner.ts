import { Database } from 'bun:sqlite'
import { join } from 'node:path'

/** SQLite's OS-held lock also works across container PID namespaces and releases on crashes. */
export class RuntimeOwner {
  private readonly database: Database

  constructor(dataDir: string) {
    this.database = new Database(join(dataDir, 'runtime-owner.sqlite'), { create: true })
    try {
      this.database.exec('PRAGMA busy_timeout=1000')
      this.database.exec('PRAGMA locking_mode=EXCLUSIVE')
      this.database.exec('BEGIN EXCLUSIVE')
      this.database.exec('CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY, pid INTEGER)')
      this.database.query('INSERT OR REPLACE INTO owner(id,pid) VALUES (1,?)').run(process.pid)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.close()
      throw new Error('Bot 数据目录已被其他进程使用，不能同时运行两个写入实例', { cause: error })
    }
  }

  close() {
    this.database.close()
  }
}
