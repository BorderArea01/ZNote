const {mkdir,writeFile,rename,chmod,access}=require('node:fs/promises');
const {join}=require('node:path');const {createHash}=require('node:crypto');const {gunzipSync}=require('node:zlib');
const ff={
 'win32-x64':['8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77','8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903','a636a7183c58006351acbaf35303c0ed85c6e1320fd4e80de453ba6157de6311'],
 'darwin-arm64':['8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa','cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2','05ba4b92c96605434b1aaae3eedf5a2c280c9607bf78ffca9a5b536d9af2dc6a'],
 'darwin-x64':['929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106','2e1d16c72fd74e12063776371da757322f8b77589386532f4fd8634bde7de1af','e88a0325f8e5b75210355e37341824f074d3cd82def2125be54c914b62848a36']
};
function paths(data){const dir=join(data,'tools','media-2026.08.19-b6.1.1');return {dir,ffmpeg:join(dir,process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),downloader:join(dir,process.platform==='win32'?'yt-dlp.exe':'yt-dlp')}}
async function installed(data){const p=paths(data);try{await access(join(p.dir,'READY'));return true}catch{return false}}
async function get(url,hash){const r=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error('组件下载失败：HTTP '+r.status);const b=Buffer.from(await r.arrayBuffer());if(createHash('sha256').update(b).digest('hex')!==hash)throw Error('组件校验失败，未安装');return b}
async function install(data){if(await installed(data))return;const platform=process.platform+'-'+process.arch,digests=ff[platform];if(!digests)throw Error('此平台请配置系统视频组件');const p=paths(data);await mkdir(p.dir,{recursive:true});
 const base='https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';
 // Each upstream byte stream is pinned; retain its complete license and build/source attribution.
 const license=await get(base+platform+'.LICENSE',digests[1]),readme=await get(base+platform+'.README',digests[2]);
 const compressed=await get(base+'ffmpeg-'+platform+'.gz',digests[0]);const binary=gunzipSync(compressed,{maxOutputLength:180*1024*1024});
 await writeFile(p.ffmpeg+'.LICENSE',license);await writeFile(p.ffmpeg+'.README',readme);await writeFile(p.ffmpeg+'.download',binary);await chmod(p.ffmpeg+'.download',0o755);await rename(p.ffmpeg+'.download',p.ffmpeg);
 const win=process.platform==='win32',asset=win?'yt-dlp.exe':'yt-dlp_macos';const yt=await get('https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/'+asset,win?'66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a':'0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202');
 await writeFile(p.downloader+'.download',yt);await chmod(p.downloader+'.download',0o755);await rename(p.downloader+'.download',p.downloader);
 await writeFile(join(p.dir,'SOURCES.txt'),'yt-dlp: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19\nFFmpeg: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1\nLicense and build/source attribution: ffmpeg*.LICENSE and ffmpeg*.README.\nDownloaded directly from upstream by this installation, not bundled in ZNote releases.\n');await writeFile(join(p.dir,'READY'),'verified\n');
}
module.exports={paths,installed,install};
