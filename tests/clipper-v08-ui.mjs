import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createApp } from "../server/app.js";
const dir = await mkdtemp(resolve("artifacts/clipper-v08-ui-"));
const runtime = createApp({
  dataDir: join(dir, "data"),
  staticDir: resolve(process.env.UI_DIST || "dist"),
});
const server = runtime.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const png = await sharp({
  create: { width: 2400, height: 1600, channels: 3, background: "#627ca8" },
})
  .png()
  .toBuffer();
const mp4 = await readFile("tests/fixtures/sample.mp4");
const source = createServer((req, res) => {
  if (req.url === "/image.png") {
    res.setHeader("Content-Type", "image/png");
    return res.end(png);
  }
  if (req.url === "/missing.png") {
    res.statusCode = 404;
    return res.end("missing");
  }
  if (req.url === "/movie.mp4") {
    res.setHeader("Content-Type", "video/mp4");
    return res.end(mp4);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url === "/article")
    return res.end(
      `<!doctype html><html><head><title>播客的幕后故事</title></head><body><nav>导航广告</nav><article><h1>播客的幕后故事</h1><p>${"这是一篇关于声音制作和图像记录的文章，我们希望完整保存正文和相关资源。".repeat(15)}</p><h2>参考资料</h2><p>请查看<a href="/reference?q=one#section">带链接的资料</a>以及<strong>重要说明</strong>。</p><ul><li>录音</li><li>剪辑</li></ul><blockquote>保留引用内容</blockquote><pre><code class="language-js">const greeting = 'hello';</code></pre><table><thead><tr><th>名称</th><th>用途</th></tr></thead><tbody><tr><td>麦克风</td><td>录音</td></tr></tbody></table><img src="/image.png" alt="正文配图"><img src="/missing.png" alt="失效配图"><a href="javascript:alert(1)">无效链接</a><p>${"文章结尾还有需要保留的正文，感谢阅读。".repeat(10)}</p></article><footer>不需要的导航</footer></body></html>`,
    );
  res.end(
    `<!doctype html><html><head><title>封面视频交互</title></head><body style="margin:0;background:#eaf0f6;font:16px system-ui"><h1>视频封面与大图预览同时工作</h1><div id="card" style="position:absolute;left:530px;top:300px;width:320px;height:180px"><img id="cover" src="/image.png" style="width:320px;height:180px;object-fit:cover"><video muted loop src="/movie.mp4" style="position:absolute;inset:0;width:320px;height:180px;pointer-events:none;opacity:.7"></video></div><script>window.leaves=0;const card=document.querySelector('#card'),video=document.querySelector('video');card.onmouseenter=()=>video.play();card.onmouseleave=()=>{window.leaves++;video.pause();};</script></body></html>`,
  );
});
source.listen(0, "127.0.0.1");
await new Promise((r) => source.once("listening", r));
const sourceUrl = `http://127.0.0.1:${source.address().port}`;
const extension = resolve("addons/browser/clipper"),
  profile = join(dir, "profile");
const launch = (ext) =>
  chromium.launchPersistentContext(profile, {
    channel: "msedge",
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport: { width: 1440, height: 1000 },
  });
let context = await launch(extension),
  page = await context.newPage();
try {
  let worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  await context.request.post(base + "/api/auth/setup", {
    data: { password: "0813" },
  });
  await page.goto(base);
  await page.getByRole("button", { name: "设置与连接", exact: true }).click();
  await page.getByRole("button", { name: "一键连接扩展", exact: true }).click();
  await page
    .getByText("扩展已连接此知识库，无需填写 API 令牌", { exact: true })
    .waitFor();
  const first = await worker.evaluate(() =>
    chrome.storage.local.get(["server", "token"]),
  );
  assert.ok(first.server === base && first.token.startsWith("zn_"));
  const count = runtime.db
    .prepare("SELECT count(*) n FROM tokens WHERE kind='api'")
    .get().n;
  await page.getByRole("button", { name: "一键连接扩展", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(
    runtime.db.prepare("SELECT count(*) n FROM tokens WHERE kind='api'").get()
      .n,
    count,
  );
  // Actual synthetic-page clicks must never authorize connection.
  await worker.evaluate(() => chrome.storage.local.clear());
  await page.locator("[data-znote-connect]").evaluate((el) => el.click());
  await page.waitForTimeout(150);
  assert.ok(
    !(await worker.evaluate(() => chrome.storage.local.get("token"))).token,
  );
  await page.getByRole("button", { name: "一键连接扩展", exact: true }).click();
  await page
    .getByText("扩展已连接此知识库，无需填写 API 令牌", { exact: true })
    .waitFor();
  await page.goto(sourceUrl);
  await page.locator("#cover").hover();
  const preview = page.locator("[data-znote-overlay]").locator(".preview");
  await preview.waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 0.3,
  );
  const overlap = await page.evaluate(() => {
    const a = document.querySelector("#card").getBoundingClientRect(),
      b = document
        .querySelector("[data-znote-overlay]")
        .shadowRoot.querySelector(".preview")
        .getBoundingClientRect();
    return !(
      b.left >= a.right ||
      b.right <= a.left ||
      b.top >= a.bottom ||
      b.bottom <= a.top
    );
  });
  assert.equal(overlap, false);
  assert.equal(await page.evaluate(() => window.leaves), 0);
  assert.equal(await page.locator("video").evaluate((v) => v.paused), false);
  await page.screenshot({ path: resolve("artifacts/v08-preview-video.png") });
  const before = await preview.locator("img").boundingBox();
  const slider = preview.getByRole("slider", { name: "预览展示大小" });
  await slider.focus();
  for (let i = 0; i < 10; i++) await slider.press("ArrowLeft");
  const after = await preview.locator("img").boundingBox();
  assert.ok(after.width < before.width);
  const width = (
    await worker.evaluate(() => chrome.storage.local.get("previewWidth"))
  ).previewWidth;
  assert.equal(width, 320);
  await page.keyboard.press("Escape");
  await page.locator("#cover").hover();
  await preview.waitFor({ state: "visible" });
  assert.ok((await preview.locator("img").boundingBox()).width <= 320);
  await page.goto(sourceUrl + "/article");
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    sourceUrl + "/article",
  );
  const articlePage = await context.newPage();
  await articlePage.goto(`chrome-extension://${id}/article.html?tab=${tabId}`);
  await articlePage
    .getByRole("button", { name: "保存图文笔记", exact: true })
    .waitFor();
  await articlePage.waitForFunction(
    () => !document.querySelector("#save").disabled,
  );
  const markdown = await articlePage.locator("#content").inputValue();
  assert.ok(
    markdown.includes(`[带链接的资料](${sourceUrl}/reference?q=one#section)`),
  );
  assert.ok(markdown.includes("```"));
  assert.ok(markdown.includes("| 名称 |"));
  assert.ok(!markdown.includes("javascript:"));
  assert.ok(!markdown.includes("导航广告"));
  await articlePage
    .getByRole("button", { name: "保存图文笔记", exact: true })
    .click();
  await articlePage.getByText(/图文笔记已保存，1 张配图已归档/).waitFor();
  await articlePage.screenshot({
    path: resolve("artifacts/v08-article.png"),
    fullPage: true,
  });
  const notes = await (
    await context.request.get(base + "/api/items?kind=note")
  ).json();
  assert.equal(notes.total, 1);
  const note = notes.items[0];
  assert.ok(note.content.includes("/media/"));
  assert.ok(note.content.includes("未归档"));
  assert.ok(note.tags.includes("127.0.0.1"));
  assert.equal(note.source_url, sourceUrl + "/article");
  const images = await (
    await context.request.get(base + "/api/items?kind=image")
  ).json();
  assert.equal(images.total, 1);
  assert.deepEqual(
    await (await context.request.get(base + images.items[0].url)).body(),
    png,
  );
  await page.goto(base + "/#item/" + note.id);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.getByRole("link", { name: "带链接的资料", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "带链接的资料", exact: true })
      .getAttribute("href"),
    sourceUrl + "/reference?q=one#section",
  );
  await page.locator(".markdown-preview img").waitFor();
  await page.screenshot({
    path: resolve("artifacts/v08-note-render.png"),
    fullPage: true,
  });
  const config = await worker.evaluate(() =>
    chrome.storage.local.get(["server", "token", "previewWidth"]),
  );
  await context.close();
  const upgrade = join(dir, "different-download-directory");
  await cp(extension, upgrade, { recursive: true });
  const manifest = JSON.parse(await readFile(join(upgrade, "manifest.json")));
  manifest.version = manifest.version.replace(/\d+$/, patch => String(Number(patch) + 1));
  await writeFile(join(upgrade, "manifest.json"), JSON.stringify(manifest));
  context = await launch(upgrade);
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  assert.equal(new URL(worker.url()).host, id);
  const preserved = await worker.evaluate(() =>
    chrome.storage.local.get(["server", "token", "previewWidth"]),
  );
  assert.ok(JSON.stringify(preserved) === JSON.stringify(config));
  const valid = await worker.evaluate(async () => {
    const config = await chrome.storage.local.get(["server", "token"]);
    return (
      await fetch(config.server + "/api/me", {
        headers: { Authorization: "Bearer " + config.token },
      })
    ).json();
  });
  assert.equal(valid.scope, "write");
  console.log(
    "PASS: trusted one-click pairing without typing API; same token reused; cleared settings reconnect; preview size persists and never covers playing card; Readability Markdown links, tables, code, archived image and honest failure; rendered note; new extension version in different directory retains ID and full connection",
  );
} catch (e) {
  await page
    .screenshot({ path: resolve("artifacts/v08-ui-failure.png") })
    .catch(() => {});
  throw e;
} finally {
  await context.close();
  await runtime.imports.stop();
  await runtime.backups.stop();
  await runtime.webhooks.stop();
  await new Promise((r) => server.close(r));
  runtime.db.close();
  await new Promise((r) => source.close(r));
}
