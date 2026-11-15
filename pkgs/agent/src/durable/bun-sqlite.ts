import { Database } from "bun:sqlite"
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite"
import { privateSqliteFiles } from "@pi-im-bot/storage/private-file"

/** Serial async facade required by durable; transaction callbacks use only their scoped executor. */
export class BunSqliteDatabase implements SqliteDatabase {
  private readonly database: Database
  private line = Promise.resolve()
  private closing = false

  constructor(path: string) {
    this.database = new Database(path, { create: true, strict: true })
    privateSqliteFiles(path)
    this.database.exec("PRAGMA journal_mode=WAL")
    this.database.exec("PRAGMA foreign_keys=ON")
    this.database.exec("PRAGMA busy_timeout=2500")
  }

  exec(sql: string) {
    return this.enqueue(async () => {
      this.database.exec(sql)
    })
  }
  run(sql: string, ...params: SqliteValue[]) {
    return this.enqueue(async () => {
      this.database.query(sql).run(...params)
    })
  }
  runCounted(sql: string, ...params: SqliteValue[]) {
    return this.enqueue(async () => {
      return this.database.query(sql).run(...params).changes
    })
  }
  get<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.enqueue(async () => {
      return this.database.query<T, SqliteValue[]>(sql).get(...params) ?? undefined
    })
  }
  all<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.enqueue(async () => {
      return this.database.query<T, SqliteValue[]>(sql).all(...params)
    })
  }

  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.database.exec("BEGIN IMMEDIATE")
      let active = true
      const database = this.database
      function assertActive() {
        if (!active) {
          throw new Error("SQLite transaction handle is no longer active")
        }
      }
      const executor: SqliteExecutor = {
        async exec(sql) {
          assertActive()
          database.exec(sql)
        },
        async run(sql, ...params) {
          assertActive()
          database.query(sql).run(...params)
        },
        async runCounted(sql, ...params) {
          assertActive()
          return database.query(sql).run(...params).changes
        },
        async get<Row extends object>(sql: string, ...params: SqliteValue[]) {
          assertActive()
          return database.query<Row, SqliteValue[]>(sql).get(...params) ?? undefined
        },
        async all<Row extends object>(sql: string, ...params: SqliteValue[]) {
          assertActive()
          return database.query<Row, SqliteValue[]>(sql).all(...params)
        }
      }
      try {
        const result = await callback(executor)
        this.database.exec("COMMIT")
        return result
      } catch (error) {
        try {
          this.database.exec("ROLLBACK")
        } catch (rollback) {
          throw new AggregateError([error, rollback], "SQLite transaction failed and rollback could not be confirmed")
        }
        throw error
      } finally {
        active = false
      }
    })
  }

  close() {
    if (this.closing) {
      return this.line
    }
    this.closing = true
    const closed = this.line.then(() => {
      this.database.close()
    })
    this.line = closed
    return closed
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      return Promise.reject(new Error("SQLite database is closing"))
    }
    const task = this.line.then(operation)
    this.line = task.then(
      () => {},
      () => {}
    )
    return task
  }
}
