import {Worker} from 'node:worker_threads';
import {copyFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import multer from 'multer';
import {fileDigest} from './videos.js';
export const MAX_BGM_BYTES=50*1024*1024;
const fail=(status,message)=>Object.assign(Error(message),{status});
export const bgmSchema=z.object({file_key:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/).refine(v=>!v.includes('..')),hash:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().min(1).max(MAX_BGM_BYTES),mime:z.enum(['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/webm']),duration:z.number().positive().finite(),title:z.string().min(1).max(200),author:z.string().max(200),source_url:z.url().max(4096).refine(v=>/^https?:\/\//i.test(v)&&!new URL(v).username&&!new URL(v).password).nullable()});
export const itemBgm=item=>item?.bgm?bgmSchema.parse(typeof item.bgm==='string'?JSON.parse(item.bgm):item.bgm):null;
export function publicBgm(item){const bgm=itemBgm(item);return bgm?{...bgm,file_key:undefined,url:`/media/${item.id}/bgm`}:null;}
export function bgmFiles(db){
  if(!db.prepare('PRAGMA table_info(items)').all().some(c=>c.name==='bgm'))return [];
  return db.prepare('SELECT DISTINCT bgm FROM items WHERE bgm IS NOT NULL').all().map(itemBgm);
}
export function mediaKeys(db){return [...new Set([...db.prepare('SELECT file_key FROM items WHERE file_key IS NOT NULL').all().map(r=>r.file_key),...bgmFiles(db).map(r=>r.file_key)])];}
export function probeAudio(path){return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./audio-probe-worker.js',import.meta.url),{workerData:{path},resourceLimits:{maxOldGenerationSizeMb:128}});let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(fail(415,'配乐分析超时，请检查音频是否完整')),20000);
  worker.once('message',v=>finish(v.error?fail(415,'无法识别配乐，请使用包含完整音频的 MP3、M4A、AAC、OGG、WAV 或 WebM 文件'):null,v));
  worker.once('error',()=>finish(fail(415,'配乐分析失败，请重试')));worker.once('exit',()=>{if(!settled)finish(fail(415,'配乐分析未完成'));});
});}
export function createBgmManager({app,db,dataDir,transaction,event,getItem,serialize,maintenance,queue}){
  const targets=anchor=>anchor.group_key?db.prepare('SELECT * FROM items WHERE group_key=? AND collection_id IS ? AND deleted_at IS NULL ORDER BY id').all(anchor.group_key,anchor.collection_id):[anchor];
  const check=anchor=>{if(anchor.deleted_at||!['image','video','note'].includes(anchor.kind))throw fail(409,'不能修改已删除内容的配乐');};
  const fingerprint=rows=>JSON.stringify(rows.map(r=>[r.id,r.version,r.collection_id,r.group_key,r.bgm]));
  const queueUnused=track=>{if(track&&!db.prepare("SELECT 1 FROM items WHERE json_extract(bgm,'$.file_key')=?").get(track.file_key))db.prepare('INSERT OR IGNORE INTO pending_file_deletions(file_key) VALUES(?)').run(track.file_key);};
  function attach(rows,track){
    const previous=[...new Map(rows.map(itemBgm).filter(Boolean).map(old=>[old.file_key,old])).values()],value=track?JSON.stringify(bgmSchema.parse(track)):null,date=new Date().toISOString();
    transaction(()=>{for(const row of rows)if(row.bgm!==value){db.prepare('UPDATE items SET bgm=?,version=version+1,updated_at=? WHERE id=?').run(value,date,row.id);event('item.updated',row.id);}for(const old of previous)queueUnused(old);});
    return rows.map(row=>serialize(getItem(row.id)));
  }
  async function store(file,metadata){
    const digest=await fileDigest(file.path);if(digest.bytes<1||digest.bytes>MAX_BGM_BYTES)throw fail(413,'配乐文件不能超过 50 MB');
    const info=await probeAudio(file.path),key='bgm-'+digest.hash+'.'+info.extension;
    const track=bgmSchema.parse({file_key:key,...digest,mime:info.mime,duration:info.duration,title:String(metadata.title||'作品配乐').trim().slice(0,200)||'作品配乐',author:String(metadata.author||'').slice(0,200),source_url:metadata.source_url||null});
    try{await copyFile(file.path,join(dataDir,'media',key),1);}catch(e){if(e.code!=='EEXIST')throw e;const existing=await fileDigest(join(dataDir,'media',key));if(existing.hash!==digest.hash)throw fail(409,'已有配乐文件校验失败，未覆盖');}
    return track;
  }
  async function saveCapture(file,metadata,ids,collection){
    return queue.run('capture-bgm:'+ids[0],async()=>{
      const rows=ids.map(getItem);if(rows.some(r=>r.deleted_at||r.collection_id!==collection))throw fail(409,'作品归属已改变，未附加配乐');
      if(rows.filter(r=>r.kind!=='note').some(r=>r.group_key!==rows.find(r=>r.kind!=='note')?.group_key))throw fail(409,'作品已重新分组，未附加配乐');
      if(rows.every(r=>r.bgm&&r.bgm===rows[0].bgm))return rows.map(serialize);
      if(rows.some(r=>r.bgm))throw fail(409,'作品已有其他配乐，未覆盖，请在预览中调整');
      const before=fingerprint(rows),track=await store(file,metadata);
      try{if(fingerprint(ids.map(getItem))!==before)throw fail(409,'作品已变化，未附加配乐，请重试');return attach(rows,track);}
      catch(e){queueUnused(track);throw e;}
    });
  }
  const upload=multer({dest:join(dataDir,'uploads'),limits:{fileSize:MAX_BGM_BYTES,files:1,fields:3,fieldSize:1000}});
  app.post('/api/items/:id/bgm',upload.single('file'),async(req,res)=>{
    try{
      if(!req.file)throw fail(400,'请选择配乐文件');
      const version=z.coerce.number().int().positive().parse(req.body.version);
      const result=await maintenance.work(()=>queue.run('upload-bgm:'+req.params.id,async()=>{
        const anchor=getItem(req.params.id);check(anchor);if(anchor.version!==version)throw fail(409,'内容已变化，请重新打开后再设置配乐');
        const rows=targets(anchor),before=fingerprint(rows),track=await store(req.file,{title:req.body.title||req.file.originalname,author:req.body.author||'',source_url:anchor.source_url});
        try{if(fingerprint(targets(getItem(anchor.id)))!==before)throw fail(409,'组成员已变化，未修改配乐，请重新打开后重试');return attach(rows,track);}
        catch(e){queueUnused(track);throw e;}
      }));res.json({item:result.find(r=>r.id===req.params.id),items:result});
    }finally{if(req.file)await unlink(req.file.path).catch(()=>{});}
  });
  app.delete('/api/items/:id/bgm',(req,res)=>{
    const anchor=getItem(req.params.id);check(anchor);if(anchor.version!==z.number().int().positive().parse(req.body.version))throw fail(409,'内容已变化，请重新打开后重试');
    const items=attach(targets(anchor),null);res.json({item:items.find(r=>r.id===anchor.id),items});
  });
  return {saveCapture};
}
