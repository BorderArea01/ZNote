// Real saved soundtrack; mouse drag, touch input and keyboard endpoints.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
if(!process.argv.includes('--live'))throw Error('Pass --live');
const baseline=process.argv.includes('--baseline'),base='http://127.0.0.1:3741',db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const item=db.prepare("SELECT id,bgm FROM items WHERE kind='image' AND bgm IS NOT NULL AND group_key IS NOT NULL AND deleted_at IS NULL LIMIT 1").get();assert.ok(item);
const tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),pinHash=()=>createHash('sha256').update(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value||'').digest('hex'),priorPin=pinHash();
const dir=await mkdtemp(resolve('artifacts/bgm-seek-live-')),result={baseline,ui:[]};let browser,page;
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时配乐进度验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+3600000).toISOString());
try{
  for(const touch of [false,true]){
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-gpu','--renderer-process-limit=2']});
    const context=await browser.newContext({hasTouch:touch,isMobile:touch,viewport:touch?{width:390,height:844}:{width:1440,height:940}});
    await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/#item/'+item.id);const detail=page.getByRole('dialog',{name:'图片详情',exact:true}),slider=detail.getByRole('slider',{name:'配乐进度',exact:true});await slider.waitFor();
    await page.waitForFunction(()=>{const a=document.querySelector('[data-znote-bgm]');return Number.isFinite(a.duration)&&a.duration>0;});
    await page.locator('[data-znote-bgm]').evaluate(a=>a.pause());
    const state=()=>page.evaluate(()=>{const a=document.querySelector('[data-znote-bgm]'),s=document.querySelector('input[aria-label="配乐进度"]'),css=getComputedStyle(s);return {position:a.currentTime,duration:a.duration,value:Number(s.value),max:Number(s.max),padding:css.padding,paused:a.paused};});
    await slider.focus();await slider.press('End');await page.waitForTimeout(120);const end=await state();
    await slider.press('Home');await page.waitForTimeout(120);const start=await state();
    await slider.scrollIntoViewIfNeeded();const box=await slider.boundingBox();
    const touchSession=touch?await context.newCDPSession(page):null;
    async function pointerTo(fraction){
      if(touch){
        await slider.tap({position:{x:Math.max(1,Math.min(box.width-1,box.width*fraction)),y:box.height/2}});
        // Move the native thumb under the finger, then perform a real touch
        // drag to the endpoint. No synthetic DOM input/change events.
        await slider.tap({position:{x:box.width/2,y:box.height/2}});
        const point=x=>({x,y:box.y+box.height/2,id:0});
        await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(box.x+box.width/2)]});
        const target=box.x+Math.max(1,Math.min(box.width-1,box.width*fraction));
        for(let step=1;step<=12;step++)await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(box.x+box.width/2+(target-box.x-box.width/2)*step/12)]});
        await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }
      else{await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*fraction,box.y+box.height/2,{steps:12});await page.mouse.up();}
      await page.waitForTimeout(120);return state();
    }
    const pointerEnd=await pointerTo(1),pointerStart=await pointerTo(0);
    const playingDragButton=detail.getByRole('button',{name:'播放配乐',exact:true});
    await (touch?playingDragButton.tap():playingDragButton.click());
    const playingDrag=await pointerTo(.7);
    assert.equal(playingDrag.paused,false);
    assert.ok(playingDrag.position>playingDrag.duration*.6&&playingDrag.position<playingDrag.duration*.8);
    assert.ok(Math.abs(playingDrag.value-playingDrag.position)<.5);
    await page.waitForFunction(prior=>Number(document.querySelector('input[aria-label="配乐进度"]').value)>prior+.2,playingDrag.value);
    result.ui.push({touch,keyboardEnd:end,keyboardStart:start,pointerEnd,pointerStart,realTouchDrag:touch,playingDrag,progressContinuesAfterDrag:true});
    await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'.png'),mask:[page.locator('img')],maskColor:'#27322f'});
    if(!baseline){
      assert.ok(Math.abs(end.position-end.duration)<.002,JSON.stringify(end));assert.equal(start.position,0);
      assert.ok(Math.abs(pointerEnd.position-pointerEnd.duration)<.002,JSON.stringify(pointerEnd));assert.equal(pointerStart.position,0);
      assert.ok(Math.abs(pointerEnd.value-pointerEnd.duration)<.002);assert.equal(pointerStart.value,0);
      assert.deepEqual(errors,[]);
    }
    await (touch?detail.getByRole('button',{name:'关闭窗口',exact:true}).tap():detail.getByRole('button',{name:'关闭窗口',exact:true}).click());await detail.waitFor({state:'hidden'});
    assert.ok(await page.locator('[data-znote-bgm]').evaluate(a=>a.paused&&!a.getAttribute('src')));
    await browser.close();browser=null;page=null;console.log('PASS '+(touch?'touch':'desktop'));
  }
}catch(error){result.error=error.message;if(page&&!page.isClosed())await page.screenshot({path:join(dir,'failure.png'),mask:[page.locator('img')],maskColor:'#27322f'}).catch(()=>{});throw error;}
finally{await browser?.close();db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);assert.equal(pinHash(),priorPin);assert.equal(db.prepare('SELECT bgm FROM items WHERE id=?').get(item.id).bgm,item.bgm);db.close();result.pinAndMusicUnchanged=true;result.authCleaned=true;await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence: '+dir);}
