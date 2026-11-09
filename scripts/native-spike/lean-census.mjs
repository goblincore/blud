// scripts/native-spike/lean-census.mjs
//
// THE LEAN WALK'S CENSUS of a captured frame (docs/superpowers/specs/2026-11-09-march-lean-walk-design.md): which
// pixels' walks took mapLean. Reads the march target the GAME drew for a capture taken with debug mode 23 on a
// `?leanwalk` page (capture.mjs, SPIKE_VARIANTS='...;census=__sdfGame.setMarchDebugMode(23)'): r = 1 where the walk
// took mapLean, g = the slots in the pixel's tile table, b = steps + 1000 x hit. No GPU: it reads the capture's files.
//
//   node scripts/native-spike/lean-census.mjs <captureDir-census>
//
// One JSON line: pixels that marched, the share on the fast path, the same by steps (a missed ray walks many more
// steps than a hit), and the rows by (slots 1 / 2 / 3+, lean or body, hit or miss).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/native-spike/lean-census.mjs <captureDir>'); process.exit(2); }
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const sc = manifest.meta?.scene ?? {};
if (!/setMarchDebugMode\(\s*23\s*\)/.test(sc.variant?.js ?? '')) { console.error(`lean-census: ${dir} was not captured with setMarchDebugMode(23)`); process.exit(1); }
if (!/(^|&)leanwalk\b/.test(sc.query ?? '')) { console.error(`lean-census: ${dir} was not captured on a ?leanwalk page`); process.exit(1); }
const pass = manifest.passes[0];
const post = Object.values(pass.post)[0]?.mips?.[0];
if (!post) { console.error('lean-census: the capture holds no readback of the pass output'); process.exit(1); }
const bytes = readFileSync(join(dir, post.file));
const { width: w, height: h, bytesPerRow } = post;
const rows = {};
let marched = 0, lean = 0, steps = 0, leanSteps = 0, hits = 0, leanHits = 0;
for (let y = 0; y < h; y++) {
  const f = new Float32Array(bytes.buffer, bytes.byteOffset + y * bytesPerRow, w * 4);
  for (let x = 0; x < w; x++) {
    const slots = Math.round(f[x * 4 + 1]);
    // The cleared texel and a fragment that discarded before the walk carry no slot count.
    if (!(slots > 0) || f[x * 4] < -0.5 || f[x * 4] > 1.5) continue;
    const isLean = f[x * 4] > 0.5;
    const b = f[x * 4 + 2];
    const hit = b >= 999.5;
    const st = hit ? b - 1000 : b;
    marched++; steps += st;
    if (hit) hits++;
    if (isLean) { lean++; leanSteps += st; if (hit) leanHits++; }
    const key = `${slots >= 3 ? '3+' : slots}/${isLean ? 'lean' : 'body'}/${hit ? 'hit' : 'miss'}`;
    rows[key] = (rows[key] ?? 0) + 1;
  }
}
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : 0);
console.log(JSON.stringify({
  dir, size: `${w}x${h}`, scene: sc.scene, prelude: sc.prelude ?? '', staged: sc.staged,
  marched, hits, leanPixels: lean, leanPixelPct: pct(lean, marched), leanHitPct: pct(leanHits, hits),
  steps: Math.round(steps), leanSteps: Math.round(leanSteps), leanStepPct: pct(leanSteps, steps), rows,
}));
