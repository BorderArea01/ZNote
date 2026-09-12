// ZNote integration, GPL-3.0-or-later.
import { read, write, removeJob, writeJob, writeProgress, summaries } from './store.js';
import { serverURL, api } from './client.js';
import { ingestRecord } from './ingest.js';
const $ = id => document.getElementById(id);
let config, job, collections = [], connected = false, running = false, controller, uploading = false, page = 0;
const success = r => ['done','duplicate'].includes(r.status);
function draw() {
  $('empty').hidden = !!job; $('task').hidden = !job;
  if (!job) return;
  $('title').textContent = job.title; $('source').href = job.source;
  const done = job.records.filter(success).length;
  $('progress').max = job.records.length || 1; $('progress').value = done;
  $('start').disabled = !connected || running || ['queued','running'].includes(job.state) || !job.records.length || done === job.records.length;
  $('start').textContent = done === job.records.length && done ? '全部已入库' : job.target ? '继续 / 重试未完成' : '保存到知识库';
  $('stop').hidden = !running; $('delete').disabled = running || ['queued','running'].includes(job.state); $('connect').disabled = running;
  for (const id of ['collection','tags','include-tags']) $(id).disabled = running || !!job.target;
  $('rejected').textContent = job.rejected.length ? `${job.rejected.length} 条未加入：\n` + job.rejected.slice(0,20).map(r => r.title + '：' + r.error).join('\n') : '';
  $('records').replaceChildren();
  for (const r of job.records.slice(page * 50, page * 50 + 50)) {
    const li = document.createElement('li'), info = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small'), state = document.createElement('span'), link = document.createElement('a');
    info.className = 'info'; title.textContent = r.title; meta.textContent = r.error || `${r.author} · ${['插画','漫画','动图','小说'][r.type]}${r.type < 2 ? ' · 第 ' + (r.index + 1) + ' 张' : ''}`;
    if (r.status === 'failed') meta.className = 'error';
    state.className = 'state'; state.textContent = { done:'已入库',duplicate:'已收录',failed:'失败',active:'处理中…',pending:'待入库' }[r.status];
    link.href = r.source; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = '来源 ↗';
    const preview = r.preview || r.cover;
    if (preview) { const img = document.createElement('img'); img.className = 'thumb'; img.src = preview; img.alt = ''; img.loading = 'lazy'; img.onerror = () => img.remove(); li.append(img); }
    info.append(title, meta); li.append(info, state, link); $('records').append(li);
  }
  const pages = Math.max(1, Math.ceil(job.records.length / 50));
  $('page').textContent = `${page + 1} / ${pages}`; $('previous').disabled = !page; $('next').disabled = page >= pages - 1;
}
function destination() {
  const selected = job?.target?.collection_id ?? config?.collection_id ?? '';
  $('collection').replaceChildren(new Option('未分类', ''), ...collections.map(c => new Option(c.name, c.id)));
  if (selected && !collections.some(c => c.id === selected)) { $('collection').append(new Option('原知识库已删除，请新建任务', selected)); }
  $('collection').value = selected; $('tags').value = job?.target?.tags ?? config?.tags ?? '';
  $('include-tags').checked = job?.target?.includeTags ?? true; draw();
}
async function connect(next, persist = true) {
  const me = await api(next, '/api/me'); if (me.scope !== 'write') throw Error('请使用 write 写入令牌');
  collections = await api(next, '/api/collections'); config = next; connected = true;
  if (persist) await write('connection', config);
  $('connection-status').textContent = '已连接，设置会在更新后保留'; destination();
}
$('connection').onsubmit = async e => {
  e.preventDefault();
  try {
    const server = serverURL($('server').value.trim()), token = $('token').value.trim() || (config && server === config.server ? config.token : '');
    if (!/^zn_[a-f0-9]{64}$/.test(token)) throw Error('请输入有效的 ZNote 写入令牌');
    const allowed = await chrome.permissions.request({ origins: [new URL(server).origin + '/*'] });
    if (!allowed) throw Error('需要允许扩展访问所选知识库地址');
    $('connection-status').textContent = '正在连接…'; await connect({ ...config, server, token, collection_id: config?.collection_id || '', tags: config?.tags || '' });
    $('token').value = '';
  } catch (e) { $('connection-status').textContent = e.message; }
};
async function listJobs() {
  $('jobs').replaceChildren();
  for (const item of (await summaries()).sort((a,b)=>b.created-a.created)) {
    const button = document.createElement('button'); button.className = 'quiet';
    button.textContent = `${item.title} · ${item.done}/${item.total}${!item.finalized ? '（准备中断）' : ''}`;
    button.onclick = () => { if (!running) selectJob(item.id).catch(e => $('connection-status').textContent = e.message); };
    $('jobs').append(button);
  }
}
async function selectJob(id) {
  job = await read('job:' + id); page = 0;
  if (job) { $('status').textContent = `已入库 ${job.records.filter(success).length} / ${job.records.length}，可继续未完成项。`; }
  destination(); history.replaceState(null,'', '?job=' + (job?.id || ''));
}
async function run() {
  if (!job || !config || running || ['queued','running'].includes(job.state)) return;
  const id = job.id;
  await navigator.locks.request('znote-job:' + id, { ifAvailable: true }, async lock => {
    if (!lock) throw Error('此任务正在另一个窗口入库');
    job = await read('job:' + id); if (!job) throw Error('任务已删除');
    if (job.target && job.target.server !== config.server) throw Error('此任务属于另一个知识库服务，请恢复原连接后继续');
    const target = job.target || { ...job.reviewPreferences, server: config.server, collection_id: $('collection').value, tags: $('tags').value.trim(), includeTags: $('include-tags').checked };
    const custom = target.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean);
    if (custom.length > 28 || custom.some(t => t.length > 40)) throw Error('附加标签最多 28 个，每个最多 40 字');
    if (target.collection_id && !collections.some(c => c.id === target.collection_id)) throw Error('目标知识库已删除，请新建任务');
    job.target = target; const connection = { ...config };
    const me = await api(connection, '/api/me'); if (me.scope !== 'write') throw Error('写入令牌已失效，请重新连接');
    job.state = 'review'; running = true; controller = new AbortController(); draw();
    try {
      await writeJob(job);
      for (const [i, r] of job.records.entries()) {
        if (controller.signal.aborted) break; if (success(r)) continue;
        r.status = 'active'; r.error = ''; page = Math.floor(i / 50); draw(); $('status').textContent = `正在入库 ${i + 1} / ${job.records.length}：${r.title}`;
        try {
          const item = await ingestRecord(connection, r, target, controller.signal, value => uploading = value);
          r.status = item.duplicate ? 'duplicate' : 'done'; r.itemId = item.id;
        } catch (e) { r.status = controller.signal.aborted && !uploading ? 'pending' : 'failed'; r.error = e.message; }
        finally { uploading = false; }
        await writeProgress(job, r); draw();
        // Keep requests sequential and leave room for the source site between files.
        if (!controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 250));
      }
      const failed = job.records.filter(r => r.status === 'failed').length;
      $('status').textContent = `${controller.signal.aborted ? '已停止。' : ''}已入库 ${job.records.filter(success).length} / ${job.records.length}${failed ? `，${failed} 项失败，可重试。` : '。'}`;
    } finally { job.state = controller.signal.aborted ? 'paused' : job.records.every(success) ? 'done' : 'failed'; await writeJob(job); running = false; draw(); await listJobs(); }
  });
}
$('start').onclick = () => run().catch(e => $('status').textContent = e.message);
$('stop').onclick = () => { controller?.abort(); $('status').textContent = uploading ? '正在停止，等待当前上传确认…' : '正在停止…'; };
$('refresh').onclick = () => listJobs().catch(e => $('connection-status').textContent = e.message);
$('delete').onclick = async () => {
  if (!job || running) return;
  await navigator.locks.request('znote-job:' + job.id, { ifAvailable: true }, async lock => {
    if (!lock) { $('status').textContent = '此任务正在其他窗口处理'; return; }
    await removeJob(job.id); job = null; draw(); await listJobs();
  });
};
$('previous').onclick = () => { page--; draw(); }; $('next').onclick = () => { page++; draw(); };
window.addEventListener('beforeunload', e => { if (running) { e.preventDefault(); e.returnValue = ''; } });
try {
  config = await read('connection'); $('server').value = config?.server || 'http://localhost:3741';
  if (config) await connect(config, false).catch(e => { $('connection-status').textContent = e.message; collections = []; });
  await listJobs(); const id = new URL(location.href).searchParams.get('job'); if (id) await selectJob(id);
} catch (e) { $('connection-status').textContent = e.message; }

// The optional detail view observes background jobs; it never claims their lock.
setInterval(async () => {
  if (running || !job || !['queued','running'].includes(job.state)) return;
  const next = await read('job:' + job.id); if (!next) return; job = next;
  $('status').textContent = job.error || job.message || '后台队列处理中'; draw(); await listJobs();
}, 1500);
