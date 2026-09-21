import {spawn} from 'node:child_process';
import {join} from 'node:path';
import sharp from 'sharp';
import {mediaTools} from './imports.js';

// Decode one local frame; never fetch a poster or rewrite the original video.
export async function videoThumbnail(dataDir,item) {
  const duration=Number(item.duration);
  const offset=Number.isFinite(duration)&&duration>0?Math.min(Math.max(duration*0.12,0.25),3,Math.max(duration-0.05,0)):0.5;
  const decode=seek=>new Promise((resolve,reject)=>{
    const seekArgs=seek>0?['-ss',String(seek)]:[];
    const child=spawn(mediaTools().ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-threads','1',...seekArgs,'-i',join(dataDir,'media',item.file_key),'-map','0:v:0','-frames:v','1','-vf','scale=480:480:force_original_aspect_ratio=decrease','-threads','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{windowsHide:true,shell:false,stdio:['ignore','pipe','ignore']});
    const chunks=[];let size=0,done=false;
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);if(error){child.kill();reject(Object.assign(Error(error),{status:503}))}else resolve(Buffer.concat(chunks))};
    const timer=setTimeout(()=>finish('视频封面生成超时，可继续播放或下载原视频'),15000);
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)finish('视频封面超出处理上限');else chunks.push(chunk)});
    child.on('error',()=>finish('视频封面组件不可用，可继续播放或下载原视频'));
    child.on('close',code=>finish(code===0&&size?null:'无法解码视频首帧，可继续播放或下载原视频'));
  });
  // Keep the historical first-frame cover whenever it contains content. Some
  // live-photo/video encoders begin with a blank transition; only those covers
  // get a small near-start fallback so groups do not look empty.
  let bytes=await decode(0);
  if(Number.isFinite(duration)&&duration>offset){
    try{
      const stats=await sharp(bytes).stats();
      const means=stats.channels.slice(0,3).map(channel=>channel.mean);
      if(Math.max(...means)<12)bytes=await decode(offset);
    }catch{}
  }
  return sharp(bytes,{limitInputPixels:480*480}).webp({quality:78}).toBuffer();
}
