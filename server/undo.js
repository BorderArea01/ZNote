import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { localMediaReferences } from '../shared/local-media.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const excluded = new Set(['id', 'version', 'updated_at', 'thumbnail_key']);
const TTL = 24 * 60 * 60 * 1000;
const MAX_BYTES = 32 * 1024 * 1024;

export function createUndoManager({ app, db, transaction, event, mediaCollision, clearCache }) {
  let recording = false;
  const fields = db.prepare('PRAGMA table_info(items)').all().map(c => c.name).filter(c => !excluded.has(c));
  db.function('znote_recording_undo', () => recording ? 1 : 0);
  db.exec(`CREATE TEMP TABLE undo_capture (id TEXT NOT NULL, field TEXT NOT NULL, value, PRIMARY KEY(id,field));
    CREATE TEMP TRIGGER undo_capture_insert AFTER INSERT ON main.items WHEN znote_recording_undo()=1 BEGIN
      INSERT OR IGNORE INTO undo_capture VALUES(NEW.id,'@created',NULL); END;
    CREATE TEMP TRIGGER undo_capture_update AFTER UPDATE ON main.items WHEN znote_recording_undo()=1 BEGIN
      ${fields.map(field => `INSERT OR IGNORE INTO undo_capture SELECT OLD.id,'${field}',OLD.${field} WHERE OLD.${field} IS NOT NEW.${field};`).join('\n')}
    END;`);
  const get = db.prepare('SELECT * FROM items WHERE id=?');
  const summary = row => ({ id: row.id, label: row.label, count: row.count, created_at: row.created_at, expires_at: row.expires_at, undone_at: row.undone_at });
  function prune(owner) {
    db.prepare('DELETE FROM undo_actions WHERE expires_at<=?').run(new Date().toISOString());
    db.prepare('DELETE FROM undo_actions WHERE owner=? AND id NOT IN (SELECT id FROM undo_actions WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT 50)').run(owner, owner);
    // Compressed history is bounded independently of the original media store.
    const rows = db.prepare('SELECT id,length(payload) bytes FROM undo_actions WHERE owner=? ORDER BY created_at DESC,rowid DESC').all(owner);
    let bytes = 0;
    for (const row of rows) { bytes += row.bytes; if (bytes > MAX_BYTES) db.prepare('DELETE FROM undo_actions WHERE id=?').run(row.id); }
  }
  function run(req, label, fn) {
    if (req.body?.undo !== true) return { result: transaction(fn), undo: null };
    return transaction(() => {
      const sourceId = req.params?.id || req.body?.id || req.body?.items?.[0]?.id;
      const source = sourceId ? get.get(sourceId) : req.body?.group_key ? db.prepare('SELECT * FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL LIMIT 1').get(req.body.group_key, req.body.collection_id) : null;
      if (source) {
        const name = label.startsWith('整组') ? source.group_title || source.title : source.title;
        const library = source.collection_id ? db.prepare('SELECT name FROM collections WHERE id=?').get(source.collection_id)?.name : '未分类';
        label += '：' + [...name].slice(0, 60).join('') + (req.body.items?.length > 1 ? ` 等 ${req.body.items.length} 项` : '') + (library ? ' · ' + library : '');
      }
      db.exec('DELETE FROM undo_capture'); recording = true;
      let result;
      try { result = fn(); } finally { recording = false; }
      if (db.prepare('SELECT COALESCE(sum(length(value)),0) bytes FROM undo_capture').get().bytes > MAX_BYTES) throw fail(413, '本次改动过大，无法完整记录撤销；请分批操作');
      const changes = new Map();
      for (const row of db.prepare('SELECT * FROM undo_capture').all()) {
        if (!changes.has(row.id)) changes.set(row.id, { id: row.id, before: {}, after: {} });
        const entry = changes.get(row.id);
        if (row.field === '@created') entry.created = true;
        else entry.before[row.field] = row.value;
      }
      let payloadBytes = 2;
      for (const [id, entry] of changes) {
        const current = get.get(id);
        if (!current) throw fail(409, '此次操作包含无法撤销的文件删除');
        entry.deleted_at = current.deleted_at;
        if (entry.created) { entry.before = {}; entry.after = Object.fromEntries(fields.map(f => [f, current[f]])); }
        else for (const field of Object.keys(entry.before)) {
          if (entry.before[field] === current[field]) delete entry.before[field];
          else entry.after[field] = current[field];
        }
        if (!entry.created && !Object.keys(entry.before).length) changes.delete(id);
        else { payloadBytes += Buffer.byteLength(JSON.stringify(entry)) + 1; if (payloadBytes > MAX_BYTES) throw fail(413, '本次改动过大，无法完整记录撤销；请分批操作'); }
      }
      db.exec('DELETE FROM undo_capture');
      if (!changes.size) return { result, undo: null };
      const date = new Date(), action = { id: randomUUID(), owner: req.auth.id, label, count: changes.size, created_at: date.toISOString(), expires_at: new Date(+date + TTL).toISOString(), undone_at: null };
      const payload = gzipSync(Buffer.from(JSON.stringify([...changes.values()])));
      if (payload.length > MAX_BYTES) throw fail(413, '撤销记录过大，请分批操作');
      db.prepare('INSERT INTO undo_actions VALUES(?,?,?,?,?,?,?,NULL)').run(action.id, action.owner, label, action.count, action.created_at, action.expires_at, payload);
      prune(req.auth.id);
      return { result, undo: summary(action) };
    });
  }
  app.get('/api/undo', (req, res) => {
    prune(req.auth.id);
    res.json({ actions: db.prepare('SELECT id,label,count,created_at,expires_at,undone_at FROM undo_actions WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT 50').all(req.auth.id) });
  });
  app.post('/api/undo/:id', (req, res) => {
    const response = transaction(() => {
      const action = db.prepare('SELECT * FROM undo_actions WHERE id=? AND owner=?').get(req.params.id, req.auth.id);
      if (!action || action.expires_at <= new Date().toISOString()) throw fail(410, '撤销记录已过期或不属于本次登录');
      if (action.undone_at) return { ...summary(action), already_undone: true };
      const changes = JSON.parse(gunzipSync(action.payload, { maxOutputLength: 2 * MAX_BYTES }).toString());
      const affected = new Map(), removed = new Set(changes.filter(c => c.created).map(c => c.id));
      for (const entry of changes) {
        const current = get.get(entry.id);
        if (!current || current.deleted_at !== entry.deleted_at || Object.entries(entry.after).some(([field, value]) => current[field] !== value))
          throw fail(409, '相关内容已被修改、恢复或永久删除，无法完整撤销；未更改任何内容');
        const target = { ...current, ...entry.before };
        if (target.collection_id && !db.prepare('SELECT 1 FROM collections WHERE id=?').get(target.collection_id)) throw fail(409, '原知识库已删除，无法撤销移动');
        affected.set(entry.id, target);
      }
      // Check the projected graph before writing anything. An alias created by
      // deletion may have acquired new references since the original operation.
      for (const currentNote of db.prepare("SELECT * FROM items WHERE kind='note'").all()) {
        const note = affected.get(currentNote.id) || currentNote;
        if (removed.has(note.id)) continue;
        for (const ref of localMediaReferences(note.content)) {
          if (!affected.has(note.id) && !affected.has(ref.id)) continue;
          const media = affected.get(ref.id) || get.get(ref.id);
          if (removed.has(ref.id) || !media || media.deleted_at || (!note.deleted_at && media.collection_id !== note.collection_id))
            throw fail(409, '笔记配图关系已变化，无法完整撤销；请先整理相关笔记');
        }
      }
      const date = new Date().toISOString();
      for (const entry of changes) {
        const row = affected.get(entry.id);
        if (entry.created) {
          // Metadata aliases share originals. Only the regular reference-aware
          // cleanup queue may remove a now-unused file or thumbnail.
          for (const key of [row.file_key, row.thumbnail_key].filter(Boolean)) db.prepare('INSERT OR IGNORE INTO pending_file_deletions VALUES(?)').run(key);
          db.prepare('DELETE FROM items WHERE id=?').run(entry.id); event('item.deleted', entry.id);
        } else {
          const keys = Object.keys(entry.before);
          db.prepare(`UPDATE items SET ${keys.map(k => k + '=?').join(',')},version=version+1,updated_at=? WHERE id=?`).run(...keys.map(k => entry.before[k]), date, entry.id);
          event(entry.before.deleted_at === null && entry.after.deleted_at ? 'item.restored' : 'item.updated', entry.id);
        }
      }
      for (const entry of changes) {
        if (entry.created || entry.before.collection_id === undefined) continue;
        const row = get.get(entry.id);
        if (!row.deleted_at && row.hash && mediaCollision(row, row.collection_id)) throw fail(409, '原知识库出现了重复素材，无法撤销移动；未更改任何内容');
      }
      db.prepare('UPDATE undo_actions SET undone_at=?,payload=? WHERE id=?').run(date, Buffer.alloc(0), action.id);
      return { ...summary(action), undone_at: date };
    });
    clearCache(); res.json(response);
  });
  return { run };
}
