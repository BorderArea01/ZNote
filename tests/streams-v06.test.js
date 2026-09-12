import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { createCipheriv } from 'node:crypto';
import { createApp } from "../server/app.js";
import { packageHls } from "../extensions/clipper/hls-package.js";
import { validatePlaylist } from "../server/streams.js";
import {
  mediaKind,
  addResource,
} from "../extensions/clipper/resource-store.js";
test("sniffer identifies media MIME and excludes fragments, deduplicates and bounds page resources", () => {
  assert.equal(
    mediaKind("https://site.test/stream", "application/vnd.apple.mpegurl"),
    "hls",
  );
  assert.equal(mediaKind("https://site.test/file", "video/mp4"), "video");
  assert.equal(mediaKind("blob:https://site.test/123"), null);
  assert.equal(mediaKind("https://a.test/a.ts", "video/mp2t"), null);
  const state = { resources: [], source_url: "https://site.test/post" };
  const first = addResource(state, { url: "https://site.test/a.jpg" });
  assert.equal(
    addResource(state, { url: "https://site.test/a.jpg", bytes: 99 }).id,
    first.id,
  );
  for (let i = 0; i < 150; i++)
    addResource(state, { url: "https://a.test/" + i + ".mp4" });
  assert.equal(state.resources.length, 100);
});
test("HLS package rejects external paths and unsupported encrypted references", () => {
  for (const line of [
    "../secret",
    "http://127.0.0.1/a",
    "file:/etc/passwd",
    '#EXT-X-MAP:URI="../../secret"',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="part-1.bin"',
  ])
    assert.throws(() =>
      validatePlaylist("#EXTM3U\n" + line + '\n#EXT-X-ENDLIST', new Set(["part-1.bin"])),
    );
  validatePlaylist(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="part-1.bin"\npart-2.bin\n#EXT-X-ENDLIST',
    new Set(["part-1.bin", "part-2.bin"]),
  );
  assert.throws(() => validatePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\npart-1.bin', new Set(['part-1.bin'])));
  assert.throws(() => validatePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex.m3u8', new Set(['index.m3u8'])));
  assert.throws(() => validatePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8', new Set(['video.m3u8']), 'audio.m3u8'));
});
test("real HLS fetch, master selection, remux download, save with source, auth and malformed packages", async () => {
  const dir = await mkdtemp(resolve("artifacts/hls-api-"));
  const runtime = createApp({ dataDir: dir });
  const server = runtime.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const source = createServer(async (req, res) => {
    try {
      const name = new URL(req.url, "http://x").pathname.slice(1);
      if(name==='encrypted.m3u8'){res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n'+[0,1,2,3].map(i=>'#EXTINF:1,\nenc'+i+'.ts').join('\n')+'\n#EXT-X-ENDLIST');return;}
      if(name==='key.bin'){res.end(Buffer.alloc(16,7));return;}
      if(/^enc\d\.ts$/.test(name)){const i=Number(name[3]),iv=Buffer.alloc(16);iv.writeUInt32BE(i,12);const cipher=createCipheriv('aes-128-cbc',Buffer.alloc(16,7),iv);res.end(Buffer.concat([cipher.update(await readFile('tests/fixtures/hls/video'+i+'.ts')),cipher.final()]));return;}
      if (!/^(?:split\/)?(?:(?:master|video|audio)\.m3u8|(?:video|audio)\d+\.ts)$/.test(name))
        throw new Error();
      res.end(await readFile("tests/fixtures/hls/" + name));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  source.listen(0, "127.0.0.1");
  await new Promise((r) => source.once("listening", r));
  const url = `http://127.0.0.1:${source.address().port}/master.m3u8`;
  let cookie;
  try {
    cookie = (
      await fetch(base + "/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "0561" }),
      })
    ).headers
      .get("set-cookie")
      .split(";")[0];
    const bundle = await packageHls(url, {
      signal: new AbortController().signal,
    });
    assert.equal(bundle.label, "320x180");
    assert.ok(bundle.files.size >= 6);
    const form = () => {
      const data = new FormData();
      for (const [name, blob] of bundle.files) data.append("files", blob, name);
      data.set("title", "分段视频");
      data.set("source_url", url);
      data.set("tags", '["HLS","参考"]');
      return data;
    };
    assert.equal(
      (await fetch(base + "/api/streams", { method: "POST", body: form() }))
        .status,
      401,
    );
    const get = async (options) => {
      await new Promise((r) => setTimeout(r, 40));
      return fetch(
        base + "/api/streams" + (options.download ? "?mode=download" : ""),
        {
          method: "POST",
          headers: { Cookie: cookie },
          body: options.form || form(),
        },
      );
    };
    const download = await get({ download: true });
    assert.equal(download.status, 200, await download.clone().text());
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.ok(bytes.length > 2000);
    for(const variant of ['encrypted.m3u8','split/master.m3u8']){
      const packed=await packageHls(url.replace('master.m3u8',variant),{signal:new AbortController().signal});const data=new FormData();for(const [name,blob]of packed.files)data.append('files',blob,name);
      const result=await get({download:true,form:data});assert.equal(result.status,200,await result.clone().text());assert.ok((await result.arrayBuffer()).byteLength>2000);
    }
    assert.equal(runtime.db.prepare("SELECT count(*) n FROM items").get().n, 0);
    await new Promise(resolve=>{const request=httpRequest(base+'/api/streams',{method:'POST',headers:{Cookie:cookie,'Content-Type':'multipart/form-data; boundary=abort-check','Content-Length':'1000000'}});request.on('error',()=>{});request.on('close',resolve);request.write('--abort-check\r\nContent-Disposition: form-data; name="files"; filename="part-1.bin"\r\nContent-Type: application/octet-stream\r\n\r\npartial upload');setTimeout(()=>request.destroy(),30);});
    await new Promise(r=>setTimeout(r,80));
    const saved = await get({});
    assert.equal(saved.status, 201, await saved.clone().text());
    const item = await saved.json();
    assert.equal(item.kind, "video");
    assert.equal(item.width, 320);
    assert.ok(item.duration >= 3.9);
    assert.match(item.content, /来源链接/);
    assert.deepEqual(item.tags, ["HLS", "参考", "127.0.0.1"]);
    assert.deepEqual(
      Buffer.from(
        await (
          await fetch(base + item.url, { headers: { Cookie: cookie } })
        ).arrayBuffer(),
      ),
      bytes,
    );
    const bad = new FormData();
    bad.append(
      "files",
      new Blob(["#EXTM3U\nfile:/etc/passwd\n#EXT-X-ENDLIST"]),
      "index.m3u8",
    );
    assert.equal((await get({ form: bad })).status, 400);
    const duplicate = new FormData();
    duplicate.append("files", new Blob(["#EXTM3U"]), "index.m3u8");
    duplicate.append("files", new Blob(["#EXTM3U"]), "index.m3u8");
    assert.equal((await get({ form: duplicate })).status, 400);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await readdir(join(dir, "uploads"))).length, 0);
  } finally {
    await runtime.imports.stop();
    await runtime.backups.stop();
    await runtime.webhooks.stop();
    await new Promise((r) => server.close(r));
    runtime.db.close();
    await new Promise((r) => source.close(r));
  }
});
