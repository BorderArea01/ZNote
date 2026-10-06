import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ffmpeg from 'ffmpeg-static';
import {createHash} from 'node:crypto';
const source=dirname(fileURLToPath(import.meta.url));
const root=join(source,'../../output/promo-znote');
const scenes=JSON.parse(await readFile(join(source,'storyboard.json'),'utf8'));
const expected=scenes.reduce((sum,s)=>sum+s.seconds,0);
const fullHD=process.argv.includes('--1080p');
const suffix=fullHD?'-1080P':'';
const resolution=fullHD?{width:1920,height:1080}:{width:1280,height:720};
async function run(args){
  let output='';
  const code=await new Promise((resolve,reject)=>{const p=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});p.stderr.on('data',b=>output+=b);p.on('error',reject);p.on('close',resolve)});
  if(code!==0)throw Error(output);
  return output;
}
async function samples(file){
  const blocks=[];
  let errors='';
  const code=await new Promise((resolve,reject)=>{const p=spawn(ffmpeg,['-hide_banner','-loglevel','error','-i',file,'-t','4.5','-vn','-ac','1','-ar','16000','-f','f32le','-'],{stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>blocks.push(b));p.stderr.on('data',b=>errors+=b);p.on('error',reject);p.on('close',resolve)});
  if(code!==0)throw Error(errors);
  const bytes=Buffer.concat(blocks);
  return Float32Array.from({length:bytes.length/4},(_,i)=>bytes.readFloatLE(i*4));
}
const music=await samples(join(root,'music.wav'));
await mkdir(join(root,'qa'),{recursive:true});
const results=await Promise.all(['女声','男声'].map(async variant=>{
  const file=join(root,`ZNote-宣传片-自然配音-${variant}${suffix}.mp4`);
  const audio=await samples(file);
  let dot=0,musicEnergy=0,audioEnergy=0;
  for(let i=0;i<Math.min(music.length,audio.length);i++){dot+=music[i]*audio[i];musicEnergy+=music[i]**2;audioEnergy+=audio[i]**2}
  const musicCorrelation=dot/Math.sqrt(musicEnergy*audioEnergy);
  if(musicCorrelation>0.92)throw Error('The export contains only music, without narration: '+variant);
  const decoded=await run(['-hide_banner','-nostats','-i',file,'-vf','blackdetect=d=1:pix_th=0.05','-af','volumedetect','-f','null','-']);
  const dimensions=decoded.match(/Video:[^\n]*?\b(\d{3,5})x(\d{3,5})\b/);
  const width=Number(dimensions?.[1]),height=Number(dimensions?.[2]);
  if(width!==resolution.width||height!==resolution.height)throw Error('Incorrect video resolution: '+variant);
  const duration=decoded.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const seconds=Number(duration?.[1])*3600+Number(duration?.[2])*60+Number(duration?.[3]);
  if(!Number.isFinite(seconds)||Math.abs(seconds-expected)>0.2)throw Error('Incorrect movie duration: '+variant);
  const volume=Number(decoded.match(/max_volume: ([-\d.]+) dB/)?.[1]);
  const mean=Number(decoded.match(/mean_volume: ([-\d.]+) dB/)?.[1]);
  const blacks=[...decoded.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)].map(m=>({start:Number(m[1]),end:Number(m[2]),duration:Number(m[3])}));
  if(!Number.isFinite(volume)||mean< -40||blacks.length)throw Error('Movie has silence or a black interval: '+variant);
  for(const [name,t] of [['opening',2],['what-is',46],['image',83],['closing',expected-3]]){
    await run(['-hide_banner','-loglevel','error','-y','-ss',String(t),'-i',file,'-frames:v','1',join(root,'qa',`${variant}-${name}${suffix}.png`)]);
  }
  return {variant,width,height,seconds,maxVolume:volume,meanVolume:mean,musicCorrelation:+musicCorrelation.toFixed(3),hash:createHash('sha256').update(await readFile(file)).digest('hex'),blackIntervals:blacks,decode:'complete'};
}));
if(results[0].hash===results[1].hash)throw Error('The two narration variants are identical');
await writeFile(join(root,'qa',fullHD?'movies-1080p.json':'movies.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
