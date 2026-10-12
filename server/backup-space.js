import {readdir,stat,statfs,link as fileLink} from 'node:fs/promises';
import {join} from 'node:path';
const fail=(message)=>Object.assign(new Error(message),{status:507,publicMessage:message});
const identity=(row,path)=>row.ino>0n?`${row.dev}:${row.ino}`:path;
export async function measureBackupSpace(dataDir,entries) {
  let metadata=0,shared=0,retained=0,copied=0;
  const seen=new Set();
  const liveByName=new Map(),liveIdentities=new Set();
  for(const file of await readdir(join(dataDir,'media'),{withFileTypes:true})) {
    if(!file.isFile()||file.isSymbolicLink())continue;
    const path=join(dataDir,'media',file.name),row=await stat(path,{bigint:true}).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(row){liveByName.set(file.name,row);liveIdentities.add(identity(row,path));}
  }
  for(const entry of entries) {
    const folder=join(dataDir,'backups',entry.id);
    if(entry.format==='zip'){metadata+=Number((await stat(folder,{bigint:true})).size);continue;}
    for(const file of ['data/znote.sqlite','snapshot.json','RESTORE.txt'])metadata+=Number((await stat(join(folder,file),{bigint:true})).size);
    for(const file of await readdir(join(folder,'data/media'),{withFileTypes:true})) {
      if(!file.isFile()||file.isSymbolicLink())throw fail('快照媒体包含非普通文件，无法安全核对占用');
      const path=join(folder,'data/media',file.name),row=await stat(path,{bigint:true}),key=identity(row,path);
      if(seen.has(key))continue;seen.add(key);
      if(liveIdentities.has(key))shared+=Number(row.size);
      else if(liveByName.has(file.name))copied+=Number(row.size);else retained+=Number(row.size);
    }
  }
  return {additional_bytes:metadata+retained+copied,metadata_bytes:metadata,shared_media_bytes:shared,retained_media_bytes:retained,copied_media_bytes:copied,measured_at:new Date().toISOString()};
}
export function assertBackupBudget(additionalBytes,limitBytes) {
  if(additionalBytes>limitBytes)throw fail('恢复快照额外占用将超过容量上限；已停止创建，已有快照保留。请删除不需要的快照或调整上限');
}
export async function assertBackupDisk(directory,newBytes,{inspect=statfs}={}) {
  const fs=await inspect(directory),available=Number(fs.bavail)*Number(fs.bsize);
  if(!Number.isFinite(available)||available<newBytes+256*1024**2)throw fail('磁盘可用空间不足；已停止创建恢复快照，已有快照保留');
}
export async function linkSnapshotMedia(source,target,{link=fileLink}={}) {
  try{await link(source,target);}
  catch(e){if(e.code==='ENOENT')throw e;throw Object.assign(fail(`恢复快照无法共享媒体文件（${e.code||'文件系统错误'}）；未复制原文件，已有快照保留。请检查同盘硬链接支持与目录权限`),{cause:e});}
}
