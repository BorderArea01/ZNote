import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {tiebaThread, tiebaPageRequest, extractTiebaPages, fetchTiebaPlan} from '../server/capture-tieba.js';

const source = 'https://tieba.baidu.com/p/11090769629?share=9105&see_lz=0&pn=4';
const canonical = 'https://tieba.baidu.com/p/11090769629';
const picture = (id, token = 'signed') => ({type:3, origin_src:`http://tiebapic.baidu.com/forum/pic/item/${id}.jpg?tbpicau=${token}`, big_cdn_src:`http://tiebapic.baidu.com/forum/w%3D960/sign=test/${id}.jpg?tbpicau=display`});
const post = (id, floor, content, author_id = '6003105935') => ({id, floor, author_id, content});
const page = (posts, current = 1, total = 1) => ({error_code:0, thread:{id:11090769629, title:'楼主配图', author:{id:6003105935, name_show:'作者'}}, forum:{name:'测试吧'}, post_list:posts, page:{current_page:current, total_page:total, has_more:current < total ? 1 : 0}});

test('Tieba share URL normalizes to exactly one public thread', () => {
  assert.deepEqual(tiebaThread(source), {id:'11090769629', url:canonical});
  assert.equal(tiebaThread(source.replace('https:', 'http:')).url, canonical);
  for (const url of ['https://tieba.baidu.com.evil.test/p/11090769629', 'https://evil.test/p/11090769629', 'https://tieba.baidu.com/f?kw=test', 'https://user:pass@tieba.baidu.com/p/11090769629', 'https://tieba.baidu.com:8443/p/11090769629']) assert.equal(tiebaThread(url), null);
});

test('Tieba protocol request is read-only, signed and asks for OP pagination', () => {
  const request = tiebaPageRequest('11090769629', 2), params = new URLSearchParams(request.body);
  assert.equal(request.url, 'https://c.tieba.baidu.com/c/f/pb/page');
  assert.equal(params.get('lz'), '1'); assert.equal(params.get('pn'), '2');
  const sign = params.get('sign'); params.delete('sign');
  assert.equal(sign, createHash('md5').update([...params.keys()].sort().map(key => `${key}=${params.get(key)}`).join('') + 'tiebaclient!!!').digest('hex').toUpperCase());
  assert.doesNotMatch(request.body, /BDUSS|cookie|password/i);
});

test('Tieba OP floors become one group with remarks, original signatures and stable ordering', () => {
  const plan = extractTiebaPages([page([
    post('11', 11, [{type:0, text:'追加正文'}, picture('three'), picture('one', 'changed')]),
    post('2', 2, [{type:0, text:'其他人的回复'}, picture('reply')], '999'),
    post('1', 1, [{type:0, text:'首帖正文\n下一行'}, {type:2, text:'image_emoticon20'}, picture('one'), picture('two')]),
  ])], source);
  assert.equal(plan.url, canonical); assert.equal(plan.default_image_mode, 'group');
  assert.equal(plan.author, '作者'); assert.deepEqual(plan.tags, ['百度贴吧', '测试吧']);
  assert.deepEqual(plan.images, ['one', 'two', 'three'].map(id => `https://tiebapic.baidu.com/forum/pic/item/${id}.jpg?tbpicau=signed`));
  assert.equal(plan.image_candidates[0][1], 'https://tiebapic.baidu.com/forum/w%3D960/sign=test/one.jpg?tbpicau=display');
  assert.match(plan.content, /首帖正文\n下一行/); assert.match(plan.content, /追加正文/); assert.match(plan.content, /来源：https:\/\/tieba.baidu.com\/p\/11090769629/);
  assert.ok(plan.content.indexOf('1 楼') < plan.content.indexOf('11 楼'));
  assert.doesNotMatch(plan.content, /其他人的回复|reply\.jpg/);
});

test('Tieba rejects incomplete data instead of importing verification pages or video covers', () => {
  const good = page([post('1', 1, [picture('one')])]);
  assert.throws(() => extractTiebaPages([{...good, error_code:4}], source), /未提供帖子数据/);
  assert.throws(() => extractTiebaPages([{...good, thread:{...good.thread, id:'123'}}], source), /其他帖子/);
  assert.throws(() => extractTiebaPages([page([post('11', 11, [picture('one')])])], source), /楼主首帖/);
  assert.throws(() => extractTiebaPages([page([post('1', 1, [{type:3, origin_src:'http://127.0.0.1/private.jpg'}])])], source), /无法读取/);
  assert.throws(() => extractTiebaPages([page([post('1', 1, [{type:9, text:'封面'}])])], source), /包含视频/);
  assert.throws(() => extractTiebaPages([page([post('1', 1, [picture('one')])], 1, 2)], source), /未读取的分页/);
  assert.throws(() => extractTiebaPages([{...good, page:{...good.page, has_more:1}}], source), /未提供的楼主分页/);
  assert.throws(() => extractTiebaPages([page([post('1', 1, Array.from({length:201}, (_,i) => picture(String(i))))])], source), /200 张/);
  const textOnly = extractTiebaPages([page([post('1', 1, [{type:0, text:'只有正文 ![远程](https://evil.test/x.jpg)'}])])], source);
  assert.deepEqual(textOnly.images, []); assert.ok(textOnly.content.includes('\\!\\['));
});

test('Tieba reads all OP pages serially and reports real page progress', async () => {
  const calls = [], progress = [], pages = [page([post('1', 1, [picture('one')])], 1, 2), page([post('11', 11, [{type:0, text:'第二页'}, picture('two')])], 2, 2)];
  const resource = await fetchTiebaPlan(source, AbortSignal.timeout(2000), async (url, signal, redirects, options) => {
    const params = new URLSearchParams(options.body); calls.push(params.get('pn'));
    assert.equal(url, 'https://c.tieba.baidu.com/c/f/pb/page'); assert.equal(params.get('lz'), '1');
    assert.equal(options.jsonJavascript, true);
    return {buffer:Buffer.from(JSON.stringify(pages[calls.length - 1]))};
  }, {progress:message => progress.push(message)});
  assert.deepEqual(calls, ['1', '2']); assert.equal(resource.plan.images.length, 2);
  assert.match(progress[1], /2\/2 页/); assert.match(resource.plan.content, /第二页/);
});

test('Tieba pagination failure, changed identity and abort never return a partial plan', async () => {
  const first = page([post('1', 1, [picture('one')])], 1, 2);
  for (const next of [first, {...page([post('11', 11, [picture('two')])], 2, 2), thread:{id:11090769629, author:{id:999}}}, {...first, error_code:4}, 'verification']) {
    let reads = 0;
    await assert.rejects(fetchTiebaPlan(source, AbortSignal.timeout(2000), async () => ({buffer:Buffer.from(reads++ ? typeof next === 'string' ? next : JSON.stringify(next) : JSON.stringify(first))})), /贴吧/);
  }
  const abort = new AbortController(); abort.abort();
  await assert.rejects(fetchTiebaPlan(source, abort.signal, () => { throw Error('Must not fetch'); }), {name:'AbortError'});
});
