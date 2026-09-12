// ZNote integration, GPL-3.0-or-later.
import { read, write, jobs } from './store.js';
import { normalize } from './records.js';
const owned = (job, sender) => job?.owner === sender.tab?.id && job?.source === sender.url;
let serial = Promise.resolve();
async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id || !/^https:\/\/www\.pixiv(?:ision)?\.net\//.test(sender.url || '') || sender.frameId !== 0) throw Error('无效作品页面');
  if (message.action === 'open') { await chrome.tabs.create({ url: chrome.runtime.getURL('znote/index.html') }); return {}; }
  if (message.action === 'begin') {
    const all = await jobs();
    if (all.length >= 20) throw Error('最多保留 20 个入库任务，请打开 ZNote 任务页删除已完成任务');
    const id = crypto.randomUUID();
    await write('job:' + id, { id, title: String(message.title || 'Pixiv 抓取结果').slice(0,180), created: Date.now(), owner: sender.tab.id, source: sender.url, records: [], rejected: [], finalized: false });
    return { id };
  }
  const job = await read('job:' + message.id);
  if (!owned(job, sender) || job.finalized) throw Error('任务已失效');
  if (message.action === 'append') {
    if (!Array.isArray(message.records) || message.records.length > 50 || JSON.stringify(message.records).length > 4e6 || job.records.length + message.records.length > 10000) throw Error('单次最多 10000 个文件，请缩小抓取范围');
    const seen = new Set(job.records.map(r => r.key));
    for (const r of message.records) {
      try { const record = normalize(r); if (!seen.has(record.key)) { seen.add(record.key); job.records.push(record); } }
      catch (e) { job.rejected.push({ title: String(r.title || r.id || '').slice(0,180), error: e.message }); }
    }
    if (JSON.stringify(job).length > 40e6) throw Error('作品元数据超过 40 MB，请缩小抓取范围');
    await write('job:' + job.id, job); return {};
  }
  if (message.action === 'finish') {
    job.finalized = true; delete job.owner;
    await write('job:' + job.id, job);
    await chrome.tabs.create({ url: chrome.runtime.getURL('znote/index.html') + '?job=' + job.id });
    return { count: job.records.length, rejected: job.rejected.length };
  }
  throw Error('未知入库操作');
}
// A named port avoids competing with upstream's asynchronous onMessage handlers.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'znote-capture') return;
  port.onMessage.addListener(message => {
    const next = serial.then(() => handle(message, port.sender)); serial = next.catch(() => {});
    const respond = value => { try { port.postMessage(value); } catch {} };
    next.then(data => respond({ ok: true, ...data }), e => respond({ ok: false, error: e.message }));
  });
});
