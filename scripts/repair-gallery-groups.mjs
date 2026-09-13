import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {legacyGalleryPage} from '../shared/gallery-group.js';

export function repairGalleryGroups(db,{apply=false}={}) {
  const candidates=new Map();
  for(const row of db.prepare("SELECT * FROM items WHERE kind='image' AND group_key IS NULL AND group_manual=0 AND deleted_at IS NULL").all()){
    const page=legacyGalleryPage(row);if(!page)continue;
    const key=JSON.stringify([row.collection_id,page.group_key]);
    if(!candidates.has(key))candidates.set(key,[]);
    candidates.get(key).push({row,page});
  }
  const plans=[];let skipped=0;
  for(const pages of candidates.values()){
    const {row,page}=pages[0];pages.sort((a,b)=>a.page.group_index-b.page.group_index);
    if(pages.length!==page.total||pages.some((p,i)=>p.page.group_index!==i||p.page.total!==page.total||p.page.group_title!==page.group_title)||db.prepare('SELECT 1 FROM items WHERE collection_id IS ? AND group_key=?').get(row.collection_id,page.group_key)){skipped++;continue;}
    plans.push(pages);
  }
  if(apply){
    db.exec('BEGIN IMMEDIATE');
    try{
      const date=new Date().toISOString();
      for(const pages of plans)for(const {row,page} of pages){
        if(JSON.stringify(db.prepare('SELECT * FROM items WHERE id=?').get(row.id))!==JSON.stringify(row))throw Error('分组修复期间内容已变化，未应用本次修复');
        db.prepare('UPDATE items SET group_key=?,group_index=?,group_title=?,version=version+1,updated_at=? WHERE id=?').run(page.group_key,page.group_index,page.group_title,date,row.id);
        db.prepare("INSERT INTO events(type,item_id,created_at) VALUES('item.updated',?,?)").run(row.id,date);
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  return {applied:apply,groups:plans.length,images:plans.flat().length,skipped,ids:plans.flat().map(p=>p.row.id)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),i=args.indexOf('--data-dir');if(i<0||!args[i+1])throw Error('请指定 --data-dir');
  const apply=args.includes('--apply');if(apply&&!args.includes('--service-stopped'))throw Error('应用修复前请停止服务并备份，再指定 --apply --service-stopped');
  const db=new DatabaseSync(join(resolve(args[i+1]),'znote.sqlite'),{readOnly:!apply});
  try{db.exec('PRAGMA busy_timeout=5000');console.log(JSON.stringify(repairGalleryGroups(db,{apply})));}finally{db.close();}
}
