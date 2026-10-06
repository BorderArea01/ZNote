import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const root = join(source, '../../output/promo-znote');
const scenes = JSON.parse(await readFile(join(source, 'storyboard.json'), 'utf8'));
const stamp = seconds => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
let time = 0;
const entries = scenes.map((scene, index) => {
  const start = time + 0.15;
  time += scene.seconds;
  return `${index + 1}\n${stamp(start)} --> ${stamp(time - 0.15)}\n${scene.voice}\n`;
});
const target = join(root, 'ZNote-宣传片-字幕.srt');
await writeFile(target, entries.join('\n'), 'utf8');
console.log(JSON.stringify({ target, count: entries.length, duration: time }));
