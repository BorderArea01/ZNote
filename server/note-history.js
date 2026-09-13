import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
const fail = (status, message) => Object.assign(Error(message), { status });

export function createNoteHistory({ app, db }) {
  const current = db.prepare("SELECT * FROM items WHERE id=? AND kind='note'");
  function capture(id) {
    const note = current.get(id); if (!note || note.deleted_at) return;
    const value = Buffer.from(JSON.stringify({ title: note.title, content: note.content, tags: JSON.parse(note.tags) }));
    const hash = createHash('sha256').update(value).digest('hex');
    if (db.prepare('SELECT hash FROM note_versions WHERE item_id=? ORDER BY version DESC LIMIT 1').get(id)?.hash === hash) return;
    db.prepare('INSERT OR IGNORE INTO note_versions VALUES(?,?,?,?,?,?,?)').run(randomUUID(), id, note.version, note.title, note.updated_at, hash, gzipSync(value));
    let bytes = 0, count = 0;
    for (const row of db.prepare('SELECT id,length(payload) bytes FROM note_versions WHERE item_id=? ORDER BY version DESC').all(id)) {
      count++; bytes += row.bytes;
      if (count > 50 || bytes > 8 * 1024 * 1024) db.prepare('DELETE FROM note_versions WHERE id=?').run(row.id);
    }
  }
  function seed() { for (const note of db.prepare("SELECT id FROM items WHERE kind='note' AND deleted_at IS NULL AND id NOT IN (SELECT item_id FROM note_versions)").all()) capture(note.id); }
  app.get('/api/items/:id/versions', (req, res) => {
    const note = current.get(req.params.id); if (!note) throw fail(404, '笔记不存在');
    res.json({ versions: db.prepare('SELECT id,version,title,saved_at FROM note_versions WHERE item_id=? ORDER BY version DESC LIMIT 50').all(note.id) });
  });
  app.get('/api/items/:id/versions/:versionId', (req, res) => {
    const version = db.prepare('SELECT * FROM note_versions WHERE id=? AND item_id=?').get(req.params.versionId, req.params.id);
    if (!version) throw fail(404, '版本不存在或已清理');
    res.json({ id: version.id, version: version.version, saved_at: version.saved_at, ...JSON.parse(gunzipSync(version.payload, { maxOutputLength: 4 * 1024 * 1024 }).toString()) });
  });
  return { capture, seed };
}
