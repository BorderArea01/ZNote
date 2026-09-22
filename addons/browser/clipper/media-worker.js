import { api, saveDirectVideo, serverUrl } from './client.js';
import { packageHls } from './hls-package.js';
import { videoDetails } from './video-details.js';
import { readPlayableVideo } from './video-fetch.js';

const queue = [];
const known = new Set();
let running = false;

const update = (task, status, message, extra = {}) =>
  chrome.runtime.sendMessage({
    target: 'background',
    type: 'media-task-update',
    task: { id: task.id, status, message, ...extra },
  }).catch(() => {});

async function downloadBlob(blob, task) {
  const url = URL.createObjectURL(blob);
  try {
    const result = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'media-task-download',
      taskId: task.id,
      url,
      filename: 'ZNote/' + String(task.resource.title || '网页视频')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 110) + '.mp4',
    });
    if (!result?.ok) throw new Error(result?.error || '浏览器下载失败');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function process(task) {
  const { resource, action, config } = task;
  const controller = new AbortController();
  await update(task, 'running', action === 'save' ? '正在保存到知识库…' : '正在准备下载…');
  let item;
  if (resource.kind === 'hls') {
    if (!config.token) throw new Error('m3u8 处理需要先连接 ZNote');
    const bundle = await packageHls(resource.url, {
      signal: controller.signal,
      quality: -1,
      onProgress: message => update(task, 'running', message),
    });
    const form = new FormData();
    for (const [name, blob] of bundle.files) form.append('files', blob, name);
    const details = videoDetails(resource, config.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean));
    form.set('title', details.title);
    form.set('content', details.content);
    form.set('tags', JSON.stringify(details.tags));
    form.set('source_url', resource.source_url);
    if (config.collection_id) form.set('collection_id', config.collection_id);
    if (action === 'save') {
      item = await api('/api/streams', { method: 'POST', body: form, signal: controller.signal }, config);
    } else {
      const response = await fetch(serverUrl(config.server) + '/api/streams?mode=download', {
        method: 'POST', body: form, credentials: 'omit', redirect: 'error',
        headers: { Authorization: 'Bearer ' + config.token }, signal: controller.signal,
      });
      if (!response.ok) {
        let result = {}; try { result = await response.json(); } catch {}
        throw new Error(result.error || '合并失败');
      }
      await downloadBlob(await response.blob(), task);
    }
  } else if (action === 'save') {
    item = await saveDirectVideo(
      resource.url, resource.source_url, resource.title,
      controller.signal, resource, config,
    );
  } else if (action === 'download') {
    const blob = await readPlayableVideo(resource.url, {
      signal: controller.signal,
      expectedTotal: Number(resource.total_bytes) || 0,
    });
    await downloadBlob(blob, task);
  } else {
    throw new Error('此任务不需要后台媒体处理');
  }
  const message = item
    ? item.duplicate ? '知识库已收录，已补充来源' : '已保存到知识库'
    : '下载完成';
  await update(task, 'complete', message, item ? { itemId: item.id } : {});
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const task = queue.shift();
    try { await process(task); }
    catch (error) { await update(task, 'failed', error?.message || '视频处理失败'); }
  }
  running = false;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'media-worker' || message.type !== 'media-task-run') return;
  const task = message.task;
  if (!task?.id || known.has(task.id)) { reply({ ok: true }); return; }
  known.add(task.id);
  queue.push(task);
  update(task, running ? 'queued' : 'running', running ? '已排队，等待前一任务完成' : '正在启动后台处理…');
  drain();
  reply({ ok: true });
});
