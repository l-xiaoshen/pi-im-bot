import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { registerStorageConformance } from "@earendil-works/pi-durable/testing"
import { openBunStorage } from "../src/index"

registerStorageConformance({ describe, expect, it }, "Bun SQLite storage", async (use) => {
    const storage = await openBunStorage(new Database(":memory:"))
    try {
        await use(storage)
    } finally {
        await storage.close(BACKGROUND_CONTEXT)
    }
})
