// scripts/native-spike/march-census.mjs
//
// WHERE THE MARCH'S TIME GOES, BY PIXEL (docs/dev-notes/2026-11-10-silhouette-spike/CENSUS.md). A captured
// `sdf:march` pass is replayed with one edit to its fragment shader: a pixel outside a given CLASS returns at once.
// The classes come from the game's own readback of the frame:
//
//   hit    the pixel ended on a body
//   near   a miss within NEAR px (default 8) of a hit: the grazing rays round the silhouettes
//   far    every other miss the pass rasterised
//   none   no pixel runs: what the pass costs with every invocation returning at its first line
//
// Each class is timed by alternation against the whole pass. A class's own cost is its leg minus `none`.
//
//   node scripts/native-spike/march-census.mjs <reps> <captureDir> [nearPx]
//   CENSUS_CDP (default 9391), CENSUS_REPEAT (10), CENSUS_ROUNDS (15)
//
// Writes <captureDir>-census.json. Run through servers.sh, under the GPU lock. The capture must be the FRAGMENT
// march (capture.mjs turns the compute march off). The mask edit is silhouette.mjs's, with its trap: a `discard`
// needs its `return`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPS = Number(process.argv[2] ?? 5);
const DIR = (process.argv[3] ?? '.scratch/compute/mob-ship').replace(/\/+$/, '');
const NEAR = Number(process.argv[4] ?? 8);
const CDP = process.env.CENSUS_CDP ?? '9391';
const REPEAT = process.env.CENSUS_REPEAT ?? '10';
const ROUNDS = process.env.CENSUS_ROUNDS ?? '15';

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const pass0 = manifest.passes[0];
const view0 = manifest.objects[pass0.desc.colorAttachments[0].view.$ref];
const ref = pass0.post[view0.texture.$ref]?.mips?.[0];
if (!ref) throw new Error(`march-census: ${DIR} has no readback of its colour target`);
const W = ref.width, H = ref.height;
const bytes = readFileSync(join(DIR, ref.file));
const px = new Float32Array(bytes.buffer, bytes.byteOffset, W * H * 4);
const hit = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) hit[i] = px[i * 4 + 3] < 0.99999 ? 1 : 0;
// Distance to the nearest hit, capped: a box dilation NEAR times is enough for "within NEAR px".
const near = new Uint8Array(W * H);
{
  let cur = hit.slice();
  for (let k = 0; k < NEAR; k++) {
    const next = cur.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (cur[y * W + x]) continue;
      if ((x > 0 && cur[y * W + x - 1]) || (x < W - 1 && cur[y * W + x + 1]) || (y > 0 && cur[(y - 1) * W + x]) || (y < H - 1 && cur[(y + 1) * W + x])) next[y * W + x] = 1;
    }
    cur = next;
  }
  for (let i = 0; i < W * H; i++) near[i] = cur[i] && !hit[i] ? 1 : 0;
}
const classes = {
  hit: (i) => hit[i] === 1,
  near: (i) => near[i] === 1,
  far: (i) => hit[i] === 0 && near[i] === 0,
  none: () => false,
};
const counts = Object.fromEntries(Object.entries(classes).map(([k, f]) => { let n = 0; for (let i = 0; i < W * H; i++) if (f(i)) n++; return [k, n]; }));

const buildLeg = (name) => {
  const m = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
  const pass = m.passes[0];
  let next = Math.max(...Object.keys(m.objects).map(Number)) + 1;
  const add = (o) => { m.objects[next] = o; return next++; };
  const mask = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = classes[name](i) ? 1 : 0;
  const file = `census_mask_${name}.bin`;
  writeFileSync(join(DIR, file), Buffer.from(mask.buffer));
  const tex = add({ kind: 'texture', desc: { size: [W, H], format: 'r32float', dimension: '2d', mipLevelCount: 1, sampleCount: 1, viewFormats: [], usage: 4 } });
  pass.res[tex] = { mips: [{ file, width: W, height: H, bytesPerRow: W * 4, layers: 1 }] };
  const view = add({ kind: 'view', texture: { $ref: tex }, desc: {} });
  const layout = add({ kind: 'bindGroupLayout', desc: { entries: [{ binding: 0, visibility: 2, texture: { sampleType: 'unfilterable-float' } }] } });
  const group = add({ kind: 'bindGroup', desc: { layout: { $ref: layout }, entries: [{ binding: 0, resource: { $ref: view } }] } });
  const doneLayouts = new Map(), doneModules = new Map();
  const cmds = [];
  for (const c of pass.cmds) {
    cmds.push(c);
    if (c[0] !== 'setPipeline') continue;
    const pipe = m.objects[c[1].$ref], lay = m.objects[pipe.desc.layout.$ref];
    if (lay.kind !== 'pipelineLayout') throw new Error(`march-census: a pipeline with a ${lay.kind} layout`);
    if (!doneLayouts.has(pipe.desc.layout.$ref)) {
      doneLayouts.set(pipe.desc.layout.$ref, lay.desc.bindGroupLayouts.length);
      lay.desc.bindGroupLayouts.push({ $ref: layout });
    }
    const slot = doneLayouts.get(pipe.desc.layout.$ref);
    const modId = pipe.desc.fragment.module.$ref;
    if (!doneModules.has(modId)) {
      doneModules.set(modId, slot);
      let code = m.objects[modId].desc.code;
      const at = code.indexOf('\n@fragment\nfn main(');
      if (at < 0) throw new Error('march-census: no fragment main in a march module');
      code = `${code.slice(0, at)}\n@group( ${slot} ) @binding( 0 ) var gCensusMask : texture_2d<f32>;\n${code.slice(at)}`;
      const head = /\n@fragment\nfn main\([^{]*\{/.exec(code);
      if (!head || !head[0].includes('fragCoord')) throw new Error('march-census: the fragment main has no fragCoord');
      const end = head.index + head[0].length;
      code = `${code.slice(0, end)}\n\tif ( textureLoad( gCensusMask, vec2<i32>( fragCoord.xy ), 0 ).r < 0.5 ) { discard; var censusSkipped : OutputStruct; return censusSkipped; }\n${code.slice(end)}`;
      m.objects[modId].desc.code = code;
    } else if (doneModules.get(modId) !== slot) throw new Error('march-census: one module under two layouts of different size');
    cmds.push(['setBindGroup', slot, { $ref: group }]);
  }
  pass.cmds = cmds;
  const out = `manifest.census-${name}.json`;
  writeFileSync(join(DIR, out), JSON.stringify(m));
  return out;
};

const legs = [
  { name: 'all', manifest: 'manifest.json' },
  { name: 'all2', manifest: 'manifest.json' },
  ...Object.keys(classes).map((name) => ({ name, manifest: buildLeg(name), pixels: counts[name] })),
];
const run = (leg, repeat = REPEAT, rounds = ROUNDS) => {
  let out;
  try {
    out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, DIR, repeat, rounds, leg.manifest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (e) {
    out = String(e.stdout ?? '');
    if (!out.trim()) throw new Error(`march-census: ${leg.name} replay failed: ${String(e.stderr || e.message).slice(0, 2000)}`);
  }
  return JSON.parse(out.trim().split('\n').pop());
};
console.log(`${DIR}: ${W} x ${H}, ${pass0.cmds.filter((c) => c[0].startsWith('draw')).length} draw(s); hit ${counts.hit} px (${(100 * counts.hit / (W * H)).toFixed(1)} %), near miss (within ${NEAR} px) ${counts.near}, far miss ${counts.far}`);
let failed = false;
for (const leg of legs) {
  const t0 = Date.now();
  const res = run(leg, '2', '2');
  console.log(`warm ${leg.name.padEnd(5)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  errors ${res.errors?.length ?? 0}`);
  if (res.errors?.length) { failed = true; for (const e of res.errors.slice(0, 4)) console.error(`  ERROR ${leg.name}: ${e.slice(0, 1200)}`); }
}
if (failed) { console.error('march-census: a leg replays with errors; nothing timed'); process.exit(1); }
const file = `${DIR}-census.json`;
const reps = [];
for (let rep = 0; rep < REPS; rep++) {
  const order = legs.map((_, i) => legs[(i + rep) % legs.length]);
  const row = {};
  for (const leg of order) row[leg.name] = run(leg).medianMs;
  reps.push(row);
  console.log(`  rep ${String(rep + 1).padStart(2)}  ${legs.map((l) => `${l.name} ${row[l.name].toFixed(2)}`).join('  ')}`);
  writeFileSync(file, JSON.stringify({ dir: DIR, size: [W, H], near: NEAR, counts, runs: reps }, null, 1));
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const all = med(reps.map((r) => r.all));
const table = [];
console.log(`\nthe whole pass ${all.toFixed(2)} ms; again ${med(reps.map((r) => r.all2)).toFixed(2)}; with no pixel running ${med(reps.map((r) => r.none)).toFixed(2)}`);
console.log(`${'class'.padEnd(6)}${'pixels'.padStart(9)}${'leg ms'.padStart(9)}${'own ms'.padStart(9)}${'range'.padStart(18)}${'of the pass'.padStart(13)}${'ns a pixel'.padStart(12)}`);
for (const name of ['hit', 'near', 'far']) {
  const own = reps.map((r) => r[name] - r.none);
  const t = { name, pixels: counts[name], legMs: med(reps.map((r) => r[name])), ownMs: med(own), ownMin: Math.min(...own), ownMax: Math.max(...own) };
  t.share = t.ownMs / all; t.nsPerPixel = counts[name] ? 1e6 * t.ownMs / counts[name] : 0;
  table.push(t);
  console.log(`${name.padEnd(6)}${String(t.pixels).padStart(9)}${t.legMs.toFixed(2).padStart(9)}${t.ownMs.toFixed(2).padStart(9)}${`${t.ownMin.toFixed(2)}..${t.ownMax.toFixed(2)}`.padStart(18)}${`${(100 * t.share).toFixed(0)} %`.padStart(13)}${t.nsPerPixel.toFixed(0).padStart(12)}`);
}
const sum = med(reps.map((r) => r.hit + r.near + r.far - 2 * r.none));
console.log(`the three legs put together (hit + near + far - 2 x none): ${sum.toFixed(2)} ms against the whole pass's ${all.toFixed(2)}`);
writeFileSync(file, JSON.stringify({ dir: DIR, size: [W, H], near: NEAR, counts, runs: reps, allMs: all, noneMs: med(reps.map((r) => r.none)), table, sumMs: sum }, null, 1));
console.log(`wrote ${file}`);
