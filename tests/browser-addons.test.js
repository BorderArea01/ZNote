import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {loadAddons,checkAddon,extensionId} from '../scripts/browser-addons.mjs';
import {contextMenuEntries} from '../addons/browser/clipper/entry-menu.js';
test('plugin catalogue rejects public references to private plugins and protects stable extension IDs',async()=>{
 const root=await mkdtemp(resolve('artifacts/addon-catalog-')),base=join(root,'addons/browser');await mkdir(join(base,'public'),{recursive:true});await mkdir(join(base,'private'),{recursive:true});
 const put=(path,value)=>writeFile(path,JSON.stringify(value));
 const spec={schemaVersion:1,id:'sample',name:'Sample',visibility:'public',extension:'.',expectedId:extensionId('dGVzdA==')};
 await put(join(base,'catalog.json'),{schemaVersion:1,plugins:['public/addon.json']});await put(join(base,'public/addon.json'),spec);await put(join(base,'public/manifest.json'),{manifest_version:3,version:'1.0.0',key:'dGVzdA=='});
 const [addon]=await loadAddons(root);assert.equal((await checkAddon(addon)).extensionId,spec.expectedId);await assert.rejects(checkAddon({...addon,expectedId:'wrong'}),/ID/);
 await put(join(base,'catalog.json'),{schemaVersion:1,plugins:['private/addon.json']});await assert.rejects(loadAddons(root),/所属目录/);
 await put(join(base,'catalog.json'),{schemaVersion:1,plugins:['public/addon.json']});await put(join(base,'public/addon.json'),{...spec,visibility:'private'});await assert.rejects(loadAddons(root),/登记无效/);
});
test('one context menu root preserves all actions and groups screenshots and video tools',()=>{
 const menus=contextMenuEntries(),ids=new Set(menus.map(m=>m.id));assert.equal(ids.size,menus.length);assert.equal(menus.filter(m=>!m.parentId).length,1);for(const menu of menus)if(menu.parentId)assert.ok(ids.has(menu.parentId));assert.equal(menus.find(m=>m.id==='znote-capture-region').parentId,'znote-shot-menu');assert.ok(menus.find(m=>m.id==='znote-root').documentUrlPatterns.every(p=>p.startsWith('http')));
});
