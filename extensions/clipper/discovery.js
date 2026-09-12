import { mediaKind, addResource } from "./resource-store.js";
import { api, settings, serverUrl, saveImage, limitedImage } from "./client.js";
import { openGallery } from './gallery-ticket.js';
const key = "sniffTabs";
let states = {},
  chain = chrome.storage.session.get(key).then((v) => {
    states = v[key] || {};
  });
const serial = (operation) => {
  const next = chain.then(operation);
  chain = next.catch(() => {});
  return next;
};
async function persist() {
  const ids = Object.keys(states).sort(
    (a, b) => states[b].updated - states[a].updated,
  );
  for (const id of ids.slice(12)) delete states[id];
  await chrome.storage.session.set({ [key]: states });
}
async function stateFor(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const state = (states[tabId] ||= {
    resources: [],
    enabled: false,
    source_url: tab.url,
    updated: Date.now(),
  });
  return state;
}
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (
      details.tabId < 0 ||
      details.statusCode < 200 ||
      details.statusCode >= 300
    )
      return;
    const header = (name) =>
      details.responseHeaders?.find((h) => h.name.toLowerCase() === name)
        ?.value || "";
    const mime = header("content-type");
    if (!mediaKind(details.url, mime)) return;
    serial(async () => {
      const state = states[details.tabId];
      if (!state?.enabled) return;
      addResource(state, {
        url: details.url,
        mime,
        bytes: header("content-length"),
      });
      state.updated = Date.now();
      await persist();
    }).catch(() => {});
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["responseHeaders"],
);
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  serial(async () => {
    delete states[details.tabId];
    await persist();
  }).catch(() => {});
});
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  serial(async () => {
    const old = states[details.tabId];
    if (old && old.source_url !== details.url) {
      states[details.tabId] = {
        resources: [],
        enabled: old.enabled,
        source_url: details.url,
        updated: Date.now(),
      };
      await persist();
      await chrome.tabs
        .sendMessage(details.tabId, { type: "scan-media-frame" })
        .catch(() => {});
    }
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) =>
  serial(async () => {
    delete states[tabId];
    await persist();
  }).catch(() => {}),
);
function cleanFilename(resource) {
  let name = resource.title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .slice(0, 110);
  const url = new URL(resource.url),
    mime = resource.mime?.split(";")[0];
  const extension =
    url.pathname.match(
      /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov)(?:$|[!@:])/i,
    )?.[1] ||
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
    }[mime] ||
    (/^(jpe?g|png|webp|gif|avif)$/.test(url.searchParams.get("format"))
      ? url.searchParams.get("format")
      : null);
  if (!extension) return undefined;
  if (!new RegExp("\\." + extension + "$", "i").test(name))
    name += "." + extension;
  return "ZNote/" + name;
}
export async function resourceAction(resource, action) {
  if (action === "download" && resource.kind !== "hls") {
    await chrome.downloads.download({
      url: resource.url,
      filename: cleanFilename(resource),
      conflictAction: "uniquify",
      saveAs: false,
    });
    return { message: "已交给浏览器下载" };
  }
  if (action === "save" && resource.kind === "image") {
    const blob = await limitedImage(resource.url);
    const item = await saveImage(blob, {
      title: resource.title,
      filename: cleanFilename(resource)?.split("/").pop(),
      image_url: resource.url,
      source_url: resource.source_url,
      capture_note: "悬停预览 / 媒体发现采集",
    });
    return {
      message: item.duplicate
        ? "已收录，保留原备注并补充来源"
        : "已保存到知识库",
      itemId: item.id,
    };
  }
  if (!["preview", "save", "download"].includes(action))
    throw new Error("操作无效");
  const saved = await chrome.storage.session.get(null),
    tickets = Object.entries(saved)
      .filter(([k]) => k.startsWith("media-"))
      .sort((a, b) => b[1].created - a[1].created);
  await chrome.storage.session.remove(
    tickets
      .filter(([, r], i) => i >= 49 || Date.now() - r.created > 86400000)
      .map(([k]) => k),
  );
  const ticket = crypto.randomUUID();
  await chrome.storage.session.set({
    ["media-" + ticket]: { ...resource, action, created: Date.now() },
  });
  // Preview/large downloads run in an extension page, which survives service-worker suspension.
  await chrome.tabs.create({
    url: chrome.runtime.getURL("media.html") + "?id=" + ticket,
  });
  return {
    message: action === "preview" ? "已打开预览" : "已打开媒体处理窗口",
  };
}
export async function discover(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.id !== chrome.runtime.id)
    throw new Error("无效页面");
  if (message.type === 'media-gallery') return openGallery(message.group, sender);
  if (message.type === "media-action") {
    const resource = await serial(async () =>
      states[tabId]?.resources.find((r) => r.id === message.id),
    );
    if (!resource) throw new Error("资源已失效，请重新扫描");
    return resourceAction(resource, message.action);
  }
  if (message.type === "hover-resource")
    return serial(async () => {
      const state = await stateFor(tabId);
      const resource = addResource(state, {
        url: message.url,
        kind: "image",
        title: message.title,
        source_url: message.source_url,
      });
      state.updated = Date.now();
      await persist();
      return resource;
    });
  if (message.type === "media-settings") {
    const config = await settings();
    return { hover: config.hover !== false, dock: config.dock !== false, downloadKey: config.downloadKey, saveKey: config.saveKey, previewWidth: config.previewWidth };
  }
  if (message.type === 'media-preview-size') {
    if (!Number.isInteger(message.width) || message.width < 240 || message.width > 1200) throw new Error('预览宽度应为 240～1200');
    await chrome.storage.local.set({previewWidth: message.width});
    return {};
  }
  if (message.type === "media-connect") {
    const config = await settings();
    const collections = await api("/api/collections");
    return {
      collections,
      collection_id: config.collection_id,
      tags: config.tags,
    };
  }
  if (message.type === "media-destination") {
    if (
      typeof message.collection_id !== "string" ||
      typeof message.tags !== "string" ||
      message.tags.length > 1200
    )
      throw new Error("设置格式不正确");
    await chrome.storage.local.set({
      collection_id: message.collection_id,
      tags: message.tags,
    });
    return { message: "保存位置已更新" };
  }
  if (message.type === "media-options") {
    await chrome.runtime.openOptionsPage();
    return {};
  }
  return serial(async () => {
    const state = await stateFor(tabId);
    if (message.type === "media-start") {
      state.enabled = true;
      chrome.tabs
        .sendMessage(tabId, { type: "scan-media-frame" })
        .catch(() => {});
    }
    if (message.type === "media-stop") state.enabled = false;
    if (message.type === "media-clear") state.resources = [];
    if (message.type === "media-scan" && state.enabled)
      for (const resource of (Array.isArray(message.resources)
        ? message.resources
        : []
      ).slice(0, 200))
        addResource(state, resource);
    state.updated = Date.now();
    await persist();
    return { resources: state.resources, enabled: state.enabled };
  });
}
