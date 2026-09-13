import { unified } from 'unified';
import remarkParse from 'remark-parse';

const parser = unified().use(remarkParse);
const unpad = text => text.replace(/^\r?\n\r?\n/, '').replace(/\r?\n\r?\n$/, '');

// HTML comments keep message boundaries portable through Markdown exports,
// drafts and version history. Paired IDs isolate Markdown parsing per message,
// including messages ending in an unfinished code fence. Legacy notes use
// top-level AST rules so fenced/quoted separators are never split.
export function readMessageBlocks(content, legacy = false) {
  const blocks = []; let cursor = 0, marked = false;
  const loose = (from, to) => {
    const text = content.slice(from, to);
    if (text.trim()) blocks.push({ id: 'legacy-' + from, content: unpad(text) });
  };
  const pattern = /^<!-- znote-message:([a-zA-Z0-9_-]{1,80}) -->\r?\n\r?\n([\s\S]*?)\r?\n\r?\n<!-- \/znote-message:\1 -->$/gm;
  for (const match of content.matchAll(pattern)) {
    loose(cursor, match.index); blocks.push({ id:match[1], content:match[2] });
    cursor=match.index+match[0].length; marked=true;
  }
  // An unfinished boundary remains ordinary editable Markdown, never dropped.
  if (marked) { loose(cursor, content.length); return { blocks: unique(blocks), legacy: false }; }
  if (!legacy) return { blocks: content ? [{ id: 'legacy-0', content }] : [], legacy: false };
  blocks.length = 0; cursor = 0;
  for (const node of parser.parse(content).children) if (node.type === 'thematicBreak') {
    loose(cursor, node.position.start.offset); cursor = node.position.end.offset;
  }
  loose(cursor, content.length);
  return { blocks: unique(blocks), legacy: blocks.length > 1 };
}
function unique(blocks) {
  const seen = new Set();
  return blocks.map((block, index) => {
    let id = block.id; while (seen.has(id)) id = 'duplicate-' + index + '-' + id.slice(0,50);
    seen.add(id); return { ...block, id };
  });
}
export function writeMessageBlocks(blocks) {
  return blocks.map(({ id, content }) => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Error('消息编号无效');
    return `<!-- znote-message:${id} -->\n\n${content}\n\n<!-- /znote-message:${id} -->`;
  }).join('\n\n');
}
export function appendMessageBlocks(previous, incoming) {
  return writeMessageBlocks([...readMessageBlocks(previous, true).blocks, ...readMessageBlocks(incoming).blocks]);
}

// remark-breaks handles single line endings. Markdown otherwise discards
// empty lines between blocks; preserve those separately without touching code.
export function remarkMessageSpacing() {
  return (tree, file) => {
    const source = String(file).replace(/\r\n?/g, '\n'), lines = source.split('\n');
    const result = []; let cursor = 1;
    const blanks = (from, to) => {
      for (let n = from; n < to; n++) if (/^[ \t]*$/.test(lines[n-1] ?? '')) result.push({ type: 'paragraph', data: { hProperties: { className: ['message-empty-line'], 'aria-hidden': 'true' } }, children: [{ type: 'text', value: '\u00a0' }] });
    };
    for (const node of tree.children) { blanks(cursor, node.position?.start.line ?? cursor); result.push(node); cursor = (node.position?.end.line ?? cursor) + 1; }
    blanks(cursor, lines.length + (source.endsWith('\n') ? 1 : 0)); tree.children = result;
  };
}
