import {videoDetails} from './video-details.js';
import {
  settings,
  serverUrl,
  api,
  saveImage,
  limitedImage,
  saveDirectVideo,
} from "./client.js";
import { packageHls, MAX_BYTES } from "./hls-package.js";
const $ = (id) => document.getElementById(id),
  ticket = new URL(location.href).searchParams.get("id");
let resource, controller, hls, objectURL;
function report(text) {
  $("status").textContent = text;
}
function setBusy(value) {
  $("download").disabled = value;
  $("save").disabled = value;
  $("cancel").hidden = !value;
}
async function downloadBlob(blob) {
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url: objectURL,
    filename: "ZNote/znote-video.mp4",
    saveAs: false,
  });
}
async function process(action) {
  if (controller) return;
  controller = new AbortController();
  setBusy(true);
  report("正在处理…");
  try {
    let item;
    if (resource.kind === "hls") {
      const config = await settings();
      if (!config.token)
        throw new Error("m3u8 合并需要连接 ZNote，请先填写连接设置");
      const bundle = await packageHls(resource.url, {
        signal: controller.signal,
        onProgress: report,
        quality: Number($("quality").value),
      });
      const form = new FormData();
      for (const [name, blob] of bundle.files) form.append("files", blob, name);
      const details=videoDetails(resource,config.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean));
      form.set('title',details.title);form.set('content',details.content);form.set('tags',JSON.stringify(details.tags));form.set('source_url',resource.source_url);
      if(config.collection_id)form.set('collection_id',config.collection_id);
      if (action === "save")
        item = await api("/api/streams", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      else {
        const response = await fetch(
          serverUrl(config.server) + "/api/streams?mode=download",
          {
            method: "POST",
            body: form,
            credentials: "omit",
            redirect: "error",
            headers: { Authorization: "Bearer " + config.token },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || "合并失败");
        }
        await downloadBlob(await response.blob());
      }
    } else if (action === "download") {
      await chrome.downloads.download({ url: resource.url, saveAs: false });
    } else if (resource.kind === "image") {
      item = await saveImage(
        await limitedImage(resource.url, controller.signal),
        {
          title: resource.title,
          image_url: resource.url,
          source_url: resource.source_url,
        },
        controller.signal,
      );
    } else
      item = await saveDirectVideo(
        resource.url,
        resource.source_url,
        resource.title,
        controller.signal,
        resource,
      );
    report(
      item
        ? item.duplicate
          ? "知识库已收录，已补充来源"
          : "已保存到知识库"
        : "已交给浏览器下载",
    );
    if (item) {
      $("saved").hidden = false;
      $("saved").href =
        serverUrl((await settings()).server) + "/#item/" + item.id;
    }
  } catch (e) {
    report(controller.signal.aborted ? "已取消处理" : e.message);
  } finally {
    controller = null;
    setBusy(false);
  }
}
try {
  resource = (await chrome.storage.session.get("media-" + ticket))[
    "media-" + ticket
  ];
  if (!resource || Date.now() - resource.created > 24 * 3600000)
    throw new Error("资源记录已过期，请回原页面重新选择");
  document.title = "ZNote · " + resource.title;
  $("title").textContent = resource.title;
  if(resource.author){$('author').hidden=false;$('author').textContent='作者：'+resource.author;}
  $("source").href = resource.source_url;
  if (resource.kind === "image") {
    $("image").hidden = false;
    $("image").src = resource.url;
    $("image").onerror = () =>
      report("图片无法直接预览，可能已过期或有防盗链限制");
  } else {
    const video = $("video");
    video.hidden = false;
    if (resource.kind === "hls" && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: false,
        maxBufferLength: 20,
        xhrSetup: (xhr) => {
          xhr.withCredentials = true;
        },
      });
      hls.loadSource(resource.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const variants = [...hls.levels].sort((a, b) => b.bitrate - a.bitrate);
        $("quality-label").hidden = false;
        for (const [i, l] of variants.entries())
          $("quality").append(
            new Option(
              `${l.width || "?"} × ${l.height || "?"} · ${Math.round(l.bitrate / 1000)} kbps`,
              String(i),
            ),
          );
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal)
          report("播放失败：视频地址可能已过期、受保护或当前网络无法读取");
      });
    } else {
      video.src = resource.url;
      video.onerror = () =>
        report("当前浏览器无法直接播放此媒体，可尝试下载原文件");
    }
  }
  $("hint").textContent =
    resource.kind === "hls"
      ? "可预览 m3u8 视频流。下载/入库会获取完整点播分片，并通过 ZNote 无损合并为 MP4；最多 500 MB、1200 个分片。处理期间请保持此窗口打开。"
      : "预览与下载使用网页提供的资源。保存到知识库会自动保留来源链接。";
  if (resource.action !== "preview") process(resource.action);
} catch (e) {
  report(e.message);
  $("download").disabled = true;
  $("save").disabled = true;
}
$("download").onclick = () => process("download");
$("save").onclick = () => process("save");
$("cancel").onclick = () => controller?.abort();
$("settings").onclick = () => chrome.runtime.openOptionsPage();
window.addEventListener("pagehide", () => {
  controller?.abort();
  hls?.destroy();
  if (objectURL) URL.revokeObjectURL(objectURL);
});
