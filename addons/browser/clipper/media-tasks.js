import { settings } from './client.js';

const KEY = 'mediaTasks';
const OFFSCREEN_PATH = 'media-worker.html';
let creating;

async function load() {
  const stored = (await chrome.storage.session.get(KEY))[KEY] || {};
  const cutoff = Date.now() - 24 * 3600000;
  for (const [id, task] of Object.entries(stored)) if ((task.updated || task.created || 0) < cutoff) delete stored[id];
  return stored;
}
async function save(tasks) { await chrome.storage.session.set({ [KEY]: tasks }); }

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const exists = 'getContexts' in chrome.runtime
    ? (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length > 0
    : (await clients.matchAll()).some(client => client.url === url);
  if (exists) return;
  if (!creating) creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['BLOBS'],
    justification: '在不打开新标签页的情况下处理并合并用户选择的视频',
  }).finally(() => { creating = null; });
  await creating;
}

export async function startMediaTask(resource, action, tabId) {
  if (!['save', 'download'].includes(action)) throw new Error('后台任务类型无效');
  const config = await settings();
  if (action === 'save' && !config.token) throw new Error('请先在连接设置中连接 ZNote');
  if (resource.kind === 'hls' && !config.token) throw new Error('m3u8 合并需要先连接 ZNote');
  const tasks = await load();
  const existing = Object.values(tasks).find(task =>
    task.tabId === tabId && task.resourceId === resource.id && task.action === action && ['queued', 'running'].includes(task.status));
  if (existing) return existing;
  const task = {
    id: crypto.randomUUID(), tabId, resourceId: resource.id,
    title: resource.title, action, status: 'queued', message: '正在加入后台任务…',
    created: Date.now(), updated: Date.now(),
  };
  tasks[task.id] = task;
  await save(tasks);
  try {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({
      target: 'media-worker', type: 'media-task-run',
      task: { ...task, resource, config: {
        server: config.server, token: config.token,
        collection_id: config.collection_id, tags: config.tags || '',
      } },
    });
    if (!response?.ok) throw new Error(response?.error || '后台视频任务启动失败');
    return task;
  } catch(error) {
    task.status='failed';task.message=error?.message||'后台视频任务启动失败';task.updated=Date.now();
    tasks[task.id]=task;await save(tasks);throw error;
  }
}

export async function mediaTasksForTab(tabId) {
  return Object.values(await load()).filter(task => task.tabId === tabId).sort((a, b) => b.updated - a.updated).slice(0, 20);
}

export async function updateMediaTask(patch) {
  if (!patch?.id) throw new Error('后台任务编号无效');
  const tasks = await load(), task = tasks[patch.id];
  if (!task) return null;
  Object.assign(task, patch, { updated: Date.now() });
  await save(tasks);
  chrome.tabs.sendMessage(task.tabId, { type: 'media-task-update', task }, { frameId: 0 }).catch(() => {});
  return task;
}

export async function downloadMediaBlob(message) {
  if (!/^blob:chrome-extension:\/\//.test(message.url || '')) throw new Error('后台下载地址无效');
  let id, settled = false, downloadListener;
  const completion = new Promise((resolve, reject) => {
    downloadListener = delta => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') finish(resolve);
      else if (delta.state.current === 'interrupted') finish(() => reject(new Error('浏览器下载被中断')));
    };
    const finish = callback => { if(settled)return;settled=true;chrome.downloads.onChanged.removeListener(downloadListener);callback({ id }); };
    chrome.downloads.onChanged.addListener(downloadListener);
  });
  try {
    id = await chrome.downloads.download({ url: message.url, filename: message.filename, conflictAction: 'uniquify', saveAs: false });
    const [current] = await chrome.downloads.search({ id });
    if (current?.state === 'complete') {
      settled=true;chrome.downloads.onChanged.removeListener(downloadListener);return { id };
    }
    if (current?.state === 'interrupted') throw new Error('浏览器下载被中断');
    return completion;
  } catch(error) {
    settled=true;chrome.downloads.onChanged.removeListener(downloadListener);throw error;
  }
}
