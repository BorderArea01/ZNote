import {parentPort,workerData} from 'node:worker_threads';
import {open} from 'node:fs/promises';
import mediaInfoFactory from 'mediainfo.js';
let handle,probe;
try{
  handle=await open(workerData.path,'r');const {size}=await handle.stat();
  probe=await mediaInfoFactory({format:'object'});
  const result=await probe.analyzeData(size,async(length,position)=>{const buffer=Buffer.alloc(Math.min(length,1024*1024));const {bytesRead}=await handle.read(buffer,0,buffer.length,position);return buffer.subarray(0,bytesRead);});
  const tracks=result.media?.track||[],general=tracks.find(t=>t['@type']==='General'),audio=tracks.find(t=>t['@type']==='Audio');
  const formats={'MPEG Audio':['mp3','audio/mpeg'],'MPEG-4':['m4a','audio/mp4'],ADTS:['aac','audio/aac'],Ogg:['ogg','audio/ogg'],Wave:['wav','audio/wav'],WebM:['webm','audio/webm']};
  if(!audio||tracks.some(t=>t['@type']==='Video')||!formats[general?.Format])throw Error('Unsupported audio');
  const duration=Number(audio.Duration||general.Duration);
  if(!Number.isFinite(duration)||duration<=0)throw Error('Empty audio');
  const [extension,mime]=formats[general.Format];parentPort.postMessage({extension,mime,duration});
}catch{parentPort.postMessage({error:true});}
finally{probe?.close();await handle?.close();}
