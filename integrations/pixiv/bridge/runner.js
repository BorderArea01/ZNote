// GPL-3.0-or-later. Offscreen document: DOM Markdown conversion and APNG workers.
import { read, writeJob, writeProgress, summaries, success } from "./store.js";
import { api } from "./client.js";
import { acquire } from "./acquire.js";
import { ingestRecord } from "./ingest.js";
import {scheduleRetry, retryMessage} from './retry.js';
let pumping = false,
  current,
  controller,
  uploading = false;
async function run(id) {
  await navigator.locks.request(
    "znote-job:" + id,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return;
      const job = await read("job:" + id);
      if (!job || !["queued", "running", "retry_wait"].includes(job.state) || (job.retryAt || 0)>Date.now()) return;
      current = id;
      controller = new AbortController();
      const command = await read("control:" + id);
      if (command === "stop") controller.abort();
      job.state = "running";
      job.retryAt = 0;
      job.error = "";
      job.message = "准备入库…";
      job.records.forEach((r) => {
        if (r.status === "active") r.status = "pending";
      });
      await writeJob(job);
      try {
        controller.signal.throwIfAborted();
        const connection = await read("connection");
        if (!connection || connection.server !== job.target.server)
          throw Error("请恢复此任务的知识库连接后重试");
        const me = await api(connection, "/api/me", {
          signal: controller.signal,
        });
        if (me.scope !== "write") throw Error("知识库需要写入令牌");
        if (job.work && !job.records.length) {
          job.records = await acquire(job.work, controller.signal);
          job.title = job.records[0]?.title || job.title;
          if (JSON.stringify(job).length > 40e6)
            throw Error("作品元数据超过 40 MB");
          await writeJob(job);
        }
        job.retryCount = 0;
        for (const [i, record] of job.records.entries()) {
          if ((await read("control:" + id)) === "stop") controller.abort();
          if (controller.signal.aborted) break;
          if (success(record) || record.status === 'failed') continue;
          record.status = "active";
          record.error = "";
          job.message = `正在入库 ${i + 1} / ${job.records.length}`;
          await writeProgress(job, record);
          try {
            const item = await ingestRecord(
              connection,
              record,
              job.target,
              controller.signal,
              (value) => (uploading = value),
            );
            record.status = item.duplicate ? "duplicate" : "done";
            record.itemId = item.id;
          } catch (e) {
            const retryAt = controller.signal.aborted ? 0 : scheduleRetry(record,e);
            record.status = controller.signal.aborted ? "pending" : retryAt ? "retrying" : "failed";
            record.error = e.message;
            if(retryAt){
              job.state='retry_wait';job.retryAt=retryAt;
              job.message=retryMessage(record.retryCount,retryAt);
            }
          }
          await writeProgress(job, record);
          if(job.state==='retry_wait') break;
          if (!controller.signal.aborted)
            await new Promise((r) => setTimeout(r, 180));
        }
        if(job.state !== 'retry_wait') {
        job.state = controller.signal.aborted
          ? "paused"
          : job.records.some((r) => !success(r))
            ? "failed"
            : "done";
        job.message = `${job.state === "paused" ? "已停止。" : ""}已入库 ${job.records.filter(success).length} / ${job.records.length}`;
        }
      } catch (e) {
        const retryAt=controller.signal.aborted?0:scheduleRetry(job,e);
        job.state = controller.signal.aborted ? "paused" : retryAt ? 'retry_wait' : "failed";
        job.retryAt=retryAt;
        if(retryAt) job.message=retryMessage(job.retryCount,retryAt);
        job.error = controller.signal.aborted ? "已停止，可继续" : e.message;
      } finally {
        await writeJob(job);
        current = null;
        controller = null;
        uploading = false;
      }
    },
  );
}
let retryTimer;
async function pump() {
  if (pumping) return;
  pumping = true;
  clearTimeout(retryTimer);
  try {
    while (true) {
      const all=await summaries();
      const next = all
        .filter((j) => ["queued", "running", "retry_wait"].includes(j.state) && (j.retryAt || 0)<=Date.now())
        .sort((a, b) => a.created - b.created)[0];
      if (!next) {
        const due=all.filter(j=>j.state==='retry_wait').map(j=>j.retryAt).filter(Boolean);
        if(due.length) retryTimer=setTimeout(()=>pump().catch(()=>{}),Math.max(100,Math.min(...due)-Date.now()));
        break;
      }
      await run(next.id);
      // A task manager may own the same job lock; yield before trying again.
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    pumping = false;
  }
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "znote-runner") return;
  port.onMessage.addListener((message) => {
    if (message.stop === current && controller) controller.abort();
    pump().catch(() => {});
    try {
      port.postMessage({ ok: true, current, uploading });
    } catch {}
  });
});
// A queued/running job is durable; browser restart resumes it without a Pixiv tab.
pump().catch(() => {});
