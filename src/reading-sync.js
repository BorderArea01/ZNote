import { api } from './api.js';
const KEY='znote:reading-pending:v1';
function uuid() { const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const s=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; }
function read(key=KEY) { try { const text=localStorage.getItem(key)||'{}';if(text.length>64000)return {};const value=JSON.parse(text);return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; } catch { return {}; } }

// One write in flight, one latest candidate. Uncertain writes retain their exact
// request ID/version; a later device's progress is never silently overwritten.
export class ReadingSync {
  constructor(library,onChange,request=api,{endpoint='/api/reading-progress',storageKey=KEY}={}) {
    this.endpoint=endpoint;this.storageKey=storageKey;
    this.blockedItems=new Set();
    this.library=library;this.key=library||'unfiled';this.owner=uuid();this.onChange=onChange;this.request=request;
    const saved=read(this.storageKey)[this.key];this.active=saved?.active||null;this.next=saved?.next||null;
    this.restoreUnknown=!!this.next&&!this.active;this.recorded=false;
    this.state={data:null,status:'loading',error:''};this.busy=false;this.disposed=false;
    this.generation=0;this.readGeneration=0;
    if(this.active||this.next)this.persist(true);
  }
  emit(value={}) { Object.assign(this.state,value);if(!this.disposed)this.onChange({...this.state}); }
  scoped(data) {
    if(Object.hasOwn(data,'collection_id')&&data.collection_id!==this.library)throw Error('浏览记录知识库不匹配，请刷新重试');
    return {...data,entries:(data.entries||[]).filter(entry=>!Object.hasOwn(entry,'collection_id')||entry.collection_id===this.library)};
  }
  persist(claim=false) {
    try {
      const map=read(this.storageKey);if(!claim&&map[this.key]?.owner&&map[this.key].owner!==this.owner)return;
      if(this.active||this.next)map[this.key]={owner:this.owner,active:this.active,next:this.next,at:Date.now()};else delete map[this.key];
      localStorage.setItem(this.storageKey,JSON.stringify(Object.fromEntries(Object.entries(map).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,32))));
    } catch { this.emit({localError:'本地暂存不可用，请保持页面打开，直到位置同步成功'}); }
  }
  async load() {
    const generation=this.generation,read=++this.readGeneration;
    try { const data=this.scoped(await this.request(this.endpoint+'?collection='+this.key));if(this.disposed||generation!==this.generation||read!==this.readGeneration)return;const pending=this.active||this.next;this.emit({data,status:this.restoreUnknown?'conflict':pending?(['conflict','error'].includes(this.state.status)?this.state.status:'pending'):'ready',error:pending?this.state.error:''});if(this.recorded&&!this.active&&this.next&&!this.restoreUnknown)this.timer=setTimeout(()=>this.flush(),600); }
    catch(e){if(!this.disposed&&generation===this.generation&&read===this.readGeneration)this.emit({status:'error',error:e.message});}
  }
  record(itemId) {
    if(this.disposed||this.blockedItems.has(typeof itemId==='string'?itemId:itemId.item_id))return;
    this.recorded=true;this.restoreUnknown=false;this.next={...(typeof itemId==='string'?{item_id:itemId}:itemId),request_id:uuid()};
    if(this.active?.method==='POST'&&!this.active.attempted&&!this.busy)this.active=null;
    this.prepare();this.persist(true);this.emit();
    clearTimeout(this.timer);
    if(!['conflict','error'].includes(this.state.status))this.timer=setTimeout(()=>this.flush(),600);
  }
  prepare() {
    if(!this.restoreUnknown&&!this.active&&this.next&&this.state.data){this.active={method:'POST',body:{collection_id:this.library,version:this.state.data.version,epoch:this.state.data.epoch,...this.next}};this.next=null;}
  }
  async flush() {
    clearTimeout(this.timer);if(this.busy)return;
    this.prepare();if(!this.active)return;
    const action=this.active;action.attempted=true;const generation=++this.generation;this.controller=new AbortController();this.busy=true;this.emit({status:'saving',error:''});this.persist();
    try {
      const data=await this.request(this.endpoint,{method:action.method,body:JSON.stringify(action.body),keepalive:true,signal:this.controller.signal});
      if(generation!==this.generation)return;
      this.state.data=this.scoped(data);this.active=null;this.prepare();this.persist();this.emit({status:this.active?'pending':'ready',error:''});
      if(this.active)this.timer=setTimeout(()=>this.flush(),this.disposed?0:600);
    }catch(e){if(generation===this.generation)this.emit({status:e.status===409?'conflict':'error',error:e.message});}
    finally{this.busy=false;}
  }
  async retry() { if(!this.state.data||(!this.active&&!this.next))await this.load();await this.flush(); }
  allowItem(id) { this.blockedItems.delete(id); }
  cancelItems(ids,{block=false}={}) {
    const affected=new Set(ids);let changed=false;
    if(block)for(const id of ids)this.blockedItems.add(id);
    if(this.active?.method==='POST'&&affected.has(this.active.body.item_id)){this.generation++;this.controller?.abort();this.active=null;changed=true;}
    if(this.next&&affected.has(this.next.item_id)){this.next=null;changed=true;}
    if(changed){clearTimeout(this.timer);this.persist();this.emit({status:this.active||this.next?'pending':'ready',error:''});}
  }
  async discard() { if(this.busy)return;clearTimeout(this.timer);this.active=null;this.next=null;this.restoreUnknown=false;this.recorded=false;this.persist();this.emit({status:'ready',error:''});await this.load(); }
  async replaceWithLatest() {
    if(this.busy)return;
    await this.load();if(!this.state.data||this.state.status==='error')return;
    const candidate=this.next||this.active?.body;
    if(!candidate)return;
    const clearing=!this.next&&this.active?.method==='DELETE';
    this.restoreUnknown=false;
    const {collection_id,version,epoch,request_id,...position}=candidate;
    this.active={method:clearing?'DELETE':'POST',body:{collection_id:this.library,version:this.state.data.version,epoch:this.state.data.epoch,request_id:uuid(),...(!clearing?position:{})}};this.next=null;this.persist(true);await this.flush();
  }
  async clear() {
    if(this.busy||!this.state.data)return;
    clearTimeout(this.timer);this.next=null;this.active={method:'DELETE',body:{collection_id:this.library,version:this.state.data.version,epoch:this.state.data.epoch,request_id:uuid()}};this.persist(true);await this.flush();
  }
  dispose() { clearTimeout(this.timer);if(!['error','conflict'].includes(this.state.status))this.flush();this.disposed=true; }
}
