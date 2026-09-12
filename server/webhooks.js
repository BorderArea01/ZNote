import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { z } from 'zod';

const types = ['item.created', 'item.updated', 'item.deleted', 'item.restored'];
const endpoint = z.url().max(2048).refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
}, '请使用不含账号密码和片段的 HTTP(S) 地址');
const input = z.object({ name: z.string().trim().min(1).max(80), url: endpoint, events: z.array(z.enum(types)).min(1).max(4).default(types), enabled: z.boolean().default(true) });
const fail = (status, message) => Object.assign(new Error(message), { status });

export function webhookSignature(secret, id, timestamp, payload) {
  return 'v1,' + createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${payload}`).digest('base64');
}

export function createWebhookManager({ db, maintenance, now = () => Date.now(), fetcher = fetch, timeoutMs = 5000 }) {
  let busy = false, stopped = false, timer;
  const iso = () => new Date(now()).toISOString();
  const get = id => { const row = db.prepare('SELECT * FROM webhooks WHERE id=?').get(id); if (!row) throw fail(404, 'Webhook 不存在'); return row; };
  const publicRow = row => ({ id: row.id, name: row.name, url: row.url, events: JSON.parse(row.events), enabled: !!row.enabled, created_at: row.created_at,
    pending: db.prepare("SELECT count(*) n FROM webhook_deliveries WHERE webhook_id=? AND status IN ('pending','inflight')").get(row.id).n,
    failed: db.prepare("SELECT count(*) n FROM webhook_deliveries WHERE webhook_id=? AND status='failed'").get(row.id).n,
  });
  const recover = () => db.prepare("UPDATE webhook_deliveries SET status='pending',next_attempt=?,last_error='服务重启后重试未确认的投递' WHERE status='inflight'").run(now());
  const enqueue = () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const hook of db.prepare('SELECT * FROM webhooks WHERE enabled=1').all()) {
        const events = db.prepare('SELECT * FROM events WHERE id>? ORDER BY id LIMIT 100').all(hook.cursor);
        const enabled = JSON.parse(hook.events);
        for (const event of events) if (enabled.includes(event.type)) {
          db.prepare('INSERT OR IGNORE INTO webhook_deliveries(id,webhook_id,event_id,payload,next_attempt,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
            .run(randomUUID(), hook.id, event.id, JSON.stringify(event), now(), iso(), iso());
        }
        if (events.length) db.prepare('UPDATE webhooks SET cursor=? WHERE id=?').run(events.at(-1).id, hook.id);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  async function deliver(job) {
    const hook = get(job.webhook_id), attempts = job.attempts + 1;
    db.prepare("UPDATE webhook_deliveries SET status='inflight',attempts=?,updated_at=? WHERE id=?").run(attempts, iso(), job.id);
    let status = null, error = null;
    try {
      const timestamp = String(Math.floor(now() / 1000));
      const response = await fetcher(hook.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: {
        'Content-Type': 'application/json', 'webhook-id': job.id, 'webhook-timestamp': timestamp,
        'webhook-signature': webhookSignature(hook.secret, job.id, timestamp, job.payload),
      }, body: job.payload });
      status = response.status;
      await response.body?.cancel();
      if (!response.ok) error = `接收端返回 HTTP ${status}`;
    } catch (e) { error = e.name === 'TimeoutError' || e.name === 'AbortError' ? '接收端超时' : '无法连接接收端（或发生重定向）'; }
    db.prepare('UPDATE webhook_deliveries SET status=?,next_attempt=?,last_status=?,last_error=?,updated_at=? WHERE id=?')
      .run(error ? attempts >= 8 ? 'failed' : 'pending' : 'delivered', now() + Math.min(3600000, 1000 * 2 ** (attempts - 1)), status, error, iso(), job.id);
  }
  const tick = async () => {
    if (busy || stopped || maintenance.locked) return;
    busy = true;
    try {
      enqueue();
      const due = db.prepare("SELECT d.* FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE w.enabled=1 AND d.status='pending' AND d.next_attempt<=? ORDER BY d.next_attempt,d.created_at LIMIT 2").all(now());
      const results = await Promise.allSettled(due.map(deliver));
      const failure = results.find(r => r.status === 'rejected');
      if (failure) throw failure.reason;
      // Completed delivery detail is bounded; failed/pending jobs are always retained.
      db.prepare("DELETE FROM webhook_deliveries WHERE status='delivered' AND id NOT IN (SELECT id FROM webhook_deliveries WHERE status='delivered' ORDER BY updated_at DESC LIMIT 1000)").run();
    } finally { busy = false; }
  };
  return {
    tick, recover,
    get busy() { return busy; },
    list() { return db.prepare('SELECT * FROM webhooks ORDER BY created_at').all().map(publicRow); },
    create(value) {
      if (db.prepare('SELECT count(*) n FROM webhooks').get().n >= 20) throw fail(400, '最多可配置 20 个 Webhook');
      const parsed = input.parse(value), id = randomUUID(), secret = 'whsec_' + randomBytes(32).toString('base64');
      const cursor = db.prepare('SELECT coalesce(max(id),0) n FROM events').get().n;
      db.prepare('INSERT INTO webhooks VALUES(?,?,?,?,?,?,?,?)').run(id, parsed.name, parsed.url, secret, JSON.stringify(parsed.events), +parsed.enabled, cursor, iso());
      return { ...publicRow(get(id)), secret };
    },
    update(id, value) {
      if (busy) throw fail(409, '投递进行中，请稍后修改');
      const old = get(id), parsed = input.parse({ ...old, events: JSON.parse(old.events), enabled: !!old.enabled, ...value });
      db.prepare('UPDATE webhooks SET name=?,url=?,events=?,enabled=? WHERE id=?').run(parsed.name, parsed.url, JSON.stringify(parsed.events), +parsed.enabled, id);
      return publicRow(get(id));
    },
    remove(id) { if (busy) throw fail(409, '投递进行中，请稍后删除'); get(id); db.prepare('DELETE FROM webhooks WHERE id=?').run(id); },
    deliveries(id, offset = 0) {
      get(id); return { items: db.prepare('SELECT * FROM webhook_deliveries WHERE webhook_id=? ORDER BY created_at DESC,id LIMIT 50 OFFSET ?').all(id, offset),
        total: db.prepare('SELECT count(*) n FROM webhook_deliveries WHERE webhook_id=?').get(id).n, offset };
    },
    retry(id, deliveryId) {
      get(id); if (busy) throw fail(409, '投递进行中，请稍后重试');
      const row = db.prepare('SELECT * FROM webhook_deliveries WHERE id=? AND webhook_id=?').get(deliveryId, id);
      if (!row) throw fail(404, '投递记录不存在');
      db.prepare("UPDATE webhook_deliveries SET status='pending',attempts=0,next_attempt=?,last_error=NULL,updated_at=? WHERE id=?").run(now(), iso(), deliveryId);
      return { queued: true };
    },
    async idle() { while (busy) await new Promise(r => setTimeout(r, 25)); },
    start() { stopped = false; recover(); timer = setInterval(() => { tick().catch(() => {}); }, 1000); timer.unref(); },
    async stop() { stopped = true; clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 25)); },
  };
}

export function registerWebhookRoutes(app, manager, admin) {
  app.get('/api/webhooks', admin, (req, res) => res.json(manager.list()));
  app.post('/api/webhooks', admin, (req, res) => res.status(201).json(manager.create(req.body)));
  app.patch('/api/webhooks/:id', admin, (req, res) => res.json(manager.update(req.params.id, req.body)));
  app.delete('/api/webhooks/:id', admin, (req, res) => { manager.remove(req.params.id); res.status(204).end(); });
  app.get('/api/webhooks/:id/deliveries', admin, (req, res) => res.json(manager.deliveries(req.params.id, z.coerce.number().int().min(0).parse(req.query.offset || 0))));
  app.post('/api/webhooks/:id/deliveries/:delivery/retry', admin, (req, res) => res.json(manager.retry(req.params.id, req.params.delivery)));
}
