import test from 'node:test';
import assert from 'node:assert/strict';
import { changeSelection, collectSelection, resolveSelectionCards } from '../src/selection.js';

test('selection ranges, page inversion and limits preserve off-page choices atomically', () => {
  assert.deepEqual(changeSelection(['outside','a'],['a','b'],'invert'),['outside','b']);
  assert.deepEqual(changeSelection(['a','b'],['a','b']),[]);
  assert.deepEqual(changeSelection(['a'],['a','b']),['a','b']);
  assert.deepEqual(changeSelection(['a','b','c'],['b','c'],'remove'),['a']);
  const full=Array.from({length:10000},(_,i)=>String(i));
  assert.throws(()=>changeSelection(full,['extra'],'add'),/10000/);
  assert.equal(full.length,10000);
  assert.equal(changeSelection(full,['0','extra'],'invert').length,10000);
});

test('folded cards resolve complete groups in display order with bounded concurrent reads',async()=>{
  const cards=Array.from({length:7},(_,i)=>({id:String(i),group_key:'g'+i,group_count:1}));
  let active=0,peak=0,reads=0;
  const result=await resolveSelectionCards(async path=>{
    const id=new URL(path,'http://local').searchParams.get('id');reads++;peak=Math.max(peak,++active);
    await new Promise(resolve=>setTimeout(resolve,8-Number(id)));active--;
    return {collection_id:'lib',trash:false,group_key:'g'+id,items:[{id:id+'a',version:3,kind:'image'},{id:id+'b',version:4,kind:'image'}]};
  },[...cards,cards[0],{id:'note',kind:'note',version:1}],{collectionId:'lib',trash:false});
  assert.equal(reads,7);assert.ok(peak<=4);assert.equal(result.rows.length,15);
  assert.deepEqual(result.rows.map(row=>row.id),[...cards.flatMap(card=>[card.id+'a',card.id+'b']),'note']);
  assert.deepEqual(result.groups.g0,['0a','0b']);
});

test('folded selection rejects moved, regrouped, deleted and failed snapshots atomically',async()=>{
  const cards=[{id:'a',group_key:'g',group_count:1}],scope={collectionId:'lib',trash:false};
  const snapshot={collection_id:'lib',trash:false,group_key:'g',items:[{id:'a',version:1}]};
  for(const patch of [{collection_id:'other'},{trash:true},{group_key:'other'}])await assert.rejects(resolveSelectionCards(async()=>({...snapshot,...patch}),cards,scope),/变化|移动/);
  await assert.rejects(resolveSelectionCards(async()=>{throw Error('断网')},cards,scope),/断网/);
  const controller=new AbortController();await assert.rejects(resolveSelectionCards(async()=>{controller.abort();return snapshot},cards,{...scope,signal:controller.signal}),{name:'AbortError'});
});

test('select all reads every filtered page with one cursor and retains only selection metadata',async()=>{
  const requests=[],progress=[];
  const rows=await collectSelection(async path=>{
    const p=new URL(path,'http://localhost').searchParams;requests.push(p);
    const offset=Number(p.get('offset'));
    return {total:205,event_cursor:42,items:Array.from({length:Math.min(100,205-offset)},(_,i)=>({id:String(offset+i),version:1,kind:'note',content:'not retained',title:'Note'}))};
  },'collection=library&tags=%5B%22art%22%5D&tag_mode=all&favorite=true&sort=title&anchor=old&grouped=true',{onProgress:v=>progress.push(v.loaded)});
  assert.equal(rows.length,205);assert.deepEqual(progress,[100,200,205]);
  assert.equal(requests[1].get('cursor'),'42');assert.equal(requests[0].has('anchor'),false);
  assert.ok(requests.every(p=>p.get('collection')==='library'&&p.get('tags')==='["art"]'&&p.get('favorite')==='true'&&p.get('grouped')==='false'));
  assert.equal(rows[0].content,undefined);
});

test('select all never commits partial results after cancellation, conflicts or overflow',async()=>{
  const controller=new AbortController();
  await assert.rejects(collectSelection(async()=>{controller.abort();return {items:[],total:0,event_cursor:1};},'',{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(collectSelection(async()=>({items:[],total:10001,event_cursor:1}),''),/10000/);
  let n=0;
  await assert.rejects(collectSelection(async()=>({total:101,event_cursor:++n,items:Array.from({length:n===1?100:1},(_,i)=>({id:String(i)}))}),''),/变化/);
  await assert.rejects(collectSelection(async()=>{if(n++>2)throw Error('断网');return {total:101,event_cursor:1,items:Array.from({length:100},(_,i)=>({id:String(i)}))};},''),/断网/);
});
