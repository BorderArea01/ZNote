// Recover only the exact group fields lost by the 0.9.8 note-purge regression.
// A full database reference from before the purge is required; never guess groups.
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function repairDetachedNoteGroups(db,reference,{apply=false}={}) {
  const groups=new Map();
  for(const old of reference.prepare("SELECT * FROM items WHERE kind='image' AND group_key LIKE 'note:%'").all()){
    if(!groups.has(old.group_key))groups.set(old.group_key,[]);
    groups.get(old.group_key).push(old);
  }
  const plans=[];
  for(const [key,originals] of groups){
    const noteId=key.slice(5);
    if(db.prepare('SELECT 1 FROM items WHERE id=?').get(noteId))continue;
    if(!db.prepare("SELECT 1 FROM events WHERE item_id=? AND type='item.deleted'").get(noteId))continue;
    const pages=[];let changed=false;
    for(const old of originals){
      const current=db.prepare('SELECT * FROM items WHERE id=?').get(old.id);
      if(!current)continue; // Do not resurrect permanently deleted pages.
      if(current.group_key==='album:'+noteId)continue;
      const ignored=new Set(['group_key','group_index','group_order','group_title','version','updated_at']);
      if(current.group_key!==null||current.group_title!==null||current.group_index!==0||current.group_order!==null||current.version!==old.version+1||Object.keys(old).some(k=>!ignored.has(k)&&current[k]!==old[k])){changed=true;break;}
      pages.push({current,old});
    }
    if(changed)throw Error('A former group has changed since the reference backup; inspect before repairing');
    if(pages.length)plans.push({noteId,pages});
  }
  if(apply){
    const date=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
    try{
      for(const {noteId,pages} of plans)for(const {current,old} of pages){
        if(JSON.stringify(db.prepare('SELECT * FROM items WHERE id=?').get(current.id))!==JSON.stringify(current))throw Error('An item changed during recovery');
        db.prepare('UPDATE items SET group_key=?,group_index=?,group_order=?,group_title=?,version=version+1,updated_at=? WHERE id=?').run('album:'+noteId,old.group_index,old.group_order,old.group_title,date,current.id);
        db.prepare("INSERT INTO events(type,item_id,created_at) VALUES('item.updated',?,?)").run(current.id,date);
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  return {groups:plans.length,images:plans.reduce((sum,p)=>sum+p.pages.length,0),applied:apply};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
  if(!args.includes('--data-dir')||!args.includes('--reference-db'))throw Error('Provide --data-dir and --reference-db');
  const apply=args.includes('--apply');
  if(apply&&!args.includes('--service-stopped'))throw Error('Stop the service and take a complete backup before using --apply --service-stopped');
  const db=new DatabaseSync(join(resolve(value('--data-dir')),'znote.sqlite'),{readOnly:!apply}),reference=new DatabaseSync(resolve(value('--reference-db')),{readOnly:true});
  try{db.exec('PRAGMA busy_timeout=5000');console.log(JSON.stringify(repairDetachedNoteGroups(db,reference,{apply})));}finally{reference.close();db.close();}
}
