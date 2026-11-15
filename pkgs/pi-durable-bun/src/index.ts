import type { Database } from "bun:sqlite"
import { SqliteStorage, type SqliteStorageOptions } from "@earendil-works/pi-durable/storage/sqlite"
import { BunSqliteDatabase } from "./database"

export { BunSqliteDatabase }

/** Open durable storage that owns and closes the supplied Bun database. */
export function openBunStorage(db: Database, options?: SqliteStorageOptions): Promise<SqliteStorage> {
    return SqliteStorage.open(new BunSqliteDatabase(db), options)
}
