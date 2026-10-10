import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const fail = (status, message) => Object.assign(new Error(message), { status });
const name = z.string().trim().min(1).max(80);
const references = z.array(z.object({id:z.uuid(),version:z.number().int().positive(),group:z.boolean().optional()})).min(1).max(10000);
const groupSnapshot = z.object({key:z.string(),kind:z.enum(['image','video']),collection_id:z.string().nullable(),ids:z.array(z.uuid()).max(10000)});
export const albumSchema = z.object({id:z.uuid(),name,collection_id:z.uuid().nullable(),version:z.number().int().positive(),created_at:z.string(),updated_at:z.string()});
const cardIdentity = "CASE WHEN kind IN ('image','video') AND NULLIF(group_key,'') IS NOT NULL THEN kind||':group:'||group_key ELSE 'item:'||id END";

export function registerAlbums({app,db,transaction,event,undo,serialize=row=>({id:row.id,version:row.version})}) {
  const getItem = db.prepare('SELECT id,version,kind,group_key,collection_id,favorite,deleted_at FROM items WHERE id=?');
  const summaryColumns=db.prepare('PRAGMA table_info(items)').all().map(({name})=>name==='content'?"CASE WHEN kind='note' THEN substr(content,1,1000) ELSE '' END AS content":name).join(',');
  const summaryItem=db.prepare(`SELECT ${summaryColumns},length(content) AS content_length FROM items WHERE id=?`);
  function scope(value) {
    const id=z.union([z.literal('unfiled'),z.uuid()]).default('unfiled').parse(value);
    if(id!=='unfiled'&&!db.prepare('SELECT 1 FROM collections WHERE id=?').get(id))throw fail(404,'知识库不存在');
    return id==='unfiled'?null:id;
  }
  function get(id) {
    const row=db.prepare('SELECT * FROM albums WHERE id=?').get(z.uuid().parse(id));
    if(!row)throw fail(404,'相册已删除，请重新选择收藏目标');
    return row;
  }
  function unique(library,title,id='') {
    if(db.prepare('SELECT 1 FROM albums WHERE collection_id IS ? AND name=? AND id!=?').get(library,title,id))throw fail(409,'当前知识库已有同名相册');
  }
  function list(library) {
    return db.prepare(`SELECT a.*, (SELECT count(*) FROM (SELECT 1 FROM items WHERE deleted_at IS NULL AND collection_id IS a.collection_id AND id IN (SELECT item_id FROM album_items WHERE album_id=a.id) GROUP BY ${cardIdentity})) card_count FROM albums a WHERE collection_id IS ? ORDER BY name COLLATE NOCASE,id`).all(library);
  }
  function members(group) {
    return db.prepare('SELECT id,version,kind,group_key,collection_id,favorite,deleted_at FROM items WHERE kind=? AND group_key=? AND collection_id IS ? AND deleted_at IS NULL ORDER BY id').all(group.kind,group.key,group.collection_id);
  }
  function resolve(input,library,expand) {
    const rows=new Map(),groups=new Map();
    for(const ref of input) {
      const row=getItem.get(ref.id);
      if(!row||row.deleted_at||row.collection_id!==library)throw fail(409,'内容已移动或删除，请重新选择');
      if(!expand&&row.version!==ref.version)throw fail(409,'内容已修改，请重新加载收藏目标');
      if(expand&&ref.group&&row.group_key&&['image','video'].includes(row.kind)) {
        const group={key:row.group_key,kind:row.kind,collection_id:library};
        const values=members(group);group.ids=values.map(value=>value.id);
        groups.set(JSON.stringify([row.kind,row.group_key]),group);
        for(const value of values)rows.set(value.id,value);
      } else rows.set(row.id,row);
      if(rows.size>10000)throw fail(413,'本次选择超过 10000 项，请分批收藏');
    }
    return {items:[...rows.values()],groups:[...groups.values()]};
  }
  app.get('/api/albums',(req,res)=>res.json({albums:list(scope(req.query.collection))}));
  app.post('/api/albums',(req,res)=>{
    const input=z.object({name,collection_id:z.uuid().nullable()}).strict().parse(req.body);
    const row=transaction(()=>{
      scope(input.collection_id||'unfiled');unique(input.collection_id,input.name);
      const id=randomUUID(),time=new Date().toISOString();
      db.prepare('INSERT INTO albums(id,name,collection_id,version,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(id,input.name,input.collection_id,time,time);
      event('album.created',null);return get(id);
    });res.status(201).json(row);
  });
  app.patch('/api/albums/:id',(req,res)=>{
    const input=z.object({name,version:z.number().int().positive()}).strict().parse(req.body);
    res.json(transaction(()=>{
      const old=get(req.params.id);if(old.version!==input.version)throw fail(409,'相册已被修改，请重新加载');
      unique(old.collection_id,input.name,old.id);
      db.prepare('UPDATE albums SET name=?,version=version+1,updated_at=? WHERE id=?').run(input.name,new Date().toISOString(),old.id);
      event('album.updated',null);return get(old.id);
    }));
  });
  app.delete('/api/albums/:id',(req,res)=>{
    const input=z.object({version:z.number().int().positive()}).strict().parse(req.body);
    transaction(()=>{const old=get(req.params.id);if(old.version!==input.version)throw fail(409,'相册已被修改，请重新加载');db.prepare('DELETE FROM albums WHERE id=?').run(old.id);db.prepare("UPDATE saved_views SET config=json_remove(config,'$.album_id'),version=version+1,updated_at=? WHERE collection_id IS ? AND json_extract(config,'$.album_id')=?").run(new Date().toISOString(),old.collection_id,old.id);event('album.deleted',null);});
    res.status(204).end();
  });
  app.post('/api/favorite-targets/preview',(req,res)=>{
    const input=z.object({items:references,collection_id:z.uuid().nullable()}).strict().parse(req.body);
    const result=transaction(()=>{
      const library=scope(input.collection_id||'unfiled'),snapshot=resolve(input.items,library,true),ids=new Set(snapshot.items.map(row=>row.id));
      const counts=new Map();
      for(const entry of db.prepare('SELECT ai.album_id,ai.item_id FROM album_items ai JOIN albums a ON a.id=ai.album_id WHERE a.collection_id IS ?').iterate(library))if(ids.has(entry.item_id))counts.set(entry.album_id,(counts.get(entry.album_id)||0)+1);
      return {...snapshot,favorite_count:snapshot.items.filter(row=>row.favorite).length,albums:list(library).map(row=>({...row,selected_count:counts.get(row.id)||0}))};
    });res.json(result);
  });
  app.post('/api/favorite-targets',(req,res)=>{
    const input=z.object({items:references,collection_id:z.uuid().nullable(),groups:z.array(groupSnapshot).max(10000).default([]),favorite:z.boolean().optional(),add:z.array(z.uuid()).default([]),remove:z.array(z.uuid()).default([]),undo:z.boolean().optional()}).strict().parse(req.body);
    const mutate=()=>{
      const library=scope(input.collection_id||'unfiled'),snapshot=resolve(input.items,library,false),ids=new Set(snapshot.items.map(row=>row.id));
      for(const group of input.groups) {
        if(group.collection_id!==library||group.ids.some(id=>!ids.has(id))||JSON.stringify(members(group).map(row=>row.id))!==JSON.stringify([...group.ids].sort()))throw fail(409,'组内成员已变化，请重新加载收藏目标');
      }
      const add=[...new Set(input.add)],remove=[...new Set(input.remove)];
      if(add.some(id=>remove.includes(id)))throw fail(400,'同一相册不能同时添加和移出');
      for(const id of [...add,...remove])if(get(id).collection_id!==library)throw fail(409,'相册属于其他知识库');
      const insert=db.prepare('INSERT OR IGNORE INTO album_items(album_id,item_id) VALUES(?,?)'),erase=db.prepare('DELETE FROM album_items WHERE album_id=? AND item_id=?');
      let changed=0;
      for(const row of snapshot.items) {
        let dirty=false;
        for(const id of add)if(insert.run(id,row.id).changes)dirty=true;
        for(const id of remove)if(erase.run(id,row.id).changes)dirty=true;
        const favorite=input.favorite===undefined?row.favorite:+input.favorite;
        if(dirty||favorite!==row.favorite){db.prepare('UPDATE items SET favorite=?,version=version+1 WHERE id=?').run(favorite,row.id);event('item.updated',row.id);changed++;}
      }
      return {count:snapshot.items.length,changed_count:changed,items:snapshot.items.map(row=>({...serialize(summaryItem.get(row.id)),summary:true}))};
    };
    const response=undo&&!input.add.length&&!input.remove.length?undo.run(req,'收藏',mutate):{result:transaction(mutate),undo:null};
    res.json({...response.result,undo:response.undo});
  });
}
