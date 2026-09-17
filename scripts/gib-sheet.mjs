// scripts/gib-sheet.mjs — CUT A GIB SHEET OUT OF RENDERED SDF BODY FRAMES.
//
// The owner's idea, and the reference game's own approach: "generate spritesheets
// based on the rendered SDF and then cut those up randomly and use them in the
// gibs". Blood's gib pool IS cut-up renders of the enemy; this script is the
// cutting step, fed by `scripts/blob-turntable.mjs` (the deterministic N-yaw
// capture of the lab body, which already solves the camera and pose traps).
//
// The output is COMMITTABLE, unlike the reference extract in
// public/assets/gibs-placeholder (gitignored Blood assets: never commit, never
// ship), so this is the sheet that can actually ship.
//
// ── THE CUT ─────────────────────────────────────────────────────────────────
// Pieces are NOT rectangles. A rectangle of a render reads as "a slice of a
// screenshot"; what reads as gore is an irregular blob of flesh with a torn edge.
// So each piece gets a radial-noise mask, and the piece's alpha is (body AND
// mask) — the body test comes from the background key below, which is why a piece
// cut across the gap between two legs keeps the gap.
//
// ⚠ BLOCKED ON AN ALPHA RENDER, and the three failed keys are the evidence.
//
// The lab's background is NOT a flat colour: it is the clear colour (0x1a1116 =
// 26,17,22, which the top of a frame matches exactly) shading to 35,24,22 at the
// bottom — a fogged vertical gradient — AND it is dithered, so neighbouring
// background pixels disagree with each other. Three keys were tried and MEASURED:
//
//   1. absolute "dark and unsaturated" (luma < 74, sat < 26): the body's own
//      pixel count collapsed from 32637 at yaw 0 to 1749 at yaw 225. Where the key
//      light does not reach, a limb IS a dark unsaturated blob. Not tuning: wrong.
//   2. distance from the row's background, tolerance 34: the flood fill LEAKED
//      INTO the body at the back-facing angles — yaw 180 "found" a 102x32 sliver.
//   3. distance from the row's background, tolerance 10: no leak, but the dither
//      shows up as speckles, so the mask spans a 1352 px box and the grid finds
//      almost no piece with real coverage (7 pieces from 8 frames, coverage ~0.5).
//
// The fix is not a fourth heuristic: `lab-renderer.ts` should render an ALPHA
// background for a capture (`alpha: true` + `setClearColor(color, 0)` + no fog),
// behind a URL param so interactive pacing — the reason it is `alpha: false` — is
// untouched. Then the mask IS the alpha channel and this whole section goes away.
// Until then this script is not producing a usable sheet, and the code below is
// kept because the CUT and PACK halves are independent of the key and tested.
//
// ── THE KEY (as written; see the warning above) ─────────────────────────────
// The lab renders on a DARK, near-flat background (measured: 26,17,22 at the top
// of the frame, 35,24,22 at the bottom) with no alpha channel. A plain luminance
// threshold would eat the genuinely dark parts of the body (shadowed cloth, a
// black prop), so the key is a FLOOD FILL FROM THE BORDER through
// background-like pixels: anything reachable from the frame edge is background,
// and a dark region ENCLOSED by lit flesh is not. Then the largest connected
// component of what remains is the body, which drops stray specks.
//
// ── WHY THE SHEET IS ONE PNG ────────────────────────────────────────────────
// Per-piece files would mean ~100 committed PNGs. One sheet plus a rect manifest
// is one file to review, one to diff, and one to load; the manifest carries each
// piece's rect so the runtime can point a texture at it.
//
// Usage:
//   node scripts/gib-sheet.mjs <framesDir> [outDir] [--cols 4] [--rows 4]
//   node scripts/gib-sheet.mjs /tmp/blob-shot/zombie public/assets/lab/gore
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from './lib/demo-presented.mjs';
import { writePng } from './lib/png-write.mjs';

const args = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { flags.set(args[i].slice(2), args[++i]); continue; }
  positional.push(args[i]);
}
const FRAMES_DIR = positional[0] ?? '/tmp/blob-shot/zombie';
/** Extra frame dirs cut into the SAME sheet. Variety is the point of a gib sheet:
 *  a sheet of clean pieces only looks like one body, and a wounded capture costs
 *  one more turntable run. `--also /tmp/gib-wounded`. */
const ALSO = String(flags.get('also') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const OUT_DIR = positional[1] ?? 'public/assets/lab/gore';
const COLS = flags.has('cols') ? Number(flags.get('cols')) : null;
const ROWS = flags.has('rows') ? Number(flags.get('rows')) : null;
/**
 * CELLS PER FRAME, and the cell shape. THE OWNER'S REPORT that drove these:
 * "the sprites we made are not very good they are all somewhat elongated ovoid
 * shaped, they whould be more chunky like squareish, polyhedral shaped".
 *
 * He was describing the CUTTER, not the gore, and there were two causes:
 *
 *  1. fixed COLS/ROWS = 4x4 over a STANDING BODY's bounding rect, so every cell
 *     inherited the body's aspect. MEASURED on the shipped sheet: all 154 pieces
 *     tall, median aspect (w/h) **0.36**, and NOT ONE square-ish. The pieces were
 *     never elongated because limbs are — they were elongated because the grid
 *     was. So the grid is now derived from the rect's own aspect to make cells
 *     SQUARE, at roughly `CELLS` cells per frame.
 *  2. the mask was `r = hypot(nx, ny)` in cells already normalized to -1..1, so
 *     the kept region was an ELLIPSE in pixel space — a smooth ovoid whatever the
 *     cell shape. It is now a POLYGON of `SIDES` facets, so a piece has straight
 *     edges and corners and reads as a chunk rather than a pebble.
 *
 * `--cols/--rows` still override the derivation (the old behaviour, for an A/B),
 * and `--sides 0` restores the old round mask.
 */
const CELLS = Number(flags.get('cells') ?? 16);
const SIDES = Number(flags.get('sides') ?? 5);
/**
 * HOW MUCH OF THE CELL THE POLYGON COVERS, as a multiplier on its radius.
 *
 * This is the dial that decides whether a piece reads as a FACETED CHUNK or as an
 * OFFCUT OF THE BODY, and it is exposed rather than guessed because the effect
 * cannot be measured from the sheet — the alpha is `body AND polygon`, so the
 * silhouette is the polygon only where the polygon is INSIDE the body, and the
 * body's own outline wherever it is not.
 *
 * The cells are mostly interior (measured coverage of the cell by body: median
 * 0.70), so at the default radius (~0.74-1.08 of the half-cell) a large part of
 * every rim is the BODY's edge — a limb's contour, which is exactly the smooth
 * elongated outline the owner described. Turning this DOWN pulls the whole cut
 * inside the flesh, so the edges are the polygon's own straight facets.
 *
 * 1.0 = the default above; 0.7 is the first thing to try for a chunkier read.
 */
const POLY_SCALE = Number(flags.get('polyscale') ?? 1);
/** A cell this covered by body is kept; below it the piece is mostly background. */
const MIN_COVERAGE = Number(flags.get('minCoverage') ?? 0.45);
/** Piece size in the sheet, in texels. The reference extract is 10-26 px; this is
 *  the resolution headroom that makes generating worthwhile. */
const PIECE_PX = Number(flags.get('piece') ?? 128);
const SEED = Number(flags.get('seed') ?? 12345);

// ——— deterministic noise for the torn edges ——————————————————————————

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm2(x, y, seed) {
  return valueNoise(x, y, seed) * 0.6
    + valueNoise(x * 2.3, y * 2.3, seed + 7) * 0.28
    + valueNoise(x * 4.7, y * 4.7, seed + 19) * 0.12;
}

// ——— the background key ———————————————————————————————————————————————

/**
 * THE BACKGROUND IS A KNOWN CONSTANT, and that is the whole key.
 *
 * `lab-renderer.ts` clears to `0x1a1116`, and the measured background of a
 * capture is 26,17,22 — exactly that. Two attempts at a heuristic ("dark and
 * unsaturated", then "close to the row's own background") both FAILED, and the
 * numbers said so: the body's pixel count collapsed from 32637 at yaw 0 to 1749
 * at yaw 225, because where the key light does not reach, a dark limb is
 * indistinguishable from a dark background BY COLOUR. Losing 95% of a silhouette
 * is not a tuning problem, it is the wrong test.
 *
 * Matching the clear colour EXACTLY cannot make that mistake: 26,17,22 is a
 * single colour, and a shadowed limb is a hundred others. The tolerance exists
 * only for the antialiased silhouette edge, where the browser has already blended
 * body into background — and there, keying is correct.
 */
const CLEAR_RGB = [0x1a, 0x11, 0x16];
/** Distance from the row's background colour that still counts as background.
 *  TIGHT on purpose: the first attempt used 34 and the flood fill LEAKED INTO the
 *  body at the back-facing angles (yaw 180 found a 102x32 "body" — a sliver, the
 *  rest eaten), because a shadowed silhouette edge sits within 34 of the
 *  background. 10 keys the antialiased rim and nothing else. */
const KEY_TOL = Number(flags.get('keyTol') ?? 10);

/** The background is NOT one colour: it is the clear colour (26,17,22) at the top
 *  of the frame and 35,24,22 at the bottom — a smooth vertical gradient from the
 *  lab's fog/ground. So the estimate is per ROW, from the frame's left and right
 *  edges, which are background in every capture this tool is fed. */
function rowBackgrounds(p) {
  const { w, h, ch, data } = p;
  const rows = new Float32Array(h * 3);
  const EDGE = 10;
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < 3; k++) {
      const vals = [];
      for (let i = 0; i < EDGE; i++) {
        vals.push(data[(y * w + i) * ch + k]);
        vals.push(data[(y * w + (w - 1 - i)) * ch + k]);
      }
      vals.sort((a, b) => a - b);
      rows[y * 3 + k] = vals[vals.length >> 1];
    }
  }
  return rows;
}

function backgroundLike(r, g, b, rows, y) {
  const dr = r - rows[y * 3], dg = g - rows[y * 3 + 1], db = b - rows[y * 3 + 2];
  return (dr * dr + dg * dg + db * db) <= KEY_TOL * KEY_TOL;
}
/**
 * The body mask: everything NOT reachable from the frame border by a flood fill
 * through background-like pixels. Enclosed dark regions (a shadowed armpit, dark
 * cloth between lit arms) stay body, which a threshold alone cannot do.
 */
function bodyMask(p) {
  const { w, h, ch, data } = p;
  const rows = rowBackgrounds(p);
  const isBgLike = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    isBgLike[i] = backgroundLike(
      data[i * ch], data[i * ch + 1], data[i * ch + 2], rows, (i / w) | 0,
    ) ? 1 : 0;
  }
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bg[i] || !isBgLike[i]) return;
    bg[i] = 1; stack.push(i);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  const body = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) body[i] = bg[i] ? 0 : 1;

  // Largest connected component, so a stray lit pixel in the background is not a
  // "body" the cutter then centres a piece on.
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestN = 0, n = 0;
  for (let start = 0; start < w * h; start++) {
    if (!body[start] || label[start] >= 0) continue;
    const q = [start]; label[start] = n; let size = 0;
    while (q.length) {
      const i = q.pop(); size++;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (body[j] && label[j] < 0) { label[j] = n; q.push(j); }
      }
    }
    if (size > bestN) { bestN = size; best = n; }
    n++;
  }
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) keep[i] = label[i] === best ? 1 : 0;
  return { keep, count: bestN };
}

// ——— cutting ———————————————————————————————————————————————————————

function bboxOf(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Cut one frame into pieces. The grid is JITTERED and each cell's mask is
 * radial noise, so no two pieces share a silhouette — a regular grid reads as a
 * tiled screenshot, which is the failure mode this whole approach exists to
 * avoid.
 */
function cutFrame(p, mask, rect, yawDeg, seed, origin) {
  const { w, ch, data } = p;
  const out = [];
  const rectW = rect.x1 - rect.x0 + 1;
  const rectH = rect.y1 - rect.y0 + 1;
  // SQUARE CELLS, derived from THIS frame's rect (see the CELLS doc block).
  //
  // BY SEARCH, NOT BY FORMULA. The obvious `cols = round(sqrt(CELLS * aspect))`
  // was tried first and it is too coarse at these sizes: a rect of 140x395
  // (aspect 0.354) rounds to cols=2, rows=8, whose cells are 1.42 — WIDER than
  // square, i.e. the same complaint in the other direction. With ~16 cells the
  // reachable cell aspects are a sparse set, so the pair is chosen by scoring
  // every candidate on how square it is, with a small penalty for straying from
  // CELLS so a pathological pair with 2 cells cannot win.
  let cols = COLS, rows = ROWS;
  if (cols === null || rows === null) {
    // BOTH DIMENSIONS ARE SEARCHED. Deriving `rows = round(CELLS / cols)` looks
    // equivalent and is not: it only visits pairs on one hyperbola, and for a
    // 140x395 rect it can reach (2,8) — cells 1.42, too WIDE — but never (2,6),
    // which is the square one. MEASURED: with the derived version the sheet's
    // median aspect stayed at 1.39, i.e. unchanged from the bug being fixed.
    let best = { score: Infinity, cols: 1, rows: 1 };
    for (let c = 1; c <= CELLS; c++) {
      for (let r = 1; r <= CELLS; r++) {
        // |log| not |difference|: "twice as tall" and "half as wide" are the same
        // error and a linear metric would punish only one of them.
        const cellAspect = (rectW / c) / (rectH / r);
        const score = Math.abs(Math.log(cellAspect)) + 0.05 * Math.abs(c * r - CELLS) / CELLS;
        if (score < best.score) best = { score, cols: c, rows: r };
      }
    }
    cols = best.cols;
    rows = best.rows;
  }
  const cw = rectW / cols;
  const chh = rectH / rows;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      // Jitter the cell centre by up to a third of a cell, deterministically.
      const jx = (hash2(cx, cy, seed) - 0.5) * cw * 0.6;
      const jy = (hash2(cx + 91, cy + 17, seed) - 0.5) * chh * 0.6;
      const centreX = rect.x0 + (cx + 0.5) * cw + jx;
      const centreY = rect.y0 + (cy + 0.5) * chh + jy;
      const halfW = cw * 0.62, halfH = chh * 0.62;
      const x0 = Math.max(0, Math.round(centreX - halfW));
      const y0 = Math.max(0, Math.round(centreY - halfH));
      const x1 = Math.min(w - 1, Math.round(centreX + halfW));
      const y1 = Math.min(p.h - 1, Math.round(centreY + halfH));
      const pw = x1 - x0 + 1, ph = y1 - y0 + 1;
      if (pw < 8 || ph < 8) continue;

      // ——— THE PIECE'S OWN POLYGON. Its vertex radii are hashed from the cell,
      // so no two pieces share a silhouette, and they are hashed ONCE per piece
      // rather than sampled per pixel: a per-pixel radius would give the smooth
      // blobby rim this replaced. With SIDES = 0 the mask falls back to the old
      // circle radius (the A/B control for the whole shape change).
      const polyR = [];
      for (let k = 0; k < SIDES; k++) {
        polyR.push((0.74 + 0.34 * hash2(cx * 31 + k * 7, cy * 17 + k * 3, seed + 5)) * POLY_SCALE);
      }
      const polyAt = (theta) => {
        // Normalise to [0,1) around the ring, then lerp between the two
        // neighbouring vertex radii. Lerping the RADIUS (rather than solving the
        // chord) rounds the corners a little, which is the read we want on torn
        // meat — a mathematically exact polygon looks like a low-poly asset.
        let t = theta / (Math.PI * 2);
        t -= Math.floor(t);
        const f = t * SIDES;
        const k = Math.floor(f);
        return polyR[k % SIDES] * (1 - (f - k)) + polyR[(k + 1) % SIDES] * (f - k);
      };

      const px = new Uint8Array(pw * ph * 4);
      let bodyPx = 0, kept = 0, rSum = 0, gSum = 0, bSum = 0;
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const sx = x0 + x, sy = y0 + y;
          const si = sy * w + sx;
          const di = (y * pw + x) * 4;
          const isBody = mask[si] === 1;
          if (isBody) bodyPx++;
          // POLYGONAL MASK, PLUS A TEAR. The polygon gives the chunk its facets;
          // the fbm wobble is kept but halved, because at its old amplitude it
          // was enough to smooth the straight edges back into a blob and undo
          // the whole point of the change.
          const nx = (x / pw - 0.5) * 2, ny = (y / ph - 0.5) * 2;
          const r = Math.hypot(nx, ny);
          const wobble = fbm2(sx * 0.045, sy * 0.045, seed + cx * 7 + cy * 13);
          let edge;
          if (SIDES > 0) {
            edge = polyAt(Math.atan2(ny, nx)) * (0.96 + 0.15 * (wobble - 0.5));
          } else {
            edge = 0.86 + 0.3 * (wobble - 0.5);
          }
          const a = r <= edge ? 1 : 0;
          const alpha = isBody && a ? 255 : 0;
          px[di + 0] = data[si * ch];
          px[di + 1] = data[si * ch + 1];
          px[di + 2] = data[si * ch + 2];
          px[di + 3] = alpha;
          if (alpha) { kept++; rSum += px[di]; gSum += px[di + 1]; bSum += px[di + 2]; }
        }
      }
      const coverage = bodyPx / (pw * ph);
      if (coverage < MIN_COVERAGE || kept < 24) continue;
      out.push({
        px, w: pw, h: ph, coverage, yawDeg, origin,
        meanRgb: [rSum / kept, gSum / kept, bSum / kept].map(v => Math.round(v)),
      });
    }
  }
  return out;
}

// ——— sheet packing (shelf) ——————————————————————————————————————————

function packPieces(pieces, piecePx) {
  // Scale every piece so its LONG side is `piecePx`, preserving aspect, then
  // shelf-pack the scaled pieces.
  const scaled = pieces.map((pc) => {
    const k = piecePx / Math.max(pc.w, pc.h);
    const w = Math.max(4, Math.round(pc.w * k));
    const h = Math.max(4, Math.round(pc.h * k));
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(pc.h - 1, Math.floor((y / h) * pc.h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(pc.w - 1, Math.floor((x / w) * pc.w));
        const si = (sy * pc.w + sx) * 4;
        const di = (y * w + x) * 4;
        px[di] = pc.px[si]; px[di + 1] = pc.px[si + 1];
        px[di + 2] = pc.px[si + 2]; px[di + 3] = pc.px[si + 3];
      }
    }
    return { ...pc, w, h, px };
  });
  scaled.sort((a, b) => b.h - a.h);
  const targetW = Math.max(piecePx * 4, 512);
  let x = 0, y = 0, rowH = 0;
  const placed = [];
  for (const pc of scaled) {
    if (x + pc.w > targetW) { x = 0; y += rowH + 2; rowH = 0; }
    placed.push({ ...pc, x, y });
    x += pc.w + 2;
    rowH = Math.max(rowH, pc.h);
  }
  const sheetW = targetW;
  const sheetH = y + rowH + 2;
  return { placed, sheetW, sheetH };
}

// ——— main ————————————————————————————————————————————————————————————

/** Every dir's frames, in order, each carrying its own mask dir. */
const SOURCES = [FRAMES_DIR, ...ALSO].map(dir => ({ dir,
  files: readdirSync(dir).filter(f => /^frame-\d+\.png$/.test(f)).sort() }));
const files = SOURCES.flatMap(s => s.files);
// THE MASK COMES FROM THE CAPTURE when the capture could make one: `BLOB_MASK=1`
// on the turntable writes mask-NN.png, the body's silhouette from the difference
// between the frame and the same frame with `__sdfLab.body` hidden. That is
// EXACT, and it retires every heuristic in the key section below — which is kept
// only because a bare turntable run (no masks on disk) still has to do something.
const useMasks = SOURCES.every(s => readdirSync(s.dir).some(f => /^mask-\d+\.png$/.test(f)));
if (!files.length) {
  console.error(`no frame-NN.png in ${FRAMES_DIR} — run: npm run blob:shot -- <character>`);
  process.exit(1);
}
console.log(`cutting ${files.length} frame(s) from ${FRAMES_DIR}`
  + ` (masks: ${useMasks ? 'from the body-hidden capture — exact' : 'KEYED — see the header warning'})`);

const allPieces = [];
let frameStats = [];
SOURCES.flatMap(src => src.files.map(f => ({ src, f }))).forEach(({ src, f: file }, fi) => {
  const p = decodePng(readFileSync(join(src.dir, file)));
  let keep, count;
  const maskFile = `mask-${file.slice(6)}`;
  if (useMasks) {
    const m = decodePng(readFileSync(join(src.dir, maskFile)));
    if (m.w !== p.w || m.h !== p.h) throw new Error(`${maskFile}: size differs from ${file}`);
    keep = new Uint8Array(p.w * p.h);
    count = 0;
    for (let i = 0; i < p.w * p.h; i++) {
      const on = m.data[i * m.ch + 3] > 127 ? 1 : 0;
      keep[i] = on; count += on;
    }
  } else {
    ({ keep, count } = bodyMask(p));
  }
  const rect = bboxOf(keep, p.w, p.h);
  if (!rect) { console.warn(`  ${file}: no body found (key too aggressive?)`); return; }
  // The yaw is the index WITHIN this source, not across the merged list — with
  // two dirs merged, a global index would mislabel every piece of the second set.
  const localIndex = src.files.indexOf(file);
  const yawDeg = Math.round((localIndex / src.files.length) * 360);
  const origin = src.dir === FRAMES_DIR ? 'clean' : (src.dir.split('/').pop() ?? 'extra');
  const pieces = cutFrame(p, keep, rect, yawDeg, SEED + fi * 101, origin);
  allPieces.push(...pieces);
  frameStats.push({ file, dir: src.dir, origin, yawDeg, bodyPx: count, body: rect, pieces: pieces.length });
  console.log(`  ${file} yaw ${String(yawDeg).padStart(3)}deg  body ${count}px  `
    + `rect ${rect.x1 - rect.x0 + 1}x${rect.y1 - rect.y0 + 1}  pieces ${pieces.length}`);
});

if (!allPieces.length) {
  console.error('no pieces survived — check --minCoverage and --keyLuma');
  process.exit(1);
}

const { placed, sheetW, sheetH } = packPieces(allPieces, PIECE_PX);
const sheet = new Uint8Array(sheetW * sheetH * 4);
for (const pc of placed) {
  for (let y = 0; y < pc.h; y++) {
    for (let x = 0; x < pc.w; x++) {
      const si = (y * pc.w + x) * 4;
      const di = ((pc.y + y) * sheetW + (pc.x + x)) * 4;
      sheet[di] = pc.px[si]; sheet[di + 1] = pc.px[si + 1];
      sheet[di + 2] = pc.px[si + 2]; sheet[di + 3] = pc.px[si + 3];
    }
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'sheet.png'), writePng(sheetW, sheetH, sheet));
const manifest = {
  version: 1,
  sheet: 'sheet.png',
  sheetSize: [sheetW, sheetH],
  source: {
    frames: files.length,
    dir: FRAMES_DIR,
    // `cols`/`rows` are REPORTED as the explicit override or null: since the grid
    // is per-frame and aspect-derived, there is no single pair to record. The
    // derivation inputs are what reproduce the sheet.
    cols: COLS, rows: ROWS, cells: CELLS, sides: SIDES,
    piecePx: PIECE_PX, polyScale: POLY_SCALE, keyTol: KEY_TOL, seed: SEED,
    mask: useMasks ? 'body-hidden-capture' : 'keyed',
  },
  frames: placed.map((pc, i) => ({
    picnum: 9000 + i,
    x: pc.x, y: pc.y, w: pc.w, h: pc.h,
    yawDeg: pc.yawDeg,
    origin: pc.origin,
    coverage: +pc.coverage.toFixed(3),
    meanRgb: pc.meanRgb,
  })),
  frameStats,
};
writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// A contact sheet to LOOK at. Whether these read as gore is the owner's call, and
// he should not have to launch the game to make it.
const cells = manifest.frames.map(f => `
  <div class="cell"><img src="${manifest.sheet}" style="--x:${-f.x}px; --y:${-f.y}px; --w:${f.w}px; --h:${f.h}px" />
  <span>${f.picnum} · yaw ${f.yawDeg}°</span></div>`).join('');
const html = `<!doctype html><meta charset="utf-8"><title>gib sheet — ${OUT_DIR}</title>
<style>
 body { background:#141014; color:#c8b8b8; font:12px ui-monospace,monospace; margin:16px; }
 h1 { font-size:14px; font-weight:600; }
 .grid { display:flex; flex-wrap:wrap; gap:10px; }
 .cell { display:flex; flex-direction:column; align-items:center; gap:4px; }
 .cell img { width:var(--w); height:var(--h); object-fit:cover;
   object-position:var(--x) var(--y); image-rendering:pixelated;
   background:conic-gradient(#2a2028 0 25%, #1d1620 0 50%, #2a2028 0 75%, #1d1620 0);
   background-size:12px 12px; border:1px solid #3a2e38; }
 .cell span { font-size:10px; color:#8a7a86; }
</style>
<h1>${placed.length} pieces from ${files.length} yaws — sheet ${sheetW}x${sheetH}</h1>
<p>Checkerboard = transparent alpha. If a piece shows the lab background instead, the key missed.</p>
<div class="grid">${cells}</div>`;
writeFileSync(join(OUT_DIR, 'index.html'), html);

const coverages = placed.map(p => p.coverage);
console.log(`\n${placed.length} pieces from ${files.length} frames`);
console.log(`sheet ${sheetW}x${sheetH} (${(writePng(sheetW, sheetH, sheet).length / 1024).toFixed(0)} KB) -> ${OUT_DIR}/sheet.png`);
console.log(`coverage: min ${Math.min(...coverages).toFixed(2)} median ${[...coverages].sort((a, b) => a - b)[coverages.length >> 1].toFixed(2)} max ${Math.max(...coverages).toFixed(2)}`);
console.log(`review: ${OUT_DIR}/index.html`);
