import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function openDatabase(dir) {
  mkdirSync(join(dir, "media"), { recursive: true });
  const db = new DatabaseSync(join(dir, "znote.sqlite"));
  const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (schemaVersion > 5) { db.close(); throw new Error('This data directory requires a newer ZNote version'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT);
    CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT NOT NULL DEFAULT '#287464', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('note','image')), title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL, favorite INTEGER NOT NULL DEFAULT 0, file_key TEXT, thumbnail_key TEXT, mime TEXT, bytes INTEGER, width INTEGER, height INTEGER, hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS items_updated ON items(updated_at DESC);
    CREATE INDEX IF NOT EXISTS items_collection ON items(collection_id);
    CREATE INDEX IF NOT EXISTS items_hash ON items(hash);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, item_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, cursor INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE, event_id INTEGER NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL, last_status INTEGER, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(webhook_id,event_id));
    CREATE INDEX IF NOT EXISTS webhook_due ON webhook_deliveries(status,next_attempt);
  `);
  // Additive v2 migration: old databases and media remain readable.
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(items)")
      .all()
      .map((c) => c.name),
  );
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 5) return db;
  if (version === 4) { migrateGroups(db); return db; }
  if (version === 3) { migrateVideo(db); migrateGroups(db); return db; }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!columns.has("storage_codec"))
      db.exec(
        "ALTER TABLE items ADD COLUMN storage_codec TEXT NOT NULL DEFAULT 'identity'",
      );
    if (!columns.has("stored_bytes"))
      db.exec("ALTER TABLE items ADD COLUMN stored_bytes INTEGER");
    if (!columns.has('source_url')) db.exec("ALTER TABLE items ADD COLUMN source_url TEXT");
    if (!columns.has('captured_at')) db.exec("ALTER TABLE items ADD COLUMN captured_at TEXT");
    db.exec(`UPDATE items SET stored_bytes=bytes WHERE kind='image' AND stored_bytes IS NULL;
      DROP INDEX IF EXISTS items_unique_hash;
      CREATE INDEX IF NOT EXISTS items_hash_collection ON items(hash,collection_id);
      CREATE INDEX IF NOT EXISTS items_library_updated ON items(collection_id,deleted_at,updated_at DESC,id);
      CREATE INDEX IF NOT EXISTS items_active_updated ON items(deleted_at,updated_at DESC,id);
      CREATE VIRTUAL TABLE IF NOT EXISTS items_search USING fts5(title,content,tags,content='items',content_rowid='rowid',tokenize='trigram');
      CREATE TRIGGER IF NOT EXISTS items_search_insert AFTER INSERT ON items BEGIN
        INSERT INTO items_search(rowid,title,content,tags) VALUES(new.rowid,new.title,new.content,new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS items_search_delete AFTER DELETE ON items BEGIN
        INSERT INTO items_search(items_search,rowid,title,content,tags) VALUES('delete',old.rowid,old.title,old.content,old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS items_search_update AFTER UPDATE OF title,content,tags ON items BEGIN
        INSERT INTO items_search(items_search,rowid,title,content,tags) VALUES('delete',old.rowid,old.title,old.content,old.tags);
        INSERT INTO items_search(rowid,title,content,tags) VALUES(new.rowid,new.title,new.content,new.tags);
      END;
      INSERT INTO items_search(items_search) VALUES('rebuild');
      PRAGMA user_version=3; COMMIT;`);
  } catch (e) {
    db.exec("ROLLBACK");
    db.close();
    throw e;
  }
  migrateVideo(db);
  migrateGroups(db);
  return db;
}

function migrateGroups(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`ALTER TABLE items ADD COLUMN group_key TEXT;
      ALTER TABLE items ADD COLUMN group_index INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE items ADD COLUMN group_title TEXT;
      CREATE INDEX items_group ON items(collection_id,group_key,deleted_at,group_index);
      PRAGMA user_version=5; COMMIT;`);
  } catch(e) { db.exec('ROLLBACK'); db.close(); throw e; }
}

function migrateVideo(db) {
  // SQLite CHECK changes require rebuilding the table; preserve rowids for FTS.
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE name='items'").get().sql;
  const dependents = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='items' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(definition.replace(/CREATE TABLE\s+items/i, 'CREATE TABLE items_next').replace("'note','image'", "'note','image','video'"));
    db.exec('INSERT INTO items_next(rowid, ' + db.prepare('PRAGMA table_info(items)').all().map(c => '"' + c.name + '"').join(',') + ') SELECT rowid,* FROM items');
    db.exec('DROP TABLE items; ALTER TABLE items_next RENAME TO items');
    for (const dependent of dependents) db.exec(dependent.sql);
    db.exec('ALTER TABLE items ADD COLUMN duration REAL; ALTER TABLE items ADD COLUMN video_codec TEXT');
    db.exec("INSERT INTO items_search(items_search) VALUES('rebuild'); PRAGMA user_version=4; COMMIT");
  } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
}
