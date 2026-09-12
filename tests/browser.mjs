import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import sharp from "sharp";
import assert from "node:assert/strict";

await mkdir(resolve("artifacts"), { recursive: true });
const dataDir = await mkdtemp(resolve("artifacts/ui-"));
const { app, db } = createApp({ dataDir, staticDir: resolve(process.env.UI_DIST || "dist") });
const server = await new Promise((r) => {
  const s = app.listen(0, "127.0.0.1", () => r(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
const password = "0427";
const checkpoint = (text) => console.log("PASS:", text);
const wait = (locator) => locator.waitFor({ state: "visible" });
const png = await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#eceade"/><rect x="150" y="120" width="900" height="660" rx="24" fill="#b8c7a5"/><circle cx="600" cy="450" r="220" fill="#edf2df"/><path d="M440 460l100 100 230-230" fill="none" stroke="#71916a" stroke-width="25"/></svg>',
  ),
)
  .png()
  .toBuffer();
const fixturePath = join(dataDir, "测试素材.png");
await writeFile(fixturePath, png);
try {
  await page.goto(base);
  await page.getByLabel("访问密码").fill(password);
  await page.getByRole("button", { name: "开始使用 ZNote" }).click();
  await wait(page.getByRole("heading", { name: /我的知识库/ }));
  assert.equal(await page.locator('.item-card').count(),0);
  checkpoint("first-run setup, authenticated home");
  await page.getByRole("button", { name: "新建知识库", exact: true }).click();
  await page.getByLabel("知识库名称").fill("设计灵感");
  await page.getByRole("button", { name: "保存知识库" }).click();
  await wait(page.getByRole("button", { name: "设计灵感 0", exact: true }));
  await page.locator("input[type=file]").first().setInputFiles(fixturePath);
  await page.getByRole('button',{name:'开始上传',exact:true}).click();
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('button',{name:'全部内容 1',exact:true}).click();
  await wait(page.getByRole("button", { name: "打开 测试素材.png" }));
  await page.getByRole("button", { name: "打开 测试素材.png" }).click();
  await page.getByLabel("标题", { exact: true }).fill("视觉配色研究");
  await page.getByLabel("标签", { exact: true }).fill("配色, 灵感");
  await page.getByLabel("所属知识库").selectOption({ label: "设计灵感" });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await wait(page.getByRole("status").filter({ hasText: "已保存" }));
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await wait(page.getByRole("button", { name: "打开 视觉配色研究" }));
  checkpoint("actual image upload and metadata editing");
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("从图像开始的知识整理");
  await page.getByLabel('所属知识库').selectOption({ label: '设计灵感' });
  await page
    .getByLabel("笔记正文")
    .fill(
      "# 视觉笔记\n\n在这里整理图片与想法。\n\n[[视觉配色研究]]\n\n- 收集\n- 连接\n- 创作",
    );
  // Real file insertion reuses the asset and adds a Markdown reference.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "插入图片" }).click();
  await (await chooser).setFiles(fixturePath);
  await page.waitForFunction(() =>
    document
      .querySelector("textarea.markdown-editor")
      ?.value.includes("/media/"),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await wait(page.getByRole("status").filter({ hasText: "已保存" }));
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await wait(page.locator(".markdown-preview img"));
  assert.ok(
    await page
      .locator(".markdown-preview img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  );
  await page.getByRole("button", { name: "关闭窗口" }).click();
  checkpoint("Markdown create, image embed, rendered preview");
  await page
    .getByRole("button", { name: "收藏 从图像开始的知识整理", exact: true })
    .click();
  await wait(
    page.getByRole("button", {
      name: "取消收藏 从图像开始的知识整理",
      exact: true,
    }),
  );
  await page.getByLabel("搜索内容").fill("图片与想法");
  await page.waitForFunction(
    () => document.querySelectorAll(".item-card").length === 1,
  );
  await wait(page.getByRole("button", { name: "打开 从图像开始的知识整理" }));
  await page.getByLabel("搜索内容").fill("");
  await page.waitForFunction(
    () => document.querySelectorAll(".item-card").length === 2,
  );
  checkpoint("favorite preserves body; Chinese body search");
  await page.getByRole("button", { name: "打开 视觉配色研究" }).click();
  await wait(
    page
      .locator(".backlinks button")
      .filter({ hasText: "从图像开始的知识整理" }),
  );
  await page.getByRole("button", { name: "全屏查看图片" }).click();
  await wait(page.locator(".lightbox img"));
  await page.getByRole("button", { name: "退出全屏" }).click();
  await page.getByRole("button", { name: "关闭窗口" }).click();
  checkpoint("image backlinks and full-size viewer");
  await page.getByRole("button", { name: "设置与连接" }).click();
  await page.getByRole("textbox", { name: "令牌名称" }).fill("测试集成");
  await page.getByRole("button", { name: "创建令牌" }).click();
  await wait(page.locator(".secret code"));
  const secret = await page.locator(".secret code").textContent();
  assert.ok(secret.startsWith("zn_"));
  const denied = await fetch(base + "/api/items", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "should fail" }),
  });
  assert.equal(denied.status, 403);
  await page.getByRole("button", { name: "我已保存" }).click();
  const popupWait = context.waitForEvent("page");
  await page.getByRole("link", { name: "接口文档" }).click();
  const docs = await popupWait;
  await docs.getByRole("heading", { name: /ZNote API/ }).waitFor();
  assert.ok((await docs.locator(".opblock").count()) >= 20);
  await docs.close();
  await page.getByRole("button", { name: "关闭窗口" }).click();
  checkpoint(
    "token generation, read-only enforcement, interactive OpenAPI docs",
  );
  // Representative, explicitly test-only content used to inspect a populated grid.
  for (const [title, color, color2] of [
    ["测试素材 · 森林色彩", "#d8e2ce", "#6e8964"],
    ["测试素材 · 暖色空间", "#efe2d0", "#b28f70"],
    ["测试素材 · 蓝灰秩序", "#dfe9e7", "#789597"],
    ["测试素材 · 纸张质感", "#f1ebdf", "#aaab8f"],
  ]) {
    const buffer = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="${color}"/><rect x="190" y="160" width="340" height="560" rx="160" fill="${color2}"/><circle cx="820" cy="440" r="170" fill="${color2}" opacity=".6"/><path d="M640 670h350" stroke="${color2}" stroke-width="6"/></svg>`,
      ),
    )
      .png()
      .toBuffer();
    const r = await context.request.post(base + "/api/assets", {
      multipart: {
        title,
        tags: '["测试素材"]',
        file: { name: "fixture.png", mimeType: "image/png", buffer },
      },
    });
    assert.ok(r.ok());
  }
  await page.getByRole("button", { name: "刷新内容" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".item-card").length === 6,
  );
  await page.locator(".toast").waitFor({ state: "hidden" });
  await page.screenshot({
    path: resolve("artifacts/desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "列表视图" }).click();
  assert.equal(await page.locator(".items.list .item-card").count(), 6);
  await page.getByRole("button", { name: "网格视图" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve("artifacts/mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "打开导航" }).click();
  await wait(page.locator(".sidebar.mobile-open"));
  await page.getByRole("button", { name: "图文笔记 1", exact: true }).click();
  await page.getByRole("button", { name: "打开 从图像开始的知识整理" }).click();
  await page.screenshot({
    path: resolve("artifacts/mobile-note.png"),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "移至回收站" }).click();
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "回收站 1", exact: true }).click();
  await page.getByRole("button", { name: "恢复 从图像开始的知识整理" }).click();
  await wait(page.getByRole("heading", { name: "回收站是空的" }));
  checkpoint("desktop and mobile layouts, list/grid, delete and restore");
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("即存即删测试");
  await page.getByLabel("笔记正文").evaluate((element, encoded) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
        "pasted.png",
        { type: "image/png" },
      ),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png.toString("base64"));
  await page.waitForFunction(() =>
    document.querySelector(".markdown-editor")?.value.includes("/media/"),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await wait(page.getByRole("button", { name: "移至回收站" }));
  await page.getByRole("button", { name: "移至回收站" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  checkpoint(
    "clipboard image paste; newly saved note can be deleted immediately",
  );
  await page.reload();
  await wait(page.getByRole("heading", { name: /我的知识库/ }));
  assert.deepEqual(errors, []);
  checkpoint("reload keeps session; no browser errors");
  console.log(
    "Screenshots: artifacts/desktop.png, artifacts/mobile.png, artifacts/mobile-note.png",
  );
} catch (e) {
  await page.screenshot({
    path: resolve("artifacts/ui-failure.png"),
    fullPage: true,
  });
  console.error(e);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
  db.close();
}
