import type { Database } from "bun:sqlite"
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite"
import { BunSqliteExecutor } from "./executor"

const pending = new WeakMap<object, Promise<void>>()

function queued<
    This extends object,
    // biome-ignore lint/suspicious/noExplicitAny: Method preserves each decorated method's parameter types.
    Method extends (this: This, ...args: any[]) => Promise<unknown>,
>(method: Method, _context: ClassMethodDecoratorContext<This, Method>): Method {
    const replacement = function (this: This, ...args: Parameters<Method>) {
        const result = (pending.get(this) ?? Promise.resolve()).then(() => method.apply(this, args))
        // Every decorated method on this instance shares the queue, including after a failure.
        pending.set(
            this,
            result.then(
                () => {},
                () => {},
            ),
        )
        return result
    }
    // Preserve the original signature, including generic type parameters.
    return replacement as Method
}

export class BunSqliteDatabase implements SqliteDatabase {
    private readonly executor: BunSqliteExecutor

    constructor(private readonly db: Database) {
        this.executor = new BunSqliteExecutor(db)
    }

    @queued
    exec(sql: string): Promise<void> {
        return this.executor.exec(sql)
    }

    @queued
    run(sql: string, ...params: SqliteValue[]): Promise<void> {
        return this.executor.run(sql, ...params)
    }

    @queued
    runCounted(sql: string, ...params: SqliteValue[]): Promise<number> {
        return this.executor.runCounted(sql, ...params)
    }

    @queued
    get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
        return this.executor.get<T>(sql, ...params)
    }

    @queued
    all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
        return this.executor.all<T>(sql, ...params)
    }

    @queued
    async transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
        // Bun's transaction helper commits synchronously, before an async callback settles.
        this.db.run("BEGIN")
        const transaction = new BunSqliteExecutor(this.db)

        try {
            const result = await callback(transaction)
            transaction.invalidate()
            this.db.run("COMMIT")
            return result
        } catch (error) {
            transaction.invalidate()
            try {
                this.db.run("ROLLBACK")
            } catch (rollbackError) {
                throw new AggregateError([error, rollbackError], "SQLite transaction failed and rollback failed")
            }
            throw error
        }
    }

    @queued
    async close(): Promise<void> {
        this.db.close(true)
    }
}
