import {rename,stat} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';

// Windows can briefly deny publication while a file scanner/reader holds a
// handle. graceful-fs uses the same narrowly scoped error set for rename.
// Keep the atomic operation; never fall back to copying/removing its target.
export async function publishRename(from,to,{replace=false,platform=process.platform,move=rename,inspect=stat,wait=sleep}={}) {
  const delays=[20,40,80,160,320,500,500,500,500,500];
  for(let attempt=0;;attempt++) {
    try{return await move(from,to)}catch(error) {
      if(platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=delays.length)throw error;
      if(!replace) {
        try{await inspect(to);throw error}catch(destinationError){if(destinationError.code!=='ENOENT')throw error;}
      }
      await wait(delays[attempt]);
    }
  }
}
