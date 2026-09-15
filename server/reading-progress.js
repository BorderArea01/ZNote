import { createHash } from 'node:crypto';
import { z } from 'zod';
const fail = (status,message) => Object.assign(Error(message),{status});
export const readingEntries = z.array(z.object({item_id:z.uuid(),group_key:z.string().max(200).nullable(),viewed_at:z.string().datetime()}).strict()).max(20);
const writeInput = z.object({collection_id:z.uuid().nullable(),version:z.number().int().nonnegative(),epoch:z.string().max(100),request_id:z.uuid(),item_id:z.uuid().optional()}).strict();

export function registerReadingProgress({app,db,transaction}) {
  const epoch = () => db.prepare("SELECT value FROM settings WHERE key='reading_epoch'").get().value;
  function scope(library) {
    if (library && !db.prepare('SELECT id FROM collections WHERE id=?').get(library)) throw fail(404,'知识库不存在');
    return library || 'unfiled';
  }
  const stored = key => db.prepare('SELECT * FROM reading_progress WHERE scope=?').get(key);
  const item = id => db.prepare('SELECT id,kind,title,group_key,group_title,group_index,group_order,collection_id,deleted_at FROM items WHERE id=?').get(id);
  function valid(entries,library) {
    return entries.flatMap(entry => {
      const row=item(entry.item_id);
      return row?.kind==='image' && !row.deleted_at && row.collection_id===library && row.group_key===entry.group_key ? [{entry,row}] : [];
    });
  }
  function result(library) {
    const state=stored(scope(library));
    return {collection_id:library,version:state?.version||0,epoch:epoch(),entries:valid(state?readingEntries.parse(JSON.parse(state.entries)):[],library).map(({entry,row})=>{
      const order=row.group_order ?? row.group_index;
      const count=row.group_key ? db.prepare("SELECT count(*) total,COALESCE(sum((COALESCE(group_order,group_index),group_index,id)<(?,?,?)),0)+1 position FROM items WHERE kind='image' AND deleted_at IS NULL AND collection_id IS ? AND group_key=?").get(order,row.group_index,row.id,library,row.group_key) : {total:1,position:1};
      return {...entry,collection_id:row.collection_id,title:row.group_title||row.title,item_title:row.title,...count,thumbnail_url:`/media/${row.id}/thumbnail`};
    })};
  }
  app.get('/api/reading-progress',(req,res)=>{
    const key=z.union([z.uuid(),z.literal('unfiled')]).default('unfiled').parse(req.query.collection);
    res.json(result(key==='unfiled'?null:key));
  });
  for(const method of ['post','delete']) app[method]('/api/reading-progress',(req,res)=>{
    const input=writeInput.parse(req.body);
    if(method==='post'&&!input.item_id)throw fail(400,'请选择要记录的图片');
    if(method==='delete'&&input.item_id)throw fail(400,'清除记录不接受图片参数');
    res.json(transaction(()=>{
      const key=scope(input.collection_id),old=stored(key);
      if(input.epoch!==epoch())throw fail(409,'数据已恢复，请重新读取浏览记录');
      const hash=createHash('sha256').update(JSON.stringify([method,input])).digest('hex');
      if(old?.request_id===input.request_id){if(old.request_hash!==hash)throw fail(409,'请求标识已使用');return {...result(input.collection_id),replayed:true};}
      if(input.version!==(old?.version||0))throw fail(409,'浏览位置已在其他页面更新，请重新读取后决定是否同步本页位置');
      let entries=[];
      if(method==='post'){
        const row=item(input.item_id);
        if(!row||row.kind!=='image'||row.deleted_at||row.collection_id!==input.collection_id)throw fail(409,'图片已移动、删除或不属于当前知识库，未更新浏览记录');
        const previous=valid(old?readingEntries.parse(JSON.parse(old.entries)):[],input.collection_id).map(({entry})=>entry);
        entries=[{item_id:row.id,group_key:row.group_key,viewed_at:new Date().toISOString()},...previous.filter(e=>row.group_key ? e.group_key!==row.group_key : e.item_id!==row.id)].slice(0,20);
      }
      db.prepare('INSERT INTO reading_progress VALUES(?,?,?,?,?,?) ON CONFLICT(scope) DO UPDATE SET version=excluded.version,entries=excluded.entries,request_id=excluded.request_id,request_hash=excluded.request_hash').run(key,input.collection_id,input.version+1,JSON.stringify(entries),input.request_id,hash);
      return result(input.collection_id);
    }));
  });
}
