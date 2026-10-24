import {z} from 'zod';

export const pluginId=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const pluginFile=z.object({id:z.uuid(),name:z.string().min(1).max(240),file_key:z.string().regex(/^(?:plugin-[a-f0-9-]{36}|[a-f0-9-]{36}\.bin)$/),bytes:z.number().int().positive().max(200*1024*1024),hash:z.string().regex(/^[a-f0-9]{64}$/),created_at:z.iso.datetime()}).strict();
export const pluginFileList=z.array(pluginFile).max(10000);
export function pluginFiles(db,id){
  const value=db.prepare('SELECT value FROM settings WHERE key=?').get('plugin.files:'+pluginId.parse(id))?.value;
  return value?pluginFileList.parse(JSON.parse(value)):[];
}
export function allPluginFiles(db){
  return db.prepare("SELECT key,value FROM settings WHERE key LIKE 'plugin.files:%'").all().flatMap(row=>{
    pluginId.parse(row.key.slice('plugin.files:'.length));return pluginFileList.parse(JSON.parse(row.value));
  });
}
