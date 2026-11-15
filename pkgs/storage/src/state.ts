import { Database } from "bun:sqlite"
import { join } from "node:path"
import { z } from "zod"
import { ChatMessageSchema, RoomSchema, type ChatMessage, type Room } from "@pi-im-bot/contracts/message"
import { RunSchema, TraceSchema, type Run, type Trace } from "@pi-im-bot/contracts/run"
import { ScheduleSchema, type Schedule } from "@pi-im-bot/scheduler/definition"
import { ConversationSchema, type Conversation } from "@pi-im-bot/conversations/schema"
import { migrateRoom } from "@pi-im-bot/conversations/migration"
import { OutboundSchema, type Outbound } from "@pi-im-bot/contracts/delivery"
import { deliveryMessage, mergeDeliveryEchoes } from "./delivery-merge"
import { MediaRecordSchema, type MediaRecord } from "@pi-im-bot/media/schema"
import { recallKey, recalledMessage, type RecallRecord } from "@pi-im-bot/messages/recall"
import { privateSqliteFiles } from "./private-file"
import { ObservationSchema, type Observation } from "@pi-im-bot/plugins/observations/schema"
import { initializePlatformIndex, platformMessageQuery } from "./platform-index"

type Table =
  | "rooms"
  | "messages"
  | "runs"
  | "traces"
  | "schedules"
  | "conversations"
  | "outbound"
  | "media"
  | "recalls"
  | "observations"
type StoredRecord =
  Room | ChatMessage | Run | Trace | Schedule | Conversation | Outbound | MediaRecord | RecallRecord | Observation

export class StateStore {
  private readonly db: Database

  constructor(dataDir: string) {
    this.db = new Database(join(dataDir, "bot.sqlite"), { create: true })
    privateSqliteFiles(join(dataDir, "bot.sqlite"))
    this.db.exec("PRAGMA journal_mode=WAL")
    this.db.exec("PRAGMA busy_timeout=1000")
    for (const table of [
      "rooms",
      "messages",
      "runs",
      "traces",
      "schedules",
      "conversations",
      "outbound",
      "media",
      "recalls",
      "observations"
    ]) {
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, room_id TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, value TEXT NOT NULL)`
      )
      this.db.exec(`CREATE INDEX IF NOT EXISTS ${table}_room_at ON ${table}(room_id, at)`)
    }
    initializePlatformIndex(this.db)
    for (const table of ["messages", "runs", "traces"]) {
      this.db.exec(`CREATE INDEX IF NOT EXISTS ${table}_at ON ${table}(at)`)
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS runs_recovery ON runs(at)
      WHERE json_extract(value, '$.status') IN ('batching','queued','running','interrupted')`)
    this.db.exec("DROP INDEX IF EXISTS runs_coding_pending")
    const rows = this.db.query<{ value: string }, []>("SELECT value FROM rooms").all()
    this.db.exec(`CREATE INDEX IF NOT EXISTS messages_pending_inbound ON messages(at)
      WHERE json_extract(value, '$.inbound.state') IN ('pending','dispatching')`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS messages_pending_room ON messages(room_id, at)
      WHERE json_extract(value, '$.inbound.state')='pending'`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS outbound_pending_presentations ON outbound(room_id, at)
      WHERE json_extract(value, '$.render') IS NOT NULL
      AND json_extract(value, '$.state') IN ('rendering','prepared','sending')`)
    for (const row of rows) {
      const migrated = migrateRoom(JSON.parse(row.value))
      if (migrated.conversation) {
        this.saveConversationSelection(migrated.room, migrated.conversation)
      }
    }
    const uncertain = this.db
      .query<{ value: string }, []>(
        "SELECT value FROM outbound WHERE json_extract(value, '$.state') IN ('sending','preparing')"
      )
      .all()
    for (const row of uncertain) {
      const original = OutboundSchema.parse(JSON.parse(row.value))
      const outbound: Outbound = {
        ...original,
        state: "unknown",
        uncertaintyStage: "transport",
        error: "服务在发送期间中断，未自动重发"
      }
      if (original.state === "preparing") {
        this.saveOutbound({
          ...outbound,
          uncertaintyStage: "presentation",
          error: "服务在呈现期间中断，结果未知，未重新生成或发送"
        })
        continue
      }
      const observation = this.getObservation("delivery.receipt@1:" + outbound.id)
      let recovered: Observation | undefined
      if (observation) {
        recovered = {
          ...observation,
          ready: true,
          payload: {
            ...observation.payload,
            state: "unknown",
            platformMessageIds: outbound.platformMessageIds
          }
        }
      }
      this.saveDelivery(deliveryMessage(outbound), outbound, recovered)
    }
  }

  private save(table: Table, record: StoredRecord, roomId: string, at: number) {
    this.db
      .query(
        `INSERT INTO ${table}(id, room_id, at, value) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET room_id=excluded.room_id, at=excluded.at, value=excluded.value`
      )
      .run(record.id, roomId, at, JSON.stringify(record))
  }

  private read<T>(table: Table, schema: z.ZodType<T>, roomId?: string, limit = 200): T[] {
    let rows: { value: string }[]
    if (roomId !== undefined) {
      rows = this.db
        .query<{ value: string }, [string, number]>(
          `SELECT value FROM ${table} WHERE room_id=? ORDER BY at DESC, rowid DESC LIMIT ?`
        )
        .all(roomId, limit)
    } else {
      rows = this.db
        .query<{ value: string }, [number]>(`SELECT value FROM ${table} ORDER BY at DESC, rowid DESC LIMIT ?`)
        .all(limit)
    }
    return rows.map((row) => {
      return schema.parse(JSON.parse(row.value))
    })
  }

  listRooms() {
    return this.read("rooms", RoomSchema, undefined, 10000)
  }
  getRoom(id: string) {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM rooms WHERE id=?").get(id)
    if (!row) {
      return undefined
    }
    return RoomSchema.parse(JSON.parse(row.value))
  }
  saveRoom(room: Room) {
    this.save("rooms", room, room.id, room.updatedAt)
  }
  listConversations(roomId?: string) {
    return this.read("conversations", ConversationSchema, roomId, 10000)
  }
  getConversation(id: string) {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM conversations WHERE id=?").get(id)
    if (row) {
      return ConversationSchema.parse(JSON.parse(row.value))
    }
    return undefined
  }
  saveConversation(conversation: Conversation) {
    this.save("conversations", conversation, conversation.roomId, conversation.createdAt)
  }
  saveConversationSelection(room: Room, conversation: Conversation) {
    this.db.transaction(() => {
      this.saveConversation(conversation)
      this.saveRoom(room)
    })()
  }
  listMessages(roomId: string, limit = 200) {
    return this.read("messages", ChatMessageSchema, roomId, limit).reverse()
  }
  saveMessage(message: ChatMessage, observation?: Observation) {
    this.db.transaction(() => {
      this.save("messages", message, message.roomId, message.createdAt)
      if (observation) {
        this.saveObservation(observation)
      }
    })()
  }
  pendingInbound(limit: number, workOnly = false) {
    return this.db
      .query<{ value: string }, [number, number]>(
        `SELECT value FROM messages WHERE json_extract(value, '$.inbound.state') IN ('pending','dispatching')
         AND (?=0 OR COALESCE(json_extract(value, '$.inbound.control'),0)=0) ORDER BY at, rowid LIMIT ?`
      )
      .all(Number(workOnly), limit)
      .map((row) => {
        return ChatMessageSchema.parse(JSON.parse(row.value))
      })
  }
  cancelPendingInbound(roomId: string) {
    return this.db.transaction(() => {
      const rows = this.db
        .query<{ value: string }, [string]>(
          `SELECT value FROM messages WHERE room_id=? AND json_extract(value, '$.inbound.state')='pending'`
        )
        .all(roomId)
      return rows.map((row) => {
        const message = ChatMessageSchema.parse(JSON.parse(row.value))
        message.inbound = { state: "cancelled", error: "此输入已由范围停止操作取消，未执行" }
        this.saveMessage(message)
        return message
      })
    })()
  }
  saveRunAdmission(run: Run, messages: ChatMessage[]) {
    this.db.transaction(() => {
      this.saveRun(run)
      for (const message of messages) {
        this.saveMessage(message)
      }
    })()
  }
  getMedia(id: string) {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM media WHERE id=?").get(id)
    if (row) {
      return MediaRecordSchema.parse(JSON.parse(row.value))
    }
    return undefined
  }
  saveMedia(media: MediaRecord) {
    this.save("media", media, media.roomId, media.createdAt)
  }
  wasRecalled(roomId: string, platformId: string) {
    return Boolean(this.db.query("SELECT 1 FROM recalls WHERE id=?").get(recallKey(roomId, platformId)))
  }
  recordRecall(roomId: string, platformId: string) {
    return this.db.transaction(() => {
      const at = Date.now()
      this.save(
        "recalls",
        { id: recallKey(roomId, platformId), roomId, platformMessageId: platformId, createdAt: at },
        roomId,
        at
      )
      const message = this.findPlatformMessage(roomId, platformId)
      if (message) {
        const updated = recalledMessage(message, [platformId])
        this.saveMessage(updated)
        return updated
      }
      return undefined
    })()
  }
  getMessage(id: string) {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM messages WHERE id=?").get(id)
    if (row) {
      return ChatMessageSchema.parse(JSON.parse(row.value))
    }
    return undefined
  }
  getOutbound(id: string) {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM outbound WHERE id=?").get(id)
    if (row) {
      return OutboundSchema.parse(JSON.parse(row.value))
    }
    return undefined
  }
  listOutbound(roomId?: string) {
    return this.read("outbound", OutboundSchema, roomId, 200)
  }
  pendingPresentations(roomId: string) {
    return this.db
      .query<{ value: string }, [string]>(
        `SELECT value FROM outbound WHERE room_id = ?
       AND json_extract(value, '$.render') IS NOT NULL
       AND json_extract(value, '$.state') IN ('rendering','prepared','sending')`
      )
      .all(roomId)
      .map((row) => {
        return OutboundSchema.parse(JSON.parse(row.value))
      })
  }
  saveObservation(observation: Observation) {
    this.save("observations", observation, observation.roomId, observation.createdAt)
  }
  getObservation(id: string) {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM observations WHERE id=?").get(id)
    if (row) {
      return ObservationSchema.parse(JSON.parse(row.value))
    }
    return undefined
  }
  hasObservation(id: string) {
    return Boolean(this.db.query("SELECT id FROM observations WHERE id=?").get(id))
  }
  observationCount() {
    return this.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM observations").get()!.count
  }
  listObservations(includePreparing = false) {
    let query = "SELECT value FROM observations WHERE json_extract(value, '$.ready')=1 ORDER BY at ASC LIMIT 64"
    if (includePreparing) {
      query = "SELECT value FROM observations ORDER BY at ASC LIMIT 1000"
    }
    return this.db
      .query<{ value: string }, []>(query)
      .all()
      .map((row) => {
        return ObservationSchema.parse(JSON.parse(row.value))
      })
  }
  deleteObservation(id: string) {
    this.db.query("DELETE FROM observations WHERE id=?").run(id)
  }
  saveOutbound(outbound: Outbound, observation?: Observation) {
    this.db.transaction(() => {
      this.save("outbound", outbound, outbound.roomId, outbound.createdAt)
      if (observation) {
        this.saveObservation(observation)
      }
    })()
  }
  saveDelivery(message: ChatMessage, outbound: Outbound, observation?: Observation) {
    return this.db.transaction(() => {
      const echoes = message.platformMessageIds.flatMap((id) => {
        const echo = this.findPlatformMessage(message.roomId, id)
        if (echo) {
          return [echo]
        }
        return []
      })
      const merged = mergeDeliveryEchoes(
        recalledMessage(
          message,
          message.platformMessageIds.filter((id) => {
            return this.wasRecalled(message.roomId, id)
          })
        ),
        echoes
      )
      for (const id of merged.removedIds) {
        this.db.query("DELETE FROM messages WHERE id=? AND room_id=?").run(id, message.roomId)
      }
      this.saveMessage(merged.message, observation)
      this.saveOutbound(outbound)
      return merged
    })()
  }
  recoverableRuns() {
    const rows = this.db
      .query<{ value: string }, []>(
        "SELECT value FROM runs WHERE json_extract(value, '$.status') IN ('batching','queued','running','interrupted') ORDER BY at, rowid"
      )
      .all()
    return rows.map((row) => {
      return RunSchema.parse(JSON.parse(row.value))
    })
  }
  findPlatformMessage(roomId: string, platformId: string) {
    const row = this.db.query<{ value: string }, [string, string]>(platformMessageQuery).get(roomId, platformId)
    if (row) {
      return ChatMessageSchema.parse(JSON.parse(row.value))
    }
    return undefined
  }
  listRuns(roomId?: string) {
    return this.read("runs", RunSchema, roomId, 100)
  }
  getRun(id: string) {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM runs WHERE id=?").get(id)
    if (!row) {
      return undefined
    }
    return RunSchema.parse(JSON.parse(row.value))
  }
  saveRun(run: Run) {
    this.save("runs", run, run.roomId, run.createdAt)
  }
  listTraces(roomId?: string) {
    return this.read("traces", TraceSchema, roomId, 200).reverse()
  }
  saveTrace(trace: Trace) {
    this.save("traces", trace, trace.roomId, trace.at)
  }
  listSchedules() {
    return this.read("schedules", ScheduleSchema)
  }
  saveSchedule(schedule: Schedule) {
    this.save("schedules", schedule, schedule.roomId, schedule.createdAt)
  }
  deleteSchedule(id: string) {
    this.db.query("DELETE FROM schedules WHERE id=?").run(id)
  }
  close() {
    this.db.close()
  }
}
