// ZNote integration, GPL-3.0-or-later. Capture stays in the browsing surface.
import { store } from "../store/Store";
import { EVT } from "../EVT";
import { states } from "../store/States";
import { artworkThumbnail } from "../ArtworkThumbnail";
import { novelThumbnail } from "../NovelThumbnail";
import { libraryRouting } from "./routing";
import { settings as nativeSettings } from "../setting/Settings";
import { API } from "../API";
import { token as pixivToken } from "../Token";
const host = document.createElement("div");
host.id = "znote-pixiv-entry";
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `<style>
:host{position:fixed;bottom:18px;left:18px;z-index:2147483646;color:#eef0fa;font:13px/1.5 system-ui;--line:#ffffff20}*{box-sizing:border-box}[hidden]{display:none!important}button,select,input{font:inherit;color:inherit;border:1px solid var(--line);border-radius:9px;background:#272b3a;padding:8px 11px}button{cursor:pointer}button:disabled{opacity:.4;cursor:default}button:hover:not(:disabled){background:#394059}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #acb5ff;outline-offset:2px}.primary{background:#6264d7;border-color:#969aff}.primary:hover:not(:disabled){background:#7476e8}.box{background:#181b27f5;border:1px solid #ffffff25;border-radius:16px;box-shadow:0 10px 40px #0005;padding:10px;max-width:calc(100vw - 36px)}.bar{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.brand{font-weight:750;letter-spacing:.4px;padding:0 4px;color:#c1c6ff}select{max-width:160px}#status{max-width:510px;margin:6px 4px 0;color:#bec5dc;overflow-wrap:anywhere;font-size:12px}#status:empty{display:none}#panel{width:500px;max-width:calc(100vw - 58px);max-height:65vh;overflow:auto;margin-bottom:10px;padding:5px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.row input[type=text]{flex:1;min-width:80px}#key{width:42px!important;flex:none}.muted{color:#a9b1c9;font-size:12px}#queue{display:grid;gap:8px;margin:12px 0}.job{border:1px solid var(--line);border-radius:10px;padding:10px}.job strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.job progress{width:100%;height:5px;accent-color:#969aff}.job .row{margin:4px 0}.job button{font-size:12px;padding:4px 8px}.job a{color:#bcc3ff}#hover{position:fixed;box-shadow:0 3px 12px #0007;z-index:2;padding:5px 10px;font-weight:650}.help{cursor:help;border:1px solid #8991b7;border-radius:50%;width:17px;height:17px;text-align:center;color:#b9c0de;font-size:11px}#scopes{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}#scopes button{font-size:12px}@media(max-width:600px){.bar{padding-right:86px}:host{left:8px;bottom:8px}.brand{display:none}.box{max-width:calc(100vw - 16px)}select{max-width:120px}#panel{max-width:calc(100vw - 38px)}}
#toggle[data-attention=true]{background:#513522;border-color:#d89d68;color:#ffe0ba}#queue-notice{margin-top:9px;padding:10px 12px;border:1px solid #5e70a4;border-radius:10px;background:#242e49;color:#dae5ff;max-width:510px}#queue-notice[data-attention=true]{background:#382b22;border-color:#ad7b52;color:#ffe0ba}#queue-summary{font-weight:650}.notice-controls{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.notice-controls button{padding:6px 10px;min-height:34px}.job[data-attention=true]{border-color:#ba855b;background:#302820}.job .error{color:#ffd4af;font-size:12px;overflow-wrap:anywhere}
</style><button id="hover" class="primary" hidden title="整部作品保存到所选知识库">入库 · Z</button><div class="box"><section id="panel" hidden><div class="row"><strong>入库队列</strong><span class="help" title="作品按钮保存整部作品。目录入库沿用原插件范围与筛选；抓取完成并加入队列后，可离开当前页。">?</span><button id="connect">连接设置</button><button id="jobs">详细任务</button></div><label class="row">附加标签<input id="tags" type="text" placeholder="多个标签用逗号分隔"></label><div class="row"><label><input id="include" type="checkbox" checked> Pixiv 标签</label><label>快捷键 <input id="key" type="text" maxlength="1" value="Z"></label><button id="preferences">记住设置</button></div><div id="scopes"></div><div id="queue"></div><div class="row"><button id="save">保存抓取结果到 ZNote</button><button id="review" title="仅在需要逐项检查时打开独立任务页">检查结果…</button></div></section><div class="bar"><span class="brand">ZNote</span><select id="collection" aria-label="目标知识库"><option value="">未分类</option></select><button id="current" class="primary">本作品入库</button><button id="scope" class="primary">当前范围入库</button><button id="native" title="设置整目录、页数与筛选条件">范围设置</button><button id="toggle" aria-expanded="false">队列</button></div><div id="queue-notice" role="status" hidden><span id="queue-summary"></span><div class="notice-controls" id="failure-actions"><button id="show-failed">查看失败</button><button id="retry-failed">重试失败任务</button></div></div><p id="status" role="status"></p></div>`;
document.body.append(host);
const choice = document.createElement("div");
choice.id = "format-choice";
choice.hidden = true;
choice.setAttribute("role", "dialog");
choice.setAttribute("aria-label", "选择入库展示方式");
choice.style.cssText =
  "position:fixed;z-index:3;width:220px;padding:12px;background:#202434;border:1px solid #697196;border-radius:12px;box-shadow:0 12px 40px #0008";
choice.innerHTML =
  '<strong>入库展示方式</strong><div class="row"><button id="group-work">按作品分组</button><button id="group-individual">逐张入库</button></div><span class="muted">快捷键沿用上次选择</span>';
root.append(choice);
const $ = (id: string) => root.getElementById(id) as HTMLInputElement;
let groupMode = "individual";
function choose(event: MouseEvent, action: () => Promise<any>) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  choice.style.left = Math.max(8, Math.min(innerWidth - 228, rect.left)) + "px";
  choice.style.top =
    Math.max(8, Math.min(innerHeight - 152, rect.bottom + 8)) + "px";
  choice.hidden = false;
  for (const mode of ["work", "individual"])
    $("group-" + mode).onclick = () => {
      groupMode = mode;
      choice.hidden = true;
      send({ action: "preferences", target: target(), saveKey: $("key").value })
        .then(action)
        .catch(report);
    };
  $("group-" + groupMode).focus();
}
document.addEventListener("pointerdown", (e) => {
  if (!e.composedPath().includes(choice)) choice.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") choice.hidden = true;
});
let busy = false,
  connected = false,
  hoverWork: { id: string; type: string } | undefined,
  hoverElement: HTMLElement | undefined,
  leaveTimer: number;
let scopeJob: string | undefined,
  crawlStarted = false,
  lastURL = location.href,
  lastJobs = "",
  pending = 0,
  failed = 0,
  retrying = 0;
const target = () => ({
  collection_id: $("collection").value,
  tags: $("tags").value,
  includeTags: $("include").checked,
  groupMode,
  bookmark: {
    enabled: nativeSettings.bmkAfterDL,
    withTags: nativeSettings.widthTagBoolean,
    private: nativeSettings.restrictBoolean,
    account: store.loggedUserID,
  },
});
const report = (error: any) => {
  $("status").textContent = error?.message || String(error);
};
const openPanel = () => {
  EVT.fire("closeSettingsPanel");
  $("panel").hidden = false;
  $("toggle").setAttribute("aria-expanded", "true");
  poll().catch(report);
};
function currentWork() {
  const art = location.pathname.match(/^\/(?:[a-z]{2}\/)?artworks\/(\d+)/);
  const novel =
    location.pathname === "/novel/show.php" &&
    new URL(location.href).searchParams.get("id");
  return art
    ? { id: art[1], type: "art" }
    : novel
      ? { id: novel, type: "novel" }
      : undefined;
}
function draw() {
  $("save").disabled = busy || states.busy || !store.result.length;
  $("review").disabled = $("save").disabled;
  $("save").textContent =
    `保存抓取结果到 ZNote${store.result.length ? "（" + store.result.length + "）" : ""}`;
  $("current").hidden = !currentWork();
  $("current").disabled = !connected;
  $("scope").disabled = !connected || busy || states.busy;
  $("toggle").textContent = (pending ? `队列 · ${pending}` : "队列") + (failed ? ` · ${failed} 失败` : retrying ? " · 重试中" : "");
  $("toggle").dataset.attention = String(failed > 0);
  $("queue-notice").hidden = !failed && !retrying;
  $("queue-notice").dataset.attention = String(failed > 0);
  $("queue-summary").textContent = [failed ? `${failed} 个任务存在失败` : '', retrying ? `${retrying} 个任务等待自动重试` : ''].filter(Boolean).join(' · ');
  $("failure-actions").hidden = !failed;
}
async function send(payload: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "znote-capture" });
    let received = false;
    const timer = setTimeout(() => {
      port.disconnect();
      reject(Error("操作超时，请重试"));
    }, 60000);
    port.onMessage.addListener((r) => {
      received = true;
      clearTimeout(timer);
      port.disconnect();
      r?.ok ? resolve(r) : reject(Error(r?.error || "入库失败"));
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      if (!received) reject(Error("扩展已更新，请刷新页面"));
    });
    port.postMessage(payload);
  });
}
async function settings() {
  const r = await send({ action: "settings" });
  connected = r.connected;
  if (connected) {
    $("collection").replaceChildren(
      new Option("未分类", ""),
      ...r.collections.map((c: any) => new Option(c.name, c.id)),
    );
    $("collection").value = r.collection_id;
    $("tags").value = r.tags;
    $("include").checked = r.includeTags;
    groupMode = r.groupMode || "individual";
    $("key").value = r.saveKey.toUpperCase();
    $("hover").textContent = "入库 · " + $("key").value;
  } else report("首次使用请打开「队列 → 连接设置」连接知识库");
  draw();
}
async function direct(work = currentWork()) {
  if (!work) return;
  const r = await send({ action: "direct", work, target: target() });
  report(r.duplicate ? "这部作品已在队列中" : "整部作品已排队，可继续浏览");
  await poll();
}
function enter(el: HTMLElement, id: string, _event?: Event, type = "illusts") {
  if (type === "novelSeries" || !/^\d+$/.test(id)) return;
  clearTimeout(leaveTimer);
  hoverElement = el;
  hoverWork = { id, type: type === "novels" ? "novel" : "art" };
  const rect = el.getBoundingClientRect();
  $("hover").style.left =
    Math.max(4, Math.min(innerWidth - 100, rect.left + 6)) + "px";
  $("hover").style.top =
    Math.max(
      4,
      Math.min(
        innerHeight - 40,
        rect.width < 120 || rect.height < 85
          ? rect.bottom + 4
          : rect.bottom - 38,
      ),
    ) + "px";
  const nativeDownload = Array.from(
    document.querySelectorAll<HTMLElement>("#downloadBtnOnThumb"),
  ).find((button) => button.getBoundingClientRect().width > 0);
  if (nativeDownload) {
    const nativeRect = nativeDownload.getBoundingClientRect();
    $("hover").style.left =
      Math.max(
        4,
        Math.min(
          innerWidth - 82,
          nativeRect.left >= 82 ? nativeRect.left - 78 : nativeRect.right + 6,
        ),
      ) + "px";
    $("hover").style.top =
      Math.max(4, Math.min(innerHeight - 36, nativeRect.top)) + "px";
  }
  $("hover").hidden = false;
}
function leave() {
  leaveTimer = window.setTimeout(() => {
    if (
      $("hover").matches(":hover") ||
      hoverElement?.matches(":hover") ||
      states.previewWorkIsShow
    )
      return;
    $("hover").hidden = true;
    hoverWork = undefined;
  }, 110);
}
artworkThumbnail.onEnter(enter);
artworkThumbnail.onLeave(leave);
novelThumbnail.onEnter(enter);
novelThumbnail.onLeave(leave);
// Fallback for new/small card layouts missed by the native detector.
document.addEventListener("mouseover", (e) => {
  const a = (e.target as Element)?.closest?.("a[href]") as HTMLAnchorElement;
  if (!a || !a.querySelector("img")) return;
  const u = new URL(a.href);
  const id = u.pathname.match(/^\/artworks\/(\d+)/)?.[1];
  if (id) {
    enter(a, id);
    a.addEventListener("mouseleave", leave, { once: true });
  }
});
$("hover").onmouseenter = () => clearTimeout(leaveTimer);
$("hover").onmouseleave = leave;
$("hover").onclick = (e) => {
  e.preventDefault();
  e.stopPropagation();
  const work = hoverWork;
  if (e.isTrusted && work) choose(e, () => direct(work));
};
document.addEventListener(
  "keydown",
  (e) => {
    const el = e.composedPath()[0] as HTMLElement;
    if (
      !e.isTrusted ||
      e.repeat ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      el?.closest?.('input,textarea,select,[contenteditable="true"]') ||
      e.key.toLowerCase() !== $("key").value.toLowerCase() ||
      !hoverWork
    )
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    direct(hoverWork).catch(report);
  },
  true,
);
window.addEventListener(
  "scroll",
  () => {
    if (!states.previewWorkIsShow) {
      $("hover").hidden = true;
      hoverWork = undefined;
    }
  },
  { passive: true },
);
async function transfer(records: any[], id: string) {
  if (records.length > 10000)
    throw Error("单次最多 10000 个文件，请缩小原插件抓取范围");
  for (let i = 0; i < records.length; i += 20) {
    report(`加入队列 ${Math.min(i + 20, records.length)} / ${records.length}`);
    await send({ action: "append", id, records: records.slice(i, i + 20) });
  }
  const r = await send({ action: "finish", id });
  report(
    `已排队 ${r.count} 个文件${r.rejected ? "，部分作品不支持，请查看详细任务" : ""}`,
  );
  await poll();
}
async function capture(review = false) {
  if (busy || states.busy || !store.result.length) return;
  busy = true;
  draw();
  try {
    const records = [...store.result];
    const { id } = await send({
      action: "begin",
      title: store.title || document.title,
      target: target(),
      review,
    });
    await transfer(records, id);
  } finally {
    busy = false;
    draw();
  }
}
async function scope(button: HTMLButtonElement) {
  if (busy || states.busy || button.disabled) return;
  busy = true;
  draw();
  const source = location.href;
  try {
    const { id } = await send({
      action: "begin",
      title: document.title,
      target: target(),
    });
    if (source !== location.href) {
      await send({ action: "delete", id });
      throw Error("页面已切换，请在新目录重试");
    }
    scopeJob = id;
    libraryRouting.active = true;
    crawlStarted = false;
    report("正在按原插件范围抓取，请等待加入队列后再离开本页");
    button.click();
    setTimeout(() => {
      if (scopeJob === id && !crawlStarted) {
        scopeJob = undefined;
        libraryRouting.active = false;
        busy = false;
        send({ action: "delete", id }).catch(report);
        report("抓取尚未开始，请检查原插件范围设置后重试");
        draw();
      }
    }, 1200);
  } catch (e) {
    busy = false;
    libraryRouting.active = false;
    scopeJob = undefined;
    draw();
    throw e;
  }
}
window.addEventListener(EVT.list.crawlStart, () => {
  if (libraryRouting.active) crawlStarted = true;
  draw();
});
window.addEventListener(EVT.list.crawlComplete, () => {
  if (libraryRouting.active && scopeJob) {
    libraryRouting.finish(store.result);
    const id = scopeJob;
    scopeJob = undefined;
    const records = [...store.result];
    transfer(records, id)
      .catch(report)
      .finally(() => {
        busy = false;
        draw();
      });
  }
  setTimeout(draw, 0);
});
for (const event of [
  "resultChange",
  "readyDownload",
  "downloadComplete",
  "downloadStop",
  "crawlEmpty",
] as const)
  window.addEventListener(EVT.list[event], () => setTimeout(draw, 0));
const nativeButtons = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      'slot[data-name="crawlBtns"] button:not([data-znote-scope]):not(#scheduleCrawling):not(#cancelScheduledCrawling)',
    ),
  );
function decorateScopes() {
  // Add the second output beside the original download controls themselves.
  for (const original of document.querySelectorAll<HTMLButtonElement>(
    "#startDownload,#settingsPanelSummaryStart",
  )) {
    let button = original.nextElementSibling as HTMLButtonElement;
    if (!button?.hasAttribute("data-znote-output")) {
      button = document.createElement("button");
      button.type = "button";
      button.className = original.className;
      button.setAttribute("data-znote-output", original.id);
      button.textContent = "入库";
      button.title = "将原插件当前结果保存到知识库";
      button.style.minWidth = "42px";
      button.style.setProperty("display", "inline-flex", "important");
      button.onclick = (event) => {
        if (event.isTrusted) choose(event, () => capture());
      };
      original.after(button);
    }
    button.disabled = !connected || busy || states.busy || !store.result.length;
  }
  const buttons = nativeButtons();
  const signature = buttons.map((b) => b.id + ":" + b.textContent).join("|");
  if ($("scopes").dataset.signature !== signature) {
    $("scopes").dataset.signature = signature;
    $("scopes").replaceChildren();
    for (const original of buttons) {
      const b = document.createElement("button");
      b.textContent = "入库 · " + original.textContent?.trim();
      b.onclick = (e) => {
        if (e.isTrusted) choose(e, () => scope(original));
      };
      $("scopes").append(b);
    }
  }
  for (const original of buttons) {
    if (original.nextElementSibling?.hasAttribute("data-znote-scope")) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("data-znote-scope", original.id);
    b.className = original.className;
    b.dataset.btnEmphasis = "low";
    b.dataset.btnIntent = "primary";
    b.textContent = "入库 · " + original.textContent?.trim();
    b.title = "按此按钮的范围和原插件筛选保存到所选知识库";
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) choose(e, () => scope(original));
    };
    original.after(b);
  }
}
async function poll() {
  const r = await send({ action: "status" });
  pending = r.pending;
  failed = r.failed || 0;
  retrying = r.retrying || 0;
  draw();
  const signature = JSON.stringify(r.jobs);
  if (signature === lastJobs) return;
  lastJobs = signature;
  $("queue").replaceChildren();
  if (!r.jobs.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "从作品旁或目录按钮开始入库";
    $("queue").append(p);
  }
  for (const j of r.jobs) {
    const row = document.createElement("div");
    row.className = "job";
    row.dataset.job = j.id;
    row.dataset.attention=String(j.state==='failed'||j.failed>0||j.bookmarkFailed>0);
    const title = document.createElement("strong");
    title.textContent = j.title;
    const progress = document.createElement("progress");
    progress.max = j.total || 1;
    progress.value = j.done;
    const info = document.createElement("div");
    info.className = row.dataset.attention==='true' ? "error" : "muted";
    info.textContent = `${({ collecting: "抓取中", queued: "排队中", running: "入库中", retry_wait: "等待自动重试", paused: "已停止", failed: "需重试", done: "已完成", review: "待检查" } as any)[j.state] || j.state} · ${j.done} / ${j.total}${j.failed ? " · " + j.failed + " 项失败" : ""}${j.error || j.failureReason ? " · " + (j.error || j.failureReason) : ""}${j.state==='retry_wait' ? " · " + j.message : ""}`;
    if (j.bookmarkDone || j.bookmarkPending || j.bookmarkFailed)
      info.textContent += ` · Pixiv 收藏 ${j.bookmarkDone} 项完成${j.bookmarkPending ? "，" + j.bookmarkPending + " 项待同步" : ""}${j.bookmarkFailed ? "，" + j.bookmarkFailed + " 项失败" : ""}`;
    const controls = document.createElement("div");
    controls.className = "row";
    for (const [action, label] of ["queued", "running", "retry_wait"].includes(j.state)
      ? [["stop", "停止"]]
      : [
          ["retry", "继续 / 重试"],
          ["delete", "移除记录"],
        ]) {
      if (
        action === "retry" &&
        (!j.finalized ||
          (j.state === "done" && !j.bookmarkFailed && !j.bookmarkPending) ||
          j.state === "review")
      )
        continue;
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = (e) => {
        if (e.isTrusted) {
          b.disabled = true;
          send({ action, id: j.id })
            .then(poll)
            .catch(report)
            .finally(() => {
              b.disabled = false;
            });
        }
      };
      controls.append(b);
    }
    const link = document.createElement("a");
    link.href = j.source;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "来源 ↗";
    controls.append(link);
    row.append(title, progress, info, controls);
    $("queue").append(row);
  }
}
$("show-failed").onclick = async () => {
  openPanel();await poll().catch(report);
  root.querySelector('[data-attention="true"][data-job]')?.scrollIntoView({block:'nearest'});
};
$("retry-failed").onclick = async () => {
  $("retry-failed").disabled=true;
  try {const result=await send({action:'retryFailed'});report(`已重新排队 ${result.retried} 个失败任务${result.errors?.length ? '；部分任务暂时无法重试：'+result.errors[0] : ''}`);await poll();}
  catch(error){report(error);}finally{$("retry-failed").disabled=false;}
};
$("current").onclick = (e) => {
  const work = currentWork();
  if (e.isTrusted && work) choose(e, () => direct(work));
};
$("scope").onclick = (e) => {
  if (!e.isTrusted) return;
  const buttons = nativeButtons();
  if (buttons.length === 1 && !currentWork())
    choose(e, () => scope(buttons[0]));
  else {
    openPanel();
    report("选择对应范围的「入库」按钮；页数与筛选沿用原插件设置");
  }
};
$("native").onclick = (e) => {
  e.stopPropagation();
  if (e.isTrusted) EVT.fire("openSettingsPanel");
};
$("toggle").onclick = () => {
  if ($("panel").hidden) openPanel();
  else {
    $("panel").hidden = true;
    $("toggle").setAttribute("aria-expanded", "false");
  }
};
for (const id of ["connect", "jobs"])
  $(id).onclick = (e) => {
    if (e.isTrusted) send({ action: "open" }).catch(report);
  };
$("save").onclick = (e) => {
  if (e.isTrusted) choose(e, () => capture());
};
$("review").onclick = (e) => {
  if (e.isTrusted) capture(true).catch(report);
};
$("preferences").onclick = (e) => {
  if (e.isTrusted)
    send({ action: "preferences", target: target(), saveKey: $("key").value })
      .then(() => {
        report("已记住目标知识库、标签与快捷键");
        $("hover").textContent = "入库 · " + $("key").value.toUpperCase();
      })
      .catch(report);
};
$("collection").onchange = () =>
  send({
    action: "preferences",
    target: target(),
    saveKey: $("key").value,
  }).catch(report);
window.addEventListener("focus", () => settings().catch(report));
window.addEventListener("beforeunload", (e) => {
  if (busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener(EVT.list.openSettingsPanel, () => {
  $("panel").hidden = true;
  $("toggle").setAttribute("aria-expanded", "false");
  Object.assign(host.style, {
    top: "18px",
    right: "18px",
    bottom: "auto",
    left: "auto",
  });
});
window.addEventListener(EVT.list.closeSettingsPanel, () => {
  for (const key of ["top", "right", "bottom", "left"])
    host.style.removeProperty(key);
});
// Reuse the original Pixiv API/token provider, with a durable, separately
// acknowledged queue. Never emit fake download-success events into PPD.
let bookmarking = false;
async function syncBookmark() {
  if (bookmarking || !store.loggedUserID) return;
  bookmarking = true;
  let task: any;
  try {
    ({ task } = await send({
      action: "bookmarkClaim",
      account: store.loggedUserID,
    }));
    if (!task) return;
    const heartbeat = setInterval(
      () =>
        send({
          action: "bookmarkHeartbeat",
          key: task.key,
          lease: task.lease,
        }).catch(() => {}),
      10000,
    );
    let failure = "";
    try {
      if (!pixivToken.token) await pixivToken.reset();
      try {
        await API.addBookmark(
          task.work,
          task.type,
          task.withTags ? task.tags : [],
          task.private,
          pixivToken.token,
        );
      } catch (e: any) {
        if (e.status !== 400) throw e;
        await pixivToken.reset();
        await API.addBookmark(
          task.work,
          task.type,
          task.withTags ? task.tags : [],
          task.private,
          pixivToken.token,
        );
      }
    } catch (e: any) {
      failure = `Pixiv 收藏失败${e.status ? " HTTP " + e.status : ""}，可重试`;
    } finally {
      clearInterval(heartbeat);
    }
    await send({
      action: "bookmarkResult",
      key: task.key,
      lease: task.lease,
      error: failure,
    });
  } catch (e) {
    report(e);
  } finally {
    bookmarking = false;
  }
}
setInterval(() => syncBookmark(), 2000);
let polling = false;
setInterval(() => {
  decorateScopes();
  if (location.href !== lastURL) {
    lastURL = location.href;
    hoverWork = undefined;
    $("hover").hidden = true;
    draw();
  }
  if (!polling && !document.hidden) {
    polling = true;
    poll()
      .catch(report)
      .finally(() => (polling = false));
  }
  if (
    hoverWork &&
    !hoverElement?.matches(":hover") &&
    !$("hover").matches(":hover") &&
    !states.previewWorkIsShow
  )
    leave();
}, 1400);
settings().catch(report);
decorateScopes();
draw();
