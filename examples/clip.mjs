// Node.js 24+: ZNOTE_URL=http://server:3741 ZNOTE_TOKEN=zn_... node examples/clip.mjs /path/to/image.png
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
const base = (process.env.ZNOTE_URL || 'http://localhost:3741').replace(/\/$/, '');
const token = process.env.ZNOTE_TOKEN;
const filename = process.argv[2];
if (!token || !filename) { console.error('Set ZNOTE_TOKEN to a write token and pass an image path. Optional: ZNOTE_URL.'); process.exit(1); }
const form = new FormData();
form.set('file', new Blob([await readFile(filename)]), basename(filename));
form.set('title', basename(filename));
form.set('tags', JSON.stringify(['外部采集']));
const response = await fetch(`${base}/api/assets`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
const result = await response.json();
if (!response.ok) { console.error(result.error); process.exit(1); }
console.log(JSON.stringify({ id: result.id, title: result.title, url: result.url, duplicate: !!result.duplicate }, null, 2));
