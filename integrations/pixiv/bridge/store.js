// ZNote integration, GPL-3.0-or-later. Secrets live in the extension origin's
// IndexedDB, never in Pixiv DOM, messages to content scripts, or exported jobs.
const db = new Promise((resolve, reject) => {
  const req = indexedDB.open("znote-pixiv", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("data");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
export async function read(key) {
  const database = await db;
  const value = await new Promise((resolve, reject) => {
    const req = database.transaction("data").objectStore("data").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (value && key.startsWith("job:")) {
    const results = new Map(
      (await prefix("result:" + value.id + ":")).map((r) => [r.key, r]),
    );
    value.records.forEach((r) => {
      if (results.has(r.key)) Object.assign(r, results.get(r.key));
    });
  }
  return value;
}
export async function write(key, value) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction("data", "readwrite");
    tx.objectStore("data").put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function remove(key) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction("data", "readwrite");
    tx.objectStore("data").delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function jobs() {
  const database = await db;
  return new Promise((resolve, reject) => {
    const store = database.transaction("data").objectStore("data"),
      out = [],
      req = store.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out.sort((a, b) => b.created - a.created));
      if (String(c.key).startsWith("job:")) out.push(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
export const success = (r) => ["done", "duplicate"].includes(r.status);
export function summary(job) {
  return {
    id: job.id,
    title: job.title,
    created: job.created,
    state: job.state || "review",
    source: job.source,
    total: job.records.length,
    done: job.records.filter(success).length,
    failed: job.records.filter((r) => r.status === "failed").length,
    retrying: job.records.filter((r) => r.status === "retrying").length,
    retryAt: job.retryAt || 0,
    retryCount: job.records.find(r=>r.status==='retrying')?.retryCount || job.retryCount || 0,
    failureReason: job.records.find(r=>r.status==='failed')?.error || '',
    error: job.error || "",
    work: job.work,
    target: job.target,
    message: job.message || "",
    finalized: job.finalized,
  };
}
export async function writeJob(job) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction("data", "readwrite"),
      store = tx.objectStore("data");
    store.put(job, "job:" + job.id);
    store.put(summary(job), "summary:" + job.id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function prefix(prefix) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const req = database
      .transaction("data")
      .objectStore("data")
      .getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const summaries = () => prefix("summary:");
export async function removePrefix(start) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction("data", "readwrite");
    tx.objectStore("data").delete(IDBKeyRange.bound(start, start + "\uffff"));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function removeJob(id) {
  await remove("job:" + id);
  await remove("summary:" + id);
  await remove("control:" + id);
  const database = await db;
  await new Promise((resolve, reject) => {
    const tx = database.transaction("data", "readwrite");
    for (const start of [
      "result:" + id + ":",
      "chunk:" + id + ":",
      "bookmark:" + id + ":",
    ])
      tx.objectStore("data").delete(IDBKeyRange.bound(start, start + "\uffff"));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function writeProgress(job, record) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction("data", "readwrite"),
      store = tx.objectStore("data");
    store.put(
      {
        key: record.key,
        status: record.status,
        error: record.error || "",
        itemId: record.itemId,
        retryCount: record.retryCount || 0,
      },
      "result:" + job.id + ":" + record.key,
    );
    store.put(summary(job), "summary:" + job.id);
    if (success(record) && job.target?.bookmark?.enabled) {
      const preferences = job.target.bookmark;
      const key = `bookmark:${job.id}:${record.type === 3 ? "novel" : "art"}:${record.id}`;
      const existing = store.get(key);
      existing.onsuccess = () => {
        if (!existing.result)
          store.put(
            {
              key,
              job: job.id,
              work: record.id,
              type: record.type === 3 ? "novels" : "illusts",
              tags: record.tags,
              title: record.title,
              account: preferences.account,
              withTags: preferences.withTags,
              private: preferences.private,
              state: preferences.account ? "pending" : "failed",
              error: preferences.account
                ? ""
                : "采集时未能确认 Pixiv 账号，请重新登录采集",
              created: Date.now(),
            },
            key,
          );
      };
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Reset only unfinished records; update their result overlays in the same transaction.
export async function resetJobRetries(job) {
  job.retryCount = 0; job.retryAt = 0; job.error = '';
  const database = await db;
  await new Promise((resolve,reject)=>{
    const tx=database.transaction('data','readwrite'), store=tx.objectStore('data');
    for(const record of job.records) if(!success(record)) {
      record.retryCount=0;record.status='pending';record.error='';
      store.put({key:record.key,status:record.status,error:'',retryCount:0,itemId:record.itemId},'result:'+job.id+':'+record.key);
    }
    store.put(job,'job:'+job.id);store.put(summary(job),'summary:'+job.id);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
