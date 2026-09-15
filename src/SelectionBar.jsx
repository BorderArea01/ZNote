import React from 'react';
import { Hash, Layers, Star, Trash2, RefreshCw, X, Loader2, FolderInput, CheckCheck, FlipHorizontal2, ArrowUpToLine, ChevronUp } from 'lucide-react';
import { HelpHint } from './HelpHint.jsx';

export function SelectionBar({ count, loadedCount, allLoaded, someLoaded, total, locked, progress, working, trash, imagesOnly, allFavorite, showStart, showPrevious, startLabel, previousLabel, onStart, onPrevious, onLoaded, onAll, onInvert, onClear, onExit, onCancel, onTags, onOrganize, onGroup, onFavorite, onTrash, onPurge }) {
  const disabled = !count || locked;
  return <section className="selection-bar batch-toolbar" aria-label="批量管理">
    <div className="selection-summary">
      <label><input type="checkbox" aria-label="选择当前页全部内容" checked={allLoaded} ref={node=>{if(node)node.indeterminate=someLoaded&&!allLoaded}} disabled={locked||!loadedCount} onChange={onLoaded}/>已加载 {loadedCount} 项</label>
      <strong className="selection-count" role="status" aria-live="polite">已选 {count} 项</strong>
      {working&&<span className="selection-working" role="status"><Loader2 size={14} className="spin"/>正在处理…</span>}
      <HelpHint label="多选快捷操作">图片组保持折叠，点击组卡片选择或取消整组（含筛选隐藏、未加载的成员），「选择组内图片」可单独挑选。Shift 点击连续选择，Ctrl / ⌘ 点击直接进入多选。当前页全选和反选按卡片操作；Ctrl / ⌘ A 只全选当前筛选匹配的内容。Esc 清除选择，再按一次退出。单次最多 10000 项。</HelpHint>
      <button className="selection-exit icon-button" aria-label="退出多选" title="退出多选" disabled={locked&&!progress} onClick={onExit}><X size={17}/></button>
    </div>
    <div className="selection-controls">
      <div className="selection-picking">
        {showStart&&<button disabled={locked} onClick={onStart}><ArrowUpToLine size={15}/>{startLabel}</button>}
        {showPrevious&&<button disabled={locked} onClick={onPrevious}><ChevronUp size={15}/>{previousLabel}</button>}
        <button disabled={locked||!total} onClick={onAll}><CheckCheck size={15}/>全选筛选结果</button>
        <button disabled={locked||!loadedCount} onClick={onInvert}><FlipHorizontal2 size={15}/>反选已加载</button>
        <button disabled={!count||locked} onClick={onClear}>清除选择</button>
      </div>
      <div className="selection-operations">
        {!trash && <>
          <button disabled={disabled} onClick={onTags}><Hash size={15}/>批量标签</button>
          <button disabled={disabled} onClick={onOrganize}><FolderInput size={15}/>移动 / 收藏</button>
          <button disabled={disabled} onClick={onFavorite}><Star size={15}/>{allFavorite?'取消收藏':'收藏所选'}</button>
          <button disabled={disabled||!imagesOnly} onClick={onGroup}><Layers size={15}/>整理图片组</button>
        </>}
        <button className={trash?'':'danger'} disabled={disabled} onClick={onTrash}>{trash?<RefreshCw size={15}/>:<Trash2 size={15}/>} {trash?'恢复所选':'删除所选'}</button>
        {trash&&<button className="danger" disabled={disabled} onClick={onPurge}><Trash2 size={15}/>永久删除所选</button>}
      </div>
    </div>
    {progress && <div className="selection-progress" role="status"><Loader2 size={15} className="spin"/><span>正在选择 {progress.loaded} / {progress.total} 项</span><button onClick={onCancel}>取消</button></div>}
  </section>;
}
