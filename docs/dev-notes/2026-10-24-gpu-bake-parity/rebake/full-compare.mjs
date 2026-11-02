// Byte histogram of two body normal maps (header row skipped): for each largest-channel difference, how many texels.
//   node docs/dev-notes/2026-10-24-gpu-bake-parity/rebake/full-compare.mjs a.png b.png
import { readFileSync } from 'node:fs';
import { decodePng } from '../../../../scripts/lib/demo-presented.mjs';
const [a, b] = process.argv.slice(2).map(f => decodePng(readFileSync(f)));
const h = new Map(); let n = 0;
for (let i = a.w; i < a.w * a.h; i++) { const d = Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i * a.ch + c] - b.data[i * b.ch + c]))); h.set(d, (h.get(d) ?? 0) + 1); n++; }
console.log(`${n} texels:`, [...h.entries()].sort((x, y) => x[0] - y[0]).map(([d, c]) => `${d}: ${c}`).join(', '));
