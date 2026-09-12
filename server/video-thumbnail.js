import {spawn} from 'node:child_process';
import {join} from 'node:path';
import sharp from 'sharp';
import {mediaTools} from './imports.js';

// Decode one local frame; never fetch a poster or rewrite the original video.
export async function videoThumbnail(dataDir,item) {
  const bytes=await new Promise((resolve,reject)=>{
    const child=spawn(mediaTools().ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-threads','1','-i',join(dataDir,'media',item.file_key),'-map','0:v:0','-frames:v','1','-vf','scale=480:480:force_original_aspect_ratio=decrease','-threads','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{windowsHide:true,shell:false,stdio:['ignore','pipe','ignore']});
    const chunks=[];let size=0,done=false;
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);if(error){child.kill();reject(Object.assign(Error(error),{status:503}))}else resolve(Buffer.concat(chunks))};
    const timer=setTimeout(()=>finish('视频封面生成超时，可继续播放或下载原视频'),15000);
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)finish('视频封面超出处理上限');else chunks.push(chunk)});
    child.on('error',()=>finish('视频封面组件不可用，可继续播放或下载原视频'));
    child.on('close',code=>finish(code===0&&size?null:'无法解码视频首帧，可继续播放或下载原视频'));
  });
  return sharp(bytes,{limitInputPixels:480*480}).webp({quality:78}).toBuffer();
}
