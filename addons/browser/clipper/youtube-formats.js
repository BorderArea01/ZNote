import {youtubeVideoId, youtubeVideoUrl} from './youtube-url.js';
const limit=500*1024*1024;
export function youtubeMediaUrl(value) {
  try {
    const u=new URL(value);
    return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/(^|\.)googlevideo\.com$/.test(u.hostname)&&u.pathname==='/videoplayback'&&u.href.length<=8192 ? u : null;
  } catch { return null; }
}
// Only select data for the current, playable work. No login/cookie extraction,
// player-client substitution or challenge/age-verification bypass.
export function youtubeResource(player,{pageUrl,observed=[]}={}) {
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
    const network=observed.map(youtubeMediaUrl).filter(u=>u&&u.searchParams.get('itag')===itag&&u.searchParams.get('id')===base.searchParams.get('id')).at(-1);
    if(!network&&!format.url)return null; // Ciphered URLs require an already resolved playback request.
    const url=network||base;
    const signed=new Set((url.searchParams.get('sparams')||'').split(','));
    if(['ump','srfvp','range'].some(key=>signed.has(key)))return null;
    // Request the ordinary media representation, not the player's UMP framing.
    for(const key of ['ump','srfvp'])url.searchParams.delete(key);
    const size=Number(format.contentLength||url.searchParams.get('clen'));
    if(!Number.isSafeInteger(size)||size<=0||size>limit)return null;
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
  if(!tracks)throw Error(data.serverAbrStreamingUrl&&!data.formats?.length&&!data.adaptiveFormats?.length
    ? '当前播放器只提供 SABR 播放流，暂时无法取得完整媒体文件；未保存单个片段'
    : '尚未获得完整音画地址。请播放当前视频几秒后重试；受保护或未授权的流不能采集');
  return {id:'youtube:'+id,kind:'youtube',url:youtubeVideoUrl(pageUrl),source_url:youtubeVideoUrl(pageUrl),
    title:String(player.videoDetails.title||'YouTube 视频').slice(0,200),author:String(player.videoDetails.author||'').slice(0,200),
    description:new TextDecoder().decode(new TextEncoder().encode(String(player.videoDetails.shortDescription||'')).subarray(0,6000),{stream:true}),tracks};
}

export function validateYoutubeResource(resource,source) {
  if(resource?.kind!=='youtube'||resource.source_url!==youtubeVideoUrl(source)||resource.id!=='youtube:'+youtubeVideoId(source))throw Error('YouTube 作品不匹配，请重新采集');
  const tracks=resource.tracks;
  if(!Array.isArray(tracks)||![1,2].includes(tracks.length))throw Error('未获得完整音画');
  let size=0;
  for(const t of tracks){if(!youtubeMediaUrl(t.url)||!Number.isSafeInteger(t.size)||t.size<=0)throw Error('播放流地址或大小不正确');size+=t.size;}
  if(size>limit)throw Error('视频超过 500 MB');
  if(!tracks[0].mime?.startsWith('video/')||(tracks.length===1?!tracks[0].muxed:!tracks[1].mime?.startsWith('audio/')||tracks[0].media_id!==tracks[1].media_id))throw Error('画面与声音不属于同一作品');
  return resource;
}
