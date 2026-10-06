import { writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const root = join(source, '../../output/promo-znote');
const scenes = JSON.parse(await readFile(join(source, 'storyboard.json'), 'utf8'));
const duration = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
const startOf = id => scenes.slice(0, scenes.findIndex(scene => scene.id === id)).reduce((sum, scene) => sum + scene.seconds, 0);
const turnAt = startOf('pivot');
const featuresAt = startOf('what_is');
const closeAt = startOf('closing');
const rate = 44100, count = Math.ceil(duration * rate), channels = 2;
const pcm = Buffer.alloc(44 + count * channels * 2);
const brightChords = [
  [130.81, 164.81, 196, 261.63], // Cmaj7
  [110, 130.81, 164.81, 220],     // Am7
  [87.31, 130.81, 174.61, 220],   // Fmaj7
  [98, 146.83, 196, 246.94],      // G
];
const minorChords = [brightChords[1], brightChords[2], brightChords[0], brightChords[3]];
const beat = 60 / 102, bar = beat * 4;
let seed = 155902;
const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296) * 2 - 1;
for (let i = 0; i < count; i++) {
  const t = i / rate;
  const chord = t < turnAt ? minorChords[Math.floor(t / bar) % minorChords.length]
    : t >= closeAt ? brightChords[0] : brightChords[Math.floor((t - turnAt) / bar) % brightChords.length];
  const chordTime = t % bar;
  const globalFade = Math.min(1, t / 1.4, (duration - t) / 3.2);
  const energy = t < turnAt ? 0.65 : t < featuresAt ? 0.82 : t < closeAt ? 1 : 0.78;
  let pad = 0;
  for (const freq of chord) {
    pad += Math.sin(2 * Math.PI * freq * t) * 0.21 + Math.sin(2 * Math.PI * freq * 2.003 * t) * 0.048;
  }
  pad *= 0.22;
  const note = chord[[0, 2, 1, 3, 2, 1, 3, 1][Math.floor((t % bar) / (beat / 2)) % 8]] * 2;
  const pluckTime = t % (beat / 2);
  const pluck = (Math.sin(2 * Math.PI * note * t) + 0.28 * Math.sin(2 * Math.PI * note * 2 * t)) * Math.exp(-pluckTime * 10) * (t < turnAt ? 0.085 : 0.15);
  const bassTime = t % (beat * 2);
  const bass = Math.sin(2 * Math.PI * chord[0] / 2 * t) * Math.exp(-bassTime * 2.8) * (t < turnAt ? 0.08 : 0.15);
  const kickTime = t % beat;
  const kick = kickTime < 0.17 ? Math.sin(2 * Math.PI * (56 + 65 * Math.exp(-kickTime * 27)) * kickTime) * Math.exp(-kickTime * 26) * (t < turnAt ? 0.09 : 0.19) : 0;
  const hatTime = t % (beat / 2);
  const hat = hatTime < 0.05 ? random() * Math.exp(-hatTime * 85) * (t < turnAt ? 0.015 : 0.033) : 0;
  const backbeat = t % (beat * 2);
  const clapTime = backbeat >= beat ? backbeat - beat : -1;
  const clap = clapTime >= 0 && clapTime < 0.09 ? random() * Math.exp(-clapTime * 38) * (t < featuresAt ? 0.009 : 0.022) : 0;
  const shimmer = chordTime < 0.34 ? Math.sin(2 * Math.PI * chord[3] * 4 * t) * Math.exp(-chordTime * 15) * 0.02 : 0;
  const motifStep = Math.floor((t % (beat * 8)) / beat);
  const motifFreq = [chord[2] * 2, chord[3] * 2, chord[2] * 2, chord[1] * 2, chord[2] * 2, chord[3] * 2, chord[1] * 2, chord[0] * 2][motifStep];
  const motifTime = t % beat;
  const melody = t >= featuresAt && t < closeAt
    ? (Math.sin(2 * Math.PI * motifFreq * t) + 0.18 * Math.sin(4 * Math.PI * motifFreq * t)) * Math.exp(-motifTime * 5.2) * 0.052 : 0;
  const base = Math.max(-0.9, Math.min(0.9, (pad + pluck + bass + kick + hat + clap + shimmer + melody) * energy * globalFade));
  pcm.writeInt16LE(Math.round(base * 32767), 44 + i * 4);
  pcm.writeInt16LE(Math.round((base * 0.985 + pad * 0.015) * 32767), 46 + i * 4);
}
pcm.write('RIFF', 0); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVE', 8);
pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(channels, 22); pcm.writeUInt32LE(rate, 24);
pcm.writeUInt32LE(rate * channels * 2, 28); pcm.writeUInt16LE(channels * 2, 32);
pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(count * channels * 2, 40);
const target = join(root, 'music.wav');
await writeFile(target, pcm);
console.log(JSON.stringify({ target, duration, samples: count }));
