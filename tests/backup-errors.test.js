import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

test('backup fails visibly if a referenced original is missing', async t => {
  await mkdir(resolve('artifacts'), { recursive: true });
  const dataDir = await mkdtemp(resolve('artifacts/backup-failure-'));
  const { app, db } = createApp({ dataDir });
  const server = await new Promise(r => { const s=app.listen(0,'127.0.0.1',()=>r(s)); });
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0123'})});
  const headers={Cookie:setup.headers.get('set-cookie').split(';')[0]};
  const buffer=await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toBuffer();
  const form=new FormData();form.set('file',new Blob([buffer]),'image.png');
  const upload=await fetch(base+'/api/assets',{method:'POST',headers,body:form});assert.equal(upload.status,201);const item=await upload.json();
  const row=db.prepare('SELECT file_key FROM items WHERE id=?').get(item.id);
  await unlink(join(dataDir,'media',row.file_key));
  await assert.rejects(async()=>{const response=await fetch(base+'/api/export?mode=backup',{headers,signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Backup rejected');await response.arrayBuffer();});
});
