import {createHash} from 'node:crypto';
import {z} from 'zod';
const fail=(status,message)=>Object.assign(Error(message),{status});
const seconds=z.number().min(0).max(31536000);
export const videoEntries=z.array(z.object({item_id:z.uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/),position:seconds,duration:seconds.positive(),completed:z.boolean(),viewed_at:z.string().datetime()}).strict().refine(e=>e.position<=e.duration)).max(20);
const inputSchema=z.object({collection_id:z.uuid().nullable(),version:z.number().int().nonnegative(),epoch:z.string().max(100),request_id:z.uuid(),item_id:z.uuid().optional(),position:seconds.optional(),duration:seconds.positive().optional(),completed:z.boolean().optional()}).strict();
export function registerVideoProgress({app,db,transaction}) {
  const epoch=()=>db.prepare("SELECT value FROM settings WHERE key='reading_epoch'").get().value;
  const scope=library=>{if(library&&!db.prepare('SELECT id FROM collections WHERE id=?').get(library))throw fail(404,'知识库不存在');return library||'unfiled';};
  const stored=key=>db.prepare('SELECT * FROM video_progress WHERE scope=?').get(key);
  const item=id=>db.prepare('SELECT id,kind,title,hash,duration,collection_id,deleted_at FROM items WHERE id=?').get(id);
  const valid=(entries,library)=>entries.flatMap(entry=>{const row=item(entry.item_id);return row?.kind==='video'&&!row.deleted_at&&row.collection_id===library&&row.hash===entry.hash?[{entry,row}]:[];});
  const result=library=>{const old=stored(scope(library));return{collection_id:library,version:old?.version||0,epoch:epoch(),entries:valid(old?videoEntries.parse(JSON.parse(old.entries)):[],library).map(({entry:{hash,...entry},row})=>({...entry,collection_id:row.collection_id,title:row.title,thumbnail_url:`/media/${row.id}/thumbnail`}))};};
  app.get('/api/video-progress',(req,res)=>{const key=z.union([z.uuid(),z.literal('unfiled')]).default('unfiled').parse(req.query.collection);res.json(result(key==='unfiled'?null:key));});
  for(const method of ['post','delete'])app[method]('/api/video-progress',(req,res)=>{
    const input=inputSchema.parse(req.body);
    if(method==='post'&&(!input.item_id||input.position===undefined||input.duration===undefined||input.completed===undefined))throw fail(400,'播放位置、时长与完成状态不完整');
    if(method==='delete'&&['item_id','position','duration','completed'].some(k=>input[k]!==undefined))throw fail(400,'清除播放记录不接受视频参数');
    res.json(transaction(()=>{
      const key=scope(input.collection_id),old=stored(key);
      if(input.epoch!==epoch())throw fail(409,'数据已恢复，请重新读取播放记录');
      const requestHash=createHash('sha256').update(JSON.stringify([method,input])).digest('hex');
      if(old?.request_id===input.request_id){if(old.request_hash!==requestHash)throw fail(409,'请求标识已使用');return{...result(input.collection_id),replayed:true};}
      if(input.version!==(old?.version||0))throw fail(409,'播放位置已在其他页面更新，请选择是否同步本页位置');
      let entries=[];
      if(method==='post'){
        const row=item(input.item_id);
        if(!row||row.kind!=='video'||row.deleted_at||row.collection_id!==input.collection_id)throw fail(409,'视频已移动、删除或不属于当前知识库');
        const duration=Number.isFinite(row.duration)&&row.duration>0?row.duration:input.duration;
        if(input.position>duration+2)throw fail(400,'播放位置超出视频时长');
        const position=Math.round(Math.min(input.position,duration)*1000)/1000;
        const entry={item_id:row.id,hash:row.hash,position:Math.min(position,duration),duration,completed:input.completed&&position>=duration-0.25,viewed_at:new Date().toISOString()};
        const previous=valid(old?videoEntries.parse(JSON.parse(old.entries)):[],input.collection_id).map(v=>v.entry);
        entries=videoEntries.parse([entry,...previous.filter(e=>e.item_id!==row.id)].slice(0,20));
      }
      db.prepare('INSERT INTO video_progress VALUES(?,?,?,?,?,?) ON CONFLICT(scope) DO UPDATE SET version=excluded.version,entries=excluded.entries,request_id=excluded.request_id,request_hash=excluded.request_hash').run(key,input.collection_id,input.version+1,JSON.stringify(entries),input.request_id,requestHash);
      return result(input.collection_id);
    }));
  });
}
