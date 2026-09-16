#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const MAX_IMAGES = 20;
const MAX_NOTE_CHARS = 500000;
const IMAGE_TYPES = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.avif', 'image/avif'],
]);

function configPath() {
  if (process.env.ZNOTE_CONVERSATION_CONFIG) return resolve(process.env.ZNOTE_CONVERSATION_CONFIG);
  if (process.platform === 'win32' && process.env.APPDATA) return resolve(process.env.APPDATA, 'ZNote', 'conversation-notes.json');
  return resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config'), 'znote', 'conversation-notes.json');
}

function normalizeBase(value = 'http://localhost:3741') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('base_url 必须是无凭据、无查询参数的 HTTP(S) 地址');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

async function readJsonFile(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`${path} 不是有效 JSON：${error.message}`); }
}

async function loadConfig() {
  const saved = await readJsonFile(configPath());
  const baseUrl = normalizeBase(process.env.ZNOTE_BASE_URL || saved.base_url);
  const token = process.env.ZNOTE_API_TOKEN || saved.token;
  const defaultCollectionId = process.env.ZNOTE_COLLECTION_ID ?? saved.default_collection_id ?? null;
  if (!token || !/^zn_[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('尚未配置有效的 ZNote write 令牌；请运行 configure 或设置 ZNOTE_API_TOKEN');
  return { baseUrl, token, defaultCollectionId };
}

async function inputText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function configure() {
  const raw = await inputText();
  if (!raw.trim()) throw new Error('请通过标准输入提供配置 JSON');
  const next = JSON.parse(raw);
  const prior = await readJsonFile(configPath());
  const token = next.token || prior.token;
  if (!token || !/^zn_[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('token 格式不正确');
  const payload = {
    base_url: normalizeBase(next.base_url || prior.base_url),
    token,
    default_collection_id: next.default_collection_id ?? prior.default_collection_id ?? null,
  };
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath(), 0o600).catch(() => {});
  process.stdout.write(`${JSON.stringify({ configured: true, base_url: payload.base_url, default_collection_id: payload.default_collection_id, config_path: configPath() })}\n`);
}

async function request(config, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      redirect: 'error',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json', ...(options.headers || {}) },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text.slice(0, 500) }; }
    if (!response.ok) throw new Error(body?.error || body?.message || `ZNote 返回 HTTP ${response.status}`);
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求 ZNote 超时；请保留同一份 JSON 后重试，以避免重复笔记');
    throw error;
  } finally { clearTimeout(timer); }
}

async function collections(config) {
  const body = await request(config, '/api/collections');
  return Array.isArray(body) ? body : body.collections || [];
}

async function resolveCollection(config, note) {
  if (note.collection_id !== undefined) return note.collection_id || null;
  if (note.collection_name) {
    const rows = await collections(config);
    const matches = rows.filter(row => row.name === note.collection_name);
    if (matches.length !== 1) throw new Error(`找不到唯一的知识库“${note.collection_name}”`);
    return matches[0].id;
  }
  return config.defaultCollectionId || null;
}

function cleanNote(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('笔记 JSON 必须是对象');
  const title = String(raw.title || '').trim();
  const content = String(raw.content || '').trim();
  if (!title || title.length > 200) throw new Error('title 必须为 1–200 个字符');
  if (!content || content.length > MAX_NOTE_CHARS) throw new Error(`content 必须为 1–${MAX_NOTE_CHARS} 个字符`);
  const tags = [...new Set([...(Array.isArray(raw.tags) ? raw.tags : []), 'AI 对话整理'].map(value => String(value).trim()).filter(Boolean))];
  if (tags.length > 30 || tags.some(tag => tag.length > 40)) throw new Error('标签最多 30 个，每个最多 40 个字符');
  const images = raw.images ?? [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error(`images 必须是数组，最多 ${MAX_IMAGES} 张`);
  if (raw.source_url != null) {
    const source = new URL(raw.source_url);
    if (!['http:', 'https:'].includes(source.protocol)) throw new Error('source_url 仅支持 HTTP(S)');
  }
  return { ...raw, title, content, tags, images };
}

function markerFor(note, collectionId) {
  const stable = JSON.stringify([note.title, note.content, note.tags, collectionId, note.source_url || null, note.images.map(image => [image.key || '', image.alt || '', image.caption || '', basename(String(image.path || ''))])]);
  return `znote-conversation-note:${createHash('sha256').update(stable).digest('hex')}`;
}

async function existingNote(config, marker, collectionId) {
  const params = new URLSearchParams({ q: marker, kind: 'note', summary: 'true', limit: '10', collection: collectionId || 'unfiled' });
  const body = await request(config, `/api/items?${params}`);
  const rows = Array.isArray(body) ? body : body.items || [];
  return rows.find(row => String(row.content || '').includes(marker)) || null;
}

async function uploadImage(config, image, collectionId, inputDir, sourceUrl) {
  const path = isAbsolute(String(image.path || '')) ? resolve(image.path) : resolve(inputDir, String(image.path || ''));
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error(`图片不存在：${path}`);
  const extension = /\.[^.]+$/.exec(path)?.[0].toLowerCase();
  const type = IMAGE_TYPES.get(extension);
  if (!type) throw new Error(`不支持的图片格式：${path}`);
  const form = new FormData();
  form.append('file', new Blob([await readFile(path)], { type }), basename(path));
  form.append('title', String(image.alt || basename(path)).slice(0, 200));
  form.append('content', String(image.caption || '').slice(0, 500000));
  form.append('tags', JSON.stringify(['AI 对话配图']));
  if (collectionId) form.append('collection_id', collectionId);
  if (sourceUrl) form.append('source_url', sourceUrl);
  return request(config, '/api/assets', { method: 'POST', body: form, timeout: 120000 });
}

function imageMarkdown(image, uploaded) {
  const alt = String(image.alt || uploaded.title || '对话配图').replace(/[\]\n\r]/g, ' ');
  const caption = String(image.caption || '').trim();
  return `![${alt}](/media/${uploaded.id}/original)${caption ? `\n\n*${caption}*` : ''}`;
}

async function publish(config, inputPath) {
  const absoluteInput = resolve(inputPath);
  const note = cleanNote(await readJsonFile(absoluteInput));
  const collectionId = await resolveCollection(config, note);
  const marker = markerFor(note, collectionId);
  const prior = await existingNote(config, marker, collectionId);
  if (prior) return { created: false, duplicate: true, item: prior, url: `${config.baseUrl}/?item=${encodeURIComponent(prior.id)}` };

  let content = `<!-- ${marker} -->\n\n${note.content}`;
  const append = [];
  const uploaded = [];
  for (const [index, image] of note.images.entries()) {
    const item = await uploadImage(config, image, collectionId, dirname(absoluteInput), note.source_url || null);
    uploaded.push(item);
    const markdown = imageMarkdown(image, item);
    const key = String(image.key ?? index + 1);
    const placeholder = `{{image:${key}}}`;
    if (content.includes(placeholder)) content = content.split(placeholder).join(markdown);
    else append.push(markdown);
  }
  if (append.length) content += `\n\n## 相关图片\n\n${append.join('\n\n')}`;
  if (/\{\{image:[^}]+\}\}/.test(content)) throw new Error('正文仍有未匹配的图片占位符；笔记尚未创建');

  const body = await request(config, '/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: note.title, content, tags: note.tags, collection_id: collectionId, favorite: Boolean(note.favorite), source_url: note.source_url || null, archive_images: true }),
    timeout: 150000,
  });
  return {
    created: true,
    duplicate: false,
    item: body,
    collection_id: collectionId,
    uploaded_images: uploaded.length,
    image_archive: body.image_archive || null,
    url: `${config.baseUrl}/?item=${encodeURIComponent(body.id)}`,
  };
}

export { cleanNote, configPath, markerFor, normalizeBase, publish };

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (command === 'configure') return configure();
  const config = await loadConfig();
  if (command === 'doctor') {
    const rows = await collections(config);
    return process.stdout.write(`${JSON.stringify({ ok: true, base_url: config.baseUrl, collections: rows.length, default_collection_id: config.defaultCollectionId })}\n`);
  }
  if (command === 'collections') return process.stdout.write(`${JSON.stringify(await collections(config), null, 2)}\n`);
  if (command === 'publish') {
    const at = argv.indexOf('--input');
    if (at < 0 || !argv[at + 1]) throw new Error('publish 需要 --input <笔记 JSON>');
    return process.stdout.write(`${JSON.stringify(await publish(config, argv[at + 1]), null, 2)}\n`);
  }
  throw new Error('用法：znote-note.mjs configure | doctor | collections | publish --input <note.json>');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { process.stderr.write(`错误：${error.message}\n`); process.exitCode = 1; });
