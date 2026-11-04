// Read-only network failures for the disposable emulator; no user library.
import http from 'node:http';
const version='0.10.0-beta.32';
const catalog=[{assets:[{name:`ZNote-${version}-android.apk`,browser_download_url:`https://github.com/b0rderl4nder/ZNote/releases/download/android-v${version}/ZNote-${version}-android.apk`,digest:'sha256:'+'b'.repeat(64),size:123}]}];
http.createServer((req,res)=>{
 if(req.url==='/github'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(catalog));}
 else if(req.url==='/hang'){setTimeout(()=>{res.statusCode=503;res.end();},6500);}
 else{res.statusCode=req.url==='/missing.apk'?404:503;res.end('Temporary fixture failure');}
}).listen(3748,'0.0.0.0',()=>console.log('Update HTTP fixture ready'));
