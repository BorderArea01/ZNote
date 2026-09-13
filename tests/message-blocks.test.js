import test from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {readMessageBlocks,writeMessageBlocks,appendMessageBlocks,remarkMessageSpacing} from '../shared/message-blocks.js';

test('message boundaries round trip exact whitespace, internal rules and unfinished Markdown',()=>{
  const blocks=[{id:'a',content:'\n第一行\r\n第二行\n\n\n[链接](https://example.com/)\n\n---\n\n最后\n'},
    {id:'b',content:'```js\n未结束的代码'}, {id:'c',content:'![图片](/media/a/original)'},{id:'d',content:''}];
  assert.deepEqual(readMessageBlocks(writeMessageBlocks(blocks)).blocks,blocks);
  assert.deepEqual(readMessageBlocks(appendMessageBlocks(writeMessageBlocks(blocks),writeMessageBlocks([{id:'e',content:'追加'}]))).blocks,[...blocks,{id:'e',content:'追加'}]);
  assert.deepEqual(readMessageBlocks(writeMessageBlocks([...blocks].reverse())).blocks,[...blocks].reverse());
});
test('legacy splits only root separators and retains loose text or incomplete markers',()=>{
  const legacy='第一条\n\n---\n\n```text\n---\n```\n\n> ---\n\n第二条';
  const result=readMessageBlocks(legacy,true);assert.equal(result.blocks.length,2);assert.equal(result.legacy,true);assert.ok(result.blocks[1].content.includes('> ---'));
  const content=writeMessageBlocks([{id:'a',content:'消息'}])+'\n\n手写补充\n\n<!-- znote-message:bad -->';
  const blocks=readMessageBlocks(content).blocks;assert.equal(blocks.length,2);assert.ok(blocks[1].content.endsWith('<!-- znote-message:bad -->'));
});
test('blank line rendering preserves consecutive and leading lines without altering code',()=>{
  const processor=unified().use(remarkParse).use(remarkMessageSpacing);
  const input='\n第一行\n第二行\n\n\n下一段\n\n```text\n代码\n\n代码\n```';
  const tree=processor.runSync(processor.parse(input),{value:input});
  assert.equal(tree.children.filter(n=>n.data?.hProperties?.className?.includes('message-empty-line')).length,4);
  assert.equal(tree.children.find(n=>n.type==='code').value,'代码\n\n代码');
});
