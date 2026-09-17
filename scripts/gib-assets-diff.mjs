// scripts/gib-assets-diff.mjs — matched-frame pixel diff for the Task 3 gate.
//
// The A/B legs (`?gibrender=march` vs `?gibrender=assets`) are booted with the
// SAME `?seed=`, camera bearing and detonation point, so the pieces are at the
// same world positions frame for frame (verified: identical settle lowY and
// piece counts). A whole-frame diff is therefore meaningful: any delta is the
// REPRESENTATION, not the simulation. An A/A pair (same arm twice) is the noise
// floor the A/B delta has to clear.
//
// Usage: node scripts/gib-assets-diff.mjs <dirA> <dirB> [outJson]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';

const A = process.argv[2];
const B = process.argv[3];
const OUT = process.argv[4];
if (!A || !B) { console.error('usage: gib-assets-diff.mjs <dirA> <dirB> [outJson]'); process.exit(2); }

const pngs = (dir) => readdirSync(dir).filter(f => /^(f\d+.*|settle-floor|head-.*|post-reset)\.png$/.test(f)).sort();
const aFiles = pngs(A);
const bSet = new Set(pngs(B));
const shared = aFiles.filter(f => bSet.has(f));

const rows = [];
for (const f of shared) {
  const a = decodePng(readFileSync(`${A}/${f}`));
  const b = decodePng(readFileSync(`${B}/${f}`));
  if (a.w !== b.w || a.h !== b.h) { rows.push({ file: f, error: `size ${a.w}x${a.h} vs ${b.w}x${b.h}` }); continue; }
  let n = 0, gt12 = 0, gt48 = 0, sum = 0, max = 0;
  const ch = Math.min(a.ch, b.ch);
  for (let i = 0; i < a.w * a.h; i++) {
    let dmax = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i * ch + c] - b.data[i * ch + c]);
      if (d > dmax) dmax = d;
      sum += d;
    }
    n++;
    if (dmax > 12) gt12++;
    if (dmax > 48) gt48++;
    if (dmax > max) max = dmax;
  }
  rows.push({
    file: f,
    pctGt12: +(100 * gt12 / n).toFixed(3),
    pctGt48: +(100 * gt48 / n).toFixed(3),
    meanAbs: +(sum / (n * 3)).toFixed(3),
    max,
  });
}

const valid = rows.filter(r => !r.error);
const summary = valid.length ? {
  frames: valid.length,
  meanPctGt12: +(valid.reduce((s, r) => s + r.pctGt12, 0) / valid.length).toFixed(3),
  maxPctGt12: +Math.max(...valid.map(r => r.pctGt12)).toFixed(3),
  meanMeanAbs: +(valid.reduce((s, r) => s + r.meanAbs, 0) / valid.length).toFixed(3),
} : null;
const out = { a: A, b: B, summary, rows };
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
