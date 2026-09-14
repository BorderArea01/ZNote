import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
test('public server retains generic clipper but does not distribute private plugins',async t=>{
  const runtime=createApp({dataDir:await mkdtemp(join(tmpdir(),'znote-plugins-'))});const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});
  const base='http://127.0.0.1:'+server.address().port;
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'0059'})});assert.equal(setup.status,201);const headers={Cookie:setup.headers.get('set-cookie').split(';')[0]};
  for(const kind of ['pixiv','ehentai'])for(const name of ['download','source']){const r=await fetch(base+'/api/clipper/'+kind+'/'+name,{headers});assert.equal(r.status,404);assert.equal((await r.json()).error,'接口不存在')}
  const zip=await fetch(base+'/api/clipper/download',{headers});assert.equal(zip.status,200);assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0,2).toString(),'PK');
  const packageInfo=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));assert.equal(packageInfo.scripts['pixiv:build'],undefined);
});

