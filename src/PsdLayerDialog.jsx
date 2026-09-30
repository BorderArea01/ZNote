import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Eye, EyeOff, Layers } from 'lucide-react';
import { api } from './api.js';
import { Dialog } from './ui.jsx';
import { HelpHint } from './HelpHint.jsx';
import './psd-layers.css';

function flatten(layers, depth = 0) {
  return layers.flatMap(layer => [{ ...layer, depth }, ...flatten(layer.children || [], depth + 1)]);
}
function displayOrder(layers, depth = 0) {
  return [...layers].reverse().flatMap(layer => [{ ...layer, depth }, ...displayOrder(layer.children || [], depth + 1)]);
}

export function PsdLayerDialog({ item, onClose }) {
  const [document, setDocument] = useState(null);
  const [selected, setSelected] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState({});
  const [mode, setMode] = useState('composite');
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    setDocument(null);
    setSelected(null);
    api(`/api/items/${item.id}/psd-layers`).then(value => {
      if (!active) return;
      setDocument(value);
      const entries = flatten(value.layers);
      setVisibility(Object.fromEntries(entries.map(layer => [layer.path, !layer.hidden])));
      setSelected(entries.find(layer => !layer.group && layer.width && layer.height)?.path || null);
      setMode('composite');
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [item.id, reload]);
  const all = useMemo(() => flatten(document?.layers || []), [document]);
  const display = useMemo(() => displayOrder(document?.layers || []), [document]);
  const current = all.find(layer => layer.path === selected);
  const flags = all.map(layer => visibility[layer.path] ? '1' : '0').join('');
  const originalFlags = all.map(layer => layer.hidden ? '0' : '1').join('');
  const changed = flags !== originalFlags;
  const search = query.trim().toLocaleLowerCase();
  const visible = display.filter(layer => {
    if (search) return layer.name.toLocaleLowerCase().includes(search);
    const parts = layer.path.split('.');
    return !parts.slice(1).some((_, index) => collapsed.has(parts.slice(0, index + 1).join('.')));
  });
  const layerSource = current ? `/media/${item.id}/layer/${current.path}` : null;
  const source = mode === 'composite' ? changed ? `/media/${item.id}/composite?v=${flags}` : item.preview_url : layerSource;
  useEffect(() => { setImageError(false); }, [source]);
  const choose = layer => {
    if (layer.group) setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(layer.path)) next.delete(layer.path); else next.add(layer.path);
      return next;
    });
    else { setSelected(layer.path); setMode('layer'); setImageError(false); setAttempt(value => value + 1); }
  };
  const toggle = layer => {
    setVisibility(previous => ({ ...previous, [layer.path]: !previous[layer.path] }));
    setMode('composite');
  };
  return <Dialog title="查看 PSD 图层" onClose={onClose} className="psd-layer-dialog">
    <div className="psd-layer-heading">
      <span><Layers size={16}/>{document ? `${document.count} 个图层与组` : error || '正在读取图层…'}</span>
      <HelpHint label="PSD 图层预览">点眼睛可临时开关图层或整组并重新合成预览；点名称可查看单层并导出透明 PNG。重算画面对 Photoshop 的剪贴蒙版、图层效果和部分混合模式只能近似呈现，原文件自带的合成画面始终保留。操作不会修改 PSD 原文件。</HelpHint>
    </div>
    {error && <div className="psd-layer-error" role="alert">{error}<button onClick={() => setReload(value => value + 1)}>重试</button></div>}
    <div className="psd-layer-body">
      <div className="psd-layer-sidebar">
        <input type="search" aria-label="搜索图层" placeholder="搜索图层" value={query} onChange={event => setQuery(event.target.value)}/>
        <div className="psd-layer-list" role="group" aria-label="PSD 图层">
          {visible.map(layer => <div key={layer.path}
            data-path={layer.path}
            className={`psd-layer-row${layer.path === selected ? ' is-selected' : ''}${!visibility[layer.path] ? ' is-hidden' : ''}`}
            style={{ paddingLeft: `${10 + Math.min(layer.depth, 12) * 16}px` }}
          >
            <button type="button" className="psd-layer-select"
              aria-label={`${layer.group ? '图层组' : '图层'} ${layer.name}`}
              aria-current={layer.path === selected ? 'true' : undefined}
              onClick={() => choose(layer)}>
              {layer.group ? collapsed.has(layer.path) ? <ChevronRight size={15}/> : <ChevronDown size={15}/> : <span className="psd-layer-leaf"/>}
              <span className="psd-layer-name">{layer.name}</span>
            </button>
            <button type="button" className="psd-layer-visibility" aria-label={`${visibility[layer.path] ? '隐藏' : '显示'}${layer.group ? '图层组' : '图层'} ${layer.name}`} aria-pressed={!!visibility[layer.path]} onClick={() => toggle(layer)}>
              {visibility[layer.path] ? <Eye size={15}/> : <EyeOff size={15}/>}
            </button>
          </div>)}
          {document && !visible.length && <span className="psd-layer-empty">没有匹配的图层</span>}
        </div>
      </div>
      <div className="psd-layer-preview">
        <div className="psd-layer-tabs">
          <button className={mode === 'composite' ? 'is-active' : ''} onClick={() => setMode('composite')}>合成画面</button>
          <button className={mode === 'layer' ? 'is-active' : ''} disabled={!current} onClick={() => setMode('layer')}>当前图层</button>
          {changed && <button className="psd-layer-reset" onClick={() => setVisibility(Object.fromEntries(all.map(layer => [layer.path, !layer.hidden])))}>恢复原始显示</button>}
        </div>
        {source && document ? <>
          <div className="psd-layer-canvas">
            {imageError ? <div role="alert">该图层预览失败<button onClick={() => { setImageError(false); setAttempt(value => value + 1); }}>重试</button></div>
              : <img key={`${source}:${attempt}`} src={source} alt={`图层：${current.name}`} onError={() => setImageError(true)}/>}
          </div>
          <div className="psd-layer-footer">
            <span title={mode === 'layer' ? current?.name : ''}>{mode === 'layer' ? current?.name : changed ? '重新合成预览 · 复杂效果可能有差异' : '原文件合成画面'}</span>
            {mode === 'layer' && current && <a href={`${layerSource}?download=1`} download={`layer-${current.path}.png`}><Download size={15}/>导出 PNG</a>}
          </div>
        </> : <div className="psd-layer-placeholder">{document ? '选择一个图层查看' : '正在读取 PSD 图层…'}</div>}
      </div>
    </div>
  </Dialog>;
}
