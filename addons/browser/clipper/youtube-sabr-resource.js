import {youtubeMediaUrl} from './youtube-formats.js';
export function youtubeSabrResource(player,request){
  const base=youtubeMediaUrl(player.streamingData?.serverAbrStreamingUrl),url=youtubeMediaUrl(request?.url);
  if(!base||!url||!url.searchParams.has('sabr')||!base.searchParams.get('id')||base.searchParams.get('id')!==url.searchParams.get('id')||!request.body||request.body.length>180000)return null;
  const formats=(player.streamingData.adaptiveFormats||[]).filter(f=>!f.drmFamilies?.length&&!f.drmTrackType&&Number(f.contentLength)>0&&/^\d+$/.test(f.lastModified||''));
  const videos=formats.filter(f=>f.mimeType?.startsWith('video/')).sort((a,b)=>Number(/avc1/.test(b.mimeType))-Number(/avc1/.test(a.mimeType))||b.height-a.height);
  const audios=formats.filter(f=>f.mimeType?.startsWith('audio/')).sort((a,b)=>Number(/mp4a/.test(b.mimeType))-Number(/mp4a/.test(a.mimeType))||b.bitrate-a.bitrate);
  for(const video of videos){const audio=audios.find(a=>Number(a.contentLength)+Number(video.contentLength)<=500*1024*1024);if(!audio)continue;
    const tracks=[video,audio].map(f=>({itag:f.itag,size:Number(f.contentLength),mime:f.mimeType,height:Number(f.height)||0,lastModified:f.lastModified}));
    return {tracks,sabr:{url:url.href,request:request.body,formats:[video,audio].map(f=>Object.fromEntries(['itag','lastModified','xtags','mimeType','width','height','fps','contentLength','bitrate','averageBitrate','quality','qualityLabel','audioQuality','audioChannels','approxDurationMs','audioTrack','isDrc'].filter(k=>f[k]!==undefined).map(k=>[k,f[k]]))),duration:Number(player.videoDetails.lengthSeconds)}};
  }
  return null;
}
