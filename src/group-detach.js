import {api,send} from './api.js';

export async function detachImageFromGroup(row,retryPlan=null){
  const input={items:[{id:row.id,version:row.version}],collection_id:row.collection_id||null,mode:'detach',title:'',whole_groups:false,target_id:null,note_mode:'exclude'};
  const plan=retryPlan||await api('/api/item-groups/organize/preview',{method:'POST',body:JSON.stringify(input)});
  if(!plan.changed_count)throw Object.assign(Error('这张图片已经不在图片组中'),{status:409});
  try{
    const result=await send('/api/item-groups/organize',{...plan.input,revision:plan.revision,operation_id:plan.operation_id,prepared_at:plan.prepared_at,undo:true});
    if(result.already_undone)throw Object.assign(Error('这次操作已经撤销，请重新打开图片组'),{status:409});
    return result;
  }catch(error){if(!error.status)error.retryPlan=plan;throw error}
}
