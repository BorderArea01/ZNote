import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';

test('active browser sessions renew daily with an absolute limit; expired/revoked and API authorizations remain separate',async()=>{
 const runtime=createApp({dataDir:await mkdtemp(join(tmpdir(),'znote-session-renew-'))}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const get=Cookie=>fetch(base+'/api/me',{headers:{Cookie}});
 try{
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'1234'})});
  const cookie=setup.headers.get('set-cookie').split(';')[0],row=runtime.db.prepare("SELECT * FROM tokens WHERE kind='session'").get();
  const near=new Date(Date.now()+86400000).toISOString();runtime.db.prepare('UPDATE tokens SET expires_at=? WHERE id=?').run(near,row.id);
  let response=await get(cookie);assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly/);
  const renewed=runtime.db.prepare('SELECT expires_at FROM tokens WHERE id=?').get(row.id).expires_at;assert.ok(Date.parse(renewed)>Date.now()+6*86400000);
  response=await get(cookie);assert.equal(response.headers.get('set-cookie'),null);assert.equal(runtime.db.prepare('SELECT expires_at FROM tokens WHERE id=?').get(row.id).expires_at,renewed);
  const created=new Date(Date.now()-29*86400000).toISOString();runtime.db.prepare('UPDATE tokens SET created_at=?,expires_at=? WHERE id=?').run(created,new Date(Date.now()+3600000).toISOString(),row.id);
  response=await get(cookie);assert.equal(response.status,200);assert.equal(Date.parse(runtime.db.prepare('SELECT expires_at FROM tokens WHERE id=?').get(row.id).expires_at),Date.parse(created)+30*86400000);
  runtime.db.prepare("UPDATE tokens SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").run(row.id);response=await get(cookie);assert.equal(response.status,401);assert.equal(response.headers.get('set-cookie'),null);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'1234'})});assert.equal(login.status,200);const newCookie=login.headers.get('set-cookie').split(';')[0];
  const api=await fetch(base+'/api/tokens',{method:'POST',headers:{Cookie:newCookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Persistent collector',scope:'write'})});const token=await api.json();
  response=await fetch(base+'/api/me',{headers:{Authorization:'Bearer '+token.token,Cookie:cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.equal(runtime.db.prepare('SELECT expires_at FROM tokens WHERE id=?').get(token.id).expires_at,null);
  await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:newCookie,'Content-Type':'application/json'},body:'{}'});assert.equal((await get(newCookie)).status,401);assert.equal((await fetch(base+'/api/me',{headers:{Authorization:'Bearer '+token.token}})).status,200);
 }finally{await Promise.all(['captures','weixin','trash','imports','backups','webhooks'].map(k=>runtime[k].stop()));await new Promise(r=>server.close(r));runtime.db.close();}
});
