// Cache only this public explanation. Never cache authenticated notes, API or original media.
const CACHE='znote-offline-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html'))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('znote-offline-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method==='GET'&&event.request.mode==='navigate'&&url.origin===self.location.origin&&!/^\/(api|media)(\/|$)/.test(url.pathname))event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html').then(response=>response||Response.error())));});
