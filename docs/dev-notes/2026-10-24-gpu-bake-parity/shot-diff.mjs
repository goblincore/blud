// Before/after turntable diff for the Newton polish: per frame, pixels that changed and the max channel delta; and a
// sheet per character, rows = frames, columns = before | after | |diff| x 16 (black = identical).
//   node docs/dev-notes/2026-10-24-gpu-bake-parity/shot-diff.mjs .lab-tmp/bend-polish teratoma twinhead cyclops
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { decodePng } from '../../../scripts/lib/demo-presented.mjs';
import { writePng } from '../../../scripts/lib/png-write.mjs';

const [root, ...names] = process.argv.slice(2);
for (const name of names) {
  const frames = readdirSync(`${root}/before/shot-${name}`).filter(f => /^frame-\d+\.png$/.test(f)).sort();
  const rows = [];
  let total = 0, totalMax = 0;
  for (const f of frames) {
    const a = decodePng(readFileSync(`${root}/before/shot-${name}/${f}`));
    const b = decodePng(readFileSync(`${root}/after/shot-${name}/${f}`));
    if (a.w !== b.w || a.h !== b.h) throw new Error(`${name}/${f}: size differs`);
    const ch = a.data.length / (a.w * a.h);
    let changed = 0, max = 0;
    const diff = Buffer.alloc(a.w * a.h * 4);
    for (let i = 0; i < a.w * a.h; i++) {
      let m = 0;
      for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a.data[i * ch + k] - b.data[i * ch + k]));
      if (m) changed++;
      max = Math.max(max, m);
      diff[i * 4] = diff[i * 4 + 1] = diff[i * 4 + 2] = Math.min(255, m * 16); diff[i * 4 + 3] = 255;
    }
    total += changed; totalMax = Math.max(totalMax, max);
    console.log(`${name} ${f}: ${changed} px changed (${(100 * changed / (a.w * a.h)).toFixed(3)}%), max delta ${max}`);
    rows.push({ a, b, diff, ch });
  }
  // The sheet, at half size so it stays readable.
  const { w, h } = rows[0].a, sw = Math.floor(w / 2), sh = Math.floor(h / 2), W = sw * 3 + 8, H = sh * rows.length + 2 * (rows.length - 1);
  const sheet = new Uint8Array(W * H * 4).fill(255);
  rows.forEach((r, j) => {
    const panels = [[r.a.data, r.ch], [r.b.data, r.ch], [r.diff, 4]];
    panels.forEach(([src, ch], p) => {
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const s = ((y * 2) * w + x * 2) * ch, o = ((j * (sh + 2) + y) * W + p * (sw + 4) + x) * 4;
        sheet[o] = src[s]; sheet[o + 1] = src[s + 1]; sheet[o + 2] = src[s + 2]; sheet[o + 3] = 255;
      }
    });
  });
  writeFileSync(`${root}/diff-${name}.png`, writePng(W, H, sheet));
  console.log(`${name}: ${total} px changed over ${frames.length} frames, max delta ${totalMax} -> ${root}/diff-${name}.png`);
}
