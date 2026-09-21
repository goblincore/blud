// scripts/march-raw-diff.mjs — magnitude diff of two raw march-target dumps
// written by `MARCH_HASH_RAW=<path> node scripts/march-hash.mjs`.
// When the exact sha1 moves, this says by HOW MUCH: per-channel max |Δ| over
// hit pixels (alpha < 1 in either), hit-set flips, and a histogram of the
// largest RGB deltas. Pure Node; no browser.
//
// Usage: node scripts/march-raw-diff.mjs <a.bin> <b.bin>
import { readFileSync } from 'node:fs';

const [pa, pb] = process.argv.slice(2);
if (!pa || !pb) { console.error('usage: march-raw-diff.mjs <a.bin> <b.bin>'); process.exit(2); }
const load = (p) => {
  const b = readFileSync(p);
  return { f: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), ...JSON.parse(readFileSync(`${p}.json`, 'utf8')) };
};
const A = load(pa), B = load(pb);
if (A.w !== B.w || A.h !== B.h) { console.error('size mismatch'); process.exit(2); }
const n = A.w * A.h;
const maxD = [0, 0, 0, 0];
let hitA = 0, hitB = 0, flips = 0, differing = 0;
const buckets = { '0': 0, '<1e-6': 0, '<1e-4': 0, '<1e-3': 0, '<1e-2': 0, '<1e-1': 0, '>=1e-1': 0 };
for (let i = 0; i < n; i++) {
  const o = i * 4;
  const ha = A.f[o + 3] < 1, hb = B.f[o + 3] < 1;
  if (ha) hitA++;
  if (hb) hitB++;
  if (ha !== hb) { flips++; continue; }
  if (!ha) continue;
  let m = 0;
  for (let c = 0; c < 4; c++) {
    const d = Math.abs(A.f[o + c] - B.f[o + c]);
    if (d > maxD[c]) maxD[c] = d;
    if (c < 3 && d > m) m = d;
  }
  if (m > 0) differing++;
  const k = m === 0 ? '0' : m < 1e-6 ? '<1e-6' : m < 1e-4 ? '<1e-4' : m < 1e-3 ? '<1e-3' : m < 1e-2 ? '<1e-2' : m < 1e-1 ? '<1e-1' : '>=1e-1';
  buckets[k]++;
}
console.log(JSON.stringify({ w: A.w, h: A.h, hitA, hitB, hitFlips: flips, differingHitPx: differing, maxAbs: { r: maxD[0], g: maxD[1], b: maxD[2], depth: maxD[3] }, rgbMaxDeltaHistogram: buckets }));
