# pi-durable-bun

Bun SQLite adapter for Pi Durable.

```ts
import { Database } from "bun:sqlite"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { openBunStorage } from "pi-durable-bun"

const storage = await openBunStorage(new Database("durable.sqlite"))
// Use storage with Pi Durable.
await storage.close(BACKGROUND_CONTEXT)
```

`openBunStorage(db, options?)` initializes the schema and accepts Pi Durable's
`SqliteStorageOptions`, including a table `prefix`. Storage owns the supplied
database and closes it on shutdown or initialization failure.

`BunSqliteDatabase` also exposes the portable `SqliteDatabase` interface directly.
Use the supplied transaction handle inside async transaction callbacks; unrelated
adapter calls wait until the transaction finishes. Use the database exclusively
through this adapter while it owns the connection.

Run checks from this package directory:

```sh
bun run typecheck
bun run test
```

`test/storage.test.ts` runs the upstream [storage conformance suite](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)
through `registerStorageConformance` with Bun's test runner. Each case gets a fresh
in-memory database that closes afterward.

See [Bun's SQLite documentation](https://bun.sh/docs/runtime/sqlite) for database
constructor options and connection settings.
