import express from "express";
import { archiveNoteImages } from './note-images.js';
import { fetchRemoteImage } from './remote-images.js';
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { writeFile, unlink, readFile, mkdir, copyFile } from "node:fs/promises";
import { MAX_VIDEO_BYTES, probeVideo, fileDigest, serveVideo } from './videos.js';
import { pipeline } from "node:stream/promises";
import { resolve, join } from "node:path";
import { networkInterfaces } from "node:os";
import swagger from "swagger-ui-dist";
import { openDatabase } from "./db.js";
import { spec } from "./openapi.js";
import {
  packOriginal,
  originalStream,
  thumbnail,
  storageStats,
} from "./storage.js";
import { exportContent } from "./exports.js";
import { WorkQueue } from "./work-queue.js";
import { maintenanceGate } from './maintenance.js';
import { createBackupManager, registerBackupRoutes } from './backups.js';
import { createWebhookManager, registerWebhookRoutes } from './webhooks.js';
import { registerClipper } from './clipper.js';
import { createClipperPairing } from './clipper-pair.js';
import { withSource } from './source.js';
import { createImportManager } from './imports.js';
import { registerStreamRoutes } from './streams.js';

const now = () => new Date().toISOString();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (status, message) => Object.assign(new Error(message), { status });
const filenameText = (name) => {
  // Multipart filename headers default to Latin-1 in busboy; browsers send UTF-8.
  if ([...name].some((char) => char.codePointAt(0) > 255)) return name;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(name, "latin1"),
    );
  } catch {
    return name;
  }
};
const cleanTags = z
  .array(z.string().trim().min(1).max(40))
  .max(30)
  .transform((a) => [...new Set(a)]);
const itemInput = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(500000).default(""),
  tags: cleanTags.default([]),
  collection_id: z.string().nullable().default(null),
  favorite: z.boolean().default(false),
  source_url: z.url().max(4096).refine(v => /^https?:\/\//i.test(v), '仅支持 HTTP(S) 来源网址').nullable().default(null),
  captured_at: z.iso.datetime().nullable().default(null),
});
const patchInput = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(500000).optional(),
  tags: cleanTags.optional(),
  collection_id: z.string().nullable().optional(),
  favorite: z.boolean().optional(),
});
const collectionInput = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#287464"),
});

export function createApp({
  dataDir = resolve("data"),
  port = 3741,
  staticDir = resolve("dist"),
  backupOptions = {},
  webhookOptions = {},
  importOptions = {},
  imageDownload = fetchRemoteImage,
} = {}) {
  const db = openDatabase(dataDir);
  const uploadQueue = new WorkQueue(1, 32);
  const noteArchiveQueue = new WorkQueue(1, 8);
  const thumbnailQueue = new WorkQueue(2, 128);
  const app = express();
  const maintenance = maintenanceGate(app);
  let snapshotting = false;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Frame-Options", "DENY");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    // Browser writes require same origin. Scripts authenticate with bearer tokens.
    const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || '');
    if (extensionOrigin && req.method === 'OPTIONS' && req.path.startsWith('/api/')) {
      res.set('Access-Control-Allow-Origin', req.headers.origin);
      res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
      return res.status(204).end();
    }
    let extensionToken = false;
    if (extensionOrigin && req.headers.authorization?.startsWith('Bearer ')) {
      const token = db.prepare("SELECT * FROM tokens WHERE hash=? AND kind='api'").get(hash(req.headers.authorization.slice(7)));
      extensionToken = token && (!token.expires_at || token.expires_at > now());
      if (extensionToken) res.set('Access-Control-Allow-Origin', req.headers.origin);
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host && !extensionToken && !(extensionOrigin && req.path === '/api/clipper/redeem'))
          return next(fail(403, "不允许跨站写入"));
      } catch {
        return next(fail(403, "无效的来源"));
      }
    }
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  const setting = (key) =>
    db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
  const event = (type, id) =>
    db
      .prepare("INSERT INTO events(type,item_id,created_at) VALUES(?,?,?)")
      .run(type, id, now());
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      db.exec("COMMIT");
      return v;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const serialize = (row) =>
    row && {
      ...row,
      tags: JSON.parse(row.tags),
      favorite: !!row.favorite,
      url: row.file_key ? `/media/${row.id}/original` : null,
      thumbnail_url: row.kind === 'image' ? `/media/${row.id}/thumbnail` : null,
      file_key: undefined,
      thumbnail_key: undefined,
      hash: undefined,
    };
  const getItem = (id) => {
    const item = db.prepare("SELECT * FROM items WHERE id=?").get(id);
    if (!item) throw fail(404, "内容不存在");
    return item;
  };
  const validateCollection = (id) => {
    if (id && !db.prepare("SELECT id FROM collections WHERE id=?").get(id))
      throw fail(400, "知识库不存在");
  };
  const issueToken = (name, scope, kind) => {
    const raw = `zn_${randomBytes(32).toString("hex")}`;
    const id = randomUUID();
    const created = now();
    const expires =
      kind === "session"
        ? new Date(Date.now() + 7 * 86400000).toISOString()
        : null;
    db.prepare("INSERT INTO tokens VALUES(?,?,?,?,?,?,?)").run(
      id,
      name,
      hash(raw),
      scope,
      kind,
      created,
      expires,
    );
    return {
      id,
      token: raw,
      name,
      scope,
      created_at: created,
      expires_at: expires,
    };
  };
  const session = (res, raw) =>
    res.cookie("znote_session", raw, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 7 * 86400000,
      path: "/",
    });
  app.get("/api/health", (req, res) =>
    res.json({ status: "ok", version: "0.8.3" }),
  );
  app.get("/api/auth/status", (req, res) =>
    res.json({ configured: !!setting("password") }),
  );
  app.post("/api/auth/setup", (req, res) => {
    const remote = req.socket.remoteAddress;
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote) &&
      process.env.ALLOW_REMOTE_SETUP !== "true"
    )
      throw fail(
        403,
        "请先在服务器本机打开 localhost:3741 设置密码；容器部署可设置 ALLOW_REMOTE_SETUP=true，完成后关闭。",
      );
    if (setting("password")) throw fail(409, "已经完成初始化");
    const { password } = z
      .object({ password: z.string().min(4).max(200) })
      .parse(req.body);
    const salt = randomBytes(16).toString("hex");
    db.prepare("INSERT INTO settings VALUES(?,?)").run(
      "password",
      `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    );
    const token = issueToken("浏览器会话", "admin", "session");
    session(res, token.token);
    res.status(201).json({ ok: true });
  });
  const attempts = new Map();
  app.post("/api/auth/login", (req, res) => {
    const key = req.socket.remoteAddress;
    const previous = attempts.get(key);
    const attempt =
      previous && previous.until > Date.now()
        ? previous
        : { count: 0, until: Date.now() + 60000 };
    if (attempt.count >= 10) throw fail(429, "尝试次数过多，请一分钟后重试");
    attempts.set(key, { ...attempt, count: attempt.count + 1 });
    // Bound expired rate-limit state without retaining an unbounded IP list.
    if (attempts.size > 1000)
      for (const [ip, state] of attempts)
        if (state.until < Date.now()) attempts.delete(ip);
    const { password } = z
      .object({ password: z.string().max(200) })
      .parse(req.body);
    const stored = setting("password");
    if (!stored) throw fail(409, "请先初始化");
    const [salt, digest] = stored.split(":");
    if (
      !timingSafeEqual(
        Buffer.from(digest, "hex"),
        scryptSync(password, salt, 64),
      )
    )
      throw fail(401, "密码不正确");
    attempts.delete(key);
    db.prepare(
      "DELETE FROM tokens WHERE kind='session' AND expires_at < ?",
    ).run(now());
    session(res, issueToken("浏览器会话", "admin", "session").token);
    res.json({ ok: true });
  });
  const authenticate = (req, res, next) => {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("znote_session="))
      ?.slice(14);
    const raw = req.headers.authorization?.replace(/^Bearer /, "") || cookie;
    const token =
      raw && db.prepare("SELECT * FROM tokens WHERE hash=?").get(hash(raw));
    if (!token || (token.expires_at && token.expires_at < now()))
      return next(fail(401, "请先登录"));
    req.auth = token;
    if (!["GET", "HEAD"].includes(req.method) && token.scope === "read")
      return next(fail(403, "此令牌只有读取权限"));
    next();
  };
  const clipperPairing = createClipperPairing(db, issueToken);
  app.post('/api/clipper/redeem', clipperPairing.redeem);
  app.use("/api", authenticate);
  app.post('/api/clipper/pair', clipperPairing.issue);
  app.use("/media", authenticate);
  const admin = (req, res, next) =>
    req.auth.scope === "admin"
      ? next()
      : next(fail(403, "此操作需要管理员会话"));
  app.get("/api/me", (req, res) => res.json({ scope: req.auth.scope }));
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM tokens WHERE id=?").run(req.auth.id);
    res.clearCookie("znote_session");
    res.json({ ok: true });
  });
  app.get("/api/info", (req, res) => {
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i.family === "IPv4" && !i.internal)
      .map((i) => `http://${i.address}:${port}`);
    res.json({
      name: "ZNote",
      version: "0.8.3",
      addresses,
      storage: "无损压缩原图 · 按需缩略图",
      max_upload_mb: 25,
      max_batch_files: 20,
    });
  });
  app.get("/api/storage", admin, async (req, res) =>
    res.json(await storageStats(db, dataDir)),
  );
  const preferences = () => ({
    default_collection_id: setting("default_collection_id") || null,
  });
  app.get("/api/preferences", (req, res) => res.json(preferences()));
  app.patch("/api/preferences", admin, (req, res) => {
    const input = z
      .object({ default_collection_id: z.string().nullable() })
      .parse(req.body);
    if (input.default_collection_id !== "unfiled")
      validateCollection(input.default_collection_id);
    db.prepare(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run("default_collection_id", input.default_collection_id || "");
    res.json(preferences());
  });
  const collectionScope = (value, prefix = '') => value === undefined ? { sql: '', args: [] } :
    value === 'unfiled' ? { sql: ` AND ${prefix}collection_id IS NULL`, args: [] } :
    { sql: ` AND ${prefix}collection_id=?`, args: [z.string().max(100).parse(value)] };
  app.get("/api/stats", (req, res) => {
    const scope = collectionScope(req.query.collection);
    const counts = db
      .prepare(
        `SELECT count(*) total, coalesce(sum(kind='image'),0) images, coalesce(sum(kind='video'),0) videos, coalesce(sum(kind='note'),0) notes, coalesce(sum(favorite),0) favorites, coalesce(sum(bytes),0) bytes FROM items WHERE deleted_at IS NULL${scope.sql}`,
      )
      .get(...scope.args);
    res.json({
      ...counts,
      collections: db.prepare("SELECT count(*) n FROM collections").get().n,
      trash: db
        .prepare(`SELECT count(*) n FROM items WHERE deleted_at IS NOT NULL${scope.sql}`)
        .get(...scope.args).n,
    });
  });
  app.get("/api/collections", (req, res) =>
    res.json(
      db
        .prepare(
          `SELECT c.*, (SELECT count(*) FROM items i WHERE i.collection_id=c.id AND deleted_at IS NULL) count FROM collections c ORDER BY created_at`,
        )
        .all(),
    ),
  );
  app.post("/api/collections", (req, res) => {
    const c = collectionInput.parse(req.body);
    const id = randomUUID();
    db.prepare("INSERT INTO collections VALUES(?,?,?,?)").run(
      id,
      c.name,
      c.color,
      now(),
    );
    res
      .status(201)
      .json(db.prepare("SELECT * FROM collections WHERE id=?").get(id));
  });
  app.patch("/api/collections/:id", (req, res) => {
    const c = collectionInput.parse(req.body);
    const result = db
      .prepare("UPDATE collections SET name=?,color=? WHERE id=?")
      .run(c.name, c.color, req.params.id);
    if (!result.changes) throw fail(404, "知识库不存在");
    res.json({ id: req.params.id, ...c });
  });
  app.delete("/api/collections/:id", (req, res) => {
    transaction(() => {
      const result = db
        .prepare("DELETE FROM collections WHERE id=?")
        .run(req.params.id);
      if (!result.changes) throw fail(404, "知识库不存在");
      if (setting("default_collection_id") === req.params.id)
        db.prepare(
          "DELETE FROM settings WHERE key='default_collection_id'",
        ).run();
    });
    res.status(204).end();
  });
  app.get("/api/tags", (req, res) => {
    const scope = collectionScope(req.query.collection, 'items.');
    res.json(
      db
        .prepare(
          `SELECT j.value name, count(*) count FROM items, json_each(items.tags) j WHERE deleted_at IS NULL${scope.sql} GROUP BY j.value ORDER BY count DESC, name`,
        )
        .all(...scope.args),
    );
  });
  app.get("/api/items", (req, res) => {
    const q = z
      .object({
        q: z.string().max(200).optional(),
        kind: z.enum(["note", "image", "video"]).optional(),
        collection: z.string().optional(),
        tag: z.string().optional(),
        tags: z.string().max(3000).optional(),
        tag_mode: z.enum(["all", "any"]).default("all"),
        favorite: z.enum(["true", "false"]).optional(),
        trash: z.enum(["true", "false"]).optional(),
        sort: z.enum(["updated", "created", "title"]).default("updated"),
        limit: z.coerce.number().int().min(1).max(100).default(60),
        offset: z.coerce.number().int().min(0).default(0),
        gallery: z.enum(['true', 'false']).default('false'),
      })
      .parse(req.query);
    const where = [
      q.trash === "true" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL",
    ];
    const args = [];
    if (q.q) {
      where.push([...q.q].length >= 3
        ? "rowid IN (SELECT rowid FROM items_search WHERE title LIKE ? UNION SELECT rowid FROM items_search WHERE content LIKE ? UNION SELECT rowid FROM items_search WHERE tags LIKE ?)"
        : "(title LIKE ? OR content LIKE ? OR tags LIKE ?)");
      args.push(...Array(3).fill(`%${q.q}%`));
    }
    if (q.kind) {
      where.push("kind=?");
      args.push(q.kind);
    }
    if (q.collection === "unfiled") where.push("collection_id IS NULL");
    else if (q.collection) {
      where.push("collection_id=?");
      args.push(q.collection);
    }
    if (q.tag) {
      where.push("EXISTS (SELECT 1 FROM json_each(items.tags) WHERE value=?)");
      args.push(q.tag);
    }
    if (q.tags) {
      let parsed;
      try {
        parsed = JSON.parse(q.tags);
      } catch {
        throw fail(400, "tags 必须是 JSON 数组");
      }
      const selectedTags = cleanTags.parse(parsed);
      if (selectedTags.length) {
        where.push(
          "(" +
            selectedTags
              .map(
                () =>
                  "EXISTS (SELECT 1 FROM json_each(items.tags) WHERE value=?)",
              )
              .join(q.tag_mode === "all" ? " AND " : " OR ") +
            ")",
        );
        args.push(...selectedTags);
      }
    }
    if (q.favorite === "true") where.push("favorite=1");
    const clause = where.join(" AND ");
    const sort = {
      updated: "updated_at DESC, id",
      created: "created_at DESC, id",
      title: "title COLLATE NOCASE, id",
    }[q.sort];
    if (q.gallery === 'true') return res.json({ ids: db.prepare(`SELECT id FROM items WHERE ${clause} AND kind='image' ORDER BY ${sort}`).all(...args).map(item => item.id) });
    res.json({
      items: db
        .prepare(
          `SELECT * FROM items WHERE ${clause} ORDER BY ${sort} LIMIT ? OFFSET ?`,
        )
        .all(...args, q.limit, q.offset)
        .map(serialize),
      total: db
        .prepare(`SELECT count(*) n FROM items WHERE ${clause}`)
        .get(...args).n,
      offset: q.offset,
      limit: q.limit,
    });
  });
  const insert = (input, image = null) => {
    if (input.source_url) input = withSource(input);
    validateCollection(input.collection_id);
    const id = randomUUID();
    const date = now();
    transaction(() => {
      db.prepare(
        `INSERT INTO items(id,kind,title,content,tags,collection_id,favorite,file_key,thumbnail_key,mime,bytes,width,height,hash,created_at,updated_at,storage_codec,stored_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        image?.kind || (image ? "image" : "note"),
        input.title,
        input.content,
        JSON.stringify(input.tags),
        input.collection_id,
        +input.favorite,
        image?.key ?? null,
        null,
        image?.mime ?? null,
        image?.bytes ?? null,
        image?.width ?? null,
        image?.height ?? null,
        image?.hash ?? null,
        date,
        date,
        image?.codec || "identity",
        image?.storedBytes ?? null,
      );
      db.prepare('UPDATE items SET source_url=?,captured_at=? WHERE id=?').run(input.source_url ?? null, input.captured_at ?? null, id);
      if (image?.kind === 'video') db.prepare('UPDATE items SET duration=?,video_codec=? WHERE id=?').run(image.duration, image.codecName, id);
      event("item.created", id);
    });
    return serialize(getItem(id));
  };
  app.post("/api/items", async (req, res) => {
    const input=itemInput.parse(req.body); validateCollection(input.collection_id);
    const archive=z.boolean().default(true).parse(req.body.archive_images);
    const result=archive?await noteArchiveQueue.run(randomUUID(),()=>archiveNoteImages(input,{download:imageDownload,save:saveAsset})):null;
    if(result)input.content=result.content;
    res.status(201).json({...insert(input),...(result?{image_archive:result.report}:{})});
  });
  const imageReference = (item) => ({
    kind: item.kind, duration: item.duration, codecName: item.video_codec,
    key: item.file_key, mime: item.mime, bytes: item.bytes, width: item.width,
    height: item.height, hash: item.hash, codec: item.storage_codec, storedBytes: item.stored_bytes,
  });
  app.post('/api/items/:id/copy', (req, res) => {
    const source = getItem(req.params.id);
    if (!['image', 'video'].includes(source.kind) || source.deleted_at) throw fail(409, '只能复用未删除的图片或视频');
    const input = itemInput.parse({ ...serialize(source), ...req.body });
    validateCollection(input.collection_id);
    const existing = db.prepare('SELECT * FROM items WHERE hash=? AND collection_id IS ? AND deleted_at IS NULL').get(source.hash, input.collection_id);
    if (existing) return res.json({ ...serialize(existing), duplicate: true });
    res.status(201).json({ ...insert(input, imageReference(source)), shared: true });
  });
  app.post('/api/items/batch-organize', (req, res) => {
    const input = z.object({
      items: z.array(z.object({ id: z.string(), version: z.number().int().positive() })).min(1).max(100),
      collection_id: z.string().nullable().optional(), favorite: z.boolean().optional(),
    }).refine(v => v.collection_id !== undefined || v.favorite !== undefined).parse(req.body);
    if (new Set(input.items.map(i => i.id)).size !== input.items.length) throw fail(400, '内容 ID 不可重复');
    if (input.collection_id !== undefined) validateCollection(input.collection_id);
    const result = transaction(() => input.items.map(value => {
      const old = getItem(value.id);
      if (old.deleted_at || old.version !== value.version) throw fail(409, '部分内容已被修改或删除，请刷新后重试');
      const target = input.collection_id === undefined ? old.collection_id : input.collection_id;
      if (old.hash && target !== old.collection_id && db.prepare('SELECT id FROM items WHERE hash=? AND collection_id IS ? AND deleted_at IS NULL AND id!=?').get(old.hash, target, old.id))
        throw fail(409, '目标知识库已有同一图片；请保留独立记录或先整理目标条目');
      db.prepare('UPDATE items SET collection_id=?,favorite=?,updated_at=?,version=version+1 WHERE id=?')
        .run(target, input.favorite === undefined ? old.favorite : +input.favorite, now(), old.id);
      event('item.updated', old.id);
      return serialize(getItem(old.id));
    }));
    res.json({ items: result });
  });
  app.post('/api/items/batch-trash', (req, res) => {
    const input = z.object({ items: z.array(z.object({id:z.string(),version:z.number().int().positive()})).min(1).max(100),
      collection_id:z.string().nullable(), restore:z.boolean().default(false) }).parse(req.body);
    if(new Set(input.items.map(i=>i.id)).size!==input.items.length) throw fail(400,'内容 ID 不可重复');
    const result=transaction(()=>input.items.map(value=>{
      const item=getItem(value.id);
      if(item.version!==value.version || item.collection_id!==input.collection_id || Boolean(item.deleted_at)!==input.restore)
        throw fail(409,'部分内容已变更或不属于当前知识库，请刷新后重试');
      db.prepare('UPDATE items SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?').run(input.restore?null:now(),now(),item.id);
      event(input.restore?'item.restored':'item.deleted',item.id); return serialize(getItem(item.id));
    }));
    res.json({items:result});
  });
  app.post("/api/items/batch-tags", (req, res) => {
    const input = z
      .object({
        items: z
          .array(
            z.object({ id: z.string(), version: z.number().int().positive() }),
          )
          .min(1)
          .max(100),
        tags: cleanTags,
        mode: z.enum(["add", "remove", "replace"]).default("add"),
      })
      .parse(req.body);
    if (new Set(input.items.map((i) => i.id)).size !== input.items.length)
      throw fail(400, "内容 ID 不可重复");
    const result = transaction(() =>
      input.items.map((value) => {
        const item = getItem(value.id);
        if (item.deleted_at || item.version !== value.version)
          throw fail(409, "部分内容已被修改或删除，请刷新后重试");
        const oldTags = JSON.parse(item.tags);
        const tags = cleanTags.parse(
          input.mode === "replace"
            ? input.tags
            : input.mode === "remove"
              ? oldTags.filter((t) => !input.tags.includes(t))
              : [...new Set([...oldTags, ...input.tags])],
        );
        db.prepare(
          "UPDATE items SET tags=?,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(tags), now(), item.id);
        event("item.updated", item.id);
        return serialize(getItem(item.id));
      }),
    );
    res.json({ items: result });
  });
  app.get("/api/items/:id", (req, res) =>
    res.json(serialize(getItem(req.params.id))),
  );
  app.patch("/api/items/:id", async (req, res) => {
    const patch = patchInput.parse(req.body);
    const old = getItem(req.params.id);
    if (old.deleted_at) throw fail(409, "请先从回收站恢复");
    if (patch.version !== old.version)
      throw fail(409, "内容已在其他设备更新，请重新打开后编辑");
    const item = { ...serialize(old), ...patch };
    validateCollection(item.collection_id);
    const archive=z.boolean().default(true).parse(req.body.archive_images);
    const archived=old.kind==='note' && patch.content!==undefined && archive ? await noteArchiveQueue.run(randomUUID(),()=>archiveNoteImages(item,{download:imageDownload,save:saveAsset})):null;
    if(archived)item.content=archived.content;
    const current=getItem(old.id);
    if(current.deleted_at || current.version!==old.version) throw fail(409,'归档期间内容已在其他设备变更，请重新打开后保存');
    if (old.hash && old.collection_id !== item.collection_id && db.prepare('SELECT id FROM items WHERE hash=? AND collection_id IS ? AND deleted_at IS NULL AND id!=?').get(old.hash, item.collection_id, old.id))
      throw fail(409, '目标知识库已存在同一图片');
    transaction(() => {
      db.prepare(
        "UPDATE items SET title=?,content=?,tags=?,collection_id=?,favorite=?,updated_at=?,version=version+1 WHERE id=?",
      ).run(
        item.title,
        item.content,
        JSON.stringify(item.tags),
        item.collection_id,
        +item.favorite,
        now(),
        old.id,
      );
      event("item.updated", old.id);
    });
    res.json({...serialize(getItem(old.id)),...(archived?{image_archive:archived.report}:{})});
  });
  app.delete("/api/items/:id", (req, res) => {
    const item = getItem(req.params.id);
    transaction(() => {
      db.prepare(
        "UPDATE items SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?",
      ).run(now(), now(), item.id);
      event("item.deleted", item.id);
    });
    res.status(204).end();
  });
  app.post("/api/items/:id/restore", (req, res) => {
    const item = getItem(req.params.id);
    transaction(() => {
      db.prepare(
        "UPDATE items SET deleted_at=NULL,updated_at=?,version=version+1 WHERE id=?",
      ).run(now(), item.id);
      event("item.restored", item.id);
    });
    res.json(serialize(getItem(item.id)));
  });
  app.get("/api/items/:id/backlinks", (req, res) => {
    const item = getItem(req.params.id);
    const candidates = db
      .prepare(
        "SELECT * FROM items WHERE kind='note' AND deleted_at IS NULL AND id!=? AND collection_id IS ?",
      )
      .all(item.id, item.collection_id);
    res.json(
      candidates
        .filter(
          (n) =>
            n.content.includes(`[[${item.title}]]`) ||
            n.content.includes(`/media/${item.id}/`) ||
            n.content.includes(`#item/${item.id}`),
        )
        .map(serialize),
    );
  });
  const previewCache = new Map();
  let previewBytes = 0;
  const cachePreview = (id, buffer) => {
    const previous = previewCache.get(id);
    if (previous) previewBytes -= previous.length;
    previewCache.delete(id);
    previewCache.set(id, buffer);
    previewBytes += buffer.length;
    while (previewBytes > 32 * 1024 * 1024) {
      const first = previewCache.keys().next().value;
      previewBytes -= previewCache.get(first).length;
      previewCache.delete(first);
    }
  };
  const saveAsset = (file, fields) => uploadQueue.run(randomUUID(), async () => {
    let tags;
    try {
      tags = JSON.parse(fields.tags || "[]");
    } catch {
      throw fail(400, "tags 必须为 JSON 数组");
    }
    const input = itemInput.parse({
      title: fields.title || filenameText(file.originalname),
      content: fields.content || "",
      tags,
      collection_id: fields.collection_id || null,
      source_url: fields.source_url || null,
      captured_at: fields.source_url ? (fields.captured_at || now()) : (fields.captured_at || null),
    });
    validateCollection(input.collection_id);
    const buffer = file.buffer || (await readFile(file.path));
    let metadata;
    try {
      metadata = await sharp(buffer, { limitInputPixels: 80000000 }).metadata();
    } catch {
      throw fail(415, "无法识别图片，请使用 JPEG、PNG、WebP、GIF 或 AVIF");
    }
    const formats = {
      jpeg: ["jpg", "image/jpeg"],
      png: ["png", "image/png"],
      webp: ["webp", "image/webp"],
      gif: ["gif", "image/gif"],
      avif: ["avif", "image/avif"],
      heif: ["avif", "image/avif"],
    };
    if (
      !formats[metadata.format] ||
      (metadata.format === "heif" && metadata.compression !== "av1")
    )
      throw fail(415, "暂不支持此图片格式");
    const digest = hash(buffer);
    const existing = db.prepare('SELECT * FROM items WHERE hash=? AND collection_id IS ? ORDER BY deleted_at IS NOT NULL').get(digest, input.collection_id);
    if (existing?.deleted_at) throw fail(409, '这张图片已在此知识库的回收站中，请先恢复');
    if (existing) return sourceDuplicate(existing, input);
    const old = db.prepare('SELECT * FROM items WHERE hash=?').get(digest);
    if (old) return { ...insert(input, imageReference(old)), shared: true };
    const [extension, mime] = formats[metadata.format];
    const preview = await sharp(buffer, { limitInputPixels: 80000000 })
      .rotate()
      .resize({
        width: 800,
        height: 800,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    const packed = await packOriginal(buffer);
    const key =
      randomUUID() + "." + extension + (packed.codec === "gzip" ? ".gz" : "");
    let created = false;
    try {
      await writeFile(join(dataDir, "media", key), packed.buffer, {
        flag: "wx",
      });
      created = true;
      const item = insert(input, {
        key,
        mime,
        bytes: buffer.length,
        width: metadata.width,
        height: metadata.height,
        hash: digest,
        codec: packed.codec,
        storedBytes: packed.buffer.length,
      });
      cachePreview(item.hash || digest, preview);
      return item;
    } catch (e) {
      if (created) await unlink(join(dataDir, "media", key)).catch(() => {});
      if (String(e.message).includes("UNIQUE constraint failed: items.hash")) {
        const duplicate = db
          .prepare("SELECT * FROM items WHERE hash=?")
          .get(digest);
        if (duplicate && !duplicate.deleted_at)
          return { ...serialize(duplicate), duplicate: true };
        if (duplicate?.deleted_at)
          throw fail(409, "这张图片已在回收站中，请先恢复");
      }
      throw e;
    }
  });
  const upload = multer({
    dest: join(dataDir, 'uploads'),
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 1,
      fields: 8,
      fieldSize: 512000,
    },
  });
  app.post("/api/assets", upload.single("file"), async (req, res) => {
    if (!req.file) throw fail(400, "请选择图片");
    try {
      const item = await saveAsset(req.file, req.body);
      res.status(item.duplicate ? 200 : 201).json(item);
    } finally { await unlink(req.file.path).catch(() => {}); }
  });
  const batch = multer({
    dest: join(dataDir, "uploads"),
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 20,
      fields: 8,
      fieldSize: 512000,
    },
  });
  app.post("/api/assets/batch", batch.array("files", 20), async (req, res) => {
    if (!req.files?.length) throw fail(400, "请选择图片");
    const results = [];
    try {
      for (const file of req.files) {
        try {
          const item = await saveAsset(file, req.body);
          results.push({
            filename: filenameText(file.originalname),
            status: item.duplicate ? "duplicate" : "created",
            item,
          });
        } catch (e) {
          results.push({
            filename: filenameText(file.originalname),
            status: "error",
            error:
              e instanceof z.ZodError
                ? "参数格式不正确"
                : e.status
                  ? e.message
                  : "图片处理失败",
            status_code: e.status || (e instanceof z.ZodError ? 400 : 500),
          });
        }
      }
    } finally {
      await Promise.all(
        req.files.map((file) => unlink(file.path).catch(() => {})),
      );
    }
    res
      .status(results.some((r) => r.status === "error") ? 207 : 200)
      .json({ results });
  });
  function sourceDuplicate(existing, input) {
    if (input.source_url) {
      const updated = withSource({ ...existing, tags: JSON.parse(existing.tags), source_url: input.source_url });
      if (updated.content === existing.content && JSON.stringify(updated.tags) === existing.tags && existing.source_url) return { ...serialize(existing), duplicate: true };
      transaction(() => {
        db.prepare('UPDATE items SET content=?,tags=?,source_url=COALESCE(source_url,?),captured_at=COALESCE(captured_at,?),updated_at=?,version=version+1 WHERE id=?').run(updated.content, JSON.stringify(updated.tags), input.source_url, updated.captured_at, now(), existing.id);
        event('item.updated', existing.id);
      });
      existing = getItem(existing.id);
    }
    return { ...serialize(existing), duplicate: true };
  }
  const videoQueue = new WorkQueue(1, 8);
  const saveVideo = (file, fields) => videoQueue.run(randomUUID(), async () => {
        let tags; try { tags = fields.tags ? JSON.parse(fields.tags) : []; } catch { throw fail(400, '标签必须是 JSON 数组'); }
        const input = itemInput.parse({ ...fields, title: fields.title || filenameText(file.originalname), tags, collection_id: fields.collection_id || null });
        validateCollection(input.collection_id);
        const media = await probeVideo(file.path), digest = await fileDigest(file.path);
        if (digest.bytes > MAX_VIDEO_BYTES) throw fail(413, '视频超过 500 MB');
        const existing = db.prepare('SELECT * FROM items WHERE hash=? AND collection_id IS ? ORDER BY deleted_at IS NOT NULL').get(digest.hash, input.collection_id);
        if (existing?.deleted_at) throw fail(409, '此视频已在当前知识库的回收站，请先恢复');
        if (existing) return sourceDuplicate(existing, input);
        const shared = db.prepare('SELECT * FROM items WHERE hash=?').get(digest.hash);
        if (shared) return { ...insert(input, imageReference(shared)), shared: true };
        const key = randomUUID() + '.' + media.extension;
        await copyFile(file.path, join(dataDir, 'media', key), 1);
        try { return insert(input, { kind: 'video', key, mime: media.mime, bytes: digest.bytes, storedBytes: digest.bytes, width: media.width, height: media.height, hash: digest.hash, codec: 'identity', codecName: media.codec, duration: media.duration }); }
        catch (e) { await unlink(join(dataDir, 'media', key)).catch(() => {}); throw e; }
      });
  const videoUpload = multer({ dest: join(dataDir, 'uploads'), limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 8, fieldSize: 512000 } });
  app.post('/api/videos', videoUpload.single('file'), async (req, res) => {
    if (!req.file) throw fail(400, '请选择视频');
    try {
      const item = await saveVideo(req.file, req.body);
      res.status(item.duplicate ? 200 : 201).json(item);
    } finally { await unlink(req.file.path).catch(() => {}); }
  });
  const imports = createImportManager({ dataDir, ...importOptions, save: (file, input) => {
    if (snapshotting) throw fail(409, '正在导出完整备份，请稍后重新采集');
    return maintenance.work(() => saveVideo(file, { ...input, tags: JSON.stringify(input.tags) }));
  } });
  registerStreamRoutes(app, { dataDir, saveVideo });
  app.get('/api/imports', (req, res) => res.json({ jobs: imports.list() }));
  app.get('/api/imports/:id', (req, res) => res.json(imports.get(req.params.id)));
  app.post('/api/imports', (req, res) => {
    const input = z.object({ url: z.string().max(4096), tags: cleanTags.default([]), collection_id: z.string().nullable().default(null) }).parse(req.body);
    validateCollection(input.collection_id); res.status(202).json(imports.add(input));
  });
  app.delete('/api/imports/:id', (req, res) => res.json(imports.cancel(req.params.id)));
  app.get("/media/:id/:variant", async (req, res) => {
    const item = getItem(req.params.id);
    if (!item.file_key) throw fail(404, "图片不存在");
    if (!["original", "thumbnail"].includes(req.params.variant))
      throw fail(404, "图片版本不存在");
    res.set("Cache-Control", "private, no-cache");
    if (item.kind === 'video') {
      if (req.params.variant !== 'original') throw fail(404, '视频没有图片缩略图');
      return serveVideo(req, res, dataDir, item);
    }
    if (req.params.variant === "thumbnail") {
      let buffer = previewCache.get(item.hash);
      if (!buffer) {
        buffer = await thumbnailQueue.run(item.hash, async () => {
          const result = await thumbnail(dataDir, item);
          cachePreview(item.hash, result);
          return result;
        });
      } else cachePreview(item.hash, buffer);
      res.type("image/webp").send(buffer);
    } else {
      res.type(item.mime);
      await pipeline(originalStream(dataDir, item), res);
    }
  });
  app.get("/api/tokens", admin, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,name,scope,created_at FROM tokens WHERE kind='api' ORDER BY created_at DESC",
        )
        .all(),
    ),
  );
  app.post("/api/tokens", admin, (req, res) => {
    const value = z
      .object({
        name: z.string().trim().min(1).max(80),
        scope: z.enum(["read", "write"]),
      })
      .parse(req.body);
    res.status(201).json(issueToken(value.name, value.scope, "api"));
  });
  app.delete("/api/tokens/:id", admin, (req, res) => {
    db.prepare("DELETE FROM tokens WHERE id=? AND kind='api'").run(
      req.params.id,
    );
    res.status(204).end();
  });
  app.get("/api/events", (req, res) => {
    const after = z.coerce
      .number()
      .int()
      .min(0)
      .parse(req.query.after || 0);
    const events = db
      .prepare("SELECT * FROM events WHERE id>? ORDER BY id LIMIT 100")
      .all(after);
    res.json({ events, cursor: events.at(-1)?.id ?? after });
  });
  app.get("/api/export", admin, async (req, res) => {
    const full = req.query.mode === "backup";
    if (full && snapshotting)
      throw fail(409, "另一份完整备份正在生成，请稍后重试");
    if (full) snapshotting = true;
    try {
      await exportContent({ db, dir: dataDir, req, res, serialize });
    } finally {
      if (full) snapshotting = false;
    }
  });
  app.get("/api/openapi.json", (req, res) => res.json(spec));
  const webhooks = createWebhookManager({ db, maintenance, ...webhookOptions });
  registerWebhookRoutes(app, webhooks, admin);
  registerClipper(app);
  const backups = createBackupManager({ db, dataDir, maintenance, beforeRestore: async () => { await imports.cancelAll(); await webhooks.idle(); }, clearCache: () => { previewCache.clear(); previewBytes = 0; }, ...backupOptions });
  registerBackupRoutes(app, backups, admin, dataDir);
  app.use("/docs", express.static(swagger.getAbsoluteFSPath()));
  app.get("/docs-init.js", (req, res) =>
    res
      .type("js")
      .send(
        'window.onload=()=>SwaggerUIBundle({url:"/api/openapi.json",dom_id:"#swagger-ui",persistAuthorization:false});',
      ),
  );
  app.get("/api-docs", (req, res) =>
    res
      .type("html")
      .send(
        '<!doctype html><html><head><title>ZNote API</title><link rel="stylesheet" href="/docs/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/docs/swagger-ui-bundle.js"></script><script src="/docs-init.js"></script></body></html>',
      ),
  );
  app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use(express.static(staticDir));
  app.get("/", (req, res) => res.sendFile(resolve(staticDir, "index.html")));
  app.use((err, req, res, next) => {
    if (res.headersSent || res.destroyed) {
      if (err.status !== 499 && !(res.destroyed && ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET'].includes(err.code))) console.error('Request stream failed:', err.code || err.name);
      if (!res.destroyed) res.destroy();
      return;
    }
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: "参数格式不正确",
        details: err.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    if (err instanceof multer.MulterError)
      return res.status(400).json({
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? (req.path === '/api/videos' ? '单个视频不能超过 500 MB' : req.path === '/api/backups/preview' ? '备份不能超过 5 GiB' : '单张图片不能超过 25 MB')
            : "上传格式或数量超出限制",
      });
    if (String(err.message).includes("UNIQUE constraint"))
      return res.status(409).json({ error: "名称已经存在" });
    const status = err.status || 500;
    if (status >= 500) console.error("Request failed:", err.code || err.name);
    res.status(status).json({
      error:
        status >= 500
          ? "服务器处理失败，请检查服务日志和存储空间"
          : err.message,
    });
  });
  return { app, db, backups, webhooks, imports, maintenance, diagnostics: () => ({ thumbnail_active: thumbnailQueue.active, thumbnail_peak: thumbnailQueue.peak, thumbnail_pending: thumbnailQueue.pending.length, preview_cache_bytes: previewBytes }) };
}
