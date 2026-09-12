import { DatabaseSync } from 'node:sqlite';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, readdir, stat, unlink, rename, rm, copyFile, open } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline, finished } from 'node:stream/promises';
import yauzl from 'yauzl';
import multer from 'multer';
import { z } from 'zod';
import { exportContent } from './exports.js';
import { originalBuffer, digest } from './storage.js';
import { fileDigest, MAX_VIDEO_BYTES } from './videos.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const policySchema = z.object({ enabled: z.boolean(), interval_hours: z.number().int().min(1).max(720), keep: z.number().int().min(1).max(100) });
const safeKey = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value) && !value.includes('..');
const uuid = z.uuid();
const requiredTables = ['settings', 'tokens', 'collections', 'items', 'events'];
const tables = [...requiredTables, 'webhooks', 'webhook_deliveries'];

async function removeStage(root, path) {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe staging cleanup');
  await rm(path, { recursive: true, force: true });
}

async function extract(file, directory, maxBytes) {
  await mkdir(join(directory, 'data', 'media'), { recursive: true });
  const zip = await new Promise((yes, no) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (e, z) => e ? no(e) : yes(z)));
  await new Promise((yes, no) => {
    const seen = new Set(); let bytes = 0, count = 0, settled = false;
    const reject = error => { if (settled) return; settled = true; zip.close(); no(error); };
    zip.on('error', reject);
    zip.on('end', () => { if (!settled) { settled = true; yes(); } });
    zip.on('entry', async entry => {
      try {
        const name = entry.fileName;
        if (++count > 100000 || seen.has(name.toLowerCase())) throw fail(400, '备份存在重复文件或文件过多');
        seen.add(name.toLowerCase());
        if (!['data/', 'data/media/'].includes(name) && name !== 'data/znote.sqlite' && name !== 'RESTORE.txt' && !(name.startsWith('data/media/') && safeKey(name.slice(11)))) throw fail(400, '备份包含不支持的路径');
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (mode === 0xa000 || entry.generalPurposeBitFlag & 1) throw fail(400, '不支持链接或加密备份');
        if (name.endsWith('/')) { zip.readEntry(); return; }
        bytes += entry.uncompressedSize;
        if (bytes > maxBytes || (name === 'RESTORE.txt' && entry.uncompressedSize > 65536)) throw fail(413, '备份解压大小超过限制');
        const stream = await new Promise((yes, no) => zip.openReadStream(entry, (e, s) => e ? no(e) : yes(s)));
        await pipeline(stream, createWriteStream(join(directory, name), { flags: 'wx' }));
        zip.readEntry();
      } catch (e) { reject(e); }
    });
    zip.readEntry();
  });
}

async function inspectBackup(stage) {
  const root = join(stage, 'data');
  let snapshot;
  try {
    snapshot = new DatabaseSync(join(root, 'znote.sqlite'), { readOnly: true });
    snapshot.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
    const version = snapshot.prepare('PRAGMA user_version').get().user_version;
    if (![1, 2, 3, 4, 5, 6, 7].includes(version)) throw fail(400, '备份数据版本不兼容，需要受支持的 ZNote 完整备份');
    if (snapshot.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || snapshot.prepare('PRAGMA foreign_key_check').all().length) throw fail(400, '备份数据库完整性检查失败');
    for (const name of tables) {
      const table = snapshot.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(name);
      if (!table && !requiredTables.includes(name)) continue;
      if (table?.type !== 'table' || /VIRTUAL\s+TABLE/i.test(table.sql || '')) throw fail(400, '备份缺少必要数据表');
    }
    const counts = Object.fromEntries(requiredTables.map(name => [name, snapshot.prepare(`SELECT count(*) n FROM ${name}`).get().n]));
    const password = snapshot.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(password || '')) throw fail(400, '备份的访问密码记录缺失或损坏');
    for (const collection of snapshot.prepare('SELECT * FROM collections').iterate()) {
      uuid.parse(collection.id); z.string().min(1).max(80).parse(collection.name);
    }
    if (snapshot.prepare("SELECT 1 FROM sqlite_master WHERE name='webhooks'").get()) {
      for (const hook of snapshot.prepare('SELECT * FROM webhooks').iterate()) {
        uuid.parse(hook.id); z.string().min(1).max(80).parse(hook.name);
        const url = new URL(hook.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw fail(400, '备份中的 Webhook 地址不正确');
        z.array(z.enum(['item.created', 'item.updated', 'item.deleted', 'item.restored'])).min(1).max(4).parse(JSON.parse(hook.events));
        if (!/^whsec_[A-Za-z0-9+/]{43}=$/.test(hook.secret)) throw fail(400, '备份中的 Webhook 密钥不正确');
      }
    }
    if (snapshot.prepare("SELECT 1 FROM sqlite_master WHERE name='webhook_deliveries'").get()) {
      for (const delivery of snapshot.prepare('SELECT * FROM webhook_deliveries').iterate()) {
        uuid.parse(delivery.id); uuid.parse(delivery.webhook_id);
        z.enum(['pending', 'inflight', 'delivered', 'failed']).parse(delivery.status);
        z.object({ id: z.number().int(), type: z.string(), item_id: z.string().nullable(), created_at: z.string() }).parse(JSON.parse(delivery.payload));
      }
    }
    const items = snapshot.prepare('SELECT * FROM items').iterate();
    let originalBytes = 0; const verified = new Map();
    for (const item of items) {
      uuid.parse(item.id);
      z.string().min(1).max(200).parse(item.title);
      z.string().max(500000).parse(item.content);
      z.array(z.string().min(1).max(40)).max(30).parse(JSON.parse(item.tags));
      if (item.source_url && !/^https?:\/\//i.test(item.source_url)) throw fail(400, '备份来源网址不正确');
      if (!['image', 'note', 'video'].includes(item.kind)) throw fail(400, '备份内容类型不正确');
      if (item.kind === 'note') continue;
      const limit = item.kind === 'video' ? MAX_VIDEO_BYTES : 25 * 1024 * 1024;
      if (item.kind === 'video' && (item.storage_codec !== 'identity' || !['video/mp4', 'video/webm', 'video/quicktime'].includes(item.mime))) throw fail(400, '备份视频格式不正确');
      if (!safeKey(item.file_key) || !['identity', 'gzip'].includes(item.storage_codec || 'identity') || !/^[0-9a-f]{64}$/.test(item.hash)) throw fail(400, '备份原图记录不正确');
      if (item.bytes > limit || item.bytes < 1) throw fail(400, '备份媒体大小不正确');
      const stored = await stat(join(root, 'media', item.file_key));
      if (stored.size > limit) throw fail(400, '备份媒体文件过大');
      if (!verified.has(item.file_key)) {
        const original = item.kind === 'video' ? await fileDigest(join(root, 'media', item.file_key)) : await originalBuffer(root, item);
        const size = item.kind === 'video' ? original.bytes : original.length;
        if (size !== item.bytes || (item.kind === 'video' ? original.hash : digest(original)) !== item.hash) throw fail(400, '备份原图或视频校验失败，文件可能损坏');
        verified.set(item.file_key, { hash: item.hash, bytes: item.bytes, codec: item.storage_codec || 'identity', stored: stored.size });
        originalBytes += size;
      }
      const prior = verified.get(item.file_key);
      if (prior.hash !== item.hash || prior.bytes !== item.bytes || prior.codec !== (item.storage_codec || 'identity')) throw fail(400, '共享原图记录不一致');
    }
    return { version, counts, unique_images: snapshot.prepare("SELECT count(DISTINCT file_key) n FROM items WHERE kind='image'").get().n, unique_videos: snapshot.prepare("SELECT count(DISTINCT file_key) n FROM items WHERE kind='video'").get().n, original_bytes: originalBytes, collections: snapshot.prepare('SELECT name FROM collections ORDER BY created_at').all().map(c => c.name) };
  } catch (e) {
    if (e.status) throw e;
    throw fail(400, '无法读取完整备份，数据库或原图缺失、损坏或格式不正确');
  } finally { snapshot?.close(); }
}

export function createBackupManager({ db, dataDir, maintenance, clearCache = () => {}, beforeRestore = async () => {}, afterRestore = () => {}, now = () => Date.now(), maxRestoreBytes = 20 * 1024 ** 3 }) {
  const directory = join(dataDir, 'backups'), staging = join(dataDir, 'restore-staging');
  let busy = false, stopped = false, timer;
  const previews = new Map();
  const configPath = join(directory, 'policy.json');
  const defaults = { enabled: true, interval_hours: 24, keep: 7, last_attempt: null, last_success: null, last_error: null };
  const ready = (async () => {
    await mkdir(directory, { recursive: true }); await mkdir(staging, { recursive: true });
    // Preview IDs are process-local. After a restart their owned staging
    // directories cannot be used again, so reclaim only our exact prefix.
    for (const entry of await readdir(staging, { withFileTypes: true }))
      if (entry.isDirectory() && /^preview-[a-zA-Z0-9]{6}$/.test(entry.name)) await removeStage(staging, join(staging, entry.name));
  })();
  const config = async () => { await ready; try { return { ...defaults, ...JSON.parse(await readFile(configPath, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw e; return { ...defaults }; } };
  const saveConfig = async value => { await ready; const temp = join(directory, `${randomUUID()}.json.tmp`); await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, configPath); };
  const list = async () => {
    await ready;
    const names = (await readdir(directory)).filter(name => /^\d{13}-[\da-f-]{36}\.zip$/.test(name));
    return Promise.all(names.sort().reverse().map(async id => ({ id, created_at: new Date(Number(id.slice(0, 13))).toISOString(), bytes: (await stat(join(directory, id))).size })));
  };
  const archive = async () => {
    await ready;
    const id = `${now()}-${randomUUID()}.zip`, temp = join(directory, id + '.tmp');
    const output = createWriteStream(temp, { flags: 'wx' });
    output.attachment = () => output;
    const completed = finished(output); completed.catch(() => {});
    try {
      await exportContent({ db, dir: dataDir, req: { query: { mode: 'backup' } }, res: output, serialize: row => row });
      await completed;
      const handle = await open(temp, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
      await rename(temp, join(directory, id));
      return id;
    } catch (e) { output.destroy(); await completed.catch(() => {}); await unlink(temp).catch(() => {}); throw e; }
  };
  const run = async () => {
    if (busy || maintenance.locked) throw fail(409, '备份或恢复任务正在进行');
    busy = true;
    try {
      const id = await maintenance.work(archive);
      const current = await config();
      await saveConfig({ ...current, last_attempt: now(), last_success: now(), last_error: null });
      for (const entry of (await list()).slice(current.keep)) await unlink(join(directory, entry.id));
      return { id };
    } catch (e) {
      const current = await config();
      await saveConfig({ ...current, last_attempt: now(), last_error: '备份失败，请检查原图是否完整、磁盘空间与目录权限' });
      throw e;
    } finally { busy = false; }
  };
  const cleanupPreviews = async () => {
    for (const [id, preview] of previews) if (preview.expires < now()) { previews.delete(id); await removeStage(staging, preview.stage); }
  };
  const preview = async file => {
    if (busy || maintenance.locked) throw fail(409, '备份或恢复任务正在进行');
    busy = true;
    let stage;
    try {
      await ready;
      await mkdir(staging, { recursive: true }); await cleanupPreviews();
      if (previews.size >= 3) throw fail(409, '已有三个待恢复备份，请取消不再需要的预览');
      stage = await mkdtemp(join(staging, 'preview-'));
      await extract(file, stage, maxRestoreBytes);
      const summary = await inspectBackup(stage), id = randomUUID();
      previews.set(id, { stage, summary, expires: now() + 3600000 });
      return { id, ...summary, expires_at: new Date(now() + 3600000).toISOString() };
    } catch (e) { if (stage) await removeStage(staging, stage); if (e.status) throw e; throw fail(400, '备份压缩包损坏或不是 ZNote 完整备份'); }
    finally { busy = false; }
  };
  const restore = async (id, res) => {
    if (busy) throw fail(409, '备份或恢复任务正在进行');
    const candidate = previews.get(id);
    if (!candidate || candidate.expires < now()) throw fail(404, '恢复预览已失效，请重新上传备份');
    busy = true;
    try {
      return await maintenance.exclusive(res, async () => {
        await beforeRestore();
        await inspectBackup(candidate.stage);
        // Keep a complete pre-restore archive regardless of the retention limit.
        const safety = await archive();
        const source = new DatabaseSync(join(candidate.stage, 'data', 'znote.sqlite'), { readOnly: true });
        source.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
        const oldKeys = db.prepare("SELECT DISTINCT file_key FROM items WHERE kind IN ('image','video')").all().map(i => i.file_key);
        const newKeys = new Map(); let committed = false;
        try {
          const sourceImages = source.prepare("SELECT * FROM items WHERE kind IN ('image','video')").iterate();
          for (const item of sourceImages) if (!newKeys.has(item.file_key)) {
            const key = randomUUID() + (item.storage_codec === 'gzip' ? '.gz' : '.bin');
            await copyFile(join(candidate.stage, 'data', 'media', item.file_key), join(dataDir, 'media', key));
            newKeys.set(item.file_key, key);
            const hash = item.kind === 'video' ? (await fileDigest(join(dataDir, 'media', key))).hash : digest(await originalBuffer(dataDir, { ...item, file_key: key }));
            if (hash !== item.hash) throw new Error('Restored original verification failed');
            const handle = await open(join(dataDir, 'media', key), 'r+'); try { await handle.sync(); } finally { await handle.close(); }
          }
          db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
          try {
            for (const table of [...tables].reverse()) db.exec(`DELETE FROM ${table}`);
            for (const table of tables) {
              if (!source.prepare('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?').get(table)) continue;
              const targetColumns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
              const columns = source.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name).filter(c => targetColumns.has(c));
              const insert = db.prepare(`INSERT INTO ${table}(${columns.map(c => '"' + c + '"').join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
              for (const row of source.prepare(`SELECT * FROM ${table}`).iterate()) {
                if (table === 'items' && ['image', 'video'].includes(row.kind)) { row.file_key = newKeys.get(row.file_key); row.thumbnail_key = null; }
                insert.run(...columns.map(c => row[c]));
              }
            }
            // Browser sessions must not survive a full restore on another device.
            db.prepare("DELETE FROM tokens WHERE kind='session'").run();
            db.prepare("UPDATE webhook_deliveries SET status='pending',next_attempt=? WHERE status='inflight'").run(now());
            db.exec("UPDATE items SET stored_bytes=bytes WHERE kind='image' AND stored_bytes IS NULL");
            if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Restored foreign keys invalid');
            afterRestore();
            db.exec('COMMIT'); committed = true;
          } catch (e) { db.exec('ROLLBACK'); throw e; }
          clearCache();
          source.close();
          for (const key of oldKeys) if (safeKey(key)) await unlink(join(dataDir, 'media', key)).catch(() => {});
          previews.delete(id); await removeStage(staging, candidate.stage).catch(() => {});
          return { restored: true, safety_backup: safety, requires_login: true };
        } finally {
          if (source.isOpen) source.close();
          if (!committed) for (const key of newKeys.values()) await unlink(join(dataDir, 'media', key)).catch(() => {});
        }
      });
    } finally { busy = false; }
  };
  const tick = async () => {
    if (stopped || busy || maintenance.locked) return;
    if (!db.prepare("SELECT value FROM settings WHERE key='password'").get()) return;
    const current = await config();
    if (current.enabled && now() - (current.last_success || 0) >= current.interval_hours * 3600000 && now() - (current.last_attempt || 0) >= 300000) await run();
    await cleanupPreviews();
  };
  return {
    list, run, preview, restore, tick,
    async status() { return { ...await config(), busy, backups: await list() }; },
    async configure(value) { if (busy) throw fail(409, '任务进行中，请稍后修改设置'); const policy = policySchema.parse(value); await saveConfig({ ...await config(), ...policy }); return this.status(); },
    async cancel(id) { const value = previews.get(id); if (!value) return; if (busy) throw fail(409, '任务正在进行'); previews.delete(id); await removeStage(staging, value.stage); },
    file(id) { if (!/^\d{13}-[\da-f-]{36}\.zip$/.test(id)) throw fail(404, '备份不存在'); return resolve(directory, id); },
    start() { stopped = false; timer = setInterval(() => { tick().catch(() => {}); }, 60000); timer.unref(); tick().catch(() => {}); },
    async stop() { stopped = true; clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 25)); for (const value of previews.values()) await removeStage(staging, value.stage); previews.clear(); },
  };
}

export function registerBackupRoutes(app, manager, admin, dataDir) {
  const upload = multer({ dest: join(dataDir, 'uploads'), limits: { files: 1, fileSize: 5 * 1024 ** 3, fields: 0 } });
  app.get('/api/backups', admin, async (req, res) => res.json(await manager.status()));
  app.patch('/api/backups/policy', admin, async (req, res) => res.json(await manager.configure(req.body)));
  app.post('/api/backups', admin, async (req, res) => res.status(201).json(await manager.run()));
  app.get('/api/backups/:id/download', admin, (req, res) => res.download(manager.file(req.params.id)));
  app.post('/api/backups/preview', admin, upload.single('file'), async (req, res) => {
    if (!req.file) throw fail(400, '请选择完整备份 ZIP');
    try { res.json(await manager.preview(req.file.path)); } finally { await unlink(req.file.path).catch(() => {}); }
  });
  app.delete('/api/backups/preview/:id', admin, async (req, res) => { await manager.cancel(req.params.id); res.status(204).end(); });
  app.post('/api/backups/restore/:id', admin, async (req, res) => {
    z.object({ confirm: z.literal('RESTORE') }).parse(req.body);
    const result = await manager.restore(req.params.id, res); res.clearCookie('znote_session'); res.json(result);
  });
}
