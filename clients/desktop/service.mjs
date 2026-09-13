// Copied into the packaged Node runtime beside server/, independently of Electron's ABI.
import {createApp} from './server/app.js';
let runtime,server,stopping=false;
async function stop(){if(stopping)return;stopping=true;if(server?.listening)await new Promise(resolve=>server.close(resolve));if(runtime){await runtime.weixin.stop();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();runtime.db.close()}process.exit(0)}
try{runtime=createApp({dataDir:process.env.DATA_DIR,port:Number(process.env.PORT||3741)});server=runtime.app.listen(Number(process.env.PORT||3741),process.env.HOST||'0.0.0.0',()=>{runtime.backups.start();runtime.webhooks.start();runtime.trash.start();runtime.weixin.start();process.send?.({type:'ready',port:server.address().port})});server.once('error',e=>{process.send?.({type:'error',code:e.code||'START_FAILED'});stop()});}catch(e){process.send?.({type:'error',code:e.code||'START_FAILED'});await stop()}
process.on('message',message=>{if(message?.type==='stop')stop()});process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
