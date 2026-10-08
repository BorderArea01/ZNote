import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { extractXPost } from '../server/capture-x.js';

const source='https://x.com/artist/status/2107462064294051944';
const dir=await mkdtemp(resolve('artifacts/post-capture-ui-'));
const plan=extractXPost({id_str:'2107462064294051944',text:'作品正文\n第二行',user:{name:'作者',screen_name:'artist'},mediaDetails:[1,2,3,4].map(i=>({type:'photo',media_url_https:`https://pbs.twimg.com/media/test${i}.jpg`}))},source);
const pngs=await Promise.all(['#153e39','#759c91','#adbb9a','#d1c7a6'].map(background=>sharp({create:{width:120,height:160,channels:3,background}}).png().toBuffer()));
const runtime=createApp({dataDir:dir,staticDir:resolve('dist'),captureOptions:{page:async()=>({plan}),image:async url=>pngs[Number(url.match(/test(\d)/)[1])-1]}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const contexts=[];
try {
  for(const touch of [false,true]) {
    const extension=resolve('addons/browser/clipper');
    const context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:touch?420:1200,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});contexts.push(context);
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
    const page=await context.newPage();await page.goto(base);
    await page.getByLabel('访问密码').fill('0123');await page.getByRole('button',{name:touch?'进入知识库':'开始使用 ZNote'}).click();
    await page.getByRole('heading',{name:/我的知识库/}).waitFor();
    const token=await (await context.request.post(base+'/api/tokens',{data:{name:'post-ui',scope:'write'}})).json();
    await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:token.token});
    const click=locator=>touch?locator.tap():locator.click();
    await click(page.getByRole('button',{name:touch?'个人设置':'设置与连接',exact:true}));
    const settings=page.getByRole('dialog',{name:'设置与连接'}),mode=settings.getByLabel('超过 25 MB 的图片');
    await mode.selectOption('compress');await settings.getByText('已保存，之后的图片上传和采集自动使用此策略').waitFor();
    assert.equal((await (await context.request.get(base+'/api/capture-settings')).json()).image_size_mode,'compress');
    const help=settings.getByRole('button',{name:'大图片处理说明'});await help.scrollIntoViewIfNeeded();await page.waitForTimeout(250);await click(help);
    await page.getByRole('tooltip').filter({hasText:'仅处理超过 25 MB'}).waitFor();await page.waitForTimeout(250);
    assert.equal(await help.getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Escape');assert.equal(await help.getAttribute('aria-expanded'),'false');
    await mode.selectOption('original');await settings.getByText('已保存，之后的图片上传和采集自动使用此策略').waitFor();
    await page.screenshot({path:resolve(`artifacts/post-settings-${touch?'touch':'desktop'}.png`)});
    await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
    const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);await options.waitForFunction(()=>document.body.dataset.ready==='true');
    await options.locator('#large-image-default').selectOption('original');await click(options.getByRole('button',{name:'保存浏览器行为'}));
    await options.reload();await options.waitForFunction(()=>document.body.dataset.ready==='true');assert.equal(await options.locator('#large-image-default').inputValue(),'original');
    const optionHelp=options.getByRole('button',{name:'大图片处理说明'});await optionHelp.scrollIntoViewIfNeeded();await options.waitForTimeout(250);await click(optionHelp);await options.getByRole('tooltip').filter({hasText:'默认使用 ZNote'}).waitFor();await options.waitForTimeout(300);assert.equal(await optionHelp.getAttribute('aria-expanded'),'true');await options.keyboard.press('Escape');
    await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="background:#111;color:#eee;font-family:system-ui"><article data-testid="tweet" style="max-width:580px;padding:16px;border:1px solid #555"><a href="${source}"><time>2026-10-07</time></a><div data-testid="tweetText">作品正文</div><div style="display:grid;grid-template-columns:repeat(2,1fr)">${plan.images.map(url=>`<div data-testid="tweetPhoto"><img width="100" height="140" src="${url}"></div>`).join('')}</div><div role="group" style="display:flex;justify-content:space-between"><button>回复</button><button>转发</button><button>喜欢</button></div></article></body></html>`}));
    await context.route('https://pbs.twimg.com/**',route=>route.fulfill({contentType:'image/png',body:pngs[0]}));
    const tab=await context.newPage();await tab.goto(source);const save=tab.getByRole('button',{name:'保存这条推文的全部图片到 ZNote'});await save.waitFor();
    // Failure and recovery do not navigate or strand the entry.
    if(!touch){await worker.evaluate(()=>chrome.storage.local.set({token:''}));await click(save);await save.filter({hasText:'重试采集'}).waitFor();await tab.getByRole('status').filter({hasText:'令牌'}).waitFor();await worker.evaluate(token=>chrome.storage.local.set({token}),token.token);}
    await click(save);await save.filter({hasText:'已保存 ✓'}).waitFor({timeout:15000});assert.equal(tab.url(),source);
    const saved=runtime.db.prepare("SELECT id,kind,group_key,group_index,content,source_url FROM items WHERE deleted_at IS NULL ORDER BY group_index").all();assert.equal(saved.length,4);assert.ok(saved.every(row=>row.kind==='image'&&row.content.startsWith('作品正文\n第二行')&&row.source_url===source));assert.equal(new Set(saved.map(row=>row.group_key)).size,1);assert.deepEqual(saved.map(row=>row.group_index),[0,1,2,3]);
    await page.goto(base+'/#item/'+saved[0].id);const strip=page.getByRole('navigation',{name:'图片缩略图列'});await strip.waitFor();await strip.getByRole('option',{name:'查看第 3 张图片'}).waitFor();await click(strip.getByRole('option',{name:'查看第 3 张图片'}));await strip.getByRole('option',{name:'查看第 3 张图片',selected:true}).waitFor();
    await click(strip.getByRole('option',{name:'查看第 4 张图片'}));await strip.getByRole('option',{name:'查看第 4 张图片',selected:true}).waitFor();assert.equal(await page.getByRole('button',{name:'下一张 →',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');await strip.waitFor({state:'hidden'});
    await click(tab.getByRole('button',{name:'关闭采集提示'}));await tab.locator('[data-znote-page-tools] .feedback').waitFor({state:'hidden'});
    await tab.screenshot({path:resolve(`artifacts/x-post-${touch?'touch':'desktop'}.png`)});
    await worker.evaluate(()=>chrome.storage.local.set({blockedSites:['x.com']}));await save.waitFor({state:'hidden'});
    await worker.evaluate(()=>chrome.storage.local.set({blockedSites:[]}));await tab.getByRole('button',{name:'保存这条推文的全部图片到 ZNote'}).waitFor();
    await tab.locator('article').evaluate(article=>article.remove());await tab.locator('#znote-x-page-button').waitFor();assert.equal(await tab.locator('article .znote-x-post-button').count(),0);
    await context.close();contexts.pop();
  }
  console.log('PASS desktop/touch: persisted server/extension policy, HelpHint pin/close, X post capture, inline feedback, error recovery, ordered group and remarks, dedupe, blacklist and unmount');
} catch(error) { for(const context of contexts)for(const page of context.pages()){await page.screenshot({path:join(dir,'failed-'+context.pages().indexOf(page)+'.png')}).catch(()=>{});console.log(await page.locator('.help-trigger,.help-tooltip').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,label:node.getAttribute('aria-label'),expanded:node.getAttribute('aria-expanded')}))).catch(()=>[]));}console.log('Evidence:',dir);throw error; }
finally {for(const context of contexts)await context.close();await runtime.captures.stop();await runtime.imports.stop();await runtime.trash.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}
