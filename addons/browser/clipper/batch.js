import {libraryBatch} from './gallery-save.js';
import {downloadBatch} from './batch-download.js';
const $=id=>document.getElementById(id);let library,group,id;
const announce=()=>{if(group)parent.postMessage({type:'znote-inline-progress',id,action:group.action,title:group.title,height:Math.ceil(document.body.getBoundingClientRect().height),running:!!library?.running||!!group.busy,done:(group.action==='download'?group.states||[]:group.saveStates||[]).filter(s=>['done','duplicate'].includes(s)).length,total:group.images.length},group.owner.origin);};
$('minimize').onclick=()=>{if(group)parent.postMessage({type:'znote-inline-minimize',id},group.owner.origin);};
window.addEventListener('beforeunload',e=>{if(library?.running){e.preventDefault();e.returnValue='';}});
try{
  const result=await chrome.runtime.sendMessage({type:'inline-gallery-load'});if(!result?.ok)throw Error(result?.error||'请从原网页打开批量入库');
  ({id,group}=result.value);group.busy=false;
  new ResizeObserver(announce).observe(document.body);
  $('title').textContent=group.title;$('summary').textContent=`${group.images.length} 张原图 · 按作品成组保存`;
  const rows=group.images.map((_,i)=>{const li=document.createElement('li'),label=document.createElement('span'),state=document.createElement('span');label.textContent=`第 ${i+1} 张`;li.append(label,state);$('pages').append(li);return state;});
  const persist=()=>chrome.storage.session.set({['gallery-'+id]:group});
  const changed=()=>{library?.draw();rows.forEach((row,i)=>row.textContent=library?.label(i)||'待入库');announce();};
  if(group.action==='download')await downloadBatch(group,persist,announce,rows,result.value.startNow);
  else{library=libraryBatch(group,persist,changed,()=>false);await persist();await library.connect();
    if(result.value.startNow)await library.start();}
}catch(e){$('title').textContent='无法打开入库';$('save-status').textContent=e.message;}
