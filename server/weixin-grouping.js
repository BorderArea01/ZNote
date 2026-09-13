import {createHash,randomUUID} from 'node:crypto';

export const WEIXIN_MODES=['daily','session','message'];
export const WEIXIN_TIME_ZONE='Asia/Shanghai';
export function weixinDay(date){return new Intl.DateTimeFormat('sv-SE',{timeZone:WEIXIN_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));}
export function weixinNewNoteCommand(message){
  const parts=message.item_list||[];
  if(parts.length!==1||parts[0].type!==1)return null;
  const match=/^\/新篇(?:[ \t]+([^\r\n]{1,80}))?$/.exec((parts[0].text_item?.text||'').trim());
  return match?{title:match[1]?.trim()||''}:null;
}

// Receipts have no message text or media credentials. Keeping their identity
// outside the bounded recent-jobs list makes replay safe after that list rolls.
export function createWeixinGrouping({db,exists}){
  const read=key=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):null;};
  const write=(key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
  const receiptKey=id=>'weixin_receipt_v1:'+id;
  const scope=(state,date)=>'weixin_target_v1:'+createHash('sha256').update(JSON.stringify([state.account?.bot,state.account?.user,state.collection_id,state.merge_mode,state.merge_mode==='daily'?weixinDay(date):'session'])).digest('hex');
  function target(state,date,{rotate=false,title=''}={}){
    const key=scope(state,date);let row=read(key),note=row&&exists(row.id);
    if(!row||rotate||note?.deleted_at||(note&&note.collection_id!==state.collection_id)||(row.created&&!note)){
      row={id:randomUUID(),title:title||`微信收件 · ${weixinDay(date)}`,created:false};write(key,row);
    }
    return {...row,key};
  }
  return {
    target,
    receipt:id=>read(receiptKey(id)),
    wasCreated:id=>!!read('weixin_note_v1:'+id),
    complete(job,items){
      write(receiptKey(job.id),{items,created_at:job.created_at});
      if(job.target){write('weixin_note_v1:'+job.target.id,{created:true});const row=read(job.target.key);if(row?.id===job.target.id)write(job.target.key,{...row,created:true});}
    },
    current(state,date=new Date()){
      if(!state.account||state.merge_mode==='message')return null;
      const row=read(scope(state,date));if(!row)return null;
      const note=exists(row.id);
      if(note?.deleted_at||(note&&note.collection_id!==state.collection_id)||(row.created&&!note))return null;
      return {id:note?.id||null,title:note?.title||row.title,pending:!note};
    },
  };
}
