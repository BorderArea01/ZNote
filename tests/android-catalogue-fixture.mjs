import http from 'node:http';
const jobs=new Map();let mode='online',lists=0,posts=0;const requests=[];
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/test/control'){mode=url.searchParams.get('mode')||mode;return send(res,200,{mode,lists,posts,requests,jobs:jobs.size});}
 if(req.url==='/api/health')return send(res,200,{status:'ok',version:'catalogue-fixture'});
 if(req.headers.authorization!=='Bearer zn_'+'c'.repeat(64))return send(res,401,{error:'fixture token required'});
 if(req.url==='/api/me')return send(res,200,{scope:'write'});
 if(req.url==='/api/collections'){
  lists++;if(mode==='hang')return;
  if(mode==='unavailable')return send(res,503,{error:'temporary outage'});
  if(mode==='unauthorized')return send(res,401,{error:'expired'});
  return send(res,200,{collections:mode==='removed'?[{id:'photo',name:'摄影资料'}]:[{id:'photo',name:'摄影参考'},{id:'models',name:mode==='updated'?'模型资料':'建模学习'}]});
 }
 if(req.url==='/api/captures'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);posts++;requests.push({request_id:input.request_id,collection_id:input.collection_id,text:input.text});if(!jobs.has(input.request_id))jobs.set(input.request_id,{id:'fixture-'+jobs.size,status:'completed',message:'fixture saved'});
  if(mode==='lost-write'){res.destroy();return;}return send(res,202,jobs.get(input.request_id));
 }
 if(req.url.startsWith('/api/captures/'))return send(res,200,{status:'completed',message:'fixture saved'});
 send(res,404,{error:'not found'});
}).listen(3749,'127.0.0.1',()=>console.log('Isolated catalogue fixture ready on 3749'));
