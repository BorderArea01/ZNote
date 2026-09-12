// ZNote integration, GPL-3.0-or-later.
import {
  read,
  write,
  writeJob,
  jobs,
  prefix,
  summaries,
  removeJob,
  removePrefix,
} from "./store.js";
import { normalize } from "./records.js";
const owned = (job, sender) =>
  job?.owner === sender.tab?.id && job?.source === sender.url;
let serial = Promise.resolve(),
  creating,
  libraryCache;
async function library(config, path) {
  const r = await fetch(config.server + path, {
    headers: { Authorization: "Bearer " + config.token },
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "知识库连接失败");
  return data;
}
async function connection() {
  const config = await read("connection");
  if (!config?.token) throw Error("请先在「连接设置」连接知识库");
  return config;
}
async function collections(config) {
  if (
    libraryCache?.server === config.server &&
    libraryCache.token === config.token &&
    Date.now() - libraryCache.time < 30000
  )
    return libraryCache.items;
  const items = await library(config, "/api/collections");
  libraryCache = {
    server: config.server,
    token: config.token,
    time: Date.now(),
    items,
  };
  return items;
}
async function target(input = {}) {
  const config = await connection(),
    list = await collections(config);
  const collection_id = String(
    input.collection_id ?? config.collection_id ?? "",
  );
  const tags = String(input.tags ?? config.tags ?? "").trim();
  if (collection_id && !list.some((c) => c.id === collection_id))
    throw Error("目标知识库不存在，请重新选择");
  const parts = tags
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 28 || parts.some((s) => s.length > 40))
    throw Error("附加标签最多 28 个，每个最多 40 字");
  return {
    server: config.server,
    collection_id,
    tags,
    includeTags: input.includeTags !== false,
    groupMode: ["work", "individual"].includes(input.groupMode)
      ? input.groupMode
      : config.groupMode || "individual",
    bookmark: {
      enabled: input.bookmark?.enabled === true,
      withTags: input.bookmark?.withTags !== false,
      private: input.bookmark?.private === true,
      account: /^\d{1,12}$/.test(String(input.bookmark?.account))
        ? String(input.bookmark.account)
        : "",
    },
  };
}
async function room() {
  const all = await summaries();
  const awaitingBookmarks = new Set(
    (await prefix("bookmark:"))
      .filter((b) => b.state !== "done")
      .map((b) => b.job),
  );
  if (
    all.filter((j) => j.state !== "done" || awaitingBookmarks.has(j.id))
      .length >= 2000
  )
    throw Error("已有 2000 个未完成任务，请先处理或清理队列");
  // Retain recent successful history; never silently discard failures or pending jobs.
  for (const j of all
    .filter((j) => j.state === "done" && !awaitingBookmarks.has(j.id))
    .sort((a, b) => b.created - a.created)
    .slice(99))
    await removeJob(j.id);
}
async function wake(stop) {
  if (!creating)
    creating = (async () => {
      const existing = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL("znote/runner.html")],
      });
      if (!existing.length)
        await chrome.offscreen.createDocument({
          url: "znote/runner.html",
          reasons: ["DOM_PARSER", "WORKERS", "BLOBS"],
          justification:
            "Archive selected Pixiv works with Markdown conversion and APNG workers while the user browses other pages.",
        });
    })().finally(() => (creating = null));
  await creating;
  const port = chrome.runtime.connect({ name: "znote-runner" });
  port.onMessage.addListener(() => port.disconnect());
  port.postMessage({ wake: true, stop });
  setTimeout(() => {
    try {
      port.disconnect();
    } catch {}
  }, 5000);
}
async function initialize() {
  if (!(await read("queue-index-v1"))) {
    for (const job of await jobs()) await writeJob(job);
    await write("queue-index-v1", true);
  }
}
const initialized = initialize();
async function handle(message, sender) {
  const page =
    sender.id === chrome.runtime.id &&
    /^https:\/\/www\.pixiv(?:ision)?\.net\//.test(sender.url || "") &&
    sender.frameId === 0;
  if (!page) throw Error("无效作品页面");
  await initialized;
  if (message.action === "bookmarkClaim") {
    const account = String(message.account || "");
    if (!/^\d{1,12}$/.test(account)) return { task: null };
    const tasks = await prefix("bookmark:");
    if ((await read("bookmark-next-request")) > Date.now())
      return { task: null };
    // One browser-wide request at a time. A closed Pixiv tab releases its lease.
    if (tasks.some((t) => t.state === "active" && t.until > Date.now()))
      return { task: null };
    const task = tasks.find(
      (t) =>
        t.account === account &&
        (t.state === "pending" ||
          (t.state === "active" && t.until <= Date.now())),
    );
    if (!task) return { task: null };
    if ((await read("control:" + task.job)) === "stop") {
      task.state = "paused";
      await write(task.key, task);
      return { task: null };
    }
    task.state = "active";
    task.owner = sender.tab.id;
    task.lease = crypto.randomUUID();
    task.until = Date.now() + 30000;
    await write("bookmark-next-request", Date.now() + 2000);
    await write(task.key, task);
    return { task };
  }
  if (
    message.action === "bookmarkHeartbeat" ||
    message.action === "bookmarkResult"
  ) {
    if (!String(message.key).startsWith("bookmark:"))
      throw Error("无效收藏任务");
    const task = await read(message.key);
    if (!task) return {};
    if (
      task.owner !== sender.tab.id ||
      task.lease !== message.lease ||
      task.state !== "active"
    )
      throw Error("收藏任务已交接");
    if (message.action === "bookmarkHeartbeat") task.until = Date.now() + 30000;
    else {
      task.state = message.error ? "failed" : "done";
      task.error = String(message.error || "").slice(0, 200);
      delete task.owner;
      delete task.lease;
      delete task.until;
    }
    await write(task.key, task);
    return {};
  }
  if (message.action === "open") {
    const suffix =
      message.id && (await read("job:" + message.id))
        ? "?job=" + encodeURIComponent(message.id)
        : "";
    await chrome.tabs.create({
      url: chrome.runtime.getURL("znote/index.html") + suffix,
    });
    return {};
  }
  if (message.action === "settings") {
    const config = await read("connection");
    if (!config?.token) return { connected: false, collections: [] };
    return {
      connected: true,
      collections: await collections(config),
      collection_id: config.collection_id || "",
      tags: config.tags || "",
      includeTags: config.includeTags !== false,
      groupMode: config.groupMode || "individual",
      saveKey: config.saveKey || "z",
    };
  }
  if (message.action === "preferences") {
    const value = await target(message.target),
      config = await connection();
    const saveKey = String(
      message.saveKey || config.saveKey || "z",
    ).toLowerCase();
    if (!/^[a-z0-9]$/.test(saveKey)) throw Error("快捷键应为单个字母或数字");
    await write("connection", {
      ...config,
      collection_id: value.collection_id,
      tags: value.tags,
      includeTags: value.includeTags,
      groupMode: value.groupMode,
      saveKey,
    });
    return {};
  }
  if (message.action === "status") {
    const all = (await summaries()).sort((a, b) => b.created - a.created);
    const bookmarks = await prefix("bookmark:");
    const counts = new Map();
    for (const task of bookmarks) {
      const value = counts.get(task.job) || {
        bookmarkDone: 0,
        bookmarkPending: 0,
        bookmarkFailed: 0,
      };
      value[
        task.state === "done"
          ? "bookmarkDone"
          : task.state === "failed"
            ? "bookmarkFailed"
            : "bookmarkPending"
      ]++;
      counts.set(task.job, value);
    }
    for (const job of all) {
      Object.assign(
        job,
        counts.get(job.id) || {
          bookmarkDone: 0,
          bookmarkPending: 0,
          bookmarkFailed: 0,
        },
      );
    }
    return {
      jobs: [
        ...all.filter((j) => j.state === "running"),
        ...all.filter((j) => j.state !== "running"),
      ].slice(0, 30),
      pending: all.filter((j) => ["queued", "running"].includes(j.state))
        .length,
      failed: all.filter((j) => j.state === "failed").length,
    };
  }
  if (
    message.action === "stop" ||
    message.action === "retry" ||
    message.action === "delete"
  ) {
    const job = await read("job:" + message.id);
    if (!job) throw Error("任务不存在");
    if (message.action === "stop") {
      await write("control:" + job.id, "stop");
      for (const task of await prefix("bookmark:" + job.id + ":"))
        if (task.state === "pending") {
          task.state = "paused";
          await write(task.key, task);
        }
      await navigator.locks.request(
        "znote-job:" + job.id,
        { ifAvailable: true },
        async (lock) => {
          if (lock) {
            const next = await read("job:" + job.id);
            next.state = "paused";
            next.message = "已停止，可继续";
            await writeJob(next);
          }
        },
      );
      await wake(job.id);
      return {};
    }
    await navigator.locks.request(
      "znote-job:" + job.id,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) throw Error("任务正在处理，请先停止");
        if (message.action === "delete") {
          await removeJob(job.id);
          return;
        }
        if (!job.finalized) throw Error("目录还未抓取完成，请重新抓取范围");
        for (const task of await prefix("bookmark:" + job.id + ":"))
          if (["failed", "paused"].includes(task.state) && task.account) {
            task.state = "pending";
            task.error = "";
            await write(task.key, task);
          }
        await write("control:" + job.id, "run");
        job.state = "queued";
        job.error = "";
        await writeJob(job);
      },
    );
    if (message.action === "retry") await wake();
    return {};
  }
  if (message.action === "direct") {
    const work = message.work;
    if (
      !work ||
      !/^\d{1,12}$/.test(String(work.id)) ||
      !["art", "novel"].includes(work.type)
    )
      throw Error("作品编号无效");
    const destination = await target(message.target);
    const existing = (await summaries()).find(
      (j) =>
        ["queued", "running"].includes(j.state) &&
        j.work?.id === String(work.id) &&
        j.work.type === work.type &&
        JSON.stringify(j.target) === JSON.stringify(destination),
    );
    if (existing) return { id: existing.id, duplicate: true };
    await room();
    const id = crypto.randomUUID();
    await writeJob({
      id,
      title: "作品 " + work.id,
      created: Date.now(),
      source: sender.url,
      work: { id: String(work.id), type: work.type },
      records: [],
      rejected: [],
      finalized: true,
      state: "queued",
      target: destination,
    });
    await wake();
    return { id };
  }
  if (message.action === "begin") {
    await room();
    const id = crypto.randomUUID(),
      destination = message.review ? undefined : await target(message.target);
    await writeJob({
      id,
      title: String(message.title || "Pixiv 抓取结果").slice(0, 180),
      created: Date.now(),
      owner: sender.tab.id,
      source: sender.url,
      records: [],
      rejected: [],
      finalized: false,
      state: "collecting",
      target: destination,
      review: !!message.review,
      reviewPreferences: message.review
        ? {
            groupMode: ["work", "individual"].includes(
              message.target?.groupMode,
            )
              ? message.target.groupMode
              : "individual",
            bookmark: {
              enabled: message.target?.bookmark?.enabled === true,
              withTags: message.target?.bookmark?.withTags !== false,
              private: message.target?.bookmark?.private === true,
              account: /^\d{1,12}$/.test(
                String(message.target?.bookmark?.account),
              )
                ? String(message.target.bookmark.account)
                : "",
            },
          }
        : undefined,
      chunks: 0,
      count: 0,
      metadataBytes: 0,
    });
    return { id };
  }
  const job = await read("job:" + message.id);
  if (!owned(job, sender) || job.finalized) throw Error("任务已失效");
  if (message.action === "append") {
    if (
      !Array.isArray(message.records) ||
      message.records.length > 50 ||
      JSON.stringify(message.records).length > 4e6 ||
      job.count + message.records.length > 10000
    )
      throw Error("单次最多 10000 个文件，请缩小抓取范围");
    const chunk = { records: [], rejected: [] };
    for (const r of message.records) {
      try {
        chunk.records.push(normalize(r));
      } catch (e) {
        chunk.rejected.push({
          title: String(r.title || r.id || "").slice(0, 180),
          error: e.message,
        });
      }
    }
    job.metadataBytes += JSON.stringify(chunk).length;
    if (job.metadataBytes > 40e6)
      throw Error("作品元数据超过 40 MB，请缩小抓取范围");
    await write(
      "chunk:" + job.id + ":" + String(job.chunks).padStart(5, "0"),
      chunk,
    );
    job.chunks++;
    job.count += message.records.length;
    await writeJob(job);
    return {};
  }
  if (message.action === "finish") {
    const chunks = await prefix("chunk:" + job.id + ":"),
      seen = new Set();
    for (const chunk of chunks) {
      for (const record of chunk.records)
        if (!seen.has(record.key)) {
          seen.add(record.key);
          job.records.push(record);
        }
      job.rejected.push(...chunk.rejected);
    }
    job.finalized = true;
    delete job.owner;
    job.state = job.review
      ? "review"
      : job.records.length
        ? "queued"
        : "failed";
    if (!job.records.length)
      job.error = "没有符合条件的文件，请检查原插件筛选设置";
    await writeJob(job);
    await removePrefix("chunk:" + job.id + ":");
    if (job.review)
      await chrome.tabs.create({
        url: chrome.runtime.getURL("znote/index.html") + "?job=" + job.id,
      });
    else await wake();
    return {
      id: job.id,
      count: job.records.length,
      rejected: job.rejected.length,
    };
  }
  throw Error("未知入库操作");
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "znote-capture") return;
  port.onMessage.addListener((message) => {
    const next = serial.then(() => handle(message, port.sender));
    serial = next.catch(() => {});
    const respond = (value) => {
      try {
        port.postMessage(value);
      } catch {}
    };
    next.then(
      (data) => respond({ ok: true, ...data }),
      (e) => respond({ ok: false, error: e.message }),
    );
  });
});
const resume = () =>
  initialized
    .then(async () => {
      if (
        (await summaries()).some((j) => ["queued", "running"].includes(j.state))
      )
        await wake();
    })
    .catch(() => {});
chrome.runtime.onStartup.addListener(resume);
chrome.runtime.onInstalled.addListener(resume);
resume();
