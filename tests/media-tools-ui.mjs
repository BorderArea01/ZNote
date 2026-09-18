import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createApp } from "../server/app.js";
const captureEvidence = async (target, options) => {
  if (process.env.ZNOTE_SKIP_TEST_SCREENSHOTS === "1") return;
  await target.screenshot(options);
};
const dir = await mkdtemp(resolve("artifacts/media-tools-ui-"));
const runtime = createApp({
  dataDir: join(dir, "data"),
  staticDir: resolve(process.env.UI_DIST || "dist"),
});
const server = runtime.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const small = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#567c90" },
  })
    .png()
    .toBuffer(),
  large = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: "#567c90" },
  })
    .png()
    .toBuffer();
const mp4 = await readFile("tests/fixtures/sample.mp4");
const requests = [];
const source = createServer(async (req, res) => {
  requests.push({ path: req.url, auth: req.headers.authorization });
  const path = new URL(req.url, "http://source").pathname;
  if(path==='/')res.setHeader('Set-Cookie','fixture_media=1; HttpOnly; SameSite=Lax; Path=/');
  else if(!(req.headers.cookie||'').includes('fixture_media=1')){res.statusCode=403;res.end('fixture login required');return;}
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (path === "/small.png" || path === "/large.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(path === "/small.png" ? small : large);
    } else if (path === "/movie") {
      res.setHeader("Content-Type", "video/mp4");
      res.end(mp4);
    } else if (path === "/hls.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(await readFile("addons/browser/clipper/vendor/hls.min.js"));
    } else if (
      path === "/stream" ||
      /^\/(?:video\.m3u8|video\d+\.ts)$/.test(path)
    ) {
      res.setHeader(
        "Content-Type",
        path.endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl",
      );
      res.end(
        await readFile(
          "tests/fixtures/hls/" +
            (path === "/stream" ? "master.m3u8" : path.slice(1)),
        ),
      );
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<!doctype html><html><head><title>媒体发现验证页</title><meta property="og:title" content="雨后城市纪录"><meta name="author" content="影像作者"><style>body{font:18px system-ui;background:#eef4f2;color:#234339;padding:35px}img{width:300px;height:200px}video{width:320px}input,button{font:inherit;padding:10px}</style></head><body><h1>图片与视频一起发现</h1><p>悬停图片，或点击播放按钮载入网络资源</p><img id="sample" alt="高清测试图" src="/small.png" data-original="/large.png"><p><input id="typing" placeholder="输入区不触发快捷键"></p><button id="load">加载 MP4 与 m3u8</button><video id="player" controls muted></video><script src="/hls.js"></script><script>document.getElementById("load").onclick=()=>{fetch("/movie?id=one").then(r=>r.arrayBuffer());const h=new Hls();h.loadSource("/stream?id=hls");h.attachMedia(document.getElementById("player"));};</script></body></html>',
      );
    }
  } catch (e) {
    res.statusCode = 500;
    res.end("fixture failed");
  }
});
source.listen(0, "127.0.0.1");
await new Promise((r) => source.once("listening", r));
const sourceUrl = `http://127.0.0.1:${source.address().port}`;
const extension = resolve("addons/browser/clipper");
const context = await chromium.launchPersistentContext(join(dir, "profile"), {
  channel: "msedge",
  headless: true,
  acceptDownloads: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: { width: 1440, height: 1000 },
});
const worker =
  context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
const id = new URL(worker.url()).host;
const errors = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
try {
  const setup = await context.request.post(base + "/api/auth/setup", {
    data: { password: "0059" },
  });
  assert.ok(setup.ok());
  const token = await (
    await context.request.post(base + "/api/tokens", {
      data: { name: "媒体工具测试", scope: "write" },
    })
  ).json();
  const collection = await (
    await context.request.post(base + "/api/collections", {
      data: { name: "测试素材库" },
    })
  ).json();
  await worker.evaluate((config) => chrome.storage.local.set(config), {
    server: base,
    token: token.token,
    collection_id: collection.id,
    tags: "媒体,参考",
  });
  const cdp = await context.newCDPSession(page);
  await mkdir(join(dir, "downloads"), { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: join(dir, "downloads"),
    eventsEnabled: true,
  });
  await page.goto(sourceUrl);
  const overlay = page.locator("[data-znote-overlay]");
  await overlay
    .getByRole("button", { name: "ZNote 视频嗅探", exact: true })
    .waitFor();
  const sample=page.locator("#sample");
  await sample.evaluate(el=>el.decode());
  await page.waitForTimeout(200);
  await sample.hover({position:{x:100,y:100}});
  const preview = overlay.locator('[aria-label="ZNote 高清图片预览"]');
  await preview.waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-znote-overlay]")
        .shadowRoot.querySelector(".preview img").naturalWidth === 2400,
  );
  await captureEvidence(page, { path: resolve("artifacts/v07-hover-preview.png") });
  await page.evaluate(()=>{const p=document.querySelector('[data-znote-overlay]').shadowRoot.querySelector('.preview');document.body.style.minHeight='1600px';p.style.left='900px';p.style.top='300px';p.style.width='400px';p.style.height='400px';p.style.pointerEvents='none';});
  await page.mouse.move(920,320);await page.waitForTimeout(400);assert.ok(await preview.isVisible(),'Preview stays open while the pointer is inside its hit-test-transparent image area');
  await page.evaluate(()=>window.scrollTo(0,80));await page.waitForTimeout(200);assert.ok(await preview.isVisible(),'Page scroll under the preview does not close it while the pointer remains over it');console.log('PASS: preview stays open under the pointer, including hit-test-transparent images and page scroll');
  await page.mouse.move(1420, 12);
  await page.waitForTimeout(300);
  assert.equal(await preview.isVisible(), false, 'Leaving the image dismisses within 300 ms');
  await page.locator('#sample').hover(); await preview.waitFor({state:'visible'});
  const thumbBox=await page.locator('#sample').boundingBox(),previewBox=await preview.boundingBox();
  const gapX=(thumbBox.x+thumbBox.width+previewBox.x)/2;
  await page.mouse.move(gapX,thumbBox.y+thumbBox.height/2);await page.waitForTimeout(450);assert.ok(await preview.isVisible());
  await preview.getByRole('button',{name:'Z 保存知识库',exact:true}).hover();await page.waitForTimeout(1100);assert.ok(await preview.isVisible());
  await preview.getByRole('button',{name:'Z 保存知识库',exact:true}).click();
  await preview.getByText("已保存到知识库", { exact: true }).waitFor();
  const items = await (
    await context.request.get(base + "/api/items?kind=image")
  ).json();
  assert.equal(items.total, 1);
  assert.equal(items.items[0].width, 2400);
  assert.ok(items.items[0].content.includes("来源链接：" + sourceUrl));
  assert.deepEqual(
    await (await context.request.get(base + items.items[0].url)).body(),
    large,
  );
  await preview.getByRole('button',{name:'Z 保存知识库',exact:true}).focus();await page.keyboard.press('z');
  await preview.getByText('已收录，保留原备注并补充来源', {exact:true}).waitFor();
  console.log('PASS: Z saves the current image while focus is on a ZNote preview button');
  await preview.getByRole('button',{name:'S 下载',exact:true}).click();
  await preview.getByText("已交给浏览器下载", { exact: true }).waitFor();
  let downloads;
  for (let i = 0; i < 100; i++) {
    downloads = await worker.evaluate(() => chrome.downloads.search({}));
    if (downloads.some((d) => d.state === "complete")) break;
    await page.waitForTimeout(50);
  }
  const downloaded = downloads.find((d) => d.state === "complete");
  assert.ok(downloaded);
  assert.ok(downloaded.filename.endsWith('.png'));
  assert.ok(resolve(downloaded.filename).startsWith(resolve(dir)));
  assert.deepEqual(await readFile(downloaded.filename), large);

  assert.ok(items.items[0].tags.includes('127.0.0.1'));
  const options = await context.newPage();
  await options.goto('chrome-extension://' + id + '/options.html');
  await options.getByRole('button',{name:'预览与快捷键说明',exact:true}).hover();
  await options.getByRole('tooltip').waitFor();
  assert.ok((await options.getByRole('tooltip').textContent()).includes('Z 入库'));
  await options.keyboard.press('Escape'); assert.equal(await options.getByRole('tooltip').count(),0);
  await captureEvidence(options,{path:resolve('artifacts/v082-extension-settings.png'),fullPage:true});
  await options.waitForFunction(()=>document.body.dataset.ready === 'true');
  await options.locator('#download-key').fill('D'); await options.locator('#save-key').fill('D');
  await options.getByRole('button',{name:'保存浏览器行为'}).click();
  await options.getByText('下载和入库快捷键不能相同',{exact:true}).waitFor();
  await options.locator('#save-key').fill('Q');
  await options.getByRole('button',{name:'保存浏览器行为'}).click();
  await options.getByText('浏览器行为已保存，已打开网页同步生效',{exact:true}).waitFor();
  await page.bringToFront();
  await preview.getByRole('button',{name:'Q 保存知识库'}).waitFor();
  // Masked card with pointer-events:none image and full URL on its wrapper.
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{
    document.querySelector('#sample').outerHTML='<div id="card" data-original="/large.png" style="position:relative;width:300px;height:200px;overflow:hidden;border-radius:20px"><img src="/small.png" style="pointer-events:none;object-fit:cover"><a id="mask" href="/explore/note1?from=profile" style="position:absolute;inset:0;display:block"><span id="badge" style="position:absolute;left:20px;top:20px;padding:20px">图文笔记</span></a></div>';
  });
  await page.locator('#mask').hover({position:{x:150,y:110}});
  await preview.waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('[data-znote-overlay]').shadowRoot.querySelector('.preview img').naturalWidth===2400);
  await page.keyboard.press('k'); await page.waitForTimeout(150);
  assert.equal((await (await context.request.get(base+'/api/items/'+items.items[0].id)).json()).version,items.items[0].version);
  await page.keyboard.press('q');
  await preview.getByText('已收录，保留原备注并补充来源',{exact:true}).waitFor();
  const updated=await (await context.request.get(base+'/api/items/'+items.items[0].id)).json();
  assert.ok(updated.content.includes(sourceUrl+'/explore/note1?from=profile'));
  // Moving across a badge on the same thumbnail must not close/restart preview.
  await page.locator('#badge').hover(); await page.waitForTimeout(300);assert.ok(await preview.isVisible());
  await captureEvidence(page,{path:resolve('artifacts/v07-covered-card.png')});
  const beforeDownloads=(await worker.evaluate(()=>chrome.downloads.search({}))).length;
  await page.keyboard.press('d'); await preview.getByText('已交给浏览器下载',{exact:true}).waitFor();
  assert.ok((await worker.evaluate(()=>chrome.downloads.search({}))).length>beforeDownloads);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{document.querySelector('#card').outerHTML='<div id="background" style="width:300px;height:200px;background-image:url(/large.png)"><span style="display:block;padding:40px">背景图片卡片</span></div>';});
  await page.locator('#background span').hover();await preview.waitFor({state:'visible'});
  await page.keyboard.press('Escape');

  // Representative XHS signed cover URL: expand known preset, preserve signature,
  // and fall back to the actual cover when the detail preset is unavailable.
  let detailRequests=0;
  await page.route('https://sns-webpic-qc.xhscdn.com/**',async route=>{
    const detail=route.request().url().includes('!nd_dft_wlteh_webp_3');
    if(detail) detailRequests++;
    if(detail && route.request().url().includes('missing')) return route.fulfill({status:404,body:'unavailable'});
    return route.fulfill({contentType:'image/png',body:detail?large:small});
  });
  await page.evaluate(()=>{document.querySelector('#background').outerHTML='<a id="xhs-cover" style="display:block;width:200px;height:120px" href="/explore/xhs-note?xsec_token=fixture"><img style="width:200px;height:120px;pointer-events:none" src="https://sns-webpic-qc.xhscdn.com/20260912/signed/1040fixture!nc_n_webp_mw_1?token=keep"></a>';});
  await page.locator('#xhs-cover').hover();await preview.waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('[data-znote-overlay]').shadowRoot.querySelector('.preview img').naturalWidth===2400);
  assert.ok((await preview.locator('img').getAttribute('src')).endsWith('!nd_dft_wlteh_webp_3?token=keep'));
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{document.querySelector('#xhs-cover img').src='https://sns-webpic-qc.xhscdn.com/20260912/signed/missing!nc_n_webp_mw_1?token=keep';});
  await page.locator('#xhs-cover').hover();await preview.waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('[data-znote-overlay]').shadowRoot.querySelector('.preview img').naturalWidth===600);
  assert.ok(detailRequests>=2);
  await page.evaluate(()=>{document.querySelector('#xhs-cover').outerHTML='<img id="sample" src="/small.png" data-original="/large.png">';});
  await page.keyboard.press('Escape');
  // Reinstall-equivalent cleared local settings: the SAME server token reconnects.
  await worker.evaluate(()=>chrome.storage.local.clear());
  await options.reload();await options.waitForFunction(()=>document.body.dataset.ready==='true');
  await options.locator('#server').fill(base);await options.locator('#token').fill(token.token);
  await options.getByRole('button',{name:'验证连接并读取知识库'}).click();
  await options.getByText('连接成功，请选择知识库并保存设置',{exact:true}).waitFor();
  await options.locator('#collection').selectOption(collection.id);await options.locator('#tags').fill('媒体,参考');
  await options.getByRole('button',{name:'保存设置',exact:true}).click();await options.getByText('已保存，可以右键图片或截图入库',{exact:true}).waitFor();
  await options.locator('#token').fill('zn_'+'0'.repeat(64));await options.getByRole('button',{name:'验证连接并读取知识库'}).click();
  await options.waitForFunction(()=>document.querySelector('#status').textContent!=='正在连接…');
  assert.ok(await worker.evaluate(async expected=>(await chrome.storage.local.get('token')).token===expected, token.token));
  await options.close();
  const itemPage=await context.newPage();await itemPage.goto(base+'/#item/'+updated.id);
  const sourceAnchor=itemPage.getByRole('link',{name:'查看采集来源 · 127.0.0.1（2）'});
  await sourceAnchor.waitFor();assert.equal(await sourceAnchor.getAttribute('href'),sourceUrl+'/explore/note1?from=profile');await itemPage.close();
  await page.bringToFront();
  await page.locator("#typing").fill("s k");
  assert.equal(await page.locator("#typing").inputValue(), "s k");
  await overlay
    .getByRole("button", { name: "ZNote 视频嗅探", exact: true })
    .click();
  const panel = overlay.getByRole("dialog", { name: "ZNote 视频嗅探" });
  await panel.waitFor();
  await page.locator("#load").click();
  await panel
    .locator(".item")
    .filter({ hasText: "m3u8 分段视频" })
    .first()
    .waitFor();
  await panel.locator(".item").filter({ hasText: "视频文件" }).waitFor();
  assert.equal(await panel.locator(".item").filter({ hasText: "图片 ·" }).count(),0);
  assert.equal(await panel.getByRole("button",{name:"图片",exact:true}).count(),0);
  await panel.locator(".item").filter({hasText:"影像作者"}).first().waitFor();
  assert.ok(
    (await page.locator("#player").getAttribute("src")).startsWith("blob:"),
  );
  await captureEvidence(page, { path: resolve("artifacts/v07-media-discovery.png") });
  const hlsRow = panel
    .locator(".item")
    .filter({ hasText: "m3u8 分段视频" })
    .first();
  const pagesBeforeBackgroundSave=context.pages().length;
  await hlsRow.getByRole('button',{name:'保存知识库',exact:true}).click();
  await hlsRow.getByText('已保存到知识库',{exact:true}).waitFor({timeout:30000});
  assert.equal(context.pages().length,pagesBeforeBackgroundSave,'Background save must not open a tab');
  const videos = await (
    await context.request.get(base + "/api/items?kind=video")
  ).json();
  assert.equal(videos.total, 1);
  assert.equal(videos.items[0].width, 320);
  assert.equal(videos.items[0].title,"雨后城市纪录");assert.ok(videos.items[0].tags.includes("影像作者"));assert.ok(videos.items[0].content.includes("作者：影像作者"));
  assert.equal(videos.items[0].source_url, sourceUrl + "/");
  const opened = context.waitForEvent("page");
  await hlsRow.getByRole("button", { name: "预览", exact: true }).click();
  const media = await opened;
  await media.waitForLoadState();
  await media.locator("#video").waitFor();
  await media.waitForFunction(
    () => document.querySelector("video").readyState >= 2,
  );
  await media.locator("#video").evaluate(async (v) => {
    v.muted = true;
    await v.play();
  });
  await media.waitForFunction(
    () => document.querySelector("video").currentTime > 0.3,
  );
  await media.locator("#video").evaluate((v) => v.pause());
  await captureEvidence(media, { path: resolve("artifacts/v07-hls-preview.png") });
  await media
    .getByRole("button", { name: "保存到知识库", exact: true })
    .click();
  await media.getByText("知识库已收录，已补充来源", { exact: true }).waitFor();
  const cover=await context.request.get(base+videos.items[0].thumbnail_url);assert.ok(cover.ok());assert.match(cover.headers()["content-type"],/image\/webp/);
  assert.ok(videos.items[0].duration >= 3.9);
  await context.request.patch(base+'/api/preferences',{data:{default_collection_id:collection.id}});
  const library=await context.newPage();await library.goto(base+'/#item/'+videos.items[0].id);await library.locator('video').waitFor();await library.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await library.locator('video').evaluate(async v=>{v.muted=true;await v.play();});await library.waitForFunction(()=>document.querySelector('video').currentTime>.3);assert.ok(await library.locator('video').evaluate(v=>v.webkitAudioDecodedByteCount)>0);await library.keyboard.press('Escape');await library.locator('.video-cover').first().evaluate(img=>img.decode());await captureEvidence(library,{path:resolve('artifacts/v097-video-library.png')});await library.close();
  await media.getByRole("button", { name: "下载", exact: true }).click();
  await media.getByText("已交给浏览器下载", { exact: true }).waitFor();
  for (let i = 0; i < 100; i++) {
    downloads = await worker.evaluate(() => chrome.downloads.search({}));
    if (downloads.filter((d) => d.state === "complete").length >= 2) break;
    await media.waitForTimeout(50);
  }
  assert.ok(downloads.filter((d) => d.state === "complete").length >= 2);
  await page.bringToFront();
  const pagesBeforeBackgroundDownload=context.pages().length;
  await hlsRow.getByRole('button',{name:'下载',exact:true}).click();
  await hlsRow.getByText('下载完成',{exact:true}).waitFor({timeout:30000});
  assert.equal(context.pages().length,pagesBeforeBackgroundDownload,'Background download must not open a tab');
  for (let i = 0; i < 100; i++) {
    downloads = await worker.evaluate(() => chrome.downloads.search({}));
    if (downloads.filter((d) => d.state === "complete").length >= 3) break;
    await page.waitForTimeout(50);
  }
  assert.ok(downloads.filter((d) => d.state === "complete").length >= 3);

  const directRow=panel.locator('.item').filter({hasText:'视频文件'}).first();
  const pagesBeforeDirectSave=context.pages().length;
  await directRow.getByRole('button',{name:'保存知识库',exact:true}).click();
  await directRow.getByText(/已保存到知识库|知识库已收录/).waitFor({timeout:30000});
  assert.equal(context.pages().length,pagesBeforeDirectSave,'Direct video save must not open a tab');
  assert.ok((await (await context.request.get(base+'/api/items?kind=video')).json()).total>=1);

  await panel.getByRole('button',{name:'暂停嗅探',exact:true}).click();
  await page.evaluate(()=>fetch('/movie?id=paused').then(r=>r.arrayBuffer()));await page.waitForTimeout(200);
  let sniffer=await worker.evaluate(()=>chrome.storage.session.get('sniffTabs'));assert.ok(Object.values(sniffer.sniffTabs).every(s=>s.resources.every(r=>!r.url.includes('id=paused'))));
  await panel.getByRole('button',{name:'继续嗅探',exact:true}).click();
  await page.evaluate(()=>history.pushState({},'','/?next=1'));await page.waitForTimeout(200);
  sniffer=await worker.evaluate(()=>chrome.storage.session.get('sniffTabs'));const nextStates=Object.values(sniffer.sniffTabs).filter(s=>s.source_url.endsWith('/?next=1'));assert.ok(nextStates.length);assert.ok(nextStates.every(s=>s.resources.every(r=>r.source_url.endsWith('/?next=1'))));
  await page.reload();
  await page
    .locator("[data-znote-overlay]")
    .getByRole("button", { name: "ZNote 视频嗅探", exact: true })
    .click();
  const state = await worker.evaluate(() =>
    chrome.storage.session.get("sniffTabs"),
  );
  assert.ok(
    Object.values(state.sniffTabs).every((s) =>
      s.resources.length === 0,
    ),
  );
  assert.ok(requests.every((r) => !r.auth));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: fast dismissal within 300 ms; mouse crosses preview gap and lingers over buttons; real save/download button clicks; default Z and custom D/Q; settings help; masked card, background, XHS preset/fallback, same-token reconnection, rejected credentials preserve connection, multi-source links; hover original 2400px; S real download; input guard; video-only MIME sniffing behind blob player; HLS playback; no-tab background remux save/download; source; navigation isolation; no source token leakage",
  );
} catch (e) {
  try {
    await captureEvidence(page, { path: resolve("artifacts/v07-tools-failure.png"), timeout: 5000 });
  } catch (screenshotError) {
    console.error("Failure screenshot unavailable:", screenshotError.message);
  }
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
