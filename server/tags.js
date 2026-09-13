import {z} from 'zod';
export function registerTags({app,db,collectionScope}) {
  db.function('znote_tag_fold',{deterministic:true},value=>String(value).toLowerCase());
  app.get('/api/tags',(req,res)=>{
    const q=z.object({collection:z.string().optional(),q:z.string().max(200).default(''),limit:z.coerce.number().int().min(1).max(100).optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),cursor:z.coerce.number().int().nonnegative().optional()}).parse(req.query);
    const scope=collectionScope(q.collection??'unfiled','items.');
    const cursor=db.prepare('SELECT COALESCE(MAX(id),0) cursor FROM events').get().cursor;
    if(q.cursor!==undefined&&q.cursor!==cursor)return res.status(409).json({error:'标签已有更新，请刷新标签后继续翻页'});
    const query=q.q.trim().toLowerCase(),args=[...scope.args,...(query?[query]:[])];
    const grouped=`SELECT j.value name,count(*) count FROM items,json_each(items.tags) j WHERE deleted_at IS NULL${scope.sql}${query?' AND instr(znote_tag_fold(j.value),?)>0':''} GROUP BY j.value`;
    // Existing integrations retain the full-array response unless limit is set.
    if(q.limit===undefined)return res.json(db.prepare(grouped+' ORDER BY count DESC,name').all(...args));
    const rows=db.prepare(`SELECT *,count(*) OVER() total FROM (${grouped}) ORDER BY count DESC,name LIMIT ? OFFSET ?`).all(...args,q.limit,q.offset);
    const total=rows[0]?.total??db.prepare(`SELECT count(*) total FROM (${grouped})`).get(...args).total;
    res.json({tags:rows.map(({total,...tag})=>tag),total,offset:q.offset,limit:q.limit,cursor});
  });
}
