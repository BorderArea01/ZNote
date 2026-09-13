import {createHash} from 'node:crypto';
import {z} from 'zod';
import {reorderLocalImages} from '../shared/markdown-images.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function registerGroupOrderRoutes({app,db,transaction,getItem,serialize,event,groupNoteImages}) {
  app.get('/api/item-groups/selection',(req,res)=>{
    const anchor=getItem(z.string().min(1).parse(req.query.id));
    const key=anchor.kind==='note'?'note:'+anchor.id:anchor.group_key;
    if(!key)throw fail(400,'这张图片不属于图片组');
    const rows=db.prepare("SELECT id,version FROM items WHERE kind='image' AND group_key=? AND collection_id IS ? AND (deleted_at IS NOT NULL)=? ORDER BY COALESCE(group_order,group_index),group_index,id LIMIT 10001").all(key,anchor.collection_id,+Boolean(anchor.deleted_at));
    if(rows.length>10000)throw fail(400,'单次最多选择 10000 张图片，请分组整理');
    if(!rows.length)throw fail(404,'图片组已没有可选成员');
    res.json({items:rows.map(row=>({...row,kind:'image'})),collection_id:anchor.collection_id,group_key:key,trash:Boolean(anchor.deleted_at)});
  });
  function snapshot(id) {
    const anchor=getItem(id);if(anchor.deleted_at)throw fail(409,'请先恢复内容');
    const key=anchor.kind==='note'?'note:'+anchor.id:anchor.group_key;
    if(!key)throw fail(400,'这张图片不属于图片组');
    const rows=db.prepare("SELECT * FROM items WHERE kind='image' AND group_key=? AND collection_id IS ? AND deleted_at IS NULL ORDER BY COALESCE(group_order,group_index),group_index,id").all(key,anchor.collection_id);
    if(!rows.length)throw fail(404,'图片组不存在');
    const note=key.startsWith('note:')?db.prepare("SELECT * FROM items WHERE id=? AND kind='note' AND deleted_at IS NULL AND collection_id IS ?").get(key.slice(5),anchor.collection_id):null;
    const revision=createHash('sha256').update(JSON.stringify([key,anchor.collection_id,note?.version,rows.map(r=>[r.id,r.version,r.group_order,r.group_index])])).digest('hex');
    return {anchor,rows,note,revision};
  }
  const publicState=state=>({revision:state.revision,note_id:state.note?.id||null,items:state.rows.map(r=>({id:r.id,title:r.title,thumbnail_url:`/media/${r.id}/thumbnail`,version:r.version})),cover_id:state.rows[0].id});
  app.get('/api/item-groups/order',(req,res)=>res.json(publicState(snapshot(z.string().min(1).parse(req.query.id)))));
  app.post('/api/item-groups/order',(req,res)=>{
    const input=z.object({id:z.string(),revision:z.string().length(64),ids:z.array(z.string()).min(1).max(10000),sync_note:z.boolean().default(true)}).parse(req.body);
    const result=transaction(()=>{
      const state=snapshot(input.id),ids=new Set(input.ids);
      if(input.revision!==state.revision||ids.size!==input.ids.length||ids.size!==state.rows.length||state.rows.some(r=>!ids.has(r.id)))throw fail(409,'图片组已被修改，请重新打开排序后重试');
      if(state.rows.every((row,index)=>row.id===input.ids[index]))return {...publicState(state),item:serialize(state.anchor)};
      let content;
      if(state.note&&input.sync_note){try{content=reorderLocalImages(state.note.content,input.ids);}catch(e){throw fail(409,e.message);}}
      const date=new Date().toISOString();
      for(let index=0;index<input.ids.length;index++){db.prepare('UPDATE items SET group_order=?,version=version+1,updated_at=? WHERE id=?').run(index,date,input.ids[index]);event('item.updated',input.ids[index]);}
      if(content!==undefined){
        const grouped=groupNoteImages({...serialize(state.note),content},state.note.id);
        db.prepare('UPDATE items SET content=?,version=version+1,updated_at=? WHERE id=?').run(grouped.content,date,state.note.id);event('item.updated',state.note.id);
      }
      return {...publicState(snapshot(input.id)),item:serialize(getItem(input.id))};
    });res.json(result);
  });
}
