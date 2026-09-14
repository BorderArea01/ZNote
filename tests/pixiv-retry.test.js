import test from 'node:test';
import assert from 'node:assert/strict';
import { retryableStatus, requestError, networkError, request, responseJSON, scheduleRetry, waitForRetry } from '../integrations/pixiv/bridge/retry.js';

test('Pixiv retries transient errors with a durable bounded backoff', () => {
  for (const status of [408,425,429,500,502,503,504]) assert.equal(retryableStatus(status),true);
  for (const status of [200,400,401,403,404,413,422]) assert.equal(retryableStatus(status),false);
  let state={};
  for (const delay of [5000,15000,45000,120000]) {
    assert.equal(scheduleRetry(state,{retryable:true},1000),1000+delay);
    state=JSON.parse(JSON.stringify(state));
  }
  assert.equal(scheduleRetry(state,{retryable:true},1000),0);
  assert.equal(state.retryCount,4);
  assert.equal(scheduleRetry({},new Error('file too large')),0);
});

test('Pixiv respects server Retry-After and does not retry authorization errors', () => {
  const error=requestError('busy',new Response('',{status:429,headers:{'Retry-After':'30'}}));
  assert.equal(scheduleRetry({},error,1000),31000);
  const dated=requestError('busy',new Response('',{status:503,headers:{'Retry-After':new Date(Date.now()+60000).toUTCString()}}));
  assert.ok(dated.retryAfter>58000 && dated.retryAfter<=60000);
  assert.equal(scheduleRetry({},requestError('denied',new Response('',{status:403}))),0);
});

test('Pixiv differentiates network loss, truncated JSON and explicit cancellation', async t => {
  assert.equal(networkError(new TypeError('Failed to fetch')).retryable,true);
  const control=new AbortController(); control.abort();
  assert.equal(networkError(new Error('network'),control.signal),control.signal.reason);
  await assert.rejects(waitForRetry(Date.now()+120000,control.signal),{name:'AbortError'});
  await assert.rejects(responseJSON(new Response('{')),e=>e.retryable===true);
  // A caller signal must not replace the request timeout.
  t.mock.method(globalThis,'fetch',async (_url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }));
  const keepAlive=setTimeout(()=>{},1000);
  try { await assert.rejects(request('https://fixture.invalid',{signal:new AbortController().signal},20),e=>e.retryable===true && e.message.includes('超时')); }
  finally {clearTimeout(keepAlive)}
});
