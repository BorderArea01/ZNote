import {createHash} from 'node:crypto';
import {z} from 'zod';
import {reorderLocalImages} from '../shared/markdown-images.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function registerGroupOrderRoutes({app,db,undo,getItem,serialize,event,groupNoteImages}) {
  const mediaKind = z.enum(['image','video']);
  const collectionValue = z.union([z.uuid(), z.literal('unfiled'), z.null()]).transform(value => value === 'unfiled' || value === null ? null : value);
  const groupKey = z.string().min(1).max(200);
  const readScope = value => value === undefined ? undefined : collectionValue.parse(value);
  const firstMember = (kind,key,collection,includeTrash=false) => db.prepare(
    `SELECT * FROM items WHERE kind=? AND group_key=? AND collection_id IS ? AND (deleted_at IS NOT NULL)=? ORDER BY COALESCE(group_order,group_index),group_index,id LIMIT 1`,
  ).get(kind,key,collection,+includeTrash);

  app.get('/api/item-groups/selection',(req,res)=>{
    const anchor=getItem(z.string().min(1).parse(req.query.id));
    const key=anchor.kind==='note'?'note:'+anchor.id:anchor.group_key;
    if(!key)throw fail(400,'这项内容不属于媒体组');
    const rows=db.prepare("SELECT id,version,favorite,kind FROM items WHERE kind IN ('image','video') AND group_key=? AND collection_id IS ? AND (deleted_at IS NOT NULL)=? ORDER BY COALESCE(group_order,group_index),group_index,id LIMIT 10001").all(key,anchor.collection_id,+Boolean(anchor.deleted_at));
    if(rows.length>10000)throw fail(400,'单次最多选择 10000 张图片，请分组整理');
    if(!rows.length)throw fail(404,'图片组已没有可选成员');
    res.json({items:rows.map(row=>({...row,favorite:Boolean(row.favorite)})),collection_id:anchor.collection_id,group_key:key,trash:Boolean(anchor.deleted_at)});
  });
  function snapshot(id, overrides = {}) {
    // A folded card normally supplies a member id. Older cards and a group
    // whose cover was moved can still carry a valid group key while that id
    // no longer resolves to an active member. Resolve by the stable group
    // identity as a second path so previews and ordering share one source.
    const requestedId = id || null;
    let anchor = null;
    if(requestedId) {
      try { anchor = getItem(requestedId); }
      catch(error) { if(!overrides.group_key) throw error; }
    }
    const requestedKind = overrides.kind ? mediaKind.parse(overrides.kind) : undefined;
    const requestedCollection = overrides.collection_id !== undefined ? readScope(overrides.collection_id) : undefined;
    const requestedKey = overrides.group_key ? groupKey.parse(overrides.group_key) : undefined;
    // A folded card may have been rendered before a move/re-group operation,
    // so its key or collection can be stale even though its member id is still
    // valid. Prefer the member's current identity first; use the supplied
    // group identity only when the id cannot be resolved or has no group.
    const anchorKind = anchor?.kind === 'note' ? 'image' : anchor?.kind;
    const anchorKey = anchor?.kind === 'note' ? 'note:'+anchor.id : anchor?.group_key;
    const anchorCollection = anchor?.collection_id ?? null;
    const candidates = [];
    if (anchorKey && ['image','video'].includes(anchorKind)) candidates.push({kind:anchorKind,key:anchorKey,collection:anchorCollection});
    if (requestedKey) candidates.push({kind:requestedKind || anchorKind,key:requestedKey,collection:requestedCollection !== undefined ? requestedCollection : anchorCollection});
    const candidate = candidates.find(value => ['image','video'].includes(value.kind) && value.key);
    if(!candidate)throw fail(400,anchor ? '这项内容不属于媒体组' : '请提供有效的媒体组标识');
    let kind = candidate.kind;
    let collection = candidate.collection;
    let key = candidate.key;
    if(!['image','video'].includes(kind))throw fail(400,'这项内容不支持组内排序');
    if(anchor?.deleted_at && !overrides.group_key)throw fail(409,'请先恢复内容');
    let rows=db.prepare("SELECT * FROM items WHERE kind=? AND group_key=? AND collection_id IS ? AND deleted_at IS NULL ORDER BY COALESCE(group_order,group_index),group_index,id").all(kind,key,collection);
    if(!rows.length && requestedKey && candidate !== candidates[candidates.length - 1]) {
      const fallback = candidates[candidates.length - 1];
      const fallbackRows = db.prepare("SELECT * FROM items WHERE kind=? AND group_key=? AND collection_id IS ? AND deleted_at IS NULL ORDER BY COALESCE(group_order,group_index),group_index,id").all(fallback.kind,fallback.key,fallback.collection);
      if(fallbackRows.length) { kind=fallback.kind; key=fallback.key; collection=fallback.collection; rows=fallbackRows; }
    }
    if(!rows.length)throw fail(404,kind==='video'?'视频组不存在':'图片组不存在');
    // If an id was stale, use the resolved member for the rest of the state;
    // this keeps undo and the returned detail item inside the same group.
    if(!anchor || anchor.kind === 'note' || anchor.group_key !== key || anchor.collection_id !== collection || anchor.deleted_at) anchor = firstMember(kind,key,collection);
    const note=key.startsWith('note:')?db.prepare("SELECT * FROM items WHERE id=? AND kind='note' AND deleted_at IS NULL AND collection_id IS ?").get(key.slice(5),anchor.collection_id):null;
    const revision=createHash('sha256').update(JSON.stringify([key,anchor.collection_id,note?.version,rows.map(r=>[r.id,r.version,r.group_order,r.group_index])])).digest('hex');
    return {anchor,rows,note,kind,revision};
  }
  const publicState=state=>({revision:state.revision,kind:state.kind,note_id:state.note?.id||null,collection_id:state.anchor.collection_id,group_key:state.rows[0].group_key,items:state.rows.map(r=>({id:r.id,kind:r.kind,title:r.title,thumbnail_url:`/media/${r.id}/thumbnail`,version:r.version})),cover_id:state.rows[0].id});
  app.get('/api/item-groups/order',(req,res)=>{
    const query = z.object({id:z.string().min(1).optional(),kind:mediaKind.optional(),collection:z.string().optional(),group_key:groupKey.optional()}).parse(req.query);
    if(!query.id&&!query.group_key)throw fail(400,'请提供媒体组成员或组标识');
    res.json(publicState(snapshot(query.id,{kind:query.kind,collection_id:query.collection,group_key:query.group_key})));
  });
  app.post('/api/item-groups/order',(req,res)=>{
    const input=z.object({id:z.string(),kind:mediaKind.optional(),collection_id:z.union([z.uuid(),z.literal('unfiled')]).nullable().optional(),group_key:groupKey.optional(),revision:z.string().length(64),ids:z.array(z.string()).min(1).max(10000),sync_note:z.boolean().default(true)}).parse(req.body);
    const {result,undo:receipt}=undo.run(req,'整组排序',()=>{
      const state=snapshot(input.id,input),ids=new Set(input.ids);
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
    },{guardGroups:true,guardOrder:true});res.json({...result,undo:receipt});
  });
}
