import {createHash,randomUUID} from 'node:crypto';
import {unlink,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {z} from 'zod';
import {localMediaReferences,replaceLocalMedia} from '../shared/local-media.js';
const fail=(status,message)=>Object.assign(Error(message),{status});
const selection=z.object({collection_id:z.string().nullable(),ids:z.array(z.string()).min(1).max(10000).optional()});

export function createTrashManager({app,db,dataDir,transaction,event,maintenance,clearCache,unlinkFile=unlink}) {
  let timer,pending=Promise.resolve(),stopped=false;
  function snapshot(input){
    const rows=db.prepare('SELECT * FROM items WHERE deleted_at IS NOT NULL AND collection_id IS ? ORDER BY id').all(input.collection_id);
    const wanted=input.ids?new Set(input.ids):null,targets=wanted?rows.filter(r=>wanted.has(r.id)):rows;
    if(wanted&&(wanted.size!==input.ids.length||targets.length!==wanted.size))throw fail(409,'所选内容已恢复、移动或删除，请刷新后重试');
    const ids=new Set(targets.map(r=>r.id)),media=new Map(targets.filter(r=>r.file_key).map(r=>[r.id,r]));
    const notes=[];
    for(const note of db.prepare("SELECT * FROM items WHERE kind='note' AND content LIKE '%/media/%' ORDER BY id").all()){
      if(ids.has(note.id))continue;
      const refs=localMediaReferences(note.content).filter(ref=>media.has(ref.id));if(refs.length)notes.push({note,refs});
    }
    const protectedIds=new Set(notes.flatMap(n=>n.refs.map(r=>r.id))),files=new Map(),protectedKeys=new Set([...protectedIds].map(id=>media.get(id).file_key));let shared=0;
    for(const item of media.values()){
      if(protectedKeys.has(item.file_key)||db.prepare('SELECT id FROM items WHERE file_key=?').all(item.file_key).some(r=>!ids.has(r.id))){shared++;continue}
      files.set(item.file_key,item.stored_bytes??item.bytes??0);
    }
    const revision=createHash('sha256').update(JSON.stringify([input.collection_id,input.ids||null,targets.map(r=>[r.id,r.version,r.file_key]),notes.map(n=>[n.note.id,n.note.version,n.refs.map(r=>r.id)]),[...files]])).digest('hex');
    return {targets,notes,media,revision,count:targets.length,referenced:protectedIds.size,shared,reclaimable_bytes:[...files.values()].reduce((a,b)=>a+b,0)};
  }
  const publicState=({revision,count,referenced,shared,reclaimable_bytes})=>({revision,count,referenced,shared,reclaimable_bytes});
  function preserve(notes,media){
    const date=new Date().toISOString();
    for(const {note,refs} of notes){
      const replacements=new Map(),imageIds=[...new Set(localMediaReferences(note.content).map(r=>r.id))];
      for(const ref of refs){
        if(replacements.has(ref.id))continue;
        const source=media.get(ref.id),own=source.group_key==='note:'+note.id;
        const alias={...source,id:randomUUID(),collection_id:note.collection_id,deleted_at:null,version:1,created_at:date,updated_at:date,
          group_key:source.kind==='image'?'note:'+note.id:null,group_title:source.kind==='image'?(note.title+' · 配图').slice(0,200):null,
          group_index:own?source.group_index:imageIds.indexOf(ref.id),group_order:own?source.group_order:imageIds.indexOf(ref.id)};
        const columns=Object.keys(alias);db.prepare('INSERT INTO items('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(c=>alias[c]));
        event('item.created',alias.id);replacements.set(ref.id,alias.id);
      }
      const content=replaceLocalMedia(note.content,refs,replacements);
      db.prepare('UPDATE items SET content=?,version=version+1,updated_at=? WHERE id=?').run(content,date,note.id);event('item.updated',note.id);
    }
  }
  // Called inside the caller's transaction on trash, startup and backup restoration.
  function repairReferences(){
    const media=new Map(db.prepare('SELECT * FROM items WHERE file_key IS NOT NULL AND deleted_at IS NOT NULL').all().map(r=>[r.id,r]));
    if(!media.size)return;
    const notes=db.prepare("SELECT * FROM items WHERE kind='note' AND content LIKE '%/media/%'").all().map(note=>({note,refs:localMediaReferences(note.content).filter(r=>media.has(r.id))})).filter(n=>n.refs.length);
    preserve(notes,media);
  }
  async function cleanup(){
    let freed_bytes=0,freed_files=0;
    const root=resolve(dataDir,'media');
    for(const row of db.prepare('SELECT * FROM pending_file_deletions').all()){
      if(db.prepare('SELECT 1 FROM items WHERE file_key=? OR thumbnail_key=?').get(row.file_key,row.file_key)){db.prepare('DELETE FROM pending_file_deletions WHERE file_key=?').run(row.file_key);continue}
      const path=resolve(root,row.file_key);
      if(dirname(path)!==root||! /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(row.file_key)||row.file_key.includes('..'))continue;
      try{const bytes=(await lstat(path)).size;await unlinkFile(path);freed_bytes+=bytes;freed_files++}catch(e){if(e.code!=='ENOENT')continue}
      db.prepare('DELETE FROM pending_file_deletions WHERE file_key=?').run(row.file_key);
    }
    return {freed_bytes,freed_files,pending_files:db.prepare('SELECT count(*) n FROM pending_file_deletions').get().n};
  }
  app.post('/api/trash/preview',(req,res)=>res.json(publicState(snapshot(selection.parse(req.body)))));
  app.post('/api/trash/purge',async(req,res)=>{
    const input=selection.extend({revision:z.string().length(64),confirm:z.literal('DELETE')}).parse(req.body);
    const result=await maintenance.exclusive(res,async()=>{
      const state=snapshot(input);if(state.revision!==input.revision)throw fail(409,'回收站或笔记引用已变化，请重新确认后删除');
      const date=new Date().toISOString();
      transaction(()=>{
        preserve(state.notes,state.media);
        for(const item of state.targets){
          if(item.kind==='note')for(const page of db.prepare('SELECT id FROM items WHERE group_key=?').all('note:'+item.id)){db.prepare('UPDATE items SET group_key=?,version=version+1,updated_at=? WHERE id=?').run('album:'+item.id,date,page.id);event('item.updated',page.id)}
          for(const key of [item.file_key,item.thumbnail_key].filter(Boolean))db.prepare('INSERT OR IGNORE INTO pending_file_deletions(file_key) VALUES(?)').run(key);
          db.prepare('DELETE FROM items WHERE id=?').run(item.id);event('item.deleted',item.id);
        }
      });clearCache();
      return {...publicState(state),...(await cleanup())};
    },'正在永久删除内容，请稍后重试');res.json(result);
  });
  const retry=()=>{if(stopped||maintenance.locked||!db.prepare('SELECT 1 FROM pending_file_deletions LIMIT 1').get())return;pending=maintenance.exclusive(undefined,cleanup,'正在释放已删除文件，请稍后重试').catch(()=>{});return pending};
  return {cleanup,retry,repairReferences,start(){stopped=false;retry();timer=setInterval(retry,60000);timer.unref()},async stop(){stopped=true;clearInterval(timer);await pending}};
}
