let connection;
export const draftId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
const emergencyPrefix = 'znote:note-recovery:';
function clearEmergency(id, match) {
  try { const row = JSON.parse(localStorage.getItem(emergencyPrefix + id)); if (!row || !match || row.stamp === match.stamp || (match.updated_at && row.updated_at <= match.updated_at)) localStorage.removeItem(emergencyPrefix + id); } catch {}
}
function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('znote-writing', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('drafts', { keyPath: 'id' });
      const summaries = db.createObjectStore('summaries', { keyPath: 'id' });
      summaries.createIndex('note', 'note_id'); summaries.createIndex('library', 'library_id');
      db.createObjectStore('positions', { keyPath: 'id' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = null; }; resolve(request.result); };
    request.onerror = () => { connection = null; reject(request.error); };
    request.onblocked = () => { connection = null; reject(Error('草稿存储被其他页面占用，请关闭旧版页面后重试')); };
  });
  return connection;
}
async function transaction(stores, mode, work) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode); let result;
    tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(tx.error || Error('本地草稿未写入'));
    work(tx, value => { result = value; });
  });
}
export async function putDraft(row, replace) {
  await transaction(['drafts', 'summaries'], 'readwrite', tx => {
    tx.objectStore('drafts').put(row);
    const { id, note_id, library_id, updated_at, stamp, fields } = row;
    tx.objectStore('summaries').put({ id, note_id: note_id || '', library_id, updated_at, stamp, title: fields.title || '未命名笔记', length: fields.content.length });
    if (replace && replace.id !== row.id) {
      const request = tx.objectStore('summaries').get(replace.id);
      request.onsuccess = () => { if (request.result?.stamp === replace.stamp) { tx.objectStore('drafts').delete(replace.id); tx.objectStore('summaries').delete(replace.id); } };
    }
  });
  clearEmergency(row.id, row); if (replace) clearEmergency(replace.id, { stamp: replace.stamp });
}
export function getDraft(id) { return transaction(['drafts'], 'readonly', (tx, result) => { const r = tx.objectStore('drafts').get(id); r.onsuccess = () => result(r.result); }); }
export function deleteDraft(id, stamp) {
  return transaction(['drafts', 'summaries'], 'readwrite', tx => {
    const r = tx.objectStore('summaries').get(id);
    r.onsuccess = () => { if (!stamp || r.result?.stamp === stamp) { tx.objectStore('drafts').delete(id); tx.objectStore('summaries').delete(id); } };
  }).then(() => clearEmergency(id, stamp ? { stamp } : null));
}
export function listDrafts(index, value) {
  return transaction(['summaries'], 'readonly', (tx, result) => {
    const summaries = tx.objectStore('summaries');
    const r = index ? summaries.index(index).getAll(value) : summaries.getAll();
    r.onsuccess = () => result(r.result.sort((a, b) => b.updated_at - a.updated_at));
  });
}
export function emergencyDraft(row) {
  try { localStorage.setItem(emergencyPrefix + row.id, JSON.stringify(row)); return true; } catch { return false; }
}
export async function recoverDrafts() {
  const rows = [];
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key.startsWith(emergencyPrefix)) { try { rows.push(JSON.parse(localStorage.getItem(key))); } catch {} } } } catch {}
  for (const row of rows) {
    if (typeof row?.id !== 'string' || typeof row.library_id !== 'string' || typeof row.fields?.content !== 'string' || typeof row.fields?.title !== 'string' || !Array.isArray(row.fields?.tags) || !row.fields.tags.every(t => typeof t === 'string') || !Number.isFinite(row.updated_at)) continue;
    const stored = await getDraft(row.id);
    if (!stored || stored.updated_at <= row.updated_at) await putDraft(row);
  }
}
export function putPosition(id, position) { return transaction(['positions'], 'readwrite', tx => tx.objectStore('positions').put({ id, ...position })); }
export function getPosition(id) { return transaction(['positions'], 'readonly', (tx, result) => { const r = tx.objectStore('positions').get(id); r.onsuccess = () => result(r.result); }); }
