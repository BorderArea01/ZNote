import { unlink } from 'node:fs/promises';

// Restoration needs both response streams and asynchronous route handlers to finish.
export function maintenanceGate(app) {
  const responses = new Set(), handlers = new Map(), background = new Set();
  let locked = false, lockedMessage = "正在恢复备份，请稍后重新登录";
  app.use((req, res, next) => {
    if (locked && req.path !== '/api/health') return res.status(503).json({ error: lockedMessage });
    responses.add(res);
    res.once('close', () => responses.delete(res));
    res.once('finish', () => responses.delete(res));
    next();
  });
  for (const method of ['get', 'post', 'patch', 'delete']) {
    const register = app[method].bind(app);
    app[method] = (path, ...route) => {
      if (!route.length) return register(path);
      const handler = route.pop();
      return register(path, ...route, async (req, res, next) => {
        if (locked && req.path !== '/api/health') {
          for (const file of [req.file, ...(req.files || [])].filter(Boolean)) if (file.path) await unlink(file.path).catch(() => {});
          req.releaseStream?.();
          return res.status(503).json({ error: lockedMessage });
        }
        handlers.set(req, res);
        try { await handler(req, res, next); } catch (e) { next(e); }
        finally { handlers.delete(req); }
      });
    };
  }
  return {
    get locked() { return locked; },
    async work(operation) {
      if (locked) throw Object.assign(new Error(lockedMessage), { status: 409 });
      const work = Promise.resolve().then(operation); background.add(work);
      try { return await work; } finally { background.delete(work); }
    },
    async exclusive(res, operation, message="正在恢复备份，请稍后重新登录") {
      if (locked) throw Object.assign(new Error('另一项维护操作正在进行'), { status: 409 });
      locked = true; lockedMessage=message;
      try {
        const deadline = Date.now() + 30000;
        while (background.size || [...responses].some(r => r !== res) || [...handlers.values()].some(r => r !== res)) {
          if (Date.now() > deadline) throw Object.assign(new Error('仍有上传或下载正在进行，请完成后重试'), { status: 409 });
          await new Promise(r => setTimeout(r, 25));
        }
        return await operation();
      } finally { locked = false; }
    },
  };
}
