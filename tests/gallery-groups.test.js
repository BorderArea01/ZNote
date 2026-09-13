import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {galleryGrouping,knownGalleryWork,legacyGalleryPage} from '../shared/gallery-group.js';
import {repairGalleryGroups} from '../scripts/repair-gallery-groups.mjs';

test('gallery identity is stable across jobs, titles, known-site mirrors and tracking; generic galleries remain distinct',async()=>{
 const paw=await galleryGrouping({source_url:'https://pawchive.pw/fanbox/user/1/post/2?from=list#page',title:'First',images:['https://x/a']});
 assert.equal(paw.group_key,'paw:fanbox:1:2');assert.equal(paw.source_url,'https://pawchive.pw/fanbox/user/1/post/2');
 assert.equal((await galleryGrouping({source_url:'https://pawchive.st/fanbox/user/1/post/2/',title:'Renamed',images:['https://x/b']})).group_key,paw.group_key);
 assert.equal(knownGalleryWork('https://www.pixiv.net/en/artworks/123?from=users').group_key,'pixiv:art:123');assert.equal(knownGalleryWork('https://pawchive.pw/fanbox/user/1'),null);
 const one={source_url:'https://example.org/article?id=2#top',title:'One',images:['https://example.org/1','https://example.org/2']},a=await galleryGrouping(one);
 assert.equal((await galleryGrouping({...one,title:'Renamed'})).group_key,a.group_key);assert.notEqual((await galleryGrouping({...one,images:one.images.slice(1)})).group_key,a.group_key);assert.notEqual((await galleryGrouping({...one,source_url:'https://example.org/article?id=3'})).group_key,a.group_key);
});

test('batch collection preserves page identities, repairs exact legacy records and keeps manual/note ownership',async t=>{
 const dir=await mkdtemp(resolve('artifacts/gallery-group-')),runtime=createApp({dataDir:dir}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});const base='http://127.0.0.1:'+server.address().port;
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0927'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
 const json=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r.json()};
 const lib=async name=>(await json('/api/collections','POST',{name})).id;
 const pixels=await Promise.all(['#aabbcc','#bbccdd','#ccddee'].map(background=>sharp({create:{width:32,height:32,channels:3,background}}).png().toBuffer()));
 const source='https://pawchive.pw/fanbox/user/1/post/2',key='paw:fanbox:1:2',title='Legacy gallery';
 const upload=async(index,collection,grouped=false,extra={})=>{const form=new FormData();form.set('file',new Blob([pixels[index]]),'page.png');const fields={title:`${title} · ${String(index+1).padStart(3,'0')}`,content:`作品：${title}\r\n页码：${index+1} / 3\r\n\r\n来源链接：${source}`,source_url:source,collection_id:collection,...(grouped?{group_key:key,group_index:index,group_title:title}:{}),...extra};for(const [k,v] of Object.entries(fields))form.set(k,v);const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:form});assert.ok(r.ok,await r.clone().text());return r.json()};
 const a=await lib('On retry'),old=await Promise.all([0,1,2].map(i=>upload(i,a)));
 for(let i=0;i<3;i++){const result=await upload(i,a,true,{source_url:source+'?from=retry'});assert.equal(result.id,old[i].id);assert.equal(result.group_index,i);assert.equal(result.group_key,key)}
 assert.equal((await json('/api/items?collection='+a+'&grouped=true')).total,1);
 const repair=await lib('Repair'),pages=await Promise.all([0,1,2].map(i=>upload(i,repair)));
 const protectedLib=await lib('Protected'),protectedPages=await Promise.all([0,1,2].map(i=>upload(i,protectedLib)));
 runtime.db.prepare('UPDATE items SET group_manual=1 WHERE id=?').run(protectedPages[0].id);
 runtime.db.prepare('UPDATE items SET version=version+1 WHERE id=?').run(protectedPages[1].id);
 runtime.db.prepare("UPDATE items SET deleted_at='2026-09-13T00:00:00.000Z' WHERE id=?").run(protectedPages[2].id);
 const before=runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),files=(await readdir(join(dir,'media'))).sort();
 const dry=repairGalleryGroups(runtime.db);assert.equal(dry.groups,1);assert.deepEqual(dry.ids,pages.map(p=>p.id));assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),before);
 const applied=repairGalleryGroups(runtime.db,{apply:true});assert.equal(applied.images,3);assert.equal(repairGalleryGroups(runtime.db,{apply:true}).images,0);
 const grouped=await json('/api/items?collection='+repair+'&grouped=true');assert.equal(grouped.total,1);assert.equal(grouped.items[0].id,pages[0].id);assert.equal(grouped.items[0].group_count,3);
 for(const r of protectedPages)assert.deepEqual(runtime.db.prepare('SELECT * FROM items WHERE id=?').get(r.id),before.find(x=>x.id===r.id));assert.deepEqual((await readdir(join(dir,'media'))).sort(),files);
 const manualId=old[1].id;runtime.db.prepare("UPDATE items SET group_key='manual:keep',group_manual=1 WHERE id=?").run(manualId);assert.equal((await upload(1,a,true)).group_key,'manual:keep');
 const note=await json('/api/items','POST',{title:'Note owns image',collection_id:repair,content:`![page](${pages[0].url})`});const notePage=runtime.db.prepare('SELECT * FROM items WHERE group_key=?').get('note:'+note.id);assert.equal(legacyGalleryPage(notePage),null);
 const batchLib=await lib('API batch'),batch=async group=>{const form=new FormData();for(let i=0;i<3;i++)form.append('files',new Blob([pixels[0]]),'same.png');form.set('collection_id',batchLib);form.set('group_key',group);form.set('group_index','4');form.set('group_title','Same bytes');form.set('source_url','https://example.org/post');const r=await fetch(base+'/api/assets/batch',{method:'POST',headers:{Cookie:cookie},body:form});assert.ok(r.ok);return (await r.json()).results};
 const first=await batch('batch:one');assert.ok(first.every(r=>r.status==='created'));assert.deepEqual(first.map(r=>r.item.group_index),[4,5,6]);assert.equal(new Set(first.map(r=>r.item.id)).size,3);assert.equal(new Set(first.map(r=>r.item.hash)).size,1);
 assert.deepEqual((await batch('batch:one')).map(r=>r.item.id),first.map(r=>r.item.id));const second=await batch('batch:two');assert.ok(second.every(r=>r.status==='created'));assert.equal((await json('/api/items?collection='+batchLib+'&grouped=true')).total,2,'same source and bytes in separate automatic groups do not steal membership');
 assert.equal((await json('/api/items?collection='+a+'&grouped=true')).total,2,'manual grouping retained');
});
