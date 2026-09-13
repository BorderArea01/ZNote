import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowUp, ArrowDown, Copy, Scissors, Trash2, GripVertical, Pencil, Check, Plus, Undo2} from 'lucide-react';
import {readMessageBlocks, writeMessageBlocks} from '../shared/message-blocks.js';
import {HelpHint} from './HelpHint.jsx';
import './message-blocks.css';

export function MessageBlocks({content, onChange, render, disabled, copyText, notify}) {
  const parsed=useMemo(()=>readMessageBlocks(content,true),[content]),blocks=parsed.blocks;
  const [editing,setEditing]=useState(null),[drag,setDrag]=useState(null),[target,setTarget]=useState(null),[undo,setUndo]=useState([]);
  const latest=useRef(content),pointer=useRef(null),scroller=useRef(null),point=useRef(null);latest.current=content;
  useEffect(()=>{if(!drag)return;let frame;const tick=()=>{if(pointer.current&&point.current)hover(point.current.x,point.current.y);frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[drag]);
  function change(next,remember=true){if(disabled)return;const value=writeMessageBlocks(next);if(remember)setUndo(list=>[...list.slice(-9),{before:content,after:value}]);onChange(value);}
  function move(from,to){if(disabled||from===to)return;const next=[...blocks],a=next.findIndex(b=>b.id===from),b=next.findIndex(b=>b.id===to);if(a<0||b<0)return;next.splice(b,0,next.splice(a,1)[0]);change(next);setDrag(null);setTarget(null);}
  async function copy(block,cut=false){const original=latest.current;try{await copyText(block.content);if(cut){if(latest.current!==original){notify('已复制；正文刚有变化，未执行剪切');return;}change(blocks.filter(b=>b.id!==block.id));}notify(cut?'已剪切这条消息，可撤销':'已复制消息 Markdown');}catch{notify('复制失败，正文已保留，请重试');}}
  function hover(x,y){const el=document.elementFromPoint(x,y)?.closest('[data-message-id]');if(el&&scroller.current?.contains(el))setTarget(el.dataset.messageId);const box=scroller.current?.getBoundingClientRect();if(box){if(y<box.top+55)scroller.current.scrollTop-=24;else if(y>box.bottom-55)scroller.current.scrollTop+=24;}}
  const undoable=undo.at(-1)?.after===content;
  return <div className="message-blocks markdown-preview" ref={scroller} aria-label="消息内容块">
    <div className="message-list-heading"><span>{blocks.length} 条消息</span><HelpHint label="消息块说明">{parsed.legacy?'旧笔记按已有分隔线识别消息；分块编辑后会记录明确边界。':''}拖动把手调整顺序，也可使用上下移动按钮。修改会保存为本地草稿，点击底部保存后同步到知识库。删除消息不删除素材文件。</HelpHint>
      {undoable&&<button disabled={disabled} onClick={()=>{onChange(undo.at(-1).before);setUndo(list=>list.slice(0,-1));}}><Undo2 size={14}/>撤销操作</button>}
    </div>
    {blocks.map((block,index)=><section key={block.id} data-message-id={block.id} className={`message-block ${drag===block.id?'is-dragging':''} ${target===block.id&&drag!==block.id?'is-drop-target':''}`}
      onDragOver={e=>{if(!drag)return;e.preventDefault();e.dataTransfer.dropEffect='move';hover(e.clientX,e.clientY);setTarget(block.id);}}
      onDrop={e=>{if(!drag)return;e.preventDefault();move(drag,block.id);}}>
      <div className="message-block-toolbar"><span className="message-number">{String(index+1).padStart(2,'0')}</span>
        <button className="message-grip" aria-label={`拖动第 ${index+1} 条消息`} title="拖动排序；方向键上下移动" disabled={disabled}
          onDragStart={e=>{setDrag(block.id);e.dataTransfer.setData('text/znote-message',block.id);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{setDrag(null);setTarget(null);}}
          onKeyDown={e=>{if(e.key==='ArrowUp'&&index>0){e.preventDefault();move(block.id,blocks[index-1].id);}if(e.key==='ArrowDown'&&index<blocks.length-1){e.preventDefault();move(block.id,blocks[index+1].id);}}}
          onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();pointer.current=block.id;point.current={x:e.clientX,y:e.clientY};setDrag(block.id);e.currentTarget.setPointerCapture(e.pointerId);}}
          onPointerMove={e=>{if(pointer.current){point.current={x:e.clientX,y:e.clientY};hover(e.clientX,e.clientY);}}}
          onPointerUp={e=>{if(!pointer.current)return;const el=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-message-id]');if(el&&scroller.current?.contains(el))move(pointer.current,el.dataset.messageId);pointer.current=null;setDrag(null);setTarget(null);}}
          onPointerCancel={()=>{pointer.current=null;setDrag(null);setTarget(null);}}><GripVertical size={16}/></button>
        <div className="message-actions">
          <button title={editing===block.id?'完成编辑':'编辑这条消息'} aria-label={editing===block.id?'完成消息编辑':'编辑消息'} disabled={disabled} onClick={()=>setEditing(editing===block.id?null:block.id)}>{editing===block.id?<Check size={15}/>:<Pencil size={15}/>}</button>
          <button title="上移" aria-label="上移消息" disabled={disabled||index===0} onClick={()=>move(block.id,blocks[index-1].id)}><ArrowUp size={15}/></button>
          <button title="下移" aria-label="下移消息" disabled={disabled||index===blocks.length-1} onClick={()=>move(block.id,blocks[index+1].id)}><ArrowDown size={15}/></button>
          <button title="复制 Markdown" aria-label="复制消息" onClick={()=>copy(block)}><Copy size={15}/></button>
          <button title="剪切" aria-label="剪切消息" disabled={disabled} onClick={()=>copy(block,true)}><Scissors size={15}/></button>
          <button title="删除消息，可撤销" aria-label="删除消息" className="message-delete" disabled={disabled} onClick={()=>change(blocks.filter(b=>b.id!==block.id))}><Trash2 size={15}/></button>
        </div>
      </div>
      {editing===block.id?<textarea className="message-block-editor" aria-label={`第 ${index+1} 条消息正文`} value={block.content} disabled={disabled} onChange={e=>change(blocks.map(b=>b.id===block.id?{...b,content:e.target.value}:b),false)} />:<div className="message-block-body">{block.content?render(block.content):<p className="muted">空消息</p>}</div>}
    </section>)}
    {!disabled&&<button className="message-add" onClick={()=>{const id=crypto.randomUUID?.()||'new-'+Date.now();change([...blocks,{id,content:''}]);setEditing(id);}}><Plus size={16}/>添加内容块</button>}
  </div>;
}
