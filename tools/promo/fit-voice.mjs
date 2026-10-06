import {readFile,writeFile,mkdir} from 'node:fs/promises';
import ffmpeg from 'ffmpeg-static';
import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=dirname(fileURLToPath(import.meta.url));
const root=join(source,'../../output/promo-znote');
const scenes=JSON.parse(await readFile(join(source,'storyboard.json'),'utf8'));
const report=[];
async function length(file){
  let output='';
  await new Promise((resolve,reject)=>{const p=spawn(ffmpeg,['-hide_banner','-i',file],{stdio:['ignore','ignore','pipe']});p.stderr.on('data',b=>output+=b);p.on('error',reject);p.on('close',resolve)});
  const match=output.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if(!match)throw Error('Missing audio duration: '+file);
  return Number(match[1])*3600+Number(match[2])*60+Number(match[3]);
}
for(const [i,scene] of scenes.entries()){
  const voices=await Promise.all(['warm','lively'].map(label=>length(join(root,'voice-neural',label,`${String(i).padStart(2,'0')}.mp3`))));
  const maximum=Math.max(...voices);
  scene.seconds=Math.max(scene.seconds,Math.ceil((maximum+0.9)*10)/10);
  report.push({scene:scene.id,seconds:scene.seconds,voice:maximum,remaining:+(scene.seconds-maximum-.35).toFixed(2)});
}
await writeFile(join(source,'storyboard.json'),JSON.stringify(scenes,null,2)+'\n');
await mkdir(join(root,'qa'),{recursive:true});
await writeFile(join(root,'qa','voice-timing.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({duration:scenes.reduce((sum,s)=>sum+s.seconds,0),scenes:report}));
