import {typeOrderSchema} from './saved-views.js';
import { MAX_IMAGE_BYTES, compressLargeImage } from './image-limits.js';
import {localMediaReferences} from '../shared/local-media.js';
import {appendMessageBlocks} from '../shared/message-blocks.js';
import {legacyGalleryPage} from '../shared/gallery-group.js';
import { VERSION } from './version.js';
import { createUndoManager } from './undo.js';
import { createNoteHistory } from './note-history.js';
import { registerSavedViews } from './saved-views.js';
import { registerReadingProgress } from './reading-progress.js';
import { registerVideoProgress } from './video-progress.js';
import { registerGroupOrganize } from './group-organize.js';
import {createTrashManager} from './trash.js';
import express from "express";
import { archiveNoteImages } from './note-images.js';
import { markdownImages, replaceMarkdownImages } from '../shared/markdown-images.js';
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
import { registerExportJobs } from './export-jobs.js';
import { WorkQueue } from "./work-queue.js";
import { maintenanceGate } from './maintenance.js';
import { createBackupManager, registerBackupRoutes } from './backups.js';
import { createWebhookManager, registerWebhookRoutes } from './webhooks.js';
import {createWeixinInbox,registerWeixinRoutes} from './weixin.js';
import {createWeixinNotifications,registerWeixinNotificationRoutes} from './weixin-notifications.js';
import { registerClipper } from './clipper.js';
import { createClipperPairing } from './clipper-pair.js';
import { withSource } from './source.js';
import { createImportManager } from './imports.js';
import { createCaptureManager } from './captures.js';
import { registerStreamRoutes } from './streams.js';
import { registerGroupOrderRoutes } from './group-order.js';
import { registerTags } from './tags.js';
import {videoThumbnail} from './video-thumbnail.js';

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
  group_key: z.string().max(200).nullable().optional().transform(v => v === '' ? null : v),
  group_index: z.coerce.number().int().min(0).max(10000).default(0),
  group_title: z.string().max(200).nullable().optional(),
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
  trashOptions = {},
  webhookOptions = {},
  weixinClient,
  importOptions = {},
  captureOptions = {},
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
  let noteHistory;
  const event = (type, id) => {
    const result = db
      .prepare("INSERT INTO events(type,item_id,created_at) VALUES(?,?,?)")
      .run(type, id, now());
    noteHistory?.capture(id);
    return result;
  };
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
  const groupSize = db.prepare("SELECT count(*) n FROM items WHERE collection_id IS ? AND group_key=? AND kind='image' AND (deleted_at IS NOT NULL)=?");
  const noteCoverCache = new Map();
  const noteCover = row => {
    if(row.kind!=='note')return null;
    const cached=noteCoverCache.get(row.id);
    let id;
    if(cached?.version===row.version)id=cached.id;
    else {
      const content=row.content_length>row.content.length?db.prepare('SELECT content FROM items WHERE id=?').get(row.id)?.content:row.content;
      id=markdownImages(content||'',true)[0]?.url.match(/^\/media\/([^/]+)\//)?.[1]||null;
      if(noteCoverCache.size>=500)noteCoverCache.delete(noteCoverCache.keys().next().value);
      noteCoverCache.set(row.id,{version:row.version,id});
    }
    // Recheck lifecycle and scope even when the note itself has not changed.
    return id&&db.prepare("SELECT id FROM items WHERE id=? AND kind='image' AND deleted_at IS NULL AND collection_id IS ?").get(id,row.collection_id)?`/media/${id}/thumbnail`:null;
  };
  const serialize = (row) =>
    row && {
      ...row,
      group_size: row.kind==='image'&&row.group_key ? groupSize.get(row.collection_id,row.group_key,row.deleted_at?1:0).n : undefined,
      tags: JSON.parse(row.tags),
      favorite: !!row.favorite,
      url: row.file_key ? `/media/${row.id}/original` : null,
      thumbnail_url: ['image','video'].includes(row.kind) ? `/media/${row.id}/thumbnail` : noteCover(row),
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
    res.json({ status: "ok", version: VERSION }),
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
    if(token.scope==='notify'){
      const path=req.originalUrl.split('?')[0];
      if(!((req.method==='POST'&&path==='/api/weixin/notifications')||(req.method==='GET'&&/^\/api\/weixin\/notifications\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(path))))
        return next(fail(403,'仅通知令牌不能访问知识库或连接设置'));
    }
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
      version: VERSION,
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
  const cardIdentity = "CASE WHEN kind='image' AND NULLIF(group_key,'') IS NOT NULL THEN 'group:'||group_key ELSE 'item:'||id END";
  const countCards = (scope, favorite=false) => db.prepare(`SELECT count(*) n FROM (
    SELECT 1 FROM items WHERE deleted_at IS NULL${favorite?' AND favorite=1':''}${scope.sql}
    GROUP BY collection_id, ${cardIdentity}
  )`).get(...scope.args).n;
  app.get("/api/stats", (req, res) => {
    const scope = collectionScope(req.query.collection);
    const counts = db
      .prepare(
        `SELECT count(*) total, coalesce(sum(kind='image'),0) images, coalesce(sum(kind='video'),0) videos, coalesce(sum(kind='note'),0) notes, coalesce(sum(favorite),0) favorites, coalesce(sum(bytes),0) bytes FROM items WHERE deleted_at IS NULL${scope.sql}`,
      )
      .get(...scope.args);
    res.json({
      ...counts,
      total_cards: countCards(scope),
      favorite_cards: countCards(scope,true),
      image_cards: db.prepare(`SELECT count(*) n FROM (
        SELECT 1 FROM items WHERE deleted_at IS NULL AND kind='image'${scope.sql}
        GROUP BY collection_id, CASE WHEN group_key IS NULL OR group_key='' THEN 'item:'||id ELSE 'group:'||group_key END
      )`).get(...scope.args).n,
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
          `SELECT c.*, (SELECT count(*) FROM items i WHERE i.collection_id=c.id AND deleted_at IS NULL) count,
            (SELECT count(DISTINCT ${cardIdentity}) FROM items WHERE collection_id=c.id AND deleted_at IS NULL) card_count
            FROM collections c ORDER BY created_at`,
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
  registerTags({app,db,collectionScope});
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
        direction: z.enum(["asc", "desc"]).optional(),
        type_group: z.enum(["true", "false"]).default("false"),
        type_order:typeOrderSchema,
        limit: z.coerce.number().int().min(1).max(100).default(60),
        offset: z.coerce.number().int().min(0).default(0),
        anchor: z.string().max(100).optional(),
        summary: z.enum(['true', 'false']).default('false'),
        cursor: z.coerce.number().int().nonnegative().optional(),
        gallery: z.enum(['true', 'false']).default('false'),
        gallery_scope: z.enum(['all', 'singles']).default('all'),
        grouped: z.enum(['true','false']).default('false'),
        group_key: z.string().max(200).optional(),
      })
      .parse(req.query);
    const listCursor = db.prepare('SELECT COALESCE(MAX(id),0) cursor FROM events').get().cursor;
    if (q.cursor !== undefined && q.cursor !== listCursor) throw fail(409, '内容已变化，请刷新后继续浏览');
    const where = [
      q.trash === "true" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL",
    ];
    const args = [];
    if (q.q) {
      where.push([...q.q].length >= 3
        ? "(rowid IN (SELECT rowid FROM items_search WHERE title LIKE ? UNION SELECT rowid FROM items_search WHERE content LIKE ? UNION SELECT rowid FROM items_search WHERE tags LIKE ?) OR (group_manual=1 AND group_key NOT LIKE 'note:%' AND group_title LIKE ?))"
        : "(title LIKE ? OR content LIKE ? OR tags LIKE ? OR (group_manual=1 AND group_key NOT LIKE 'note:%' AND group_title LIKE ?))");
      args.push(...Array(4).fill(`%${q.q}%`));
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
    if (q.group_key) { where.push('group_key=?'); args.push(q.group_key); }
    if (q.gallery === 'true' && q.gallery_scope === 'singles') where.push('group_key IS NULL');
    const clause = where.join(" AND ");
    const direction=(q.direction||(q.sort==='title'?'asc':'desc')).toUpperCase();
    const orderedTitle=q.grouped==='true'?"COALESCE(NULLIF(group_title,''),title)":"title";
    const valueSort = {
      updated: `updated_at ${direction}, id ${direction}`,
      created: `created_at ${direction}, id ${direction}`,
      title: `${orderedTitle} COLLATE NOCASE ${direction}, id ${direction}`,
    }[q.sort];
    // Match the card's full-library group size, including NULL/unfiled scopes.
    // Filtering down to one member must not turn a real group into a single card.
    const imageType="CASE WHEN group_key IS NOT NULL AND EXISTS (SELECT 1 FROM items member WHERE member.kind='image' AND member.collection_id IS items.collection_id AND member.group_key=items.group_key AND (member.deleted_at IS NULL)=(items.deleted_at IS NULL) AND member.id<>items.id) THEN 'group' ELSE 'image' END";
    const cardType=`CASE WHEN kind='image' THEN (${imageType}) ELSE kind END`;
    const typeSort=`CASE (${cardType}) ${q.type_order.split(',').map((type,index)=>`WHEN '${type}' THEN ${index}`).join(' ')} ELSE 4 END`;
    const sort=q.type_group==='true'?`${typeSort}, ${valueSort}`:valueSort;
    if (q.gallery === 'true') return res.json({ ids: db.prepare(`SELECT id FROM items WHERE ${clause} AND kind='image' ORDER BY ${q.group_key ? 'COALESCE(group_order,group_index), group_index, id' : sort}`).all(...args).map(item => item.id) });
    const projection = q.summary === 'true'
      ? db.prepare('PRAGMA table_info(items)').all().map(({name}) => name === 'content' ? "CASE WHEN kind='note' THEN substr(content,1,1000) ELSE '' END AS content" : name).join(',') + ',length(content) AS content_length'
      : '*';
    const listSerialize = row => q.summary === 'true' ? { ...serialize(row), summary: true } : serialize(row);
    const groupedQuery = `SELECT ${projection}, MIN(COALESCE(group_order,group_index)) AS first_group_index, count(*) AS group_count FROM items WHERE ${clause} GROUP BY collection_id, CASE WHEN group_key IS NULL THEN 'item:'||id ELSE 'group:'||group_key END`;
    let offset = q.offset;
    if (q.anchor) {
      // Seek within the same filtered and grouped result, never fetch every
      // preceding page merely to restore a browser's reading position.
      const source = q.grouped === 'true' ? groupedQuery : `SELECT * FROM items WHERE ${clause}`;
      const position = db.prepare(`SELECT position FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY ${sort}) - 1 AS position FROM (${source}) AS items) WHERE id=?`).get(...args, q.anchor)?.position;
      offset = position === undefined ? 0 : Math.floor(position / q.limit) * q.limit;
    }
    if(q.grouped==='true') {
      const grouped=groupedQuery;
      return res.json({items:db.prepare(`${grouped} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...args,q.limit,offset).map(listSerialize),total:db.prepare(`SELECT count(*) n FROM (${grouped})`).get(...args).n,offset,limit:q.limit,event_cursor:listCursor});
    }
    res.json({
      items: db
        .prepare(
          `SELECT ${projection} FROM items WHERE ${clause} ORDER BY ${sort} LIMIT ? OFFSET ?`,
        )
        .all(...args, q.limit, offset)
        .map(listSerialize),
      total: db
        .prepare(`SELECT count(*) n FROM items WHERE ${clause}`)
        .get(...args).n,
      offset,
      limit: q.limit,
      event_cursor: db.prepare('SELECT COALESCE(MAX(id),0) cursor FROM events').get().cursor,
    });
  });
  const insert = (input, image = null, fixedId = null, onCommit = () => {}) => {
    if (input.source_url) input = withSource(input);
    validateCollection(input.collection_id);
    const id = fixedId || randomUUID();
    const date = now();
    transaction(() => {
      if (!image) input=groupNoteImages(input,id);
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
      if(image && input.group_key !== undefined) db.prepare('UPDATE items SET group_key=?,group_index=?,group_title=? WHERE id=?').run(input.group_key,input.group_index,input.group_title??null,id);
      if (image?.manual) db.prepare('UPDATE items SET group_manual=1,group_origin_id=? WHERE id=?').run(image.origin || null, id);
      if (image && input.group_key) {
        const manual = db.prepare('SELECT group_title FROM items WHERE collection_id IS ? AND group_key=? AND group_manual=1 AND deleted_at IS NULL AND id!=? LIMIT 1').get(input.collection_id, input.group_key, id);
        if (manual) db.prepare('UPDATE items SET group_manual=1,group_title=? WHERE id=?').run(manual.group_title, id);
      }
      if(image?.order!=null) db.prepare('UPDATE items SET group_order=? WHERE id=?').run(image.order,id);
      else if(image && input.group_key) {
        const ordered=db.prepare('SELECT MAX(COALESCE(group_order,group_index)) AS last,COUNT(group_order) AS ordered FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL AND id<>?').get(input.group_key,input.collection_id,id);
        if(ordered.ordered)db.prepare('UPDATE items SET group_order=? WHERE id=?').run(ordered.last+1,id);
      }
      if (image?.kind === 'video') db.prepare('UPDATE items SET duration=?,video_codec=? WHERE id=?').run(image.duration, image.codecName, id);
      event("item.created", id);
      onCommit();
    });
    return serialize(getItem(id));
  };
  function groupNoteImages(input,noteId) {
    for(const ref of localMediaReferences(input.content)){
      const linked=db.prepare('SELECT deleted_at FROM items WHERE id=?').get(ref.id);
      if(!linked||linked.deleted_at)throw fail(409,'配图已删除或在回收站中，请先恢复后再引用');
    }
    const key='note:'+noteId, images=markdownImages(input.content,true).filter(i=>i.url.startsWith('/media/'));
    const groupTitle=(input.title+' · 配图').slice(0,200);
    const prior=db.prepare("SELECT content FROM items WHERE id=? AND kind='note'").get(noteId);
    const orderChanged=!prior||JSON.stringify(markdownImages(prior.content,true).filter(i=>i.url.startsWith('/media/')).map(i=>i.url))!==JSON.stringify(images.map(i=>i.url));
    const replacements=new Map(), retained=new Set(), seen=new Set();let index=0;
    for(const image of images){
      if(seen.has(image.url))continue;seen.add(image.url);
      const id=image.url.match(/^\/media\/([^/]+)\//)?.[1];
      const source=db.prepare("SELECT * FROM items WHERE id=? AND kind='image' AND deleted_at IS NULL").get(id);
      if(!source)continue;
      let row=source.group_key===key&&source.collection_id===input.collection_id&&!retained.has(source.id)?source:db.prepare('SELECT * FROM items WHERE group_key=? AND collection_id IS ? AND hash=? AND group_index=? AND deleted_at IS NULL').get(key,input.collection_id,source.hash,index);
      if(row&&retained.has(row.id))row=null;
      if(!row && source.collection_id===input.collection_id && (!source.group_key || source.group_key===key) && !retained.has(source.id))row=source;
      if(!row){
        row={...source,id:randomUUID(),collection_id:input.collection_id,group_key:key,group_index:index,group_order:index,group_title:groupTitle,version:1,created_at:now(),updated_at:now()};
        const columns=Object.keys(row);db.prepare(`INSERT INTO items(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c]));event('item.created',row.id);
      }
      if(row.group_key!==key||row.group_index!==index||row.group_title!==groupTitle){db.prepare('UPDATE items SET group_key=?,group_index=?,group_title=?,version=version+1,updated_at=? WHERE id=?').run(key,index,groupTitle,now(),row.id);event('item.updated',row.id);}
      if(orderChanged && row.group_order!==index){db.prepare('UPDATE items SET group_order=?,version=version+1,updated_at=? WHERE id=?').run(index,now(),row.id);event('item.updated',row.id);}
      retained.add(row.id);const url=`/media/${row.id}/original`;if(url!==image.url)replacements.set(image.url,url);index++;
    }
    for(const row of db.prepare('SELECT id FROM items WHERE group_key=?').all(key))if(!retained.has(row.id)){db.prepare('UPDATE items SET group_key=NULL,group_index=0,group_order=NULL,group_title=NULL,version=version+1,updated_at=? WHERE id=?').run(now(),row.id);event('item.updated',row.id);}
    return {...input,content:replaceMarkdownImages(input.content,images,replacements)};
  }
  app.post("/api/items", async (req, res) => {
    const input=itemInput.parse(req.body); validateCollection(input.collection_id);
    const archive=z.boolean().default(true).parse(req.body.archive_images);
    const result=archive?await noteArchiveQueue.run(randomUUID(),()=>archiveNoteImages(input,{download:imageDownload,save:saveAsset})):null;
    if(result)input.content=result.content;
    res.status(201).json({...insert(input),...(result?{image_archive:result.report}:{})});
  });
  // Canonical Pixiv novel + library identity makes retries after a lost upload
  // response safe, without overwriting notes the user may have edited locally.
  app.post('/api/pixiv/notes', async (req, res) => {
    const input = itemInput.parse(req.body); validateCollection(input.collection_id);
    const source = new URL(input.source_url || 'https://invalid');
    const id = source.searchParams.get('id');
    if (source.origin !== 'https://www.pixiv.net' || source.pathname !== '/novel/show.php' || !/^\d{1,12}$/.test(id || '') || source.username || source.password)
      throw fail(400, '请提供 Pixiv 小说详情链接');
    input.source_url = `https://www.pixiv.net/novel/show.php?id=${id}`;
    const item = await noteArchiveQueue.run('pixiv:' + id + ':' + input.collection_id, async () => {
      const existing = db.prepare("SELECT * FROM items WHERE kind='note' AND source_url=? AND collection_id IS ? ORDER BY deleted_at IS NOT NULL").get(input.source_url, input.collection_id);
      if (existing?.deleted_at) throw fail(409, '此小说已在回收站，请先恢复');
      if (existing) return { ...serialize(existing), duplicate: true };
      const archived = await archiveNoteImages(input, { download: imageDownload, save: saveAsset });
      input.content = archived.content;
      if (archived.report.failures.length) throw fail(400, '小说配图未能完整归档，请重试');
      return { ...insert(input), image_archive: archived.report };
    });
    res.status(item.duplicate ? 200 : 201).json(item);
  });
  const imageReference = (item) => ({
    kind: item.kind, duration: item.duration, codecName: item.video_codec,
    key: item.file_key, mime: item.mime, bytes: item.bytes, width: item.width,
    height: item.height, hash: item.hash, codec: item.storage_codec, storedBytes: item.stored_bytes,
  });
  const mediaCollision = (source, collection) => {
    if(source.group_key?.startsWith('note:'))return db.prepare('SELECT * FROM items WHERE hash=? AND collection_id IS ? AND group_key=? AND group_index=? AND deleted_at IS NULL AND id!=?').get(source.hash,collection,source.group_key,source.group_index,source.id);
    const indexed = source.group_key || /^https:\/\/www\.pixiv\.net\/artworks\/\d+$/.test(source.source_url || '');
    return indexed
      ? db.prepare('SELECT * FROM items WHERE hash=? AND collection_id IS ? AND source_url IS ? AND group_index=? AND deleted_at IS NULL AND id!=?').get(source.hash,collection,source.source_url,source.group_index,source.id)
      : db.prepare('SELECT * FROM items WHERE hash=? AND collection_id IS ? AND deleted_at IS NULL AND id!=?').get(source.hash,collection,source.id);
  };
  function checkGroupDestination(group, target) {
    if(!group.length || group[0].collection_id===target)return;
    if(db.prepare('SELECT id FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL').get(group[0].group_key,target)||group.some(row=>mediaCollision(row,target)))
      throw fail(409,'目标知识库已有组内图片，整组未移动，请先整理重复内容');
  }
  function moveNotePages(note, target) {
    if(note.collection_id===target)return;
    const pages=db.prepare('SELECT * FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL').all('note:'+note.id,note.collection_id);
    checkGroupDestination(pages,target);
    for(const page of pages){db.prepare('UPDATE items SET collection_id=?,version=version+1,updated_at=? WHERE id=?').run(target,now(),page.id);event('item.updated',page.id);}
  }
  app.post('/api/items/:id/copy', (req, res) => {
    const source = getItem(req.params.id);
    if (!['image', 'video'].includes(source.kind) || source.deleted_at) throw fail(409, '只能复用未删除的图片或视频');
    const input = itemInput.parse({ ...serialize(source), ...req.body });
    validateCollection(input.collection_id);
    const existing = source.collection_id === input.collection_id ? source : mediaCollision(source,input.collection_id);
    if (existing) return res.json({ ...serialize(existing), duplicate: true });
    res.status(201).json({ ...insert(input, {...imageReference(source),order:source.group_order,manual:source.group_manual,origin:source.group_origin_id}), shared: true });
  });
  app.post('/api/item-groups/favorite', (req,res) => {
    const input=z.object({group_key:z.string().min(1).max(200),collection_id:z.string().nullable(),favorite:z.boolean()}).parse(req.body);
    validateCollection(input.collection_id);
    const items=db.prepare('SELECT id FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL').all(input.group_key,input.collection_id);
    if(!items.length) throw fail(404,'图片组不存在');
    const action=undo.run(req,'整组收藏',()=>{for(const item of items){db.prepare('UPDATE items SET favorite=?,updated_at=?,version=version+1 WHERE id=?').run(+input.favorite,now(),item.id);event('item.updated',item.id);}});
    res.json({count:items.length,undo:action.undo});
  });
  app.post('/api/item-groups/move', (req,res) => {
    const input=z.object({id:z.string(),version:z.number().int().positive(),collection_id:z.string().nullable(),move_note:z.boolean().default(false),title:z.string().min(1).max(200).optional(),content:z.string().max(500000).optional(),tags:cleanTags.optional()}).parse(req.body);
    validateCollection(input.collection_id);
    const {result,undo:receipt}=undo.run(req,'整组移动',()=>{
      const anchor=getItem(input.id);if(anchor.deleted_at||!anchor.group_key||anchor.version!==input.version)throw fail(409,'图片组已变更，请重新打开后移动');
      const group=db.prepare('SELECT * FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL').all(anchor.group_key,anchor.collection_id);
      checkGroupDestination(group,input.collection_id);
      for(const row of group){db.prepare('UPDATE items SET collection_id=?,version=version+1,updated_at=? WHERE id=?').run(input.collection_id,now(),row.id);event('item.updated',row.id);}
      if(input.move_note&&anchor.group_key.startsWith('note:')){const note=db.prepare("SELECT * FROM items WHERE id=? AND kind='note' AND deleted_at IS NULL AND collection_id IS ?").get(anchor.group_key.slice(5),anchor.collection_id);if(note){db.prepare('UPDATE items SET collection_id=?,version=version+1,updated_at=? WHERE id=?').run(input.collection_id,now(),note.id);event('item.updated',note.id);}}
      db.prepare('UPDATE items SET title=?,content=?,tags=? WHERE id=?').run(input.title??anchor.title,input.content??anchor.content,JSON.stringify(input.tags??JSON.parse(anchor.tags)),anchor.id);
      return {...serialize(getItem(anchor.id)),moved_count:group.length};
    });res.json({...result,undo:receipt});
  });
  app.post('/api/items/batch-organize', (req, res) => {
    const input = z.object({
      items: z.array(z.object({ id: z.string(), version: z.number().int().positive() })).min(1).max(10000),
      collection_id: z.string().nullable().optional(), favorite: z.boolean().optional(),
    }).refine(v => v.collection_id !== undefined || v.favorite !== undefined).parse(req.body);
    if (new Set(input.items.map(i => i.id)).size !== input.items.length) throw fail(400, '内容 ID 不可重复');
    if (input.collection_id !== undefined) validateCollection(input.collection_id);
    const {result,undo:receipt} = undo.run(req,'批量整理',() => {
      const originals=input.items.map(value=>{const old=getItem(value.id);if(old.deleted_at||old.version!==value.version)throw fail(409,'部分内容已被修改或删除，请刷新后重试');return old;});
      if(input.collection_id!==undefined){
        const selectedIds=new Set(originals.map(row=>row.id)),groups=new Map(originals.filter(row=>row.kind==='image'&&row.group_key?.startsWith('note:')).map(row=>[row.group_key,row]));
        for(const [key,page] of groups){
          const note=db.prepare("SELECT * FROM items WHERE id=? AND kind='note' AND deleted_at IS NULL AND collection_id IS ?").get(key.slice(5),page.collection_id);
          if(note&&!selectedIds.has(note.id)&&note.collection_id!==input.collection_id&&db.prepare("SELECT id FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL").all(key,page.collection_id).every(row=>selectedIds.has(row.id))){
            db.prepare('UPDATE items SET collection_id=?,version=version+1,updated_at=? WHERE id=?').run(input.collection_id,now(),note.id);event('item.updated',note.id);
          }
        }
        for(const old of originals)if(old.kind==='note')moveNotePages(old,input.collection_id);
      }
      return originals.map(old => {
      const target = input.collection_id === undefined ? old.collection_id : input.collection_id;
      if (old.hash && target !== old.collection_id && mediaCollision(old,target))
        throw fail(409, '目标知识库已有同一图片；请保留独立记录或先整理目标条目');
      db.prepare('UPDATE items SET collection_id=?,favorite=?,updated_at=?,version=version+1 WHERE id=?')
        .run(target, input.favorite === undefined ? old.favorite : +input.favorite, now(), old.id);
      event('item.updated', old.id);
      return serialize(getItem(old.id));
    });});
    res.json({ items: result, undo: receipt });
  });
  app.post('/api/items/batch-trash', (req, res) => {
    const input = z.object({ items: z.array(z.object({id:z.string(),version:z.number().int().positive()})).min(1).max(10000),
      collection_id:z.string().nullable(), restore:z.boolean().default(false) }).parse(req.body);
    if(new Set(input.items.map(i=>i.id)).size!==input.items.length) throw fail(400,'内容 ID 不可重复');
    const {result,undo:receipt}=undo.run(req,input.restore?'恢复内容':'删除内容',()=>{const changed=input.items.map(value=>{
      const item=getItem(value.id);
      if(item.version!==value.version || item.collection_id!==input.collection_id || Boolean(item.deleted_at)!==input.restore)
        throw fail(409,'部分内容已变更或不属于当前知识库，请刷新后重试');
      db.prepare('UPDATE items SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?').run(input.restore?null:now(),now(),item.id);
      event(input.restore?'item.restored':'item.deleted',item.id); return serialize(getItem(item.id));
    });if(!input.restore)trash.repairReferences();return changed.map(item=>serialize(getItem(item.id)));});
    res.json({items:result,undo:receipt});
  });
  app.post("/api/items/batch-tags", (req, res) => {
    const input = z
      .object({
        items: z
          .array(
            z.object({ id: z.string(), version: z.number().int().positive() }),
          )
          .min(1)
          .max(10000),
        tags: cleanTags,
        mode: z.enum(["add", "remove", "replace"]).default("add"),
      })
      .parse(req.body);
    if (new Set(input.items.map((i) => i.id)).size !== input.items.length)
      throw fail(400, "内容 ID 不可重复");
    const {result,undo:receipt} = undo.run(req,'批量标签',() =>
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
    res.json({ items: result, undo: receipt });
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
    let item = { ...serialize(old), ...patch };
    validateCollection(item.collection_id);
    const archive=z.boolean().default(true).parse(req.body.archive_images);
    const archived=old.kind==='note' && patch.content!==undefined && archive ? await noteArchiveQueue.run(randomUUID(),()=>archiveNoteImages(item,{download:imageDownload,save:saveAsset})):null;
    if(archived)item.content=archived.content;
    const current=getItem(old.id);
    if(current.deleted_at || current.version!==old.version) throw fail(409,'归档期间内容已在其他设备变更，请重新打开后保存');
    if (old.hash && old.collection_id !== item.collection_id && mediaCollision(old,item.collection_id))
      throw fail(409, '目标知识库已存在同一图片');
    const action = undo.run(req,'编辑内容',() => {
      if(old.kind==='note'){
        moveNotePages(old,item.collection_id);
        item=groupNoteImages(item,old.id);
      }
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
    res.json({...serialize(getItem(old.id)),undo:action.undo,...(archived?{image_archive:archived.report}:{})});
  });
  app.delete("/api/items/:id", (req, res) => {
    const item = getItem(req.params.id);
    transaction(() => {
      db.prepare(
        "UPDATE items SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?",
      ).run(now(), now(), item.id);
      event("item.deleted", item.id);
      trash.repairReferences();
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
    while (previewBytes > 16 * 1024 * 1024) {
      const first = previewCache.keys().next().value;
      previewBytes -= previewCache.get(first).length;
      previewCache.delete(first);
    }
  };
  const saveAsset = (file, fields, fixedId = null) => uploadQueue.run(randomUUID(), async () => {
    if(fixedId){const prior=db.prepare('SELECT * FROM items WHERE id=?').get(fixedId);if(prior)return serialize(prior);}
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
      group_key: fields.group_key, group_index: fields.group_index, group_title: fields.group_title,
    });
    validateCollection(input.collection_id);
    let buffer = file.buffer || (await readFile(file.path));
    if (buffer.length > MAX_IMAGE_BYTES) throw fail(413, '单张图片不能超过 100 MB');
    if (fields.image_size_mode && !['original', 'compress'].includes(fields.image_size_mode)) throw fail(400, '图片大小处理方式不正确');
    if (fields.image_size_mode === 'compress') {
      let compressed;
      try { compressed = await compressLargeImage(buffer); }
      catch (error) { throw fail(422, error.message); }
      buffer = compressed.buffer;
      if (compressed.quality) input.content = (input.content + `\n\n已低损压缩为 WebP（质量 ${compressed.quality}），原文件 ${(compressed.originalBytes / 1048576).toFixed(1)} MB；此副本无法恢复原文件。`).trim();
    }
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
    let existing = fixedId ? null : input.group_key !== undefined
      ? db.prepare("SELECT * FROM items WHERE hash=? AND collection_id IS ? AND group_index=? AND ((? IS NOT NULL AND group_key=?) OR (source_url IS ? AND (? IS NULL OR group_key IS NULL OR group_manual=1 OR group_key LIKE 'note:%'))) ORDER BY deleted_at IS NOT NULL").get(digest,input.collection_id,input.group_index,input.group_key??null,input.group_key??null,input.source_url,input.group_key??null)
      : db.prepare('SELECT * FROM items WHERE hash=? AND collection_id IS ? ORDER BY deleted_at IS NOT NULL').get(digest,input.collection_id);
    // A new upload batch owns its grouping. Reuse the file through a new
    // entry instead of moving an existing asset or leaving it in another group.
    if(input.group_key?.startsWith('upload:')&&existing?.group_key!==input.group_key)existing=null;
    if(!fixedId&&!existing&&input.group_key){
      const candidates=db.prepare('SELECT * FROM items WHERE hash=? AND collection_id IS ? AND group_key IS NULL AND deleted_at IS NULL').all(digest,input.collection_id).filter(row=>{const old=legacyGalleryPage(row);return old?.group_key===input.group_key&&old.group_index===input.group_index;});
      if(candidates.length===1)existing=candidates[0];
    }
    if (existing?.deleted_at) throw fail(409, '这张图片已在此知识库的回收站中，请先恢复');
    if (existing) return sourceDuplicate(existing, input);
    const old = db.prepare('SELECT * FROM items WHERE hash=?').get(digest);
    if (old) return { ...insert(input, imageReference(old), fixedId), shared: true };
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
      }, fixedId);
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
      fileSize: MAX_IMAGE_BYTES,
      files: 1,
      fields: 12,
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
      fileSize: MAX_IMAGE_BYTES,
      files: 20,
      fields: 12,
      fieldSize: 512000,
    },
  });
  app.post("/api/assets/batch", batch.array("files", 20), async (req, res) => {
    if (!req.files?.length) throw fail(400, "请选择图片");
    const results = [];
    try {
      for (const [index,file] of req.files.entries()) {
        try {
          const fields=req.body.group_key?{...req.body,group_index:Number(req.body.group_index??0)+index}:req.body;
          const item = await saveAsset(file, fields);
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
    // A collector may enrich source metadata, but never undo user grouping or
    // take an image out of the note that owns its internal reference.
    if (existing.group_manual || existing.group_key?.startsWith('note:')) input = { ...input, group_key: undefined };
    if (input.group_key !== undefined || input.tags?.some(tag=>!JSON.parse(existing.tags).includes(tag))) {
      const tags=[...new Set([...JSON.parse(existing.tags), ...(input.tags||[])])];
      if(tags.length>30) throw fail(400,'已有图片的标签已满，请整理标签后重试；原内容未覆盖');
      transaction(()=>{
        db.prepare('UPDATE items SET tags=?,group_key=?,group_index=?,group_title=?,updated_at=?,version=version+1 WHERE id=?').run(JSON.stringify(tags),input.group_key===undefined?existing.group_key:input.group_key,input.group_key===undefined?existing.group_index:input.group_index,input.group_key===undefined?existing.group_title:input.group_title??null,now(),existing.id);
        event('item.updated',existing.id);
      });
      existing=getItem(existing.id);
    }
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
  const captures = createCaptureManager({db,dataDir,validateCollection,work:operation=>maintenance.work(operation),
    exists:id=>db.prepare('SELECT * FROM items WHERE id=?').get(id),
    saveImage:(buffer,{id,...fields})=>saveAsset({buffer,originalname:fields.title,size:buffer.length},{...fields,tags:JSON.stringify(fields.tags)},id),
    saveNote:({id,...fields})=>insert(itemInput.parse(fields),null,id),
    saveVideo:(file,fields)=>saveVideo(file,{...fields,tags:JSON.stringify(fields.tags)}),...captureOptions});
  app.get('/api/captures',(req,res)=>res.json({jobs:captures.list()}));
  app.post('/api/captures',(req,res)=>res.status(202).json(captures.add(req.body)));
  app.get('/api/captures/:id',(req,res)=>res.json(captures.get(req.params.id)));
  app.delete('/api/captures/:id',(req,res)=>res.json(captures.remove(req.params.id)));
  app.post('/api/captures/:id/retry',(req,res)=>res.status(202).json(captures.retry(req.params.id)));
  registerStreamRoutes(app, { dataDir, saveVideo });
  app.get('/api/imports', (req, res) => res.json({ jobs: imports.list() }));
  app.get('/api/imports/:id', (req, res) => res.json(imports.get(req.params.id)));
  app.post('/api/imports', (req, res) => {
    const input = z.object({ url: z.string().max(4096), tags: cleanTags.default([]), collection_id: z.string().nullable().default(null) }).parse(req.body);
    validateCollection(input.collection_id); res.status(202).json(imports.add(input));
  });
  app.delete('/api/imports/:id', (req, res) => res.json(imports.cancel(req.params.id)));
  app.post('/api/imports/:id/retry',(req,res)=>{const previous=imports.get(req.params.id);validateCollection(previous.collection_id);res.status(202).json(imports.retry(req.params.id));});
  app.get("/media/:id/:variant", async (req, res) => {
    const item = getItem(req.params.id);
    if (!item.file_key) throw fail(404, "图片不存在");
    if (!["original", "thumbnail"].includes(req.params.variant))
      throw fail(404, "图片版本不存在");
    res.set("Cache-Control", "private, no-cache");
    if (item.kind === 'video' && req.params.variant === 'original') {
      return serveVideo(req, res, dataDir, item);
    }
    if (req.params.variant === "thumbnail") {
      let buffer = previewCache.get(item.hash);
      if (!buffer) {
        buffer = await thumbnailQueue.run(item.hash, async () => {
          const result = await (item.kind==='video'?videoThumbnail:thumbnail)(dataDir, item);
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
        scope: z.enum(["read", "write", "notify"]),
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
    if (req.query.latest === 'true') return res.json({ events: [], cursor: db.prepare('SELECT COALESCE(MAX(id),0) cursor FROM events').get().cursor });
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
  const streamExport = async (req, res, progress) => {
    const full = req.query.mode === "backup";
    if (full && snapshotting)
      throw fail(409, "另一份完整备份正在生成，请稍后重试");
    if (full) snapshotting = true;
    try {
      await exportContent({ db, dir: dataDir, req, res, serialize, progress });
    } finally {
      if (full) snapshotting = false;
    }
  };
  app.get('/api/export', admin, (req,res)=>streamExport(req,res));
  const exportJobs=registerExportJobs({app,db,admin,streamExport});
  app.get("/api/openapi.json", (req, res) => res.json(spec));
  const webhooks = createWebhookManager({ db, maintenance, ...webhookOptions });
  registerWebhookRoutes(app, webhooks, admin);
  registerClipper(app);
  const backups = createBackupManager({ db, dataDir, maintenance, afterRestore: () => { captures.recover(); exportJobs.clear(); trash.repairReferences(); noteHistory?.seed(); }, beforeRestore: async () => { await captures.cancelAll(); await imports.cancelAll(); await webhooks.idle(); }, clearCache: () => { previewCache.clear(); previewBytes = 0; }, ...backupOptions });
  registerBackupRoutes(app, backups, admin, dataDir);
  const trash=createTrashManager({app,db,dataDir,transaction,event,maintenance,clearCache:()=>{previewCache.clear();previewBytes=0;},...trashOptions});
  const undo=createUndoManager({app,db,transaction,event,mediaCollision,clearCache:()=>{previewCache.clear();previewBytes=0;}});
  registerGroupOrderRoutes({app,db,undo,getItem,serialize,event,groupNoteImages});
  registerGroupOrganize({app,db,undo,getItem,event,serialize,validateCollection});
  noteHistory=createNoteHistory({app,db});
  transaction(() => noteHistory.seed());
  registerSavedViews({app,db,transaction});
  registerReadingProgress({app,db,transaction});
  registerVideoProgress({app,db,transaction});
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
  const weixinNotifications=createWeixinNotifications({db,client:weixinClient});
  const weixin=createWeixinInbox({db,client:weixinClient,captures,observeMessage:weixinNotifications.captureContext,validateCollection,transaction,work:operation=>maintenance.work(operation),
    exists:id=>db.prepare('SELECT * FROM items WHERE id=?').get(id),
    saveImage:(buffer,{id,...fields})=>saveAsset({buffer,originalname:'微信图片',size:buffer.length},{...fields,tags:JSON.stringify(fields.tags)},id),
    saveNote:({id,...fields},commit)=>insert(itemInput.parse(fields),null,id,commit),
    appendNote:({id,...fields},commit)=>{
      const old=db.prepare('SELECT * FROM items WHERE id=?').get(id);
      if(!old)return insert(itemInput.parse(fields),null,id,commit);
      if(old.kind!=='note'||old.deleted_at||old.collection_id!==fields.collection_id)throw fail(409,'收件笔记已移动或删除，请恢复原归属后重试；新消息会使用新篇');
      const content=appendMessageBlocks(old.content,fields.content);
      if(content.length>500000)throw fail(400,'收件笔记超过 50 万字符，请缩短原笔记后重试；后续内容可使用“开始新篇”');
      const tags=[...new Set([...JSON.parse(old.tags),...fields.tags])];
      if(tags.length>30)throw fail(400,'收件笔记超过 30 个标签，请整理标签后重试');
      transaction(()=>{
        // Appending must preserve the user's current title, text and cover order.
        const prior=db.prepare("SELECT id,COALESCE(group_order,group_index) position FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL").all('note:'+id,old.collection_id);
        const input=groupNoteImages({...serialize(old),content,tags},id);
        for(const row of prior)db.prepare('UPDATE items SET group_order=? WHERE id=? AND group_key=?').run(row.position,row.id,'note:'+id);
        const known=new Set(prior.map(row=>row.id));let position=Math.max(-1,...prior.map(row=>row.position));
        for(const row of db.prepare("SELECT id FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL ORDER BY group_index,id").all('note:'+id,old.collection_id))if(!known.has(row.id))db.prepare('UPDATE items SET group_order=? WHERE id=?').run(++position,row.id);
        db.prepare('UPDATE items SET content=?,tags=?,version=version+1,updated_at=? WHERE id=?').run(input.content,JSON.stringify(tags),now(),id);
        event('item.updated',id);commit();
      });
      return serialize(getItem(id));
    },
  });
  registerWeixinRoutes(app,admin,weixin);
  registerWeixinNotificationRoutes(app,admin,weixinNotifications);
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
            ? (req.path === '/api/videos' ? '单个视频不能超过 500 MB' : req.path === '/api/backups/preview' ? '迁移备份不能超过 25 GiB' : '单张图片不能超过 100 MB')
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
  transaction(()=>trash.repairReferences());
  if(!setting('note_groups_v1')) transaction(()=>{
    for(const row of db.prepare("SELECT * FROM items WHERE kind='note' AND deleted_at IS NULL ORDER BY created_at,id").all()){
      const grouped=groupNoteImages(serialize(row),row.id);
      if(grouped.content!==row.content){db.prepare('UPDATE items SET content=?,version=version+1,updated_at=? WHERE id=?').run(grouped.content,now(),row.id);event('item.updated',row.id);}
    }
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('note_groups_v1','true');
  });
  return { app, db, backups, webhooks, imports, captures, trash, weixin, weixinNotifications, maintenance, diagnostics: () => ({ thumbnail_active: thumbnailQueue.active, thumbnail_peak: thumbnailQueue.peak, thumbnail_pending: thumbnailQueue.pending.length, preview_cache_bytes: previewBytes }) };
}
