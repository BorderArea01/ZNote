import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import ffmpeg from 'ffmpeg-static';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const source = dirname(fileURLToPath(import.meta.url));
const root = join(source, '../../output/promo-znote');
const scenes = JSON.parse(await readFile(join(source, 'storyboard.json'), 'utf8'));
const duration = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
const voiceVariant = process.argv[2] || 'warm';
if (!['warm', 'lively'].includes(voiceVariant)) throw new Error(`Unknown voice: ${voiceVariant}`);
const rate = 48000;
const samples = new Float32Array(Math.round(duration * rate));
const clips = await Promise.all(scenes.map(async (_, i) => {
  const file = join(root, 'voice-neural', voiceVariant, `${String(i).padStart(2, '0')}.mp3`);
  const blocks=[];
  let error='';
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-i',file,'-af','loudnorm=I=-19:TP=-2:LRA=11','-ar',String(rate),'-ac','1','-f','f32le','-'],{stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>blocks.push(b));child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('close',resolve);
  });
  if(code!==0)throw Error(error);
  return Buffer.concat(blocks);
}));
let start = 0;
for (let i = 0; i < scenes.length; i++) {
  const offset = Math.round((start + (i === 4 ? 0.12 : 0.35)) * rate);
  const count = clips[i].length / 4;
  if(offset+count>Math.round((start+scenes[i].seconds)*rate))throw Error('Narration exceeds scene: '+scenes[i].id);
  for(let j=0;j<count;j++)samples[offset+j]=clips[i].readFloatLE(j*4);
  start += scenes[i].seconds;
}
const wave=Buffer.alloc(44+samples.length*2);
wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(rate,24);wave.writeUInt32LE(rate*2,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(samples.length*2,40);
for(let i=0;i<samples.length;i++)wave.writeInt16LE(Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),44+i*2);
await mkdir(root,{recursive:true});
const narration=join(root,`narration-${voiceVariant}.wav`);
await writeFile(narration,wave);
const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(root, 'render-cache', 'visual.webm'), '-i', join(root, 'music.wav'), '-i', narration];
const filters = ['[1:a]aresample=48000,asetpts=N/SR/TB,volume=0.55[bg]', '[2:a]asplit=2[voice][control]'];
filters.push('[bg][control]sidechaincompress=threshold=0.025:ratio=4:attack=40:release=450[ducked]');
filters.push(`[ducked][voice]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.93,atrim=duration=${duration.toFixed(3)}[a]`);
const suffix = voiceVariant === 'warm' ? '自然配音-女声' : '自然配音-男声';
const target = join(root, `ZNote-宣传片-${suffix}.mp4`);
const temporary = target.replace(/\.mp4$/, '.tmp.mp4');
args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', duration.toFixed(3), temporary);
await mkdir(root, { recursive: true });
const code = await new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', reject);
  child.on('close', resolve);
});
if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
await rename(temporary, target);
console.log(JSON.stringify({ target, duration }));
