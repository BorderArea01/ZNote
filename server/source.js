import { sourceSite } from '../shared/provenance.js';
// Keep provenance in both structured metadata and ordinary, exportable remarks.
export function withSource(input) {
  if (!input.source_url) return input;
  const line = `来源链接：${input.source_url}`;
  const content = input.content || '';
  const tags = [...new Set(input.tags || [])];
  const site = sourceSite(input.source_url);
  if (site && !tags.includes(site)) {
    if (tags.length >= 30) throw Object.assign(new Error('最多 30 个标签，请留出一个位置用于来源网站标签'), { status: 400 });
    tags.push(site);
  }
  if (!content.split('\n').includes(line) && content.length + line.length + 2 > 500000)
    throw Object.assign(new Error('备注过长，请为来源链接留出空间'), { status: 400 });
  return { ...input, tags, content: content.split('\n').includes(line) ? content : [content, line].filter(Boolean).join('\n\n'), captured_at: input.captured_at || new Date().toISOString() };
}
