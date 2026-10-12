// Playback can finish after the preview has closed or changed soundtracks.
// Ignore that old attempt, and leave a rejected autoplay recoverable by a click.
export async function playBgmAudio(audio,{autoplay=false,onError,isCurrent=()=>true}){
  onError('');
  try{
    if(audio.error)audio.load();
    await audio.play();
    return isCurrent();
  }catch(error){
    if(!isCurrent()||error?.name==='AbortError')return false;
    onError(autoplay&&error?.name==='NotAllowedError'
      ?'浏览器阻止了自动播放，点击播放配乐即可'
      :'配乐暂时无法播放，请重试');
    return false;
  }
}
