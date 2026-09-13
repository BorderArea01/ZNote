import {useEffect, useRef} from 'react';

const handlers = new Set();
let pending = false;
export function requestBack() {
  if (pending) return true;
  for (const entry of [...handlers].sort((a,b)=>b.priority-a.priority)) {
    const result = entry.run();
    if (result === false) continue;
    if (result?.then) {
      pending = true;
      Promise.resolve(result).catch(()=>{}).finally(()=>{pending=false;});
    }
    return true;
  }
  return false;
}
// Invoked only in the current renderer; this grants no native capabilities.
window.ZNoteNavigation = Object.freeze({back:requestBack});
export function useAppBack(callback, enabled=true, priority=0) {
  const latest=useRef(callback);latest.current=callback;
  useEffect(()=>{
    if(!enabled)return;
    const entry={priority,run:()=>latest.current()};handlers.add(entry);
    return ()=>handlers.delete(entry);
  },[enabled,priority]);
}
