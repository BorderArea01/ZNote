import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { gzipSync, gunzipSync } from 'node:zlib';
const fail = (status, message) => Object.assign(Error(message), { status });
const inputSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() })).min(1).max(10000),
  collection_id: z.uuid().nullable(), mode: z.enum(['create', 'append', 'detach']),
  whole_groups: z.boolean().default(false), title: z.string().trim().max(200).default(''),
  target_id: z.uuid().nullable().default(null), note_mode: z.enum(['copy', 'exclude']).default('copy'),
});
const picture = row => ({ id: row.id, title: row.title, thumbnail_url: `/media/${row.id}/thumbnail` });
const noteGroup = row => row.group_key?.startsWith('note:');

export function registerGroupOrganize({ app, db, undo, getItem, event, serialize, validateCollection }) {
  const fields = 'id,version,kind,deleted_at,group_key,group_title,collection_id,group_index,group_order,group_manual,group_origin_id,title';
  const read = id => { const row = db.prepare(`SELECT ${fields} FROM items WHERE id=?`).get(id); if (!row) throw fail(404, '所选图片已不存在'); return row; };
  function members(key, library) {
    const rows = db.prepare(`SELECT ${fields} FROM items WHERE kind='image' AND group_key=? AND collection_id IS ? AND deleted_at IS NULL ORDER BY COALESCE(group_order,group_index),group_index,id LIMIT 10001`).all(key, library);
    if (rows.length > 10000) throw fail(413, '图片组超过 10000 张，请先缩小整理范围');
    return rows;
  }
  function snapshot(value, refresh = false) {
    validateCollection(value.collection_id);
    if (new Set(value.items.map(i => i.id)).size !== value.items.length) throw fail(400, '所选图片不能重复');
    const selected = value.items.map(i => {
      const row = read(i.id);
      if (row.kind !== 'image' || row.deleted_at || row.collection_id !== value.collection_id) throw fail(409, '所选内容包含视频、笔记、已删除或其他知识库的图片，请重新选择');
      if (!refresh && row.version !== i.version) throw fail(409, '所选图片已有修改，请重新读取后确认');
      return row;
    });
    const input = { ...value, items: selected.map(({ id, version }) => ({ id, version })) };
    const groups = new Map();
    let relatedCount = 0;
    const loadGroup = key => { if (!groups.has(key)) { const rows = members(key, value.collection_id); relatedCount += rows.length; if (relatedCount > 10000) throw fail(413, '相关图片组共超过 10000 张，请分批整理'); groups.set(key, rows); } return groups.get(key); };
    for (const row of selected) if (row.group_key) loadGroup(row.group_key);
    let target = null, targetRows = [];
    if (value.mode === 'append') {
      if (!value.target_id) throw fail(400, '请选择要追加的图片组');
      target = read(value.target_id);
      if (target.kind !== 'image' || target.deleted_at || !target.group_key || noteGroup(target) || target.collection_id !== value.collection_id) throw fail(409, '目标必须是当前知识库中未删除的素材组');
      targetRows = loadGroup(target.group_key);
    }
    if (value.mode === 'create' && !value.title) throw fail(400, '请为新图片组命名');
    const expanded = new Map(), expandedGroups = new Set();
    for (const row of selected) {
      if (value.whole_groups && row.group_key) {
        if (expandedGroups.has(row.group_key)) continue;
        expandedGroups.add(row.group_key);
        for (const member of groups.get(row.group_key)) expanded.set(member.id, member);
      } else expanded.set(row.id, row);
    }
    if (expanded.size > 10000) throw fail(413, '单次最多整理 10000 张图片');
    const candidates = [...expanded.values()].filter(row => !noteGroup(row) || value.note_mode === 'copy');
    const targetIds = new Set(targetRows.map(row => row.id)), existingOrigins = new Set(targetRows.map(row => row.group_origin_id).filter(Boolean));
    if (value.mode === 'detach') for (const row of candidates.filter(noteGroup)) {
      const origin = row.group_origin_id || row.id;
      if (db.prepare('SELECT id FROM items WHERE collection_id IS ? AND group_key IS NULL AND deleted_at IS NULL AND group_origin_id=? LIMIT 1').get(value.collection_id, origin)) existingOrigins.add(origin);
    }
    const duplicateCopies = new Set();
    const moving = candidates.filter(row => {
      if (targetIds.has(row.id)) return false;
      if (noteGroup(row) && existingOrigins.has(row.group_origin_id || row.id)) { duplicateCopies.add(row.id); return false; }
      return value.mode !== 'detach' || row.group_key;
    });
    if (targetRows.length + moving.length > 10000) throw fail(413, '整理后单组超过 10000 张，请分组保存');
    const rows = [...targetRows, ...moving];
    const revision = createHash('sha256').update(JSON.stringify([input, [...expanded.values()].map(r => [r.id,r.version]), [...groups].map(([key,rows]) => [key,rows.map(r => [r.id,r.version])]), [...existingOrigins].sort()])).digest('hex');
    return { input, selected, expanded, target, targetRows, moving, rows, revision,
      copied: moving.filter(noteGroup).length, excluded: expanded.size - candidates.length, duplicateCopies: duplicateCopies.size };
  }
  function preview(state) {
    return { input: state.input, revision: state.revision, selected_count: state.selected.length, expanded_count: state.expanded.size,
      changed_count: state.moving.length, copied_count: state.copied, excluded_count: state.excluded, existing_count: state.duplicateCopies,
      note_count: [...state.expanded.values()].filter(noteGroup).length,
      target_count: state.targetRows.length, result_count: state.rows.length, items: state.rows.slice(0,60).map(picture),
      cover: state.input.mode === 'detach' ? null : state.rows[0] ? picture(state.rows[0]) : null };
  }
  app.get('/api/item-groups', (req, res) => {
    const q = z.object({ collection: z.union([z.uuid(), z.literal('unfiled')]).default('unfiled'), q: z.string().max(200).default(''), offset: z.coerce.number().int().min(0).max(100000).default(0) }).parse(req.query);
    const library = q.collection === 'unfiled' ? null : q.collection; validateCollection(library);
    const source = `WITH ranked AS (SELECT id,group_key,COALESCE(NULLIF(group_title,''),title) title,ROW_NUMBER() OVER(PARTITION BY group_key ORDER BY COALESCE(group_order,group_index),group_index,id) rank,COUNT(*) OVER(PARTITION BY group_key) count FROM items WHERE kind='image' AND deleted_at IS NULL AND collection_id IS ? AND group_key IS NOT NULL AND group_key NOT LIKE 'note:%') SELECT id,group_key,title,count FROM ranked WHERE rank=1 AND instr(lower(title),lower(?))>0`;
    const rows = db.prepare(source + ' ORDER BY title,id LIMIT 40 OFFSET ?').all(library, q.q, q.offset);
    res.json({ groups: rows.map(row => ({ ...row, thumbnail_url: `/media/${row.id}/thumbnail` })), total: db.prepare('SELECT count(*) n FROM (' + source + ')').get(library, q.q).n, offset: q.offset });
  });
  app.post('/api/item-groups/organize/preview', (req, res) => {
    const { refresh, ...input } = inputSchema.extend({ refresh: z.boolean().default(false) }).parse(req.body);
    res.json({ ...preview(snapshot(input, refresh)), operation_id: randomUUID(), prepared_at: new Date().toISOString() });
  });
  app.post('/api/item-groups/organize', (req, res) => {
    const { revision, operation_id, prepared_at, ...input } = inputSchema.extend({ revision: z.string().length(64), operation_id: z.uuid(), prepared_at: z.string().datetime() }).parse(req.body);
    const time = Date.now(), prepared = Date.parse(prepared_at);
    const restoredAt = Number(db.prepare("SELECT value FROM settings WHERE key='group_operations_reset_at'").get()?.value || 0);
    if (time - prepared > 86400000 || prepared > time + 30000 || prepared < restoredAt) throw fail(410, '整理预览已过期或数据已恢复，请重新读取后确认');
    const requestHash = createHash('sha256').update(JSON.stringify([input, revision, prepared_at, req.body.undo === true])).digest('hex');
    const receipt = db.prepare('SELECT * FROM group_operations WHERE id=?').get(operation_id);
    if (receipt) {
      if (receipt.owner !== req.auth.id || receipt.request_hash !== requestHash) throw fail(409, '操作标识已使用，请重新预览后确认');
      const action = db.prepare('SELECT id,label,count,created_at,expires_at,undone_at FROM undo_actions WHERE id=? AND owner=?').get(operation_id, req.auth.id);
      return res.json({ ...JSON.parse(gunzipSync(receipt.response, { maxOutputLength: 32 * 1024 * 1024 }).toString()), undo: action?.undone_at ? null : action || null, replayed: true, already_undone: !!action?.undone_at });
    }
    const result = undo.run(req, '图片组整理', () => {
      db.prepare('DELETE FROM group_operations WHERE created_at<?').run(time - 86400000);
      const remember = value => {
        const raw = Buffer.from(JSON.stringify(value));
        if (raw.length > 32 * 1024 * 1024) throw fail(413, '整理结果过大，请分批操作；本次未修改内容');
        const packed = gzipSync(raw);
        const used = db.prepare('SELECT COALESCE(sum(length(response)),0) bytes FROM group_operations WHERE owner=?').get(req.auth.id).bytes;
        if (used + packed.length > 32 * 1024 * 1024) throw fail(413, '近期整理操作的回执已满，请稍后重试；本次未修改内容');
        db.prepare('INSERT INTO group_operations VALUES(?,?,?,?,?)').run(operation_id, req.auth.id, requestHash, time, packed);
        return value;
      };
      const state = snapshot(input);
      if (state.revision !== revision) throw fail(409, '图片组成员、顺序或目标已有变化，请重新预览后确认；未修改任何图片');
      if (!state.moving.length) return remember({ changed_count: 0, copied_count: 0, group_key: state.target?.group_key || null, item: state.target ? serialize(getItem(state.target.id)) : null });
      const key = input.mode === 'detach' ? null : state.target?.group_key || 'manual:' + randomUUID();
      const title = key ? state.target?.group_title || state.target?.title || input.title : null;
      const date = new Date().toISOString(), ids = []; let copiedBytes = 0;
      function assign(row, order) {
        let id = row.id;
        if (noteGroup(row)) {
          const copy = { ...getItem(row.id), id: randomUUID(), group_key: key, group_title: title, group_order: order, group_manual: 1, group_origin_id: row.group_origin_id || row.id, version: 1, created_at: date, updated_at: date };
          copiedBytes += Buffer.byteLength(JSON.stringify(copy));
          if (copiedBytes > 16 * 1024 * 1024) throw fail(413, '配图说明总量过大，请分批建立素材引用');
          const columns = Object.keys(copy); db.prepare(`INSERT INTO items(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(c => copy[c]));
          id = copy.id; event('item.created', id);
        } else if (row.group_key !== key || row.group_title !== title || row.group_order !== order || !row.group_manual) {
          db.prepare('UPDATE items SET group_key=?,group_title=?,group_order=?,group_manual=1,version=version+1,updated_at=? WHERE id=?').run(key, title, order, date, id); event('item.updated', id);
        }
        ids.push(id);
      }
      state.targetRows.forEach((row,index) => assign(row,index));
      state.moving.forEach((row,index) => assign(row, key ? state.targetRows.length + index : null));
      return remember({ changed_count: state.moving.length, copied_count: state.copied, group_key: key, ids, item: ids[0] ? serialize(getItem(ids[0])) : null });
    }, { guardGroups: true, actionId: operation_id });
    res.json({ ...result.result, undo: result.undo });
  });
}
