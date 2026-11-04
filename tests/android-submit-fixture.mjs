import http from'node:http';
const jobs=new Map(),requests=[],held=[];let mode='online';
const send=(res,status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://fixture');if(path.pathname==='/test/control'){const next=path.searchParams.get('mode');if(next)mode=next;if(mode==='release'){while(held.length){const{response,job}=held.shift();send(response,202,job);}mode='online';}return send(res,200,{mode,requests,jobs:jobs.size,held:held.length});}
 if(req.url==='/api/health')return send(res,200,{status:'ok',version:'submission-fixture'});
 if(req.headers.authorization!=='Bearer zn_'+'d'.repeat(64))return send(res,401,{error:'fixture token required'});
 if(req.url==='/api/me')return send(res,200,{scope:'write'});
 if(req.url==='/api/collections')return send(res,200,{collections:[{id:'photo',name:'摄影参考'},{id:'models',name:'建模学习'}]});
 if(req.url==='/api/captures'&&req.method==='POST'){
  let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);requests.push(input);if(mode==='unavailable')return send(res,503,{error:'测试服务器暂时不可用'});
  if(!jobs.has(input.request_id))jobs.set(input.request_id,{id:'submit-'+jobs.size,status:'completed',message:'fixture saved'});const job=jobs.get(input.request_id);
  if(mode==='hang'){held.push({response:res,job});return;}if(mode==='lost'){res.destroy();return;}return send(res,202,job);
 }
 if(req.url.startsWith('/api/captures/'))return send(res,200,{status:'completed',message:'fixture saved'});
 send(res,404,{error:'not found'});
}).listen(3751,'0.0.0.0',()=>console.log('Submission fixture ready'));
