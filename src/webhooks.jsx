import { HelpHint } from './HelpHint.jsx';
import React, { useState, useEffect } from 'react';
import { api, send } from './api.js';
import { Dialog } from './ui.jsx';

const labels = { pending: '等待重试', inflight: '正在投递', delivered: '已送达', failed: '重试耗尽' };
export function WebhookSettings() {
  const [hooks, setHooks] = useState([]), [name, setName] = useState(''), [url, setUrl] = useState('');
  const [error, setError] = useState(''), [secret, setSecret] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null), [deliveries, setDeliveries] = useState({ items: [], total: 0, offset: 0 });
  const load = () => api('/api/webhooks').then(setHooks).catch(e => setError(e.message));
  const loadDeliveries = async (id, offset = 0) => setDeliveries(await api(`/api/webhooks/${id}/deliveries?offset=${offset}`));
  useEffect(() => { load(); const timer = setInterval(load, 10000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!selected) return;
    const timer = setInterval(() => loadDeliveries(selected.id, deliveries.offset).catch(e => setError(e.message)), 3000);
    return () => clearInterval(timer);
  }, [selected?.id, deliveries.offset]);
  async function action(fn) {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="webhook-settings">
    <div className="settings-title"><h3>Webhook 事件订阅</h3><HelpHint label="事件订阅">内容创建、修改、删除和恢复时，向接收地址推送带签名的事件。失败会自动重试，投递记录可查看和手动重试。</HelpHint></div>
    <div className="feature-field"><label>订阅名称<input aria-label="Webhook 名称" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="例如：本地图片处理服务" /></label></div>
    <div className="feature-field"><label>接收地址<input aria-label="Webhook 接收地址" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.10:4000/events" /></label></div>
    <button disabled={busy || !name.trim() || !url.trim()} onClick={() => action(async () => {
      const hook = await send('/api/webhooks', { name, url }); setSecret(hook.secret); setName(''); setUrl('');
    })}>创建事件订阅</button>
    {secret && <div className="secret"><strong>请保存签名密钥（仅显示这一次）</strong><code>{secret}</code><button onClick={() => setSecret('')}>已保存密钥</button></div>}
    {error && <p role="alert" className="error">{error}</p>}
    {hooks.map(hook => <div key={hook.id} className="webhook-entry">
      <strong>{hook.name} · {hook.enabled ? '运行中' : '已暂停'}</strong><small>{hook.url}</small><small>待投递 {hook.pending} · 失败 {hook.failed}</small>
      <div className="gallery-controls">
        <button disabled={busy} onClick={() => action(async () => { await loadDeliveries(hook.id); setSelected(hook); })}>查看 {hook.name} 投递记录</button>
        <button disabled={busy} onClick={() => action(() => send(`/api/webhooks/${hook.id}`, { enabled: !hook.enabled }, 'PATCH'))}>{hook.enabled ? '暂停' : '启用'} {hook.name}</button>
        <button disabled={busy} onClick={() => action(() => api(`/api/webhooks/${hook.id}`, { method: 'DELETE' }))}>删除 {hook.name}</button>
      </div>
    </div>)}
    {!hooks.length && <p className="muted">尚未配置事件接收端。可使用项目中的 Webhook 示例启动本地接收器。</p>}
    {selected && <Dialog title={`${selected.name} · 投递记录`} onClose={() => setSelected(null)} className="settings-dialog">
      <div className="feature-body">
        <div className="inline-heading"><span>投递与重试</span><HelpHint label="投递规则">每次投递最多等待 5 秒，失败最多自动尝试 8 次。同一事件重试沿用相同投递 ID，接收端应据此去重。</HelpHint></div>
        {deliveries.items.map(item => <div key={item.id} className="webhook-entry">
          <strong>{JSON.parse(item.payload).type} · {labels[item.status]}</strong>
          <small>{new Date(item.created_at).toLocaleString()} · 已尝试 {item.attempts} 次{item.last_status ? ` · HTTP ${item.last_status}` : ''}</small>
          {item.last_error && <p>{item.last_error}</p>}<code>{item.id}</code>
          <button disabled={busy || item.status === 'inflight'} onClick={() => action(async () => { await send(`/api/webhooks/${selected.id}/deliveries/${item.id}/retry`, {}); await loadDeliveries(selected.id, deliveries.offset); })}>重新投递</button>
        </div>)}
        {!deliveries.items.length && <p>尚无投递。创建或修改内容后，事件会显示在这里。</p>}
        <div className="feature-actions"><button disabled={!deliveries.offset} onClick={() => loadDeliveries(selected.id, Math.max(0, deliveries.offset - 50)).catch(e => setError(e.message))}>上一页</button><span>{deliveries.total} 条记录</span><button disabled={deliveries.offset + deliveries.items.length >= deliveries.total} onClick={() => loadDeliveries(selected.id, deliveries.offset + 50).catch(e => setError(e.message))}>下一页</button></div>
      </div>
    </Dialog>}
  </section>;
}
