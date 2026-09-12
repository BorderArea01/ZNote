// ZNote integration, GPL-3.0-or-later. Secrets live in the extension origin's
// IndexedDB, never in Pixiv DOM, messages to content scripts, or exported jobs.
const db = new Promise((resolve, reject) => {
  const req = indexedDB.open('znote-pixiv', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('data');
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
export async function read(key) {
  const database = await db;
  return new Promise((resolve, reject) => { const req = database.transaction('data').objectStore('data').get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
export async function write(key, value) {
  const database = await db;
  return new Promise((resolve, reject) => { const tx = database.transaction('data', 'readwrite'); tx.objectStore('data').put(value, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}
export async function remove(key) {
  const database = await db;
  return new Promise((resolve, reject) => { const tx = database.transaction('data', 'readwrite'); tx.objectStore('data').delete(key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}
export async function jobs() {
  const database = await db;
  return new Promise((resolve, reject) => {
    const store = database.transaction('data').objectStore('data'), out = [], req = store.openCursor();
    req.onsuccess = () => { const c = req.result; if (!c) return resolve(out.sort((a,b) => b.created-a.created)); if (String(c.key).startsWith('job:')) out.push(c.value); c.continue(); }; req.onerror = () => reject(req.error);
  });
}
