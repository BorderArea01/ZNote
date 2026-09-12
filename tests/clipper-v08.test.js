import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { createApp } from "../server/app.js";

test("preview placement avoids video cards and respects preferred size at viewport edges", async () => {
  const context = vm.createContext({});
  vm.runInContext(
    await readFile("extensions/clipper/preview-layout.js", "utf8"),
    context,
  );
  for (const rect of [
    { left: 550, right: 870, top: 300, bottom: 480 },
    { left: 20, right: 340, top: 20, bottom: 200 },
    { left: 1080, right: 1400, top: 790, bottom: 970 },
  ]) {
    for (const preferred of [240, 720, 1200]) {
      const b = context.ZNotePreviewLayout(
        { width: 1440, height: 1000 },
        rect,
        { width: 2400, height: 1600 },
        preferred,
      );
      assert.equal(b.overlaps, false);
      assert.ok(b.width <= preferred);
      assert.ok(b.left >= 0 && b.top >= 0);
      assert.ok(
        b.left + b.width + 18 <= 1440 && b.top + b.height + 118 <= 1000,
      );
      assert.ok(
        b.left >= rect.right ||
          b.left + b.width + 18 <= rect.left ||
          b.top >= rect.bottom ||
          b.top + b.height + 118 <= rect.top,
      );
    }
  }
});

test("one-click pairing requires an admin session and a single-use grant, never grants admin API access", async () => {
  const dataDir = await mkdtemp(resolve("artifacts/pair-v08-")),
    runtime = createApp({ dataDir }),
    server = runtime.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body = {}, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  try {
    const setup = await post("/api/auth/setup", { password: "0813" }),
      cookie = setup.headers.get("set-cookie").split(";")[0],
      origin = "chrome-extension://" + "a".repeat(32);
    assert.equal((await post("/api/clipper/pair")).status, 401);
    assert.equal(
      (
        await post(
          "/api/clipper/pair",
          {},
          { Cookie: cookie, Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    const grant = await (
      await post("/api/clipper/pair", {}, { Cookie: cookie, Origin: base })
    ).json();
    assert.ok(grant.code);
    assert.equal(grant.token, undefined);
    assert.equal((await post("/api/clipper/redeem", grant)).status, 403);
    const result = await post("/api/clipper/redeem", grant, { Origin: origin });
    assert.equal(result.status, 200);
    const token = await result.json();
    assert.equal(token.scope, "write");
    assert.equal(
      (await post("/api/clipper/redeem", grant, { Origin: origin })).status,
      401,
    );
    assert.equal(
      (
        await post(
          "/api/clipper/pair",
          {},
          { Authorization: "Bearer " + token.token, Origin: origin },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post(
          "/api/tokens",
          { name: "cannot escalate", scope: "write" },
          { Authorization: "Bearer " + token.token, Origin: origin },
        )
      ).status,
      403,
    );
    const note = await post(
      "/api/items",
      {
        title: "网页正文",
        content:
          "[链接](https://example.com/docs)\n\n![配图](/media/test/original)",
        source_url: "https://www.bilibili.com/read/cv1",
        tags: ["文章"],
      },
      { Authorization: "Bearer " + token.token, Origin: origin },
    );
    const item = await note.json();
    assert.equal(note.status, 201);
    assert.deepEqual(item.tags, ["文章", "b站"]);
    assert.match(item.content, /\[链接\]\(https:\/\/example.com\/docs\)/);
    assert.match(item.content, /来源链接/);
    const revoked = await (
      await post("/api/clipper/pair", {}, { Cookie: cookie })
    ).json();
    await post("/api/auth/logout", {}, { Cookie: cookie });
    assert.equal(
      (await post("/api/clipper/redeem", revoked, { Origin: origin })).status,
      401,
    );
  } finally {
    await runtime.imports.stop();
    await runtime.backups.stop();
    await runtime.webhooks.stop();
    await new Promise((r) => server.close(r));
    runtime.db.close();
  }
});
