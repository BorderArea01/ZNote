import {youtubeVideoId, youtubeVideoUrl} from './youtube-url.js';
import {youtubeSabrResource} from './youtube-sabr-resource.js';
const limit=500*1024*1024;
export function youtubeMediaUrl(value) {
  try {
    const u=new URL(value);
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/(^|\.)googlevideo\.com$/.test(u.hostname)&&u.pathname==='/videoplayback'&&u.href.length<=8192 ? u : null;
  } catch { return null; }
}
function sameMediaFormat(url,base,itag){
  return url.searchParams.get('itag')===itag&&url.searchParams.get('id')===base.searchParams.get('id');
}
export function youtubePlayerDiagnostic(player,observed=[]){
  const data=player?.streamingData||{},formats=[...(data.formats||[]),...(data.adaptiveFormats||[])];
  return {status:player?.playabilityStatus?.status||'missing',streamingKeys:Object.keys(data),formats:formats.map(f=>{const base=youtubeMediaUrl(f.url||new URLSearchParams(f.signatureCipher||f.cipher||'').get('url'));return {itag:f.itag,mime:f.mimeType,size:Number(f.contentLength)||null,url:!!f.url,cipher:!!(f.signatureCipher||f.cipher),audio:!!(f.audioQuality||f.audioChannels),base:!!base,modified:base?.searchParams.get('lmt'),duration:base?.searchParams.get('dur'),observedMatches:!!base&&observed.map(youtubeMediaUrl).some(u=>u&&sameMediaFormat(u,base,String(f.itag)))};}),
    observed:observed.map(youtubeMediaUrl).filter(Boolean).map(u=>({itag:u.searchParams.get('itag'),mime:u.searchParams.get('mime'),size:Number(u.searchParams.get('clen'))||null,modified:u.searchParams.get('lmt'),duration:u.searchParams.get('dur'),parameters:[...u.searchParams.keys()]})).slice(-4)};
}
// Only select data for the current, playable work. No login/cookie extraction,
// player-client substitution or challenge/age-verification bypass.
export function youtubeResource(player,{pageUrl,observed=[],request}={}) {
  const id=youtubeVideoId(pageUrl);
  if(player?.playabilityStatus?.status&&player.playabilityStatus.status!=='OK')throw Error('请先在 YouTube 登录并完成平台验证，确认当前视频可以播放');
  if(!id||player?.videoDetails?.videoId!==id)throw Error('页面作品已切换，请等待当前视频加载后重试');
  if(player.playabilityStatus?.status!=='OK')throw Error('请先在 YouTube 登录并完成平台验证，确认当前视频可以播放');
  if(player.videoDetails.isLive||player.videoDetails.isLiveContent&&!(Number(player.videoDetails.lengthSeconds)>0))throw Error('暂不采集 YouTube 直播，请等待回放生成');
  const data=player.streamingData||{};
  const select=(format,muxed=false)=>{
    if(format.drmFamilies?.length||format.drmTrackType)return null;
    const base=youtubeMediaUrl(format.url||new URLSearchParams(format.signatureCipher||format.cipher||'').get('url'));
    if(!base||!base.searchParams.get('id'))return null;
    const itag=String(format.itag);
    const network=observed.map(youtubeMediaUrl).filter(u=>u&&sameMediaFormat(u,base,itag)).at(-1);
    if(!network&&!format.url)return null; // Ciphered URLs require an already resolved playback request.
    const url=network||base;
    const signed=new Set((url.searchParams.get('sparams')||'').split(','));
    if(['ump','srfvp','range'].some(key=>signed.has(key)))return null;
    // Request the ordinary media representation, not the player's UMP framing.
    for(const key of ['ump','srfvp'])url.searchParams.delete(key);
    const size=Number(format.contentLength||url.searchParams.get('clen'));
    if(!Number.isSafeInteger(size)||size<0||size>limit||(!size&&!(muxed&&network)))return null;
    if(Number(url.searchParams.get('expire')||Infinity)<Date.now()/1000+30)return null;
    const mime=String(format.mimeType||'');
    if(!/^(video|audio)\/(mp4|webm)\b/.test(mime))return null;
    return {url:url.href,size,mime,height:Number(format.height)||0,bitrate:Number(format.bitrate)||0,muxed,
      compatible:/avc1|mp4a/.test(mime),observed:!!network,media_id:url.searchParams.get('id')};
  };
  const progressive=(data.formats||[]).filter(f=>f.audioQuality||f.audioChannels).map(f=>select(f,true)).filter(Boolean).sort((a,b)=>b.height-a.height);
  const adaptive=(data.adaptiveFormats||[]).map(f=>select(f)).filter(Boolean);
  const videos=adaptive.filter(f=>f.mime.startsWith('video/')).sort((a,b)=>Number(b.observed)-Number(a.observed)||Number(b.compatible)-Number(a.compatible)||b.height-a.height||b.bitrate-a.bitrate);
  const audios=adaptive.filter(f=>f.mime.startsWith('audio/')).sort((a,b)=>Number(b.observed)-Number(a.observed)||Number(b.compatible)-Number(a.compatible)||b.bitrate-a.bitrate);
  let tracks;
  for(const video of videos){const audio=audios.find(a=>a.media_id===video.media_id&&a.size+video.size<=limit);if(audio){tracks=[video,audio];break;}}
  if(!tracks&&progressive.length)tracks=[progressive[0]];
  const sabr=!tracks?youtubeSabrResource(player,request):null;
  if(!tracks&&sabr)tracks=sabr.tracks;
  if(!tracks)throw Error(data.serverAbrStreamingUrl
    ? '尚未取得当前视频的完整分段会话，请刷新页面并播放几秒后重试；未保存单个片段'
    : '尚未获得完整音画地址。请播放当前视频几秒后重试；受保护或未授权的流不能采集');
  return {id:'youtube:'+id,kind:'youtube',url:youtubeVideoUrl(pageUrl),source_url:youtubeVideoUrl(pageUrl),
    title:String(player.videoDetails.title||'YouTube 视频').slice(0,200),author:String(player.videoDetails.author||'').slice(0,200),
    description:new TextDecoder().decode(new TextEncoder().encode(String(player.videoDetails.shortDescription||'')).subarray(0,6000),{stream:true}),tracks,...(sabr?{sabr:sabr.sabr}:{})};
}

export function validateYoutubeResource(resource,source) {
  if(resource?.kind!=='youtube'||resource.source_url!==youtubeVideoUrl(source)||resource.id!=='youtube:'+youtubeVideoId(source))throw Error('YouTube 作品不匹配，请重新采集');
  const tracks=resource.tracks;
  if(!Array.isArray(tracks)||![1,2].includes(tracks.length))throw Error('未获得完整音画');
  if(resource.sabr){
    const s=resource.sabr;
    if(!youtubeMediaUrl(s.url)||!new URL(s.url).searchParams.has('sabr')||typeof s.request!=='string'||!/^[A-Za-z0-9+/=]+$/.test(s.request)||s.request.length>180000||!(s.duration>0&&s.duration<=86400)||!Array.isArray(s.formats)||s.formats.length!==2||tracks.length!==2)throw Error('SABR 播放数据不完整，请播放当前视频后重试');
    for(let i=0;i<2;i++)if(!Number.isSafeInteger(tracks[i].size)||tracks[i].size<=0||tracks[i].size!==Number(s.formats[i].contentLength)||tracks[i].itag!==s.formats[i].itag||tracks[i].mime!==s.formats[i].mimeType||!tracks[i].mime.startsWith(i?'audio/':'video/'))throw Error('SABR 音画格式不匹配');
    if(tracks.reduce((n,t)=>n+t.size,0)>limit)throw Error('视频超过 500 MB');return resource;
  }
  let size=0;
  for(const t of tracks){if(!youtubeMediaUrl(t.url)||!Number.isSafeInteger(t.size)||t.size<0||(!t.size&&!(t.muxed&&t.observed&&tracks.length===1)))throw Error('播放流地址或大小不正确');size+=t.size;}
  if(size>limit)throw Error('视频超过 500 MB');
  if(!tracks[0].mime?.startsWith('video/')||(tracks.length===1?!tracks[0].muxed:!tracks[1].mime?.startsWith('audio/')||tracks[0].media_id!==tracks[1].media_id))throw Error('画面与声音不属于同一作品');
  return resource;
}
