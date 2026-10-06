import { readFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const source = dirname(fileURLToPath(import.meta.url));
const root = join(source, '../../output/promo-znote');
const scenes = JSON.parse(await readFile(join(source, 'storyboard.json'), 'utf8'));
const cli = join(source, 'node_modules', 'node-edge-tts', 'bin.js');
const variants = {
  warm: { voice: 'zh-CN-XiaoxiaoNeural', rate: '-5%', pitch: '-3%' },
  lively: { voice: 'zh-CN-YunxiNeural', rate: '-3%', pitch: '-2%' },
};
const selected = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : Object.keys(variants);
for (const label of selected) if (!variants[label]) throw new Error(`Unknown voice: ${label}`);

async function run(args) {
  let output = '';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) throw new Error(output || `TTS exit ${code}`);
}

for (const label of selected) {
  const config = variants[label];
  const folder = join(root, 'voice-neural', label);
  await mkdir(folder, { recursive: true });
  for (const [index, scene] of scenes.entries()) {
    const target = join(folder, `${String(index).padStart(2, '0')}.mp3`);
    const args = ['-t', scene.tts || scene.voice, '-f', target, '-v', config.voice,
      '-r', config.rate, '--pitch', config.pitch, '-o', 'audio-24khz-96kbitrate-mono-mp3', '--timeout', '20000'];
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { await run(args); lastError = null; break; }
      catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, attempt * 1500)); }
    }
    if (lastError) throw new Error(`${label} scene ${index}: ${lastError.message}`);
    const { size } = await stat(target);
    if (size < 2000) throw new Error(`TTS returned empty audio: ${target}`);
    console.log(JSON.stringify({ label, scene: scene.id, index, bytes: size }));
  }
}
