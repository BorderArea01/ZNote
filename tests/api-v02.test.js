import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  cp,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { inflateRawSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import {
  packOriginal,
  optimizeStorage,
  originalBuffer,
  digest,
} from "../server/storage.js";
import { openDatabase } from "../server/db.js";

export function unzip(buffer) {
  const files = new Map();
  let cursor = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (cursor >= 0 && buffer.readUInt32LE(cursor) === 0x02014b50) {
    const method = buffer.readUInt16LE(cursor + 10),
      size = buffer.readUInt32LE(cursor + 20),
      nameLength = buffer.readUInt16LE(cursor + 28),
      extra = buffer.readUInt16LE(cursor + 30),
      comment = buffer.readUInt16LE(cursor + 32),
      local = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString();
    const start =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    cursor += 46 + nameLength + extra + comment;
  }
  return files;
}
test("v0.2: batch uploads, multi-tags, home preferences, six exports and lossless restore", async (t) => {
  await mkdir(resolve("artifacts"), { recursive: true });
  const dataDir = await mkdtemp(resolve("artifacts/v02-api-"));
  let runtime = createApp({ dataDir });
  let server = await new Promise((r) => {
    const s = runtime.app.listen(0, "127.0.0.1", () => r(s));
  });
  let base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    runtime.db.close();
  });
  const setup = await fetch(base + "/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "0007" }),
  });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  const request = (path, method = "GET", body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: {
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const json = async (path, method, body) => {
    const r = await request(path, method, body);
    assert.ok(r.ok, await r.clone().text());
    return r.json();
  };
  const a = await json("/api/collections", "POST", { name: "工作资料" }),
    b = await json("/api/collections", "POST", { name: "个人图片" });
  const pngA = await sharp({
    create: { width: 1300, height: 1000, channels: 3, background: "#aabc89" },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const pngB = await sharp({
    create: { width: 900, height: 900, channels: 3, background: "#7899ab" },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  let imageA, imageB, note, readToken;
  const uploadBatch = async (files, collection) => {
    const form = new FormData();
    for (const [name, buffer] of files)
      form.append("files", new Blob([buffer]), name);
    form.set("collection_id", collection);
    form.set("tags", '["资料","图像"]');
    return fetch(base + "/api/assets/batch", {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
  };
  await t.test(
    "batch accepts multiple files, reports individual failures, cleans temporary files",
    async () => {
      const r = await uploadBatch(
        [
          ["原图甲.png", pngA],
          ["原图乙.png", pngB],
          ["坏图片.png", Buffer.from("not an image")],
        ],
        a.id,
      );
      assert.equal(r.status, 207);
      const body = await r.json();
      assert.equal(body.results.length, 3);
      assert.deepEqual(
        body.results.map((i) => i.status),
        ["created", "created", "error"],
      );
      [imageA, imageB] = body.results.map((i) => i.item);
      assert.equal(imageA.title, "原图甲.png");
      assert.deepEqual(imageA.tags, ["资料", "图像"]);
      assert.equal((await readdir(join(dataDir, "uploads"))).length, 0);
      const retry = await uploadBatch([["原图甲.png", pngA]], a.id);
      assert.equal((await retry.json()).results[0].status, "duplicate");
      imageB = await json("/api/items/" + imageB.id, "PATCH", {
        version: imageB.version,
        collection_id: b.id,
      });
    },
  );
  await t.test(
    "new originals are lossless and never larger; thumbnails add no disk files",
    async () => {
      const rows = runtime.db
        .prepare("SELECT * FROM items WHERE kind='image'")
        .all();
      assert.ok(
        rows.every(
          (i) => i.stored_bytes <= i.bytes && i.thumbnail_key === null,
        ),
      );
      assert.equal(rows.length, (await readdir(join(dataDir, "media"))).length);
      assert.deepEqual(
        Buffer.from(await (await request(imageA.url)).arrayBuffer()),
        pngA,
      );
      assert.deepEqual(
        Buffer.from(await (await request(imageB.url)).arrayBuffer()),
        pngB,
      );
      const before = await readdir(join(dataDir, "media"));
      assert.equal((await request(imageA.thumbnail_url)).status, 200);
      assert.deepEqual(await readdir(join(dataDir, "media")), before);
      const metrics = await json("/api/storage");
      assert.equal(
        metrics.media_bytes,
        rows.reduce((n, r) => n + r.stored_bytes, 0),
      );
      assert.equal(metrics.source_bytes, pngA.length + pngB.length);
      assert.equal(
        metrics.total_bytes,
        metrics.media_bytes + metrics.database_bytes,
      );
      assert.ok(metrics.total_saved_bytes > 0);
      const random = randomBytes(4096),
        packed = await packOriginal(random);
      assert.equal(packed.codec, "identity");
      assert.deepEqual(packed.buffer, random);
    },
  );
  await t.test(
    "multi-tag AND/OR and atomic batch edits with version conflicts",
    async () => {
      note = await json("/api/items", "POST", {
        title: "一份 <script>危险标题</script>",
        content: `# 笔记\n![图片](${imageB.url})\n<script>window.xss=1</script>`,
        collection_id: a.id,
        tags: ["资料", "随记"],
      });
      const query = (tags) =>
        "/api/items?tags=" + encodeURIComponent(JSON.stringify(tags));
      assert.equal((await json(query(["资料", "图像"]))).total, 2);
      assert.equal(
        (await json(query(["随记", "图像"]) + "&tag_mode=any")).total,
        3,
      );
      const changed = await json("/api/items/batch-tags", "POST", {
        items: [imageA, note].map((i) => ({ id: i.id, version: i.version })),
        tags: ["重点", "资料"],
        mode: "add",
      });
      [imageA, note] = changed.items;
      assert.deepEqual(imageA.tags, ["资料", "图像", "重点"]);
      assert.ok(note.content.includes(imageB.url));
      assert.equal(
        (
          await request("/api/items/batch-tags", "POST", {
            items: [
              { id: imageA.id, version: imageA.version },
              { id: note.id, version: 1 },
            ],
            tags: ["不应写入"],
          })
        ).status,
        409,
      );
      assert.equal(
        (await json("/api/items/" + imageA.id)).version,
        imageA.version,
      );
      const removed = await json("/api/items/batch-tags", "POST", {
        items: [{ id: note.id, version: note.version }],
        tags: ["重点"],
        mode: "remove",
      });
      note = removed.items[0];
      assert.ok(!note.tags.includes("重点"));
      assert.equal((await request("/api/items?tags=invalid")).status, 400);
    },
  );
  await t.test(
    "default collection persists, validates IDs, and read tokens cannot change settings",
    async () => {
      assert.deepEqual(await json("/api/preferences"), {
        default_collection_id: null,
      });
      await json("/api/preferences", "PATCH", { default_collection_id: a.id });
      assert.equal(
        (
          await request("/api/preferences", "PATCH", {
            default_collection_id: "missing",
          })
        ).status,
        400,
      );
      readToken = await json("/api/tokens", "POST", {
        name: "read",
        scope: "read",
      });
      assert.equal(
        (
          await request(
            "/api/preferences",
            "PATCH",
            { default_collection_id: b.id },
            { Authorization: `Bearer ${readToken.token}` },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/export?mode=backup", "GET", null, {
            Authorization: `Bearer ${readToken.token}`,
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "six export modes obey scope, keep original files, and include linked attachments",
    async () => {
      for (const mode of ["portable", "images", "markdown", "json", "html"]) {
        const r = await request(
          `/api/export?mode=${mode}&collection=${a.id}&include_trash=false&layout=legacy`,
        );
        assert.equal(r.status, 200);
        if (mode === "json") {
          const m = await r.json();
          assert.equal(m.collections.length, 1);
          assert.ok(m.attachment_ids.includes(imageB.id));
          continue;
        }
        const files = unzip(Buffer.from(await r.arrayBuffer()));
        if (mode === "images") {
          assert.ok(files.has(`images/${imageA.id}.png`));
          assert.ok(!files.has(`images/${imageB.id}.png`));
          assert.ok(files.has("images.json"));
        } else {
          assert.deepEqual(files.get(`images/${imageB.id}.png`), pngB);
          if (mode === "html") {
            const html = files.get("index.html").toString();
            assert.ok(html.includes("&lt;script&gt;"));
            assert.ok(!html.includes("<script>"));
            assert.ok(html.includes(`images/${imageB.id}.png`));
          } else
            assert.ok(
              files
                .get(`notes/${note.id}.md`)
                .toString()
                .includes(`../images/${imageB.id}.png`),
            );
        }
        if (mode === "markdown")
          assert.ok(!files.has(`images/${imageA.id}.png`));
      }
      assert.equal((await request("/api/export?mode=unknown")).status, 400);
      assert.equal(
        (await request("/api/export?mode=backup&collection=" + a.id)).status,
        400,
      );
    },
  );
  await t.test(
    "full backup restores to a separate data directory and serves identical original bytes",
    async () => {
      const r = await request("/api/export?mode=backup");
      assert.equal(r.status, 200);
      const files = unzip(Buffer.from(await r.arrayBuffer()));
      assert.ok(files.has("data/znote.sqlite"));
      const restoredRoot = await mkdtemp(resolve("artifacts/restored-"));
      for (const [name, buffer] of files) {
        if (!name.startsWith("data/")) continue;
        const target = resolve(restoredRoot, name);
        assert.ok(target.startsWith(restoredRoot));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, buffer);
      }
      const copy = createApp({ dataDir: join(restoredRoot, "data") });
      const s = await new Promise((r) => {
        const x = copy.app.listen(0, "127.0.0.1", () => r(x));
      });
      try {
        const base2 = `http://127.0.0.1:${s.address().port}`;
        const response = await fetch(base2 + imageA.url, {
          headers: { Cookie: cookie },
        });
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), pngA);
        assert.equal(
          (
            await (
              await fetch(base2 + "/api/preferences", {
                headers: { Cookie: cookie },
              })
            ).json()
          ).default_collection_id,
          a.id,
        );
      } finally {
        await new Promise((r) => s.close(r));
        copy.db.close();
      }
    },
  );
  await t.test(
    "restart preserves preferences; deleting the default library resets the homepage safely",
    async () => {
      await new Promise((r) => server.close(r));
      runtime.db.close();
      runtime = createApp({ dataDir });
      server = await new Promise((r) => {
        const s = runtime.app.listen(0, "127.0.0.1", () => r(s));
      });
      base = `http://127.0.0.1:${server.address().port}`;
      assert.equal(
        (await json("/api/preferences")).default_collection_id,
        a.id,
      );
      await request("/api/collections/" + a.id, "DELETE");
      assert.deepEqual(await json("/api/preferences"), {
        default_collection_id: null,
      });
      assert.equal((await json("/api/items?collection=unfiled")).total, 2);
    },
  );
});

test("offline migration reduces legacy storage and proves original hashes survive recovery", async () => {
  await mkdir(resolve("artifacts"), { recursive: true });
  const dir = await mkdtemp(resolve("artifacts/legacy-"));
  const db = openDatabase(dir);
  try {
    const image = await sharp({
      create: { width: 600, height: 600, channels: 3, background: "#ab9f80" },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const thumb = await sharp(image).resize(200).webp().toBuffer();
    await writeFile(join(dir, "media", "legacy.png"), image);
    await writeFile(join(dir, "media", "legacy-thumb.webp"), thumb);
    db.prepare(
      "INSERT INTO items(id,kind,title,file_key,thumbnail_key,mime,bytes,stored_bytes,width,height,hash,created_at,updated_at) VALUES(?,'image',?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "legacy",
      "旧图片",
      "legacy.png",
      "legacy-thumb.webp",
      "image/png",
      image.length,
      image.length,
      600,
      600,
      digest(image),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const result = await optimizeStorage(db, dir);
    assert.equal(result.optimized, 1);
    assert.equal(result.removedThumbnails, 1);
    assert.ok(result.media_bytes < image.length);
    assert.deepEqual(
      await originalBuffer(
        dir,
        db.prepare("SELECT * FROM items WHERE id=?").get("legacy"),
      ),
      image,
    );
    const again = await optimizeStorage(db, dir);
    assert.equal(again.optimized, 0);
    assert.equal(again.removedThumbnails, 0);
  } finally {
    db.close();
  }
});
