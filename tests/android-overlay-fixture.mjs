import http from 'node:http';
const jobs=new Map();let sequence=0;
http.createServer(async(req,res)=>{
 const data=[];for await(const chunk of req)data.push(chunk);const path=req.url;
 let status=200,result={};
 if(path==='/api/collections')result={collections:[{id:'photo',name:'摄影参考'},{id:'models',name:'建模学习'}]};
 else if(req.method==='POST'&&path==='/api/captures'){
  const body=JSON.parse(Buffer.concat(data));if(body.collection_id!=='photo')throw Error('Selection was not preserved into submission');
  const id='overlay-'+(++sequence);jobs.set(id,{fail:body.text.includes('failure'),polls:0});status=201;result={id};console.log('Queued '+id+' in photo');
 }else if(path.startsWith('/api/captures/')){
  const job=jobs.get(path.split('/').pop());result=job?{status:++job.polls<2?'processing':job.fail?'failed':'completed',message:job.fail?'示例连接中断':'资源已保存'}:{status:'failed',message:'not found'};
 }else if(path==='/api/health')result={status:'ok'};
 else if(path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><title>验收用知识库</title><h1>知识库浏览</h1>');return;}
 else status=404;
 res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
}).listen(3747,'0.0.0.0');
