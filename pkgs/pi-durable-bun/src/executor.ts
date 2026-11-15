import type { Database } from "bun:sqlite"
import type { SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite"

function active<
  // biome-ignore lint/suspicious/noExplicitAny: Method preserves each decorated method's parameter types.
  Method extends (this: BunSqliteExecutor, ...args: any[]) => Promise<unknown>
>(method: Method, _context: ClassMethodDecoratorContext<BunSqliteExecutor, Method>): Method {
  const replacement = async function (this: BunSqliteExecutor, ...args: Parameters<Method>) {
    if (!this.isActive) {
      throw new Error("SQLite transaction handle is no longer active")
    }
    return method.apply(this, args)
  }
  return replacement as Method
}

export class BunSqliteExecutor implements SqliteExecutor {
  private active = true

  constructor(private readonly db: Database) {}

  get isActive(): boolean {
    return this.active
  }

  @active
  async exec(sql: string): Promise<void> {
    this.db.run(sql)
  }

  @active
  async run(sql: string, ...params: SqliteValue[]): Promise<void> {
    this.db.query(sql).run(...params)
  }

  @active
  async runCounted(sql: string, ...params: SqliteValue[]): Promise<number> {
    return this.db.query(sql).run(...params).changes
  }

  @active
  async get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.db.query<T, SqliteValue[]>(sql).get(...params) ?? undefined
  }

  @active
  async all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.db.query<T, SqliteValue[]>(sql).all(...params)
  }

  invalidate(): void {
    this.active = false
  }
}
