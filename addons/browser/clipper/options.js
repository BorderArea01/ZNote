import { settings, serverUrl, api } from './client.js';
import { parseBlockedSites } from './site-policy.js';
const $ = id => document.getElementById(id);
const current = await settings();
$('hover-enabled').checked = current.hover;
$('dock-enabled').checked = current.dock;
$('download-key').value = current.downloadKey.toUpperCase();
$('save-key').value = current.saveKey.toUpperCase();
$('preview-width').value = current.previewWidth;
$('blocked-sites').value = current.blockedSites.join('\n');
let blockedSitesDirty = false;
$('blocked-sites').addEventListener('input', () => { blockedSitesDirty = true; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.blockedSites && !blockedSitesDirty)
    $('blocked-sites').value = (changes.blockedSites.newValue || []).join('\n');
});
$('behavior').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const downloadKey = $('download-key').value.trim().toLowerCase(), saveKey = $('save-key').value.trim().toLowerCase();
    if (!/^[a-z0-9]$/.test(downloadKey) || !/^[a-z0-9]$/.test(saveKey)) throw new Error('快捷键请设置为单个字母或数字');
    if (downloadKey === saveKey) throw new Error('下载和入库快捷键不能相同');
    const previewWidth = Number($('preview-width').value);
    if (!Number.isInteger(previewWidth) || previewWidth < 240 || previewWidth > 1200) throw new Error('预览宽度应为 240～1200');
    await chrome.storage.local.set({ hover: $('hover-enabled').checked, dock: $('dock-enabled').checked, downloadKey, saveKey, shortcutVersion: 1, previewWidth, blockedSites:parseBlockedSites($('blocked-sites').value) });
    blockedSitesDirty = false;
    $('status').textContent = '浏览器行为已保存，已打开网页同步生效';
  } catch (e) { $('status').textContent = e.message; }
});
$('server').value = current.server; $('token').value = current.token; $('tags').value = current.tags;
let selected = current.collection_id;
function values() {
  const server = serverUrl($('server').value.trim()), token = $('token').value.trim();
  if (!/^zn_[a-f0-9]{64}$/.test(token)) throw new Error('请填写有效的 API 令牌');
  return { server, token, tags: $('tags').value.trim(), collection_id: $('collection').value };
}
async function load(config = current) {
  const me = await api('/api/me', {}, config);
  if (me.scope !== 'write') throw new Error('采集需要 write 写入令牌，请使用 ZNote 中的写入令牌');
  const collections = await api('/api/collections', {}, config);
  $('collection').replaceChildren(new Option('未分类', ''), ...collections.map(c => new Option(c.name, c.id)));
  if (collections.some(c => c.id === selected)) $('collection').value = selected;
}
async function saveConnection(message) {
  $('status').textContent = '正在连接…';
  try {
    const config = values(); selected = config.collection_id;
    await load(config);
    await chrome.storage.local.set({ ...config, collection_id: $('collection').value });
    $('status').textContent = message;
  } catch (e) { $('status').textContent = e.message; }
}
$('connect').addEventListener('click', () => saveConnection('连接成功，请选择知识库并保存设置'));
$('settings').addEventListener('submit', event => { event.preventDefault(); saveConnection('已保存，可以右键图片或截图入库'); });
if (current.token) load().catch(e => { $('status').textContent = e.message; });
document.body.dataset.ready = 'true';
