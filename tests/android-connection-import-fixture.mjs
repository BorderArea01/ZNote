import http from 'node:http';
import {inboxFixture} from './helpers/cloudflare-inbox-fixture.js';
const fixture=await inboxFixture();
await fixture.connector('pair',{code:'android-import-fixture-1234'});
await fixture.connector('sync',{collections:[{id:'fixture-library',name:'导入测试知识库'}],updates:[],can_claim:false});
let failTokenOnce=true;
http.createServer(async(req,res)=>{
 try{
  console.log(req.method,req.url);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  let response;
  if(req.url==='/api/tokens'&&failTokenOnce){failTokenOnce=false;response=Response.json({error:'授权暂不可用，请重试'},{status:503});}
  else response=await fixture.call(req.url,req.method,chunks.length?JSON.parse(Buffer.concat(chunks)):undefined,req.headers);
  const headers=Object.fromEntries(response.headers);
  // Emulator fixture is plain HTTP on its private host alias only.
  if(headers['set-cookie'])headers['set-cookie']=headers['set-cookie'].replace('; Secure','');
  res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('{}');}
}).listen(3745,'0.0.0.0');
