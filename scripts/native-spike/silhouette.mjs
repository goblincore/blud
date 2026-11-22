// scripts/native-spike/silhouette.mjs
//
// THE SILHOUETTE SPIKE (docs/dev-notes/2026-11-10-silhouette-spike/NOTES.md; the perf research note's proposal B).
// Question: with the edges taken from the field at output resolution, how low can the march's own resolution go?
//
// From silhouette-capture.sh's captures of ONE frozen frame (the march at 800 x 600, 400 x 300, 300 x 225 and
// 200 x 150), this does two separate things:
//
//  QUALITY, on the CPU, from the game's own readbacks. For each low scale it rebuilds the 800 x 600 frame three
//  ways and compares each with the 800 x 600 march:
//    bilinear, bicubic   the low frame scaled up, nothing else
//    sil                 bicubic inside surfaces; on EDGE texels (an output pixel whose 2 x 2 low-res footprint mixes
//                        hit and miss, or spans a depth step) the pixel's own visibility (hit or miss, and depth)
//                        decides: a miss is the background, a hit takes its colour from the footprint's texels on
//                        its own surface (nearest depth). The visibility is read from the 800 x 600 capture, which
//                        is what an edge ray through that pixel returns.
//
//  COST, in the replay harness. The edge rays are the 800 x 600 flat-albedo capture (the walk without the post-hit
//  chain) with one edit to its fragment shader: a pixel that is not an edge texel of the given low frame discards
//  before anything else. Timed by alternation against the shipped 400 x 300 pass and the lower scales.
//
//   node scripts/native-spike/silhouette.mjs <reps> <captureBase> [depthStep]
//     captureBase  e.g. .scratch/sil/mob (the -s100, -e100, -s50, -s375, -s25, -s100b directories beside it)
//     depthStep    the relative depth step that makes an edge (default 0.03); reps 0 = quality and compile only
//   SIL_CDP (default 9391), SIL_REPEAT (10), SIL_ROUNDS (15), SIL_PNG=<dir> writes the pictures there
//
// Writes <captureBase>-silhouette.json. Run through servers.sh, under the GPU lock.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const REPS = Number(process.argv[2] ?? 6);
const BASE = (process.argv[3] ?? '.scratch/sil/mob').replace(/\/+$/, '');
const STEP = Number(process.argv[4] ?? 0.03);
const CDP = process.env.SIL_CDP ?? '9391';
const REPEAT = process.env.SIL_REPEAT ?? '10';
const ROUNDS = process.env.SIL_ROUNDS ?? '15';
const PNG = process.env.SIL_PNG ?? '';
// How far the edge test looks beyond the 2 x 2 footprint, in low-res texels. The march accepts a hit within a pixel's
// footprint of the surface, so a low frame draws its bodies about one of ITS pixels fat: with reach 0 the outer part
// of that ring reads as inside a surface and keeps the body's colour where the full-resolution march sees background.
const REACH = Number(process.env.SIL_REACH ?? 1);
const NEAR = 0.1, FAR = 200;          // lab-renderer.ts's camera
const LOW = ['s50', 's375', 's25'];

// ---------------------------------------------------------------------------------------------------------------
// The captures
// ---------------------------------------------------------------------------------------------------------------
const readCapture = (name) => {
  const dir = `${BASE}-${name}`;
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const pass = manifest.passes[0];
  const view = manifest.objects[pass.desc.colorAttachments[0].view.$ref];
  const ref = pass.post[view.texture.$ref]?.mips?.[0];
  if (!ref) throw new Error(`silhouette: ${dir} has no readback of its colour target`);
  const bytes = readFileSync(join(dir, ref.file));
  const px = new Float32Array(bytes.buffer, bytes.byteOffset, ref.width * ref.height * 4);
  return { name, dir, manifest, w: ref.width, h: ref.height, px, clear: pass.desc.colorAttachments[0].clearValue };
};
const caps = Object.fromEntries(['s100', 'e100', 's100b', ...LOW].map((n) => [n, readCapture(n)]));
const full = caps.s100;
const W = full.w, H = full.h;
const isHit = (a) => a < 0.99999;
const linZ = (d) => (NEAR * FAR) / (FAR - d * (FAR - NEAR));

// ---------------------------------------------------------------------------------------------------------------
// Scaling up, and the edge texels
// ---------------------------------------------------------------------------------------------------------------
const clampI = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
/** The low frame's 2 x 2 footprint under output pixel (X, Y): texel indices and bilinear weights. */
const footprint = (low, X, Y, out) => {
  const u = (X + 0.5) * (low.w / W) - 0.5, v = (Y + 0.5) * (low.h / H) - 0.5;
  const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  const xa = clampI(x0, low.w), xb = clampI(x0 + 1, low.w), ya = clampI(y0, low.h), yb = clampI(y0 + 1, low.h);
  out.i[0] = ya * low.w + xa; out.i[1] = ya * low.w + xb; out.i[2] = yb * low.w + xa; out.i[3] = yb * low.w + xb;
  out.w[0] = (1 - fx) * (1 - fy); out.w[1] = fx * (1 - fy); out.w[2] = (1 - fx) * fy; out.w[3] = fx * fy;
  out.x0 = x0; out.y0 = y0; out.fx = fx; out.fy = fy;
  return out;
};
const cr = (t) => [((-t + 2) * t - 1) * t / 2, ((3 * t - 5) * t * t + 2) / 2, ((-3 * t + 4) * t + 1) * t / 2, ((t - 1) * t * t) / 2];

const edgeMask = (low) => {
  const mask = new Float32Array(W * H);
  const f = { i: [0, 0, 0, 0], w: [0, 0, 0, 0] };
  let n = 0;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    footprint(low, X, Y, f);
    let hits = 0, zmin = Infinity, zmax = 0, seen = 0;
    for (let dy = -REACH; dy <= 1 + REACH; dy++) for (let dx = -REACH; dx <= 1 + REACH; dx++) {
      seen++;
      const a = low.px[(clampI(f.y0 + dy, low.h) * low.w + clampI(f.x0 + dx, low.w)) * 4 + 3];
      if (!isHit(a)) continue;
      hits++;
      const z = linZ(a);
      if (z < zmin) zmin = z;
      if (z > zmax) zmax = z;
    }
    if ((hits > 0 && hits < seen) || (hits === seen && zmax - zmin > STEP * zmin)) { mask[Y * W + X] = 1; n++; }
  }
  return { mask, n };
};

const upscale = (low, mode, mask) => {
  const out = new Float32Array(W * H * 3);
  const f = { i: [0, 0, 0, 0], w: [0, 0, 0, 0] };
  const stats = { edge: 0, edgeMiss: 0, edgeNoSurface: 0 };
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const o = (Y * W + X) * 3;
    footprint(low, X, Y, f);
    if (mode === 'sil' && mask[Y * W + X]) {
      stats.edge++;
      // The pixel's own visibility: what a ray through it returns.
      const a = full.px[(Y * W + X) * 4 + 3];
      if (!isHit(a)) { stats.edgeMiss++; out[o] = low.clear.r; out[o + 1] = low.clear.g; out[o + 2] = low.clear.b; continue; }
      const zt = linZ(a);
      let ws = 0, r = 0, g = 0, b = 0;
      for (let k = 0; k < 4; k++) {
        const la = low.px[f.i[k] * 4 + 3];
        if (!isHit(la) || Math.abs(linZ(la) - zt) > STEP * zt) continue;
        const wk = f.w[k] + 1e-3;
        ws += wk; r += wk * low.px[f.i[k] * 4]; g += wk * low.px[f.i[k] * 4 + 1]; b += wk * low.px[f.i[k] * 4 + 2];
      }
      if (ws === 0) {
        // No texel of the footprint is on this surface: the nearest in depth among the hits of a 4 x 4 block.
        stats.edgeNoSurface++;
        let best = -1, bd = Infinity;
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
          const i = clampI(f.y0 + dy, low.h) * low.w + clampI(f.x0 + dx, low.w), la = low.px[i * 4 + 3];
          if (!isHit(la)) continue;
          const d = Math.abs(linZ(la) - zt);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) best = f.i[0];
        ws = 1; r = low.px[best * 4]; g = low.px[best * 4 + 1]; b = low.px[best * 4 + 2];
      }
      out[o] = r / ws; out[o + 1] = g / ws; out[o + 2] = b / ws;
      continue;
    }
    if (mode === 'bilinear') {
      for (let c = 0; c < 3; c++) out[o + c] = f.w[0] * low.px[f.i[0] * 4 + c] + f.w[1] * low.px[f.i[1] * 4 + c] + f.w[2] * low.px[f.i[2] * 4 + c] + f.w[3] * low.px[f.i[3] * 4 + c];
      continue;
    }
    const wx = cr(f.fx), wy = cr(f.fy);
    for (let j = 0; j < 4; j++) {
      const row = clampI(f.y0 - 1 + j, low.h) * low.w;
      for (let i = 0; i < 4; i++) {
        const t = (row + clampI(f.x0 - 1 + i, low.w)) * 4, wk = wx[i] * wy[j];
        out[o] += wk * low.px[t]; out[o + 1] += wk * low.px[t + 1]; out[o + 2] += wk * low.px[t + 2];
      }
    }
  }
  return { rgb: out, stats };
};

// ---------------------------------------------------------------------------------------------------------------
// The comparison: mean absolute difference of the display-encoded colour, over the frame, the edge band and inside
// ---------------------------------------------------------------------------------------------------------------
const enc = (v) => Math.min(1, Math.max(0, v)) ** (1 / 2.2);
// The band: output pixels within 2 px of a place where the 800 x 600 march changes surface (hit against miss, or a
// depth step), found from the truth so it is the same band for every method.
const band = new Uint8Array(W * H);
{
  const edge = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = full.px[(y * W + x) * 4 + 3], h = isHit(a), z = h ? linZ(a) : 0;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (x + dx >= W || y + dy >= H) continue;
      const b = full.px[((y + dy) * W + x + dx) * 4 + 3], hb = isHit(b);
      if (h !== hb || (h && Math.abs(linZ(b) - z) > STEP * Math.min(z, linZ(b)))) { edge[y * W + x] = 1; edge[(y + dy) * W + x + dx] = 1; }
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!edge[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < H && xx >= 0 && xx < W) band[yy * W + xx] = 1;
    }
  }
}
const truth = new Float32Array(W * H * 3);
for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) truth[i * 3 + c] = full.px[i * 4 + c];
const compare = (rgb) => {
  const s = { all: 0, band: 0, inside: 0 }, n = { all: 0, band: 0, inside: 0 };
  for (let i = 0; i < W * H; i++) {
    const d = (Math.abs(enc(rgb[i * 3]) - enc(truth[i * 3])) + Math.abs(enc(rgb[i * 3 + 1]) - enc(truth[i * 3 + 1])) + Math.abs(enc(rgb[i * 3 + 2]) - enc(truth[i * 3 + 2]))) / 3;
    s.all += d; n.all++;
    if (band[i]) { s.band += d; n.band++; } else if (isHit(full.px[i * 4 + 3])) { s.inside += d; n.inside++; }
  }
  return { all: s.all / n.all, band: s.band / n.band, inside: s.inside / n.inside, pixels: n };
};

// A PNG, for a look by eye (no dependency: one zlib stream).
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const writePng = (file, rgb) => {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = Math.round(255 * enc(rgb[y * W * 3 + x]));
  const head = Buffer.alloc(13); head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head[8] = 8; head[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
};
if (PNG) { mkdirSync(PNG, { recursive: true }); writePng(join(PNG, 'native.png'), truth); }

const quality = {};
const again = new Float32Array(W * H * 3);
for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) again[i * 3 + c] = caps.s100b.px[i * 4 + c];
quality.repeat = compare(again);
const masks = {};
console.log(`${BASE}: ${W} x ${H}; reach ${REACH}; band ${quality.repeat.pixels.band} px, inside ${quality.repeat.pixels.inside} px; depth step ${STEP}`);
console.log(`${'frame'.padEnd(18)}${'all'.padStart(9)}${'band'.padStart(9)}${'inside'.padStart(9)}   edge texels`);
const line = (name, q, extra = '') => console.log(`${name.padEnd(18)}${q.all.toFixed(5).padStart(9)}${q.band.toFixed(5).padStart(9)}${q.inside.toFixed(5).padStart(9)}   ${extra}`);
line('800x600 again', quality.repeat);
for (const s of LOW) {
  const low = caps[s];
  masks[s] = edgeMask(low);
  quality[s] = { size: [low.w, low.h], edgeTexels: masks[s].n };
  for (const mode of ['bilinear', 'bicubic', 'sil']) {
    const up = upscale(low, mode, masks[s].mask);
    quality[s][mode] = { ...compare(up.rgb), ...(mode === 'sil' ? up.stats : {}) };
    line(`${low.w}x${low.h} ${mode}`, quality[s][mode], mode === 'sil' ? `${up.stats.edge} (${(100 * up.stats.edge / (W * H)).toFixed(1)} % of the frame; ${up.stats.edgeMiss} miss, ${up.stats.edgeNoSurface} with no texel on their surface)` : '');
    if (PNG) writePng(join(PNG, `${s}-${mode}.png`), up.rgb);
  }
}
const file = `${BASE}-silhouette.json`;
const save = (extra = {}) => writeFileSync(file, JSON.stringify({ base: BASE, depthStep: STEP, reach: REACH, quality, ...extra }, null, 1));
save();

// ---------------------------------------------------------------------------------------------------------------
// The edge rays as a replayable pass: the flat 800 x 600 capture, discarding every pixel that is not an edge texel
// ---------------------------------------------------------------------------------------------------------------
const buildEdgePass = (s) => {
  const dir = caps.e100.dir;
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const pass = m.passes[0];
  let next = Math.max(...Object.keys(m.objects).map(Number)) + 1;
  const add = (o) => { m.objects[next] = o; return next++; };
  const maskFile = `sil_mask_${s}.bin`;
  writeFileSync(join(dir, maskFile), Buffer.from(masks[s].mask.buffer));
  const tex = add({ kind: 'texture', desc: { size: [W, H], format: 'r32float', dimension: '2d', mipLevelCount: 1, sampleCount: 1, viewFormats: [], usage: 4 } });
  pass.res[tex] = { mips: [{ file: maskFile, width: W, height: H, bytesPerRow: W * 4, layers: 1 }] };
  const view = add({ kind: 'view', texture: { $ref: tex }, desc: {} });
  const layout = add({ kind: 'bindGroupLayout', desc: { entries: [{ binding: 0, visibility: 2, texture: { sampleType: 'unfilterable-float' } }] } });
  const group = add({ kind: 'bindGroup', desc: { layout: { $ref: layout }, entries: [{ binding: 0, resource: { $ref: view } }] } });
  const doneLayouts = new Map(), doneModules = new Map();
  const cmds = [];
  let slot = -1;
  for (const c of pass.cmds) {
    cmds.push(c);
    if (c[0] !== 'setPipeline') continue;
    const pipe = m.objects[c[1].$ref];
    const lay = m.objects[pipe.desc.layout.$ref];
    if (lay.kind !== 'pipelineLayout') throw new Error(`silhouette: a pipeline with a ${lay.kind} layout`);
    if (!doneLayouts.has(pipe.desc.layout.$ref)) {
      doneLayouts.set(pipe.desc.layout.$ref, lay.desc.bindGroupLayouts.length);
      lay.desc.bindGroupLayouts.push({ $ref: layout });
    }
    slot = doneLayouts.get(pipe.desc.layout.$ref);
    const modId = pipe.desc.fragment.module.$ref;
    if (!doneModules.has(modId)) {
      doneModules.set(modId, slot);
      let code = m.objects[modId].desc.code;
      const at = code.indexOf('\n@fragment\nfn main(');
      if (at < 0) throw new Error('silhouette: no fragment main in a march module');
      code = `${code.slice(0, at)}\n@group( ${slot} ) @binding( 0 ) var gSilMask : texture_2d<f32>;\n${code.slice(at)}`;
      const head = /\n@fragment\nfn main\([^{]*\{/.exec(code);
      if (!head || !head[0].includes('fragCoord')) throw new Error('silhouette: the fragment main has no fragCoord');
      const end = head.index + head[0].length;
      // `discard` alone does not end the invocation (WGSL demotes it to a helper that runs on): the first version of
      // this edit cost the same whatever the mask held. Return as well.
      code = `${code.slice(0, end)}\n\tif ( textureLoad( gSilMask, vec2<i32>( fragCoord.xy ), 0 ).r < 0.5 ) { discard; var silSkipped : OutputStruct; return silSkipped; }\n${code.slice(end)}`;
      m.objects[modId].desc.code = code;
    } else if (doneModules.get(modId) !== slot) throw new Error('silhouette: one module under two layouts of different size');
    cmds.push(['setBindGroup', slot, { $ref: group }]);
  }
  pass.cmds = cmds;
  const name = `manifest.sil-${s}.json`;
  writeFileSync(join(dir, name), JSON.stringify(m));
  return name;
};

const legs = [
  { name: 's50', dir: caps.s50.dir, manifest: 'manifest.json' },
  { name: 's50again', dir: caps.s50.dir, manifest: 'manifest.json' },
  ...LOW.slice(1).map((s) => ({ name: s, dir: caps[s].dir, manifest: 'manifest.json' })),
  ...LOW.map((s) => ({ name: `edge-${s}`, dir: caps.e100.dir, manifest: buildEdgePass(s), edgeTexels: masks[s].n })),
];

const run = (leg, repeat = REPEAT, rounds = ROUNDS) => {
  let out;
  try {
    out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, leg.dir, repeat, rounds, leg.manifest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (e) {
    out = String(e.stdout ?? '');
    if (!out.trim()) throw new Error(`silhouette: ${leg.name} replay failed: ${String(e.stderr || e.message).slice(0, 2000)}`);
  }
  return JSON.parse(out.trim().split('\n').pop());
};
const info = {};
let failed = false;
for (const leg of legs) {
  const t0 = Date.now();
  const res = run(leg, '2', '2');
  const p = res.parity?.[0] ?? {};
  info[leg.name] = { warmS: (Date.now() - t0) / 1000, parity: res.parity, errors: res.errors };
  console.log(`warm ${leg.name.padEnd(10)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  texels differing from the game's frame: ${p.differingTexels ?? '?'}  errors ${res.errors?.length ?? 0}`);
  if (res.errors?.length) { failed = true; for (const e of res.errors.slice(0, 4)) console.error(`  ERROR ${leg.name}: ${e.slice(0, 1200)}`); }
}
save({ legs, info });
if (failed) { console.error('silhouette: a leg replays with errors; nothing timed'); process.exit(1); }
if (REPS === 0) { console.log(`wrote ${file}`); process.exit(0); }

const reps = [];
for (let rep = 0; rep < REPS; rep++) {
  const order = legs.map((_, i) => legs[(i + rep) % legs.length]);
  const row = { rep: rep + 1, ms: {} };
  for (const leg of order) row.ms[leg.name] = run(leg).medianMs;
  reps.push(row);
  console.log(`  rep ${String(rep + 1).padStart(2)}  ${legs.map((l) => `${l.name} ${row.ms[l.name].toFixed(2)}`).join('  ')}`);
  save({ legs, info, runs: reps });
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const base = med(reps.map((r) => r.ms.s50));
const table = [];
const row = (name, f) => {
  const d = reps.map((r) => f(r.ms) - r.ms.s50), v = reps.map((r) => f(r.ms));
  const t = { name, medianMs: med(v), diffMedianMs: med(d), diffMinMs: Math.min(...d), diffMaxMs: Math.max(...d), diffMedianPct: 100 * med(d) / base };
  table.push(t);
  console.log(`${name.padEnd(22)}${t.medianMs.toFixed(2).padStart(8)}${`${t.diffMedianMs >= 0 ? '+' : ''}${t.diffMedianMs.toFixed(2)}`.padStart(9)}  (${t.diffMinMs.toFixed(2)} .. ${t.diffMaxMs.toFixed(2)})  ${t.diffMedianPct.toFixed(1)} %`);
};
console.log(`\nms a pass, and each repeat's difference from the shipped 400 x 300 pass in the same repeat (median ${base.toFixed(2)} ms)`);
row('400x300 again (A/A)', (m) => m.s50again);
for (const s of LOW) row(`edge rays for ${s}`, (m) => m[`edge-${s}`]);
for (const s of LOW) row(`${s} + its edge rays`, (m) => (s === 's50' ? m.s50 : m[s]) + m[`edge-${s}`]);
for (const s of LOW.slice(1)) row(`${s} alone`, (m) => m[s]);
save({ legs, info, runs: reps, baseMedianMs: base, table });
console.log(`\nwrote ${file}`);
