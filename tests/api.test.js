import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";
import { createApp } from "../server/app.js";

function unzip(buffer) {
  const files = new Map();
  let cursor = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (cursor >= 0 && buffer.readUInt32LE(cursor) === 0x02014b50) {
    const method = buffer.readUInt16LE(cursor + 10),
      compressed = buffer.readUInt32LE(cursor + 20),
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
    const data = buffer.subarray(start, start + compressed);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    cursor += 46 + nameLength + extra + comment;
  }
  return files;
}

test("ZNote real API lifecycle, permissions, media, export and restart", async (t) => {
  await mkdir(resolve("artifacts"), { recursive: true });
  const dataDir = await mkdtemp(resolve("artifacts/api-"));
  let runtime = createApp({ dataDir });
  let server = await new Promise((r) => {
    const s = runtime.app.listen(0, "127.0.0.1", () => r(s));
  });
  let base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    runtime.db.close();
  });
  let cookie, collection, image, note, readToken, writeToken;
  const password = "0427";
  const request = (path, method = "GET", data, headers = {}) =>
    fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  await t.test("requires authentication and initializes once", async () => {
    assert.equal((await request("/api/items")).status, 401);
    assert.equal(
      (await request("/api/auth/setup", "POST", { password: "123" })).status,
      400,
    );
    const r = await request("/api/auth/setup", "POST", { password });
    assert.equal(r.status, 201);
    cookie = r.headers.get("set-cookie").split(";")[0];
    assert.match(r.headers.get("set-cookie"), /HttpOnly/);
    assert.equal(
      (await request("/api/auth/setup", "POST", { password })).status,
      409,
    );
    assert.equal((await request("/api/me")).status, 200);
    assert.equal(
      (await request("/api/auth/login", "POST", { password: "wrong" })).status,
      401,
    );
  });
  await t.test(
    "rejects browser cross-origin writes and malformed input",
    async () => {
      assert.equal(
        (
          await request(
            "/api/items",
            "POST",
            { title: "bad" },
            { Origin: "https://untrusted.example" },
          )
        ).status,
        403,
      );
      assert.equal(
        (await request("/api/items", "POST", { title: "" })).status,
        400,
      );
      assert.equal((await request("/api/items?limit=-1")).status, 400);
      assert.equal(
        (
          await request("/api/items", "POST", {
            title: "bad",
            collection_id: "missing",
          })
        ).status,
        400,
      );
    },
  );
  await t.test("creates collection and rejects duplicate names", async () => {
    const r = await request("/api/collections", "POST", {
      name: "设计研究",
      color: "#678959",
    });
    assert.equal(r.status, 201);
    collection = await r.json();
    assert.equal(
      (await request("/api/collections", "POST", { name: "设计研究" })).status,
      409,
    );
  });
  const original = await sharp({
    create: { width: 1400, height: 900, channels: 3, background: "#648a72" },
  })
    .png()
    .toBuffer();
  const upload = (buffer, filename = "灵感.png", fields = {}) => {
    const form = new FormData();
    form.set("file", new Blob([buffer]), filename);
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return fetch(base + "/api/assets", {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
  };
  await t.test(
    "validates actual image bytes, makes thumbnails and deduplicates",
    async () => {
      assert.equal(
        (await upload(Buffer.from("<script>alert(1)</script>"))).status,
        415,
      );
      assert.equal(
        (await upload(original, "image.png", { tags: "bad" })).status,
        400,
      );
      const r = await upload(original, "灵感.png", {
        tags: '["灵感","配色"]',
        collection_id: collection.id,
      });
      assert.equal(r.status, 201);
      image = await r.json();
      assert.equal(image.title, "灵感.png");
      image = await (
        await request(`/api/items/${image.id}`, "PATCH", {
          title: "苔绿的设计灵感",
          version: image.version,
        })
      ).json();
      assert.equal(image.width, 1400);
      assert.equal(image.kind, "image");
      assert.equal(image.file_key, undefined);
      assert.deepEqual(
        Buffer.from(await (await request(image.url)).arrayBuffer()),
        original,
      );
      const thumb = await sharp(
        Buffer.from(await (await request(image.thumbnail_url)).arrayBuffer()),
      ).metadata();
      assert.equal(thumb.format, "webp");
      assert.equal(thumb.width, 800);
      const duplicate = await (await upload(original, 'image.png', { collection_id: collection.id })).json();
      assert.equal(duplicate.id, image.id);
      assert.equal(duplicate.duplicate, true);
      assert.equal((await fetch(base + image.url)).status, 401);
    },
  );
  await t.test(
    "creates Markdown, finds Chinese text, tags, collection, and backlinks",
    async () => {
      note = await (
        await request("/api/items", "POST", {
          title: "视觉研究笔记",
          content: `# 材质探索\n这是中文检索测试。\n![配色](${image.url})\n[[苔绿的设计灵感]]`,
          tags: ["研究", "研究"],
          collection_id: collection.id,
        })
      ).json();
      assert.deepEqual(note.tags, ["研究"]);
      const found = await (
        await request("/api/items?q=" + encodeURIComponent("中文检索"))
      ).json();
      assert.equal(found.total, 1);
      assert.equal(found.items[0].id, note.id);
      assert.equal(
        (
          await (
            await request("/api/items?tag=" + encodeURIComponent("灵感"))
          ).json()
        ).total,
        1,
      );
      assert.equal(
        (
          await (
            await request(`/api/items?collection=${collection.id}&limit=1`)
          ).json()
        ).items.length,
        1,
      );
      assert.equal(
        (await (await request(`/api/items/${image.id}/backlinks`)).json())[0]
          .id,
        note.id,
      );
      assert.equal(
        (await (await request("/api/tags?collection="+collection.id)).json()).find(
          (t) => t.name === "研究",
        ).count,
        1,
      );
    },
  );
  await t.test("detects concurrent edits and persists favorites", async () => {
    const r = await request(`/api/items/${note.id}`, "PATCH", {
      version: note.version,
      favorite: true,
    });
    assert.equal(r.status, 200);
    assert.equal(
      (
        await request(`/api/items/${note.id}`, "PATCH", {
          version: note.version,
          title: "stale",
        })
      ).status,
      409,
    );
    const oldContent = note.content;
    note = await r.json();
    assert.equal(note.version, 2);
    assert.equal(note.content, oldContent);
    assert.deepEqual(note.tags, ["研究"]);
    assert.equal(note.collection_id, collection.id);
    assert.equal(
      (await (await request("/api/items?favorite=true")).json()).total,
      1,
    );
    assert.equal(
      (await request(`/api/items/${note.id}`, "PATCH", { title: "no version" }))
        .status,
      400,
    );
  });
  await t.test(
    "API tokens enforce scopes and cannot administer other tokens",
    async () => {
      readToken = await (
        await request("/api/tokens", "POST", {
          name: "read test",
          scope: "read",
        })
      ).json();
      writeToken = await (
        await request("/api/tokens", "POST", {
          name: "write test",
          scope: "write",
        })
      ).json();
      const headers = {
        Authorization: `Bearer ${readToken.token}`,
        Cookie: "",
      };
      assert.equal(
        (await request("/api/items", "GET", null, headers)).status,
        200,
      );
      assert.equal(
        (await request("/api/items", "POST", { title: "forbidden" }, headers))
          .status,
        403,
      );
      assert.equal(
        (
          await request("/api/tokens", "GET", null, {
            Authorization: `Bearer ${writeToken.token}`,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/api/items",
            "POST",
            { title: "plugin note" },
            { Authorization: `Bearer ${writeToken.token}`, Cookie: "" },
          )
        ).status,
        201,
      );
      const list = await (await request("/api/tokens")).json();
      assert.equal(list.length, 2);
      assert.ok(!("hash" in list[0]));
      assert.ok(!("token" in list[0]));
    },
  );
  await t.test(
    "soft deletion, restore, and incremental durable events",
    async () => {
      assert.equal(
        (await request(`/api/items/${image.id}`, "DELETE")).status,
        204,
      );
      assert.equal(
        (await (await request("/api/items?kind=image")).json()).total,
        0,
      );
      assert.equal(
        (await (await request("/api/items?trash=true")).json()).total,
        1,
      );
      assert.equal((await request(image.url)).status, 200); // Existing notes retain their image references.
      assert.equal(
        (await request(`/api/items/${image.id}/restore`, "POST", {})).status,
        200,
      );
      const feed = await (await request("/api/events?after=0")).json();
      assert.ok(feed.events.some((e) => e.type === "item.deleted"));
      assert.ok(feed.events.some((e) => e.type === "item.restored"));
      assert.deepEqual(
        (await (await request(`/api/events?after=${feed.cursor}`)).json())
          .events,
        [],
      );
    },
  );
  await t.test(
    "exports original images and portable Markdown without credentials",
    async () => {
      const r = await request("/api/export?layout=legacy");
      assert.equal(r.status, 200);
      const files = unzip(Buffer.from(await r.arrayBuffer()));
      const manifest = JSON.parse(files.get("manifest.json"));
      assert.equal(manifest.items.length, 3);
      assert.equal(manifest.collections[0].id, collection.id);
      assert.deepEqual(files.get(`images/${image.id}.png`), original);
      assert.match(
        files.get(`notes/${note.id}.md`).toString(),
        new RegExp(`../images/${image.id}.png`),
      );
      assert.ok(!files.get("manifest.json").toString().includes("zn_"));
      assert.ok(!manifest.tokens);
    },
  );
  await t.test("provides OpenAPI and runnable documentation", async () => {
    const document = await (await request("/api/openapi.json")).json();
    assert.equal(document.openapi, "3.0.3");
    assert.ok(document.paths["/api/assets"]);
    assert.ok(document.paths["/api/events"]);
    assert.equal((await request("/api-docs")).status, 200);
  });
  await t.test(
    "survives server restart with content, sessions, tokens, and media intact",
    async () => {
      await new Promise((r) => server.close(r));
      runtime.db.close();
      runtime = createApp({ dataDir });
      server = await new Promise((r) => {
        const s = runtime.app.listen(0, "127.0.0.1", () => r(s));
      });
      base = `http://127.0.0.1:${server.address().port}`;
      assert.equal(
        (await (await request(`/api/items/${note.id}`)).json()).favorite,
        true,
      );
      assert.deepEqual(
        Buffer.from(await (await request(image.url)).arrayBuffer()),
        original,
      );
      assert.equal(
        (
          await request("/api/items", "GET", null, {
            Authorization: `Bearer ${readToken.token}`,
            Cookie: "",
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "concurrent uploads deduplicate atomically and trash collisions are recoverable",
    async () => {
      const buffer = await sharp({
        create: { width: 30, height: 40, channels: 3, background: "#123456" },
      })
        .png()
        .toBuffer();
      const responses = await Promise.all([
        upload(buffer),
        upload(buffer),
        upload(buffer),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 200, 201]);
      const values = await Promise.all(responses.map((r) => r.json()));
      assert.equal(new Set(values.map((v) => v.id)).size, 1);
      await request(`/api/items/${values[0].id}`, "DELETE");
      assert.equal((await upload(buffer)).status, 409);
      assert.equal(
        (await request(`/api/items/${values[0].id}/restore`, "POST", {}))
          .status,
        200,
      );
    },
  );
  await t.test(
    "revokes tokens, logs out, and preserves notes when collection is deleted",
    async () => {
      assert.equal(
        (await request(`/api/tokens/${readToken.id}`, "DELETE")).status,
        204,
      );
      assert.equal(
        (
          await request("/api/items", "GET", null, {
            Authorization: `Bearer ${readToken.token}`,
            Cookie: "",
          })
        ).status,
        401,
      );
      assert.equal(
        (await request(`/api/collections/${collection.id}`, "DELETE")).status,
        204,
      );
      assert.equal(
        (await (await request(`/api/items/${note.id}`)).json()).collection_id,
        null,
      );
      assert.equal((await request("/api/auth/logout", "POST", {})).status, 200);
      assert.equal((await request("/api/items")).status, 401);
      assert.equal(
        (await request("/api/auth/login", "POST", { password })).status,
        200,
      );
    },
  );
});
