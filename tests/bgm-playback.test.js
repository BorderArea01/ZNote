import test from 'node:test';
import assert from 'node:assert/strict';
import {playBgmAudio} from '../src/bgm-playback.js';

test('blocked autoplay explains the manual recovery, which clears the warning',async()=>{
  let error='',blocked=true;
  const audio={play:async()=>{if(blocked)throw Object.assign(Error(),{name:'NotAllowedError'});}};
  const options={autoplay:true,onError:value=>{error=value;}};
  assert.equal(await playBgmAudio(audio,options),false);
  assert.match(error,/点击播放配乐/);
  blocked=false;
  assert.equal(await playBgmAudio(audio,{...options,autoplay:false}),true);
  assert.equal(error,'');
});
test('a late rejection from a closed preview cannot overwrite the next soundtrack status',async()=>{
  let reject,current=true,error='';
  const attempt=playBgmAudio({play:()=>new Promise((_,fail)=>{reject=fail;})},{autoplay:true,onError:value=>{error=value;},isCurrent:()=>current});
  current=false;error='next soundtrack';reject(Object.assign(Error(),{name:'NotAllowedError'}));
  assert.equal(await attempt,false);
  assert.equal(error,'next soundtrack');
});
test('closing or pausing during load is not shown as a playback failure',async()=>{
  let error='';
  assert.equal(await playBgmAudio({play:async()=>{throw Object.assign(Error(),{name:'AbortError'});}},{autoplay:true,onError:value=>{error=value;}}),false);
  assert.equal(error,'');
});
test('a failed audio source reloads on retry and network errors remain visible',async()=>{
  let loaded=0,error='';
  const audio={error:{code:2},load:()=>loaded++,play:async()=>{throw Object.assign(Error(),{name:'NotSupportedError'});}};
  assert.equal(await playBgmAudio(audio,{autoplay:true,onError:value=>{error=value;}}),false);
  assert.equal(loaded,1);
  assert.match(error,/无法播放/);
});
