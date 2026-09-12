// ZNote integration, GPL-3.0-or-later.
import { store } from '../store/Store'
import { EVT } from '../EVT'
import { states } from '../store/States'

const host = document.createElement('div')
host.id = 'znote-pixiv-entry'
const root = host.attachShadow({ mode: 'open' })
root.innerHTML = `<style>:host{position:fixed;bottom:20px;left:20px;z-index:2147483646;font:14px system-ui;color:#e8fff5}.box{background:#173c30;border:1px solid #80bea0;border-radius:14px;padding:10px;box-shadow:0 5px 25px #0004;display:flex;gap:8px;align-items:center;max-width:calc(100vw - 60px);flex-wrap:wrap}button{font:inherit;color:inherit;background:#285d47;border:1px solid #70ab8b;border-radius:9px;padding:8px 12px;cursor:pointer}button:disabled{opacity:.5}small{max-width:300px;overflow-wrap:anywhere}</style><div class="box"><button id="save">保存抓取结果到 ZNote</button><button id="jobs" title="连接设置与入库历史">任务 / 设置</button><small id="status"></small></div>`
document.body.append(host)
const button = root.querySelector('#save') as HTMLButtonElement
const status = root.querySelector('#status')!
let busy = false
const draw = () => { button.disabled = busy || states.busy || !store.result.length; button.textContent = `保存抓取结果到 ZNote${store.result.length ? '（' + store.result.length + '）' : ''}` }
for (const event of ['crawlComplete','resultChange','readyDownload','crawlStart','downloadComplete','downloadStop'] as const) window.addEventListener(EVT.list[event], () => setTimeout(draw, 0))
draw()
async function send(payload: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'znote-capture' })
    const timer = setTimeout(() => { port.disconnect(); reject(Error('准备任务超时，请重试')) }, 60000)
    let received = false
    port.onMessage.addListener(r => { received = true; clearTimeout(timer); port.disconnect(); r?.ok ? resolve(r) : reject(Error(r?.error || '任务准备失败')) })
    port.onDisconnect.addListener(() => { clearTimeout(timer); if (!received) reject(Error('扩展连接中断，请刷新页面')) })
    port.postMessage(payload)
  })
}
root.querySelector('#jobs')!.addEventListener('click', e => { if (e.isTrusted) send({ action: 'open' }).catch(e => status.textContent = e.message) })
button.addEventListener('click', async e => {
  if (!e.isTrusted || busy || states.busy) return
  busy = true; draw()
  try {
    const records = [...store.result]
    if (!records.length || records.length > 10000) throw Error('请先抓取并筛选 1～10000 个文件')
    const { id } = await send({ action: 'begin', title: store.title || document.title })
    for (let i = 0; i < records.length; i += 20) { status.textContent = `准备 ${Math.min(i + 20, records.length)} / ${records.length}`; await send({ action: 'append', id, records: records.slice(i, i + 20) }) }
    const result = await send({ action: 'finish', id })
    status.textContent = `已准备 ${result.count} 个文件${result.rejected ? '，部分作品需查看说明' : ''}`
  } catch (e) { status.textContent = (e as Error).message }
  finally { busy = false; draw() }
})
