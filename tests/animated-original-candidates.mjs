import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.route('https://**/*',r=>r.abort());
 await page.setContent(`<picture><source type="image/webp" srcset="https://picx.zhimg.com/v2-example_b.webp 2x"><img id="gif" width="600" src="https://picx.zhimg.com/v2-example_b.webp" data-actualsrc="https://picx.zhimg.com/v2-example_b.gif"></picture><img id="webp" src="https://picx.zhimg.com/v2-other_b.webp"><img id="unsafe" src="https://example.com/display.webp" data-actualsrc="javascript:alert(1)">`);
 await page.addScriptTag({path:'addons/browser/clipper/candidates.js'});
 const result=await page.evaluate(()=>Object.fromEntries(['gif','webp','unsafe'].map(id=>[id,ZNoteCandidates(document.getElementById(id)).map(c=>c.url)])));
 assert.equal(result.gif[0],'https://picx.zhimg.com/v2-example_b.gif');assert.ok(result.gif.includes('https://picx.zhimg.com/v2-example_b.webp'),'Keep a failed original recoverable via display rendition');
 assert.deepEqual(result.webp,['https://picx.zhimg.com/v2-other_b.webp'],'Do not invent nonexistent GIF URLs or rename WebP');assert.deepEqual(result.unsafe,['https://example.com/display.webp']);
 console.log('PASS: explicit Zhihu animated original precedes WebP/srcset; display fallback retained; no invented GIF or unsafe candidate');
}finally{await browser.close();}
