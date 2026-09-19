// EXPLOSION SEAM CHECK (2026-09-18, second pass): does the curl look draw a
// STRAIGHT LINE through the fireball?
//
// The first pass judged the curl cross by eye and declared it gone when the
// bright streak vanished. It was not gone: `curl-smoke.png` still carries a
// straight horizontal line into the fireball, a straight vertical seam below
// the centre, and straight-edged wedge notches on the silhouette. Eyeballing at
// normal contrast misses them, so this is the instrument that does not.
//
// WHAT IT MEASURES. A straight line is edge energy that is COHERENT along one
// row or one column. So, for the fire/smoke region only:
//
//   rowSum(y) = sum_x edge(x,y)      colSum(x) = sum_y edge(x,y)
//   H = max_y rowSum(y) - median_y rowSum(y)
//   V = max_x colSum(x) - median_x colSum(x)
//
// The median subtraction is the whole trick: a broad change lifts every row
// equally and cancels; a straight line lifts one row far above the rest. H is
// the strongest single-row edge sum, V the strongest single-column one.
//
// THE NULL, and why this is an A/B. The residue is defined RELATIVE to the
// baseline look (curlStrength 0, softFade 0), so the score is the DIFFERENCE of
// the two frames' row/column profiles:
//
//   dRow = rowSum(curl) - rowSum(base)      dCol = colSum(curl) - colSum(base)
//   curlScore = max( max dRow - median dRow,  max dCol - median dCol )
//   baseScore = the same on the NEGATED profiles (the reverse direction)
//
// Differencing AFTER the per-line sum, not before it, is what makes the gate
// robust: a scene edge (the occluder, the wall, the floor) sits at the same
// place in both frames with nearly the same total, so it cancels even when the
// smoke over it modulates the edge's strength. Differencing per PIXEL first
// (`sum max(0, Ec-Eb)`) instead amplifies every sub-pixel scene-edge shift and
// reports the occluder as a curl line — the mistake the first gate made.
//
//   node scripts/explosion-seam-check.mjs <captureDir> [--times smoke,fireball]
//   node scripts/explosion-seam-check.mjs docs/dev-notes/2026-09-18-explosion-curl/clip \
//     --exclude 558,108,810,420
//   node scripts/explosion-seam-check.mjs <dir> --out <dir>     # seam-*.png here
//   node scripts/explosion-seam-check.mjs --selftest            # gate sanity
//
// `--exclude x0,y0,x1,y1` blanks a screen rectangle from the region. The clip
// scene uses it for the occluder BOX: the box is scene geometry, not fire, and
// its own silhouette is a straight line in both frames, so scoring it would
// measure the occluder rather than the curl.
//
// It writes `seam-<time>.png` beside the numbers: the curl frame's new-edge map
// (per-pixel `max(0, Ec - Eb)`, amplified) so a human can see what it looked
// at. Exits 0 always (this is a measurement, not a CI gate); the verdict prints.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { basename } from 'node:path';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(2); };

// A curl frame whose score is this many times the baseline's is flagged. Below
// the second number the pair is called within noise.
const FLAG_RATIO = 1.5;
const NOISE_RATIO = 1.3;

// --- PNG decode / encode (the proven pair from explosion-capture.mjs) --------

function decodePng(png) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'IEND') break;
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) fail('unsupported PNG (need 8-bit RGB/A)');
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v = (v + a) & 0xff;
      else if (f === 2) v = (v + b) & 0xff;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[i] = v;
    }
    prev = cur;
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = out[i * bpp]; rgba[i * 4 + 1] = out[i * bpp + 1]; rgba[i * 4 + 2] = out[i * bpp + 2];
    rgba[i * 4 + 3] = bpp === 4 ? out[i * bpp + 3] : 255;
  }
  return { w, h, rgba };
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- The frame -> luma / mask / edges ---------------------------------------

function lumaOf(png) {
  const { w, h, rgba } = decodePng(png);
  const L = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    L[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return { w, h, L, rgba };
}

/** Warm + bright = the fire/smoke the score is allowed to look at. The scene's
 *  red stand-in is warm but dark (luma ~94), so the luma floor keeps it out. */
function warmMask({ w, h, L, rgba }) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (L[i] > 112 && rgba[i * 4] - rgba[i * 4 + 2] > 22) m[i] = 1;
  }
  return m;
}

/** Separable max-filter dilation, `r` px. */
function dilate(w, h, m, r) {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const xx = x + k; if (xx < 0 || xx >= w) continue;
        if (m[y * w + xx]) v = 1;
      }
      tmp[y * w + x] = v;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const yy = y + k; if (yy < 0 || yy >= h) continue;
        if (tmp[yy * w + x]) v = 1;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function sobel(w, h, L) {
  const E = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      E[i] = Math.hypot(L[i + 1] - L[i - 1], L[i + w] - L[i - w]);
    }
  }
  return E;
}

function medianOf(values) {
  const a = Array.from(values).sort((p, q) => p - q);
  return a.length ? a[a.length >> 1] : 0;
}

/** Strongest single-row / single-column excess of a profile over its median. */
function profileExcess(values) {
  const med = medianOf(values);
  let best = 0, at = 0;
  for (let i = 0; i < values.length; i++) {
    const e = values[i] - med;
    if (e > best) { best = e; at = i; }
  }
  return { best, at };
}

// --- Pair scoring -----------------------------------------------------------

function scorePair(curlPath, basePath, opts = {}) {
  const c = lumaOf(readFileSync(curlPath));
  const b = lumaOf(readFileSync(basePath));
  if (c.w !== b.w || c.h !== b.h) fail(`size mismatch: ${curlPath} vs ${basePath}`);
  const { w, h } = c;

  const wc = warmMask(c), wb = warmMask(b);
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (wc[i] || wb[i] || Math.abs(c.L[i] - b.L[i]) > 10) raw[i] = 1;
  }
  const mask = dilate(w, h, raw, 4);
  // Inset the region's bounding box so the frame edge can never register, then
  // blank any caller-supplied exclude rectangle (a known occluder).
  let mx0 = w, mx1 = -1, my0 = h, my1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if (x < mx0) mx0 = x; if (x > mx1) mx1 = x;
    if (y < my0) my0 = y; if (y > my1) my1 = y;
  }
  if (mx1 < 0) fail(`${basename(curlPath)}: no fire/smoke region found`);
  const IN = 6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < mx0 + IN || x > mx1 - IN || y < my0 + IN || y > my1 - IN) mask[y * w + x] = 0;
    }
  }
  if (opts.exclude) {
    const [x0, y0, x1, y1] = opts.exclude;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) mask[y * w + x] = 0;
    }
  }

  const Ec = sobel(w, h, c.L), Eb = sobel(w, h, b.L);
  const rowC = new Float64Array(h), rowB = new Float64Array(h);
  const colC = new Float64Array(w), colB = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    let sc = 0, sb = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      sc += Ec[i]; sb += Eb[i];
    }
    rowC[y] = sc; rowB[y] = sb;
  }
  for (let x = 0; x < w; x++) {
    let sc = 0, sb = 0;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      sc += Ec[i]; sb += Eb[i];
    }
    colC[x] = sc; colB[x] = sb;
  }
  const dRow = new Float64Array(h), dCol = new Float64Array(w);
  const nRow = new Float64Array(h), nCol = new Float64Array(w);
  for (let y = 0; y < h; y++) { dRow[y] = rowC[y] - rowB[y]; nRow[y] = -dRow[y]; }
  for (let x = 0; x < w; x++) { dCol[x] = colC[x] - colB[x]; nCol[x] = -dCol[x]; }

  const ch = profileExcess(dRow), cv = profileExcess(dCol);
  const bh = profileExcess(nRow), bv = profileExcess(nCol);
  const curlScore = Math.max(ch.best, cv.best);
  const baseScore = Math.max(bh.best, bv.best);
  const ratio = curlScore / Math.max(baseScore, 1e-6);

  let changed = 0, sum = 0;
  for (let i = 0; i < w * h; i++) {
    const d = Math.abs(c.L[i] - b.L[i]);
    if (d > 2) changed++;
    sum += d;
  }

  if (opts.edgeDir) {
    const out = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = mask[i] ? Math.min(255, Math.max(0, Ec[i] - Eb[i]) * 6) : 0;
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
    writeFileSync(opts.edgeDir, encodePng(out, w, h));
  }
  return {
    w, h, ratio, curlScore, baseScore,
    curlH: ch.best, curlV: cv.best, baseH: bh.best, baseV: bv.best,
    curlHAt: ch.at, curlVAt: cv.at,
    changedFrac: changed / (w * h), meanAbs: sum / (w * h),
  };
}

// --- CLI --------------------------------------------------------------------

const argv = [...process.argv];
function flagValue(name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}
const timesArg = flagValue('--times');
const outDir = flagValue('--out');
const excludeArg = flagValue('--exclude');
const SELFTEST = argv.includes('--selftest');
if (SELFTEST) argv.splice(argv.indexOf('--selftest'), 1);

let EXCLUDE = null;
if (excludeArg) {
  const v = excludeArg.split(',').map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n))) fail('--exclude needs x0,y0,x1,y1');
  EXCLUDE = v;
}

if (SELFTEST) {
  // The gate must flag a line that is KNOWN to be a line. Inject a 300 px
  // horizontal and a 220 px vertical bright line into a copy of the baseline
  // and confirm the score rises. If this fails the gate is wrong.
  const src = argv[2] ?? 'docs/dev-notes/2026-09-18-explosion-curl/baseline-smoke.png';
  const { w, h, rgba } = decodePng(readFileSync(src));
  const out = Buffer.from(rgba);
  const drawH = (yc, x0, x1) => {
    for (let x = x0; x <= x1; x++) for (let dy = -1; dy <= 1; dy++) {
      const i = ((yc + dy) * w + x) * 4;
      out[i] = Math.min(255, out[i] + 60); out[i + 1] = Math.min(255, out[i + 1] + 60); out[i + 2] = Math.min(255, out[i + 2] + 60);
    }
  };
  const drawV = (xc, y0, y1) => {
    for (let y = y0; y <= y1; y++) for (let dx = -1; dx <= 1; dx++) {
      const i = (y * w + xc + dx) * 4;
      out[i] = Math.min(255, out[i] + 60); out[i + 1] = Math.min(255, out[i + 1] + 60); out[i + 2] = Math.min(255, out[i + 2] + 60);
    }
  };
  const tmp = '/tmp/seam-selftest.png';
  drawH(Math.floor(h * 0.35), Math.floor(w * 0.25), Math.floor(w * 0.25) + 300);
  drawV(Math.floor(w * 0.45), Math.floor(h * 0.2), Math.floor(h * 0.2) + 220);
  writeFileSync(tmp, encodePng(out, w, h));
  const r = scorePair(tmp, src);
  console.log(`selftest: curl=${r.curlScore.toFixed(1)} base=${r.baseScore.toFixed(1)} ratio=${r.ratio.toFixed(2)}`);
  console.log(r.ratio > FLAG_RATIO ? 'selftest PASS (a known line is flagged)' : 'selftest FAIL (the gate missed a known line)');
  process.exit(r.ratio > FLAG_RATIO ? 0 : 2);
}

const dir = argv[2] ?? 'docs/dev-notes/2026-09-18-explosion-curl';
const times = (timesArg ?? 'flash,fireball,smoke').split(',').map((s) => s.trim()).filter(Boolean);
if (outDir) mkdirSync(outDir, { recursive: true });

console.log(`explosion-seam-check: ${dir}${EXCLUDE ? `  (exclude ${EXCLUDE.join(',')})` : ''}`);
console.log('  time       curlH     curlV    baseH    baseV   ratio  verdict   changed%  meanAbs  (H@y,V@x)');
let worst = 0;
for (const t of times) {
  const cp = `${dir}/curl-${t}.png`, bp = `${dir}/baseline-${t}.png`;
  let r;
  try { r = scorePair(cp, bp, { exclude: EXCLUDE, edgeDir: outDir ? `${outDir}/seam-${t}.png` : undefined }); }
  catch (e) { console.log(`  ${t.padEnd(9)} SKIP (${e.message})`); continue; }
  const verdict = r.ratio >= FLAG_RATIO ? 'FLAGGED ' : r.ratio <= NOISE_RATIO ? 'clean   ' : 'marginal';
  worst = Math.max(worst, r.ratio);
  console.log(`  ${t.padEnd(9)} ${r.curlH.toFixed(0).padStart(7)} ${r.curlV.toFixed(0).padStart(9)} ${r.baseH.toFixed(0).padStart(8)} ${r.baseV.toFixed(0).padStart(8)} ${r.ratio.toFixed(2).padStart(7)}  ${verdict}  ${(r.changedFrac * 100).toFixed(2).padStart(6)}% ${r.meanAbs.toFixed(2).padStart(7)}  (${r.curlHAt},${r.curlVAt})`);
}
console.log(worst >= FLAG_RATIO
  ? `\nVERDICT: residue present (worst ratio ${worst.toFixed(2)} >= ${FLAG_RATIO})`
  : `\nVERDICT: within noise (worst ratio ${worst.toFixed(2)} < ${FLAG_RATIO})`);
if (outDir) console.log(`edge maps -> ${outDir}/seam-<time>.png`);
