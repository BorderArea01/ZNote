import { api, settings, serverUrl, limitedImage, saveImage } from './client.js';
import { imageFilename } from './gallery-download.js';
import { galleryGrouping } from './gallery-group.js';

// The gallery page owns the sequential job. Only progress and destination are
// stored with its ticket; API credentials stay in the existing connection settings.
export function libraryBatch(group, persist, changed, downloading) {
  const $ = id => document.getElementById(id);
  let running = false, ready = false, controller, connection, uploading = false, needsDestination=false;
  const states = group.saveStates = group.images.map((_, i) =>
    group.saveSchema===1&&['done', 'duplicate', 'failed'].includes(group.saveStates?.[i]) ? group.saveStates[i] : 'pending');
  const complete = state => state === 'done' || state === 'duplicate';
  const count = () => states.filter(complete).length;
  function draw() {
    $('save').disabled = !ready || running || downloading() || count() === states.length;
    $('save').textContent = count() === states.length ? '全部已入库' : states.some(s => s !== 'pending') ? '重试未入库' : '保存全部到知识库';
    $('save-cancel').hidden = !running;
    $('tags').disabled = !ready || running || !!group.saveTarget;
    $('collection').disabled = (!ready&&!needsDestination) || running || !!group.saveTarget;
    $('reconnect').disabled = running;
    $('save-progress').max = states.length;
    $('save-progress').value = count();
  }
  async function connect() {
    ready = false; needsDestination=false; changed();
    try {
      connection = await settings();
      const destination=group.saveTarget || group.initialTarget;
      if (destination && serverUrl(connection.server) !== destination.server)
        throw Error('连接地址已更改，请恢复原连接后继续，或从原网页新建批量入库任务');
      const me = await api('/api/me', {}, connection);
      if (me.scope !== 'write') throw Error('批量入库需要 write 写入令牌');
      const collections = await api('/api/collections', {}, connection);
      const selected = destination?.collection_id ?? connection.collection_id;
      $('collection').replaceChildren(new Option('未分类', ''), ...collections.map(c => new Option(c.name, c.id)));
      if (selected && !collections.some(c => c.id === selected)) {
        if(group.saveTarget)throw Error('目标知识库已不存在，请从原网页新建任务并选择其他知识库');
        $('collection').value='';needsDestination=true;
        throw Error('上次的知识库已不存在，请重新选择后点击保存');
      }
      $('collection').value = selected;
      $('tags').value = destination?.tags ?? connection.tags;
      ready = true;
      $('save-status').textContent = count() ? `已入库 ${count()} / ${states.length} 张，可继续未完成项。` : '选择知识库后保存整组原图。';
    } catch (e) { $('save-status').textContent = e.message; }
    changed();
  }
  async function saveAll() {
    if (!ready || running || downloading() || count() === states.length) return;
    running = true; group.busy=true;controller = new AbortController(); changed();
    try {
      // Pin this job to its selected server/library even if another extension
      // window changes defaults while originals are still being transferred.
      const latest = await settings();
      if (serverUrl(latest.server) !== serverUrl(connection.server)) throw Error('连接地址已更改，请点击重新连接');
      const target = group.saveTarget ||= { server: serverUrl(connection.server), collection_id: $('collection').value, tags: $('tags').value.trim() };
      const config = { ...latest, ...target };
      const grouping=await galleryGrouping(group);
      group.saveSchema=1;
      await persist(); changed();
      let lastError = '';
      for (let i = 0; i < states.length; i++) {
        if (controller.signal.aborted) break;
        if (complete(states[i])) continue;
        states[i] = 'active'; changed();
        $('save-status').textContent = `正在入库 ${i + 1} / ${states.length}…`;
        try {
          const blob = await limitedImage(group.images[i], AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]));
          controller.signal.throwIfAborted();
          uploading = true;
          // A stop waits for an in-flight upload's response so we can record a
          // confirmed result. Ambiguous network failures are safe to retry via
          // the server's existing hash + collection deduplication.
          const item = await saveImage(blob, {
            filename: imageFilename(group.title, i, group.images[i], blob.type).split('/').pop(),
            title: `${group.title.slice(0, 175)} · ${String(i + 1).padStart(3, '0')}`,
            ...grouping, group_index:i, image_url: group.images[i],
            capture_note: `作品：${group.title}\n页码：${i + 1} / ${states.length}`,
          }, AbortSignal.timeout(30000), config);
          states[i] = item.duplicate ? 'duplicate' : 'done';
        } catch (e) {
          states[i] = controller.signal.aborted && !uploading ? 'pending' : 'failed';
          lastError = e.message;
        } finally { uploading = false; }
        await persist(); changed();
      }
      const failed = states.filter(s => s === 'failed').length;
      $('save-status').textContent = `${controller.signal.aborted ? '已停止。' : ''}已入库 ${count()} / ${states.length} 张${failed ? `，${failed} 张失败：${lastError}` : ''}${count() === states.length ? '。' : '，可重试未完成项。'}`;
    } finally { running = false;group.busy=false;try{await persist();}finally{changed();} }
  }
  $('save').onclick = () => saveAll().catch(e => { $('save-status').textContent = '入库已停止：' + e.message; });
  $('save-cancel').onclick = () => {
    controller?.abort();
    $('save-status').textContent = uploading ? '正在停止，等待当前上传确认…' : '正在停止…';
  };
  $('reconnect').onclick = connect;
  $('collection').addEventListener('change',async()=>{
    try{
      const latest=await settings();
      if(serverUrl(latest.server)!==serverUrl(connection.server))throw Error('连接地址已更改，请重新连接');
      await chrome.storage.local.set({collection_id:$('collection').value});
      if(!group.saveTarget){group.initialTarget={server:serverUrl(connection.server),collection_id:$('collection').value,tags:$('tags').value};await persist();if(needsDestination)await connect();}
    }catch(e){$('save-status').textContent=e.message;}
  });
  return {
    get running() { return running; }, draw, connect, start:saveAll,
    label: i => ({ done: '已入库', duplicate: '已收录', failed: '入库失败', active: '入库中…', pending: '待入库' })[states[i]],
  };
}
