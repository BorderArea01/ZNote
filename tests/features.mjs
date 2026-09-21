import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import sharp from "sharp";
import assert from "node:assert/strict";

await mkdir(resolve("artifacts"), { recursive: true });
const dir = await mkdtemp(resolve("artifacts/features-"));
const { app, db } = createApp({
  dataDir: dir,
  staticDir: resolve(process.env.UI_DIST || "dist"),
});
const server = await new Promise((r) => {
  const s = app.listen(0, "127.0.0.1", () => r(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: "light",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checkpoint = (text) => console.log("PASS:", text);
const post = async (path, body) => {
  const r = await context.request.post(base + path, { data: body });
  assert.ok(r.ok(), await r.text());
  return r.json();
};
try {
  await page.goto(base);
  await page.getByLabel("访问密码").fill("0019");
  await page.getByRole("button", { name: "开始使用 ZNote" }).click();
  await page.getByRole("heading", { name: /我的知识库/ }).waitFor();
  const a = await post("/api/collections", { name: "工作资料" }),
    b = await post("/api/collections", { name: "个人日记" });
  await post("/api/items", {
    title: "只属于个人日记",
    collection_id: b.id,
    content: "独立知识库首页",
  });
  await page.reload();
  await page.getByRole("button", { name: "工作资料 0", exact: true }).waitFor();
  assert.equal(await page.locator(".item-card").count(), 0);
  await page.screenshot({
    path: resolve("artifacts/library-home.png"),
    fullPage: true, animations: "disabled",
  });
  checkpoint("homepage shows library entrances without mixed image cards");
  await page.getByRole("button", { name: "工作资料 0", exact: true }).click();
  await page.getByRole("button", { name: "上传图片", exact: true }).click();
  const files = [];
  for (const [name, color] of [
    ["素材甲.png", "#9fac80"],
    ["素材乙.png", "#90a9ad"],
  ]) {
    const buffer = await sharp({
      create: { width: 1000, height: 800, channels: 3, background: color },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const path = join(dir, name);
    await writeFile(path, buffer);
    files.push(path);
  }
  const bad = join(dir, "失败示例.png");
  await writeFile(bad, "not a real image");
  files.push(bad);
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles(files);
  await page.getByLabel("批量上传标签").fill("标签甲, 标签乙");
  await page.getByLabel("批量上传标签").press("Enter");
  assert.equal(await page.getByRole("dialog").locator(".tag-pill").count(), 2);
  await page.screenshot({
    path: resolve("artifacts/batch-upload.png"),
    fullPage: true, animations: "disabled",
  });
  await page.getByRole("button", { name: "开始上传", exact: true }).click();
  await page
    .getByText("图片处理失败", { exact: false })
    .waitFor({ state: "hidden" })
    .catch(() => {});
  await page.waitForFunction(() =>
    document
      .querySelector(".feature-actions small")
      ?.textContent.includes("完成 2 个 · 失败 1 个"),
  );
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.waitForFunction(
    // The two valid uploads are intentionally folded into one image card;
    // the invalid file remains visible in the upload dialog only.
    () => document.querySelectorAll(".item-card").length === 1,
  );
  const records = await (
    await context.request.get(base + "/api/items?collection=" + a.id)
  ).json();
  assert.ok(
    records.items.every(
      (i) => i.tags.includes("标签甲") && i.tags.includes("标签乙"),
    ),
  );
  checkpoint(
    "multiple files upload into the selected library; common tags and per-file failures",
  );
  await page.getByRole("button", { name: "选择内容", exact: true }).click();
  await page.getByLabel("选择当前页全部内容").check();
  await page.getByRole("button", { name: "批量标签", exact: true }).click();
  await page.getByLabel("批量编辑标签").fill("批量整理");
  await page.getByLabel("批量编辑标签").press("Enter");
  await page.getByRole("button", { name: "应用标签", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const tagged = await (
    await context.request.get(base + "/api/items?collection=" + a.id)
  ).json();
  assert.ok(
    tagged.items.every(
      (i) => i.tags.includes("批量整理") && i.tags.length === 3,
    ),
  );
  await post("/api/items", {
    title: "用于标签匹配的笔记",
    content: "筛选",
    tags: ["单独"],
    collection_id: a.id,
  });
  await page.getByRole("button", { name: "刷新内容" }).click();
  await page
    .locator(".sidebar-tags")
    .getByRole("button", { name: "# 标签甲", exact: true })
    .click();
  await page
    .locator(".sidebar-tags")
    .getByRole("button", { name: "# 单独", exact: true })
    .click();
  await page.getByRole("heading", { name: "还没有找到相关内容" }).waitFor();
  await page.getByLabel("标签匹配方式").selectOption("any");
  await page.waitForFunction(
    () => document.querySelectorAll(".item-card").length === 2,
  );
  checkpoint("batch tag edits preserve old tags; multi-tag all/any matching");
  await page.getByRole("button", { name: "设置与连接" }).click();
  await page.getByRole("button", { name: "夜间", exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.getByLabel("默认展示的知识库").selectOption(b.id);
  await page.waitForFunction(
    () =>
      document.querySelector(".breadcrumbs strong")?.textContent === "个人日记",
  );
  await page.screenshot({
    path: resolve("artifacts/night-settings.png"),
    fullPage: true, animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭窗口" }).click();
  const fetched = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/items") || req.url().includes("/media/"))
      fetched.push(req.url());
  });
  await page.reload();
  await page.getByRole("heading", { name: /个人日记/, level: 1 }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.locator(".item-card").count(), 1);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.ok(
    fetched
      .filter((u) => u.includes("/api/items?"))
      .every((u) => u.includes(`collection=${b.id}`)),
  );
  assert.ok(!fetched.some((u) => u.includes("/media/")));
  checkpoint(
    "default library and night theme persist on reload; other libraries are never loaded first",
  );
  await page.getByRole("button", { name: "工作资料 2", exact: true }).click();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.screenshot({
    path: resolve("artifacts/night-export.png"),
    fullPage: true, animations: "disabled",
  });
  await page.getByRole("button", { name: /JSON 元数据/ }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载导出文件" }).click();
  const download = await downloading;
  const output = join(dir, "download.json");
  await download.saveAs(output);
  const manifest = JSON.parse(await readFile(output, "utf8"));
  assert.equal(manifest.items.length, 3);
  assert.equal(manifest.collections[0].id, a.id);
  await page.getByRole("button", { name: "关闭窗口" }).click();
  checkpoint("export dialog produces a scoped downloadable JSON artifact");
  await page.screenshot({
    path: resolve("artifacts/night-desktop.png"),
    fullPage: true, animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve("artifacts/night-mobile.png"),
    fullPage: true, animations: "disabled",
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("button", { name: "切换浅色模式" }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.reload();
  await page.getByRole("heading", { name: /个人日记/, level: 1 }).waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.deepEqual(errors, []);
  checkpoint(
    "night mobile layout has no horizontal overflow; light theme can be restored",
  );
} catch (e) {
  await page.screenshot({
    path: resolve("artifacts/features-failure.png"),
    fullPage: true, animations: "disabled",
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
  db.close();
}
