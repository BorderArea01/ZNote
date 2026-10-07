import React, { useEffect, useState } from 'react';
import { api, send } from './api.js';
import { HelpHint } from './HelpHint.jsx';
export function CaptureSettings() {
  const [mode, setMode] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function load() { try { setMode((await api('/api/capture-settings')).image_size_mode); setMessage(''); } catch (e) { setMessage(e.message); } }
  useEffect(() => { load(); }, []);
  async function save(value) {
    setBusy(true); setMessage('');
    try { const result = await send('/api/capture-settings', { image_size_mode: value }, 'PATCH'); setMode(result.image_size_mode); setMessage('已保存，之后的图片上传和采集自动使用此策略'); }
    catch (e) { setMessage(e.message); }
    finally { setBusy(false); }
  }
  return <section><div className="settings-title"><h3>采集与文件</h3><HelpHint label="大图片处理">仅处理超过 25 MB 的图片。低损压缩保留尺寸，转为 WebP；原图保留文件，单张最多 100 MB。动图或无法压到目标大小的图片自动保留原图，结果写入备注。PSD 保留图层，最多 200 MB。设置保存在服务器，对连接此知识库的网页、手机采集和扩展生效；扩展中明确选择的策略优先。失败项保留供重试，后续图片继续采集。</HelpHint></div>
    <label>超过 25 MB 的图片<select aria-label="超过 25 MB 的图片" value={mode} disabled={!mode || busy} onChange={e => save(e.target.value)}><option value="" disabled>读取设置…</option><option value="original">自动保存原图</option><option value="compress">自动低损压缩</option></select></label>
    {message && <p role="status">{message}</p>}{!mode && <button onClick={load}>重新加载</button>}
  </section>;
}
