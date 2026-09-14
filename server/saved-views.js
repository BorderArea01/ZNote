import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const fail = (status, message) => Object.assign(Error(message), { status });
export const savedViewConfig = z.object({
  view: z.enum(['all', 'images', 'videos', 'notes', 'favorites', 'trash']),
  query: z.string().max(200),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).transform(tags => [...new Set(tags)].sort()),
  mode: z.enum(['all', 'any']), sort: z.enum(['updated', 'created', 'title']), layout: z.enum(['grid', 'list', 'compact-grid', 'compact-list']),
}).strict();
const name = z.string().trim().min(1).max(80);
const input = z.object({ name, config: savedViewConfig, collection_id: z.uuid().nullable().default(null) }).strict();
const update = z.object({ name: name.optional(), config: savedViewConfig.optional(), version: z.number().int().positive() }).strict();
const serialize = row => ({ ...row, config: JSON.parse(row.config) });

export function registerSavedViews({ app, db, transaction }) {
  function scope(value) {
    const id = z.union([z.literal('unfiled'), z.uuid()]).default('unfiled').parse(value);
    const library = id === 'unfiled' ? null : id;
    if (library && !db.prepare('SELECT id FROM collections WHERE id=?').get(library)) throw fail(404, '知识库不存在');
    return library;
  }
  function get(id) { const row = db.prepare('SELECT * FROM saved_views WHERE id=?').get(z.uuid().parse(id)); if (!row) throw fail(404, '筛选已删除或知识库不存在'); return row; }
  function unique(library, value, except = '') {
    if (db.prepare('SELECT 1 FROM saved_views WHERE collection_id IS ? AND name=? AND id!=?').get(library, value, except)) throw fail(409, '当前知识库已有同名筛选，请换个名称');
  }
  app.get('/api/saved-views', (req, res) => {
    const library = scope(req.query.collection);
    res.json({ views: db.prepare('SELECT * FROM saved_views WHERE collection_id IS ? ORDER BY name,id').all(library).map(serialize) });
  });
  app.get('/api/saved-views/:id', (req, res) => res.json(serialize(get(req.params.id))));
  app.post('/api/saved-views', (req, res) => {
    const value = input.parse(req.body);
    const result = transaction(() => {
      scope(value.collection_id || 'unfiled'); unique(value.collection_id, value.name);
      if (db.prepare('SELECT count(*) n FROM saved_views WHERE collection_id IS ?').get(value.collection_id).n >= 50) throw fail(409, '每个知识库最多保存 50 个筛选，请先整理已有筛选');
      const id = randomUUID(), time = new Date().toISOString();
      db.prepare('INSERT INTO saved_views(id,collection_id,name,config,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').run(id, value.collection_id, value.name, JSON.stringify(value.config), time, time);
      return serialize(get(id));
    });
    res.status(201).json(result);
  });
  app.patch('/api/saved-views/:id', (req, res) => {
    const value = update.parse(req.body);
    res.json(transaction(() => {
      const old = get(req.params.id);
      if (old.version !== value.version) throw fail(409, '这个筛选已在其他页面修改，请读取最新版本后重试');
      const title = value.name ?? old.name, config = value.config ? JSON.stringify(value.config) : old.config;
      unique(old.collection_id, title, old.id);
      if (title !== old.name || config !== old.config) db.prepare('UPDATE saved_views SET name=?,config=?,version=version+1,updated_at=? WHERE id=?').run(title, config, new Date().toISOString(), old.id);
      return serialize(get(old.id));
    }));
  });
  app.delete('/api/saved-views/:id', (req, res) => {
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    transaction(() => { const old = get(req.params.id); if (old.version !== version) throw fail(409, '这个筛选已在其他页面修改，请读取最新版本后重试'); db.prepare('DELETE FROM saved_views WHERE id=?').run(old.id); });
    res.status(204).end();
  });
}
