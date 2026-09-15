import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const apk=await readFile('artifacts/update-fixture.apk'),badging=await readFile('artifacts/update-fixture-badging.txt','utf8');
const version=badging.match(/versionName='([^']+)'/)[1];
const manifest={version,url:`https://github.com/BorderArea01/ZNote/releases/download/test/ZNote-${version}-android.apk`,hash:createHash('sha256').update(apk).digest('hex'),size:apk.length,notes:'隔离模拟器更新测试'};
http.createServer((req,res)=>{if(req.url==='/manifest'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(manifest));}else if(req.url==='/update.apk'){res.setHeader('Content-Type','application/vnd.android.package-archive');res.setHeader('Content-Length',apk.length);res.end(apk);}else{res.statusCode=404;res.end();}}).listen(3744,'0.0.0.0');
