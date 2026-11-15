import { Database } from "bun:sqlite"
import { performance } from "node:perf_hooks"
import { initializePlatformIndex, platformMessageQuery } from "@pi-im-bot/storage/platform-index"
const original = `SELECT value FROM messages WHERE room_id=? AND EXISTS (SELECT 1 FROM json_each(messages.value, '$.platformMessageIds') ids WHERE ids.value=?) LIMIT 1`
function median(samples: number[]) {
  samples.sort((a, b) => {
    return a - b
  })
  return Number(samples[Math.floor(samples.length / 2)].toFixed(5))
}
for (const size of [1000, 10000, 100000]) {
  const db = new Database(":memory:")
  db.exec("CREATE TABLE messages(id TEXT PRIMARY KEY, room_id TEXT, at INTEGER, value TEXT)")
  db.exec("CREATE INDEX messages_room_at ON messages(room_id, at)")
  const insert = db.query("INSERT INTO messages VALUES (?,?,?,?)")
  db.transaction(() => {
    for (let n = 0; n < size; n += 1) {
      insert.run(
        "message-" + n,
        "room",
        n,
        JSON.stringify({ id: "message-" + n, platformMessageIds: ["external-" + n], text: "synthetic" })
      )
    }
  })()
  const buildStart = performance.now()
  initializePlatformIndex(db)
  const rebuildMs = performance.now() - buildStart
  const times: Record<string, number> = {}
  for (const [name, sql] of [
    ["before", original],
    ["after", platformMessageQuery]
  ]) {
    const query = db.query(sql)
    for (const [caseName, id] of [
      ["last", "external-" + (size - 1)],
      ["miss", "missing"]
    ]) {
      const samples: number[] = []
      for (let repeat = 0; repeat < 25; repeat += 1) {
        const started = performance.now()
        query.get("room", id)
        if (repeat >= 5) {
          samples.push(performance.now() - started)
        }
      }
      times[name + "_" + caseName + "_ms"] = median(samples)
    }
  }
  console.log(
    JSON.stringify({
      size,
      rebuildMs: Number(rebuildMs.toFixed(3)),
      ...times,
      afterPlan: db.query("EXPLAIN QUERY PLAN " + platformMessageQuery).all("room", "missing"),
      projected: db.query("SELECT COUNT(*) AS count FROM platform_message_index").get()
    })
  )
  db.close()
}
