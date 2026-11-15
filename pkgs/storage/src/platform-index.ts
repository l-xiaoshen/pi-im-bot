import type { Database } from 'bun:sqlite'

/** Rebuildable projection. Triggers also keep it correct if an older Bot writes this database. */
export function initializePlatformIndex(db: Database) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS platform_message_index (
      room_id TEXT NOT NULL, platform_id TEXT NOT NULL, message_id TEXT NOT NULL,
      PRIMARY KEY(room_id, platform_id, message_id)
    ) WITHOUT ROWID`)
    db.exec('CREATE INDEX IF NOT EXISTS platform_message_by_message ON platform_message_index(message_id)')
    db.exec('CREATE TABLE IF NOT EXISTS bot_projections (name TEXT PRIMARY KEY, version INTEGER NOT NULL)')
    db.exec(`CREATE TRIGGER IF NOT EXISTS messages_platform_insert AFTER INSERT ON messages BEGIN
      INSERT OR IGNORE INTO platform_message_index
        SELECT NEW.room_id, ids.value, NEW.id FROM json_each(NEW.value, '$.platformMessageIds') ids;
    END`)
    db.exec(`CREATE TRIGGER IF NOT EXISTS messages_platform_update AFTER UPDATE OF value, room_id ON messages BEGIN
      DELETE FROM platform_message_index WHERE message_id=OLD.id;
      INSERT OR IGNORE INTO platform_message_index
        SELECT NEW.room_id, ids.value, NEW.id FROM json_each(NEW.value, '$.platformMessageIds') ids;
    END`)
    db.exec(`CREATE TRIGGER IF NOT EXISTS messages_platform_delete AFTER DELETE ON messages BEGIN
      DELETE FROM platform_message_index WHERE message_id=OLD.id;
    END`)
    const prior = db.query('SELECT version FROM bot_projections WHERE name=?').get('platform-messages')
    if (!prior) {
      db.exec(`INSERT OR IGNORE INTO platform_message_index
        SELECT messages.room_id, ids.value, messages.id
        FROM messages, json_each(messages.value, '$.platformMessageIds') ids`)
      db.query('INSERT INTO bot_projections(name, version) VALUES (?, ?)').run('platform-messages', 1)
    }
  })()
}

export const platformMessageQuery = `SELECT messages.value FROM platform_message_index ids
  JOIN messages ON messages.id=ids.message_id
  WHERE ids.room_id=? AND ids.platform_id=? ORDER BY messages.rowid LIMIT 1`
