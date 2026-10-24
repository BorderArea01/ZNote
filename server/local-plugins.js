import {readdir,readFile,realpath,stat,mkdir,rename,unlink} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import multer from 'multer';
import {z} from 'zod';
import {fileDigest} from './videos.js';
import {pluginId,pluginFiles} from './plugin-assets.js';

const fail=(status,message)=>Object.assign(Error(message),{status});
const asset=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).refine(v=>!v.includes('..'));
const manifestSchema=z.object({id:pluginId,name:z.string().trim().min(1).max(60),version:z.string().max(40),description:z.string().max(300),api:z.literal(1),entry:asset,files:z.array(asset).min(1).max(40)}).strict();
const reference=z.discriminatedUnion('type',[
  z.object({type:z.literal('item'),id:z.uuid()}).strict(),
  z.object({type:z.literal('group'),kind:z.enum(['image','video']),collection_id:z.uuid().nullable(),group_key:z.string().min(1).max(200)}).strict(),
  z.object({type:z.literal('file'),id:z.uuid()}).strict(),
]);
const inside=(root,path)=>{const rel=relative(root,path);return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel);};

// Only local static web plugins: no server code, npm scripts or downloaded code
// is executed. Installation is an explicit filesystem operation by the owner.
export function registerLocalPlugins({app,db,admin,authenticate,dataDir,pluginsDir,serialize,filenameText}){
  let catalog=new Map(),errors=[];
  const setting=key=>db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  const put=(key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
  const enabled=id=>setting('plugin.enabled:'+id)==='true';
  const scope=req=>{
    if(req.query.collection===undefined)return undefined; // Legacy integrations retain their own old state.
    if(req.query.collection==='unfiled')return 'unfiled';
    const id=z.uuid().parse(req.query.collection);
    if(!db.prepare('SELECT 1 FROM collections WHERE id=?').get(id))throw fail(404,'知识库不存在，请重新选择');
    return id;
  };
  const libraryKey=(id,library)=>'plugin.library:'+id+':'+library;
  const libraryState=(id,library)=>JSON.parse(setting(libraryKey(id,library))||'{"enabled":false,"version":0,"data":null}');
  const legacy=id=>JSON.parse(setting('plugin.state:'+id)||'{"version":0,"data":null}');
  const available=(id,library)=>enabled(id)&&(library===undefined||libraryState(id,library).enabled===true);
  const scopedFiles=(id,library)=>pluginFiles(db,id).filter(f=>library===undefined?f.collection_id===undefined:f.collection_id===(library==='unfiled'?null:library));
  const visibleState=(id,library)=>library===undefined?legacy(id):{...libraryState(id,library),collection_id:library==='unfiled'?null:library,collection_name:library==='unfiled'?'未分类':db.prepare('SELECT name FROM collections WHERE id=?').get(library).name};
  async function scan(){
    const next=new Map(),issues=[];
    let entries;try{entries=await readdir(pluginsDir,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;entries=[];}
    const root=await realpath(pluginsDir).catch(()=>resolve(pluginsDir));
    for(const entry of entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink())){
      if(!pluginId.safeParse(entry.name).success)continue;
      try{
        const folder=await realpath(join(root,entry.name));if(!inside(root,folder))throw Error('插件目录越界');
        const manifestPath=await realpath(join(folder,'manifest.json'));if(!inside(folder,manifestPath))throw Error('清单路径越界');
        const text=await readFile(manifestPath,'utf8');if(Buffer.byteLength(text)>65536)throw Error('清单过大');
        const manifest=manifestSchema.parse(JSON.parse(text));
        if(manifest.id!==entry.name||!manifest.files.includes(manifest.entry))throw Error('标识或入口不匹配');
        for(const file of manifest.files){const path=await realpath(join(folder,file));if(!inside(folder,path)||!(await stat(path)).isFile())throw Error('文件路径越界或不是普通文件');}
        next.set(manifest.id,{...manifest,folder});
      }catch{issues.push({id:entry.name,error:'插件清单、API 版本或入口文件无效，请修复后重新扫描'});}
    }
    catalog=next;errors=issues;
  }
  const ready=scan();
  const list=library=>({plugins:[...catalog.values()].map(({folder,...p})=>({...p,enabled:available(p.id,library),mounted:library===undefined?false:libraryState(p.id,library).enabled===true,legacy_available:legacy(p.id).data!==null,legacy_version:legacy(p.id).version})),errors});
  const installed=async(req,res,next)=>{try{await ready;const id=pluginId.parse(req.params.id);if(!catalog.has(id))throw fail(404,'插件未安装，请重新扫描');req.plugin=catalog.get(id);req.pluginScope=scope(req);next();}catch(e){next(e);}};
  const active=(req,res,next)=>available(req.plugin.id,req.pluginScope)?next():next(fail(409,req.pluginScope===undefined?'插件已停用；数据和附件已保留':'此知识库尚未启用该插件；资料已保留'));
  app.get('/api/plugins',async(req,res)=>{await ready;res.json(list(scope(req)));});
  app.post('/api/plugins/rescan',admin,async(req,res)=>{await ready;const library=scope(req);await scan();res.json(list(library));});
  app.patch('/api/plugins/:id',admin,installed,(req,res)=>{
    const input=z.object({enabled:z.boolean()}).strict().parse(req.body),library=req.pluginScope;
    if(library===undefined)put('plugin.enabled:'+req.plugin.id,JSON.stringify(input.enabled));
    else {
      const prior=libraryState(req.plugin.id,library);
      put(libraryKey(req.plugin.id,library),JSON.stringify({...prior,enabled:input.enabled,version:prior.version+1,updated_at:new Date().toISOString()}));
      if(input.enabled)put('plugin.enabled:'+req.plugin.id,'true');
    }
    res.json(list(library));
  });
  app.post('/api/plugins/:id/legacy/claim',admin,installed,(req,res)=>{
    const library=req.pluginScope;if(library===undefined)throw fail(400,'请选择接收旧资料的知识库');
    const input=z.object({version:z.number().int().nonnegative()}).strict().parse(req.body);
    db.exec('BEGIN IMMEDIATE');
    try {
      const before=legacy(req.plugin.id),target=libraryState(req.plugin.id,library);
      if(before.version!==input.version||before.data===null)throw fail(409,'旧资料已关联或发生变化，请重新加载');
      if(target.data!==null)throw fail(409,'当前知识库已有插件资料，不能覆盖，请选择空知识库');
      const now=new Date().toISOString();
      put(libraryKey(req.plugin.id,library),JSON.stringify({enabled:true,version:target.version+1,data:before.data,updated_at:now}));
      put('plugin.state:'+req.plugin.id,JSON.stringify({version:before.version+1,data:null,updated_at:now}));
      const files=pluginFiles(db,req.plugin.id).map(file=>file.collection_id===undefined?{...file,collection_id:library==='unfiled'?null:library}:file);
      put('plugin.files:'+req.plugin.id,JSON.stringify(files));put('plugin.enabled:'+req.plugin.id,'true');
      db.exec('COMMIT');res.json(list(library));
    }catch(e){db.exec('ROLLBACK');throw e;}
  });
  app.get('/api/plugins/:id/state',installed,active,(req,res)=>res.json(visibleState(req.plugin.id,req.pluginScope)));
  app.patch('/api/plugins/:id/state',installed,active,(req,res)=>{
    if(req.auth.scope==='read')throw fail(403,'此令牌只有读取权限');
    const input=z.object({version:z.number().int().nonnegative(),data:z.unknown()}).strict().parse(req.body);
    const key=req.pluginScope===undefined?'plugin.state:'+req.plugin.id:libraryKey(req.plugin.id,req.pluginScope),previous=setting(key),before=JSON.parse(previous||'{"version":0}');
    if(input.version!==before.version)throw fail(409,'资料已在其他窗口更新，请重新加载后重试，当前编辑已保留');
    const value=JSON.stringify({...before,version:before.version+1,data:input.data,updated_at:new Date().toISOString()});
    if(Buffer.byteLength(value)>1500000)throw fail(413,'插件资料超过 1.5 MB，请拆分作品或清理不需要的文字');
    const changes=previous===undefined?db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key,value).changes:db.prepare('UPDATE settings SET value=? WHERE key=? AND value=?').run(value,key,previous).changes;
    if(!changes)throw fail(409,'资料已在其他窗口更新，未覆盖，请重新加载');
    res.json(visibleState(req.plugin.id,req.pluginScope));
  });
  // Resolve references at read time: deleted/moved resources never turn into
  // silent copies, and a group always reflects its current ordered members.
  app.post('/api/plugins/:id/resolve',installed,active,(req,res)=>{
    const refs=z.array(reference).max(200).parse(req.body.references),files=scopedFiles(req.plugin.id,req.pluginScope);
    res.json({resources:refs.map(ref=>{
      if(ref.type==='file'){const row=files.find(f=>f.id===ref.id);return {ref,available:!!row,...(row?{file:{...row,file_key:undefined,url:`/api/plugins/${req.plugin.id}/files/${row.id}${req.pluginScope===undefined?'':'?collection='+encodeURIComponent(req.pluginScope)}`}}:{})};}
      const rows=ref.type==='item'?db.prepare('SELECT * FROM items WHERE id=? AND deleted_at IS NULL').all(ref.id):db.prepare('SELECT * FROM items WHERE group_key=? AND kind=? AND collection_id IS ? AND deleted_at IS NULL ORDER BY COALESCE(group_order,group_index),group_index,id').all(ref.group_key,ref.kind,ref.collection_id);
      return {ref,available:!!rows.length,count:rows.length,item:rows[0]?serialize({...rows[0],content:rows[0].content.slice(0,1000)}):null};
    })});
  });
  const upload=multer({dest:join(dataDir,'uploads'),limits:{fileSize:200*1024*1024,files:1,fields:0}});
  app.get('/api/plugins/:id/files',installed,active,(req,res)=>res.json({files:scopedFiles(req.plugin.id,req.pluginScope).map(({file_key,...f})=>f)}));
  app.post('/api/plugins/:id/files',installed,active,upload.single('file'),async(req,res)=>{
    let target,committed=false;
    try{
      if(!req.file)throw fail(400,'请选择附件');
      const digest=await fileDigest(req.file.path);if(!digest.bytes)throw fail(400,'不能挂载空附件');
      const id=randomUUID(),file_key='plugin-'+id;target=join(dataDir,'media',file_key);
      await mkdir(join(dataDir,'media'),{recursive:true});await rename(req.file.path,target);
      if(!available(req.plugin.id,req.pluginScope))throw fail(409,'插件已停用，未添加附件');
      const files=pluginFiles(db,req.plugin.id);if(files.length>=10000)throw fail(413,'插件附件数量已达上限');
      const row={id,file_key,name:filenameText(req.file.originalname).slice(0,240),...digest,...(req.pluginScope===undefined?{}:{collection_id:req.pluginScope==='unfiled'?null:req.pluginScope}),created_at:new Date().toISOString()};
      files.push(row);put('plugin.files:'+req.plugin.id,JSON.stringify(files));committed=true;
      res.status(201).json({...row,file_key:undefined});
    }finally{if(req.file)await unlink(req.file.path).catch(()=>{});if(target&&!committed)await unlink(target).catch(()=>{});}
  });
  app.get('/api/plugins/:id/files/:file',installed,active,(req,res)=>{
    const row=scopedFiles(req.plugin.id,req.pluginScope).find(f=>f.id===req.params.file);if(!row)throw fail(404,'附件不存在');
    res.type('application/octet-stream').attachment(row.name).sendFile(resolve(dataDir,'media',row.file_key));
  });
  app.use('/local-plugins',authenticate);
  app.get('/local-plugins/:id/:file',installed,active,async(req,res)=>{
    if(!req.plugin.files.includes(req.params.file))throw fail(404,'插件文件不存在');
    const path=await realpath(join(req.plugin.folder,req.params.file));if(!inside(req.plugin.folder,path))throw fail(403,'插件文件路径越界');
    res.set('Cache-Control','no-store');res.set('X-Frame-Options','SAMEORIGIN');
    res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    res.sendFile(path);
  });
  return {ready,rescan:scan};
}
