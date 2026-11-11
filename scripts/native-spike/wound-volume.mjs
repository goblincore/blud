// scripts/native-spike/wound-volume.mjs
//
// A BAKED WOUND VOLUME, IN THE REPLAY (docs/dev-notes/2026-11-10-silhouette-spike/WOUND-VOLUME.md). The wounded
// mob's wounds, read from a 3D texture where the march walks a list of them.
//
//   bake   The capture's own crater code fills the volume. The pass is replayed once per depth slice: every pixel
//          evaluates mapBody at camPos + rd * t with applyWounds starting from -1 m (deep inside) and its rim bump
//          at full strength, so what comes back is the wound chain's own value (a second sweep returns the rim
//          bumps' sum and largest amplitude: inside the body a bump fills a large part of its carved sphere back in), the largest over the pixel's bodies, and WHICH body's it is
//          (crowd type and slot): a body reads its own carve only, as a per-limb volume would have it. Those froxels are then
//          resampled on the CPU into a regular world-space grid at each voxel size.
//   run    Legs that read the grid: applyWounds becomes one trilinear sample, smax'd onto the incoming distance.
//
//   node scripts/native-spike/wound-volume.mjs bake <captureDir>
//   node scripts/native-spike/wound-volume.mjs run <reps> <captureDir> [sheetDir]
//   WV_CDP (default 9391), WV_REPEAT (10), WV_ROUNDS (15), WV_ONLY (comma list), WV_SIZES (cm, default "1,2")
//
// Run through servers.sh, under the GPU lock. The capture is the FRAGMENT march. What the grid is NOT: a per-limb
// rest-frame volume (the frame is frozen, so world space stands in), nor small (one box round the whole mob).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MODE = process.argv[2];
const CDP = process.env.WV_CDP ?? '9391';
const SIZES = (process.env.WV_SIZES ?? '1,2').split(',').map(Number);
// Carve values below this do not move a surface: the fillet reaches 4 k = 6 cm, and the near flag reads -0.1.
const FLOOR = -0.12;
// Slices beyond this distance of the camera are left out of the grid (WV_MAXT, metres): one box round a whole mob
// at 1 cm does not fit a texture.
const MAXT = Number(process.env.WV_MAXT ?? 1e9);

const once = (code, find, repl) => {
  const n = code.split(find).length - 1;
  if (n !== 1) throw new Error(`wound-volume: expected 1 match, found ${n}, for: ${find.slice(0, 70)}`);
  return code.replace(find, () => repl);
};
const BOUND = '  if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }';
const MAIN = '\n@fragment\nfn main(';

/** A copy of the manifest with one more bind group on every march pipeline; edit(code, slot) rewrites each module. */
const withGroup = (DIR, layoutEntries, resources, edit) => {
  const m = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
  const pass = m.passes[0];
  let next = Math.max(...Object.keys(m.objects).map(Number)) + 1;
  const add = (o) => { m.objects[next] = o; return next++; };
  const made = resources(add, pass);
  const layout = add({ kind: 'bindGroupLayout', desc: { entries: layoutEntries } });
  const group = add({ kind: 'bindGroup', desc: { layout: { $ref: layout }, entries: made.entries } });
  const doneLayouts = new Map(), doneModules = new Map();
  const cmds = [];
  for (const c of pass.cmds) {
    cmds.push(c);
    if (c[0] !== 'setPipeline') continue;
    const pipe = m.objects[c[1].$ref], lay = m.objects[pipe.desc.layout.$ref];
    if (lay.kind !== 'pipelineLayout') throw new Error(`wound-volume: a pipeline with a ${lay.kind} layout`);
    if (!doneLayouts.has(pipe.desc.layout.$ref)) {
      doneLayouts.set(pipe.desc.layout.$ref, lay.desc.bindGroupLayouts.length);
      lay.desc.bindGroupLayouts.push({ $ref: layout });
    }
    const slot = doneLayouts.get(pipe.desc.layout.$ref);
    const modId = pipe.desc.fragment.module.$ref;
    if (!doneModules.has(modId)) {
      doneModules.set(modId, slot);
      m.objects[modId].desc.code = edit(m.objects[modId].desc.code, slot, doneModules.size - 1);
    } else if (doneModules.get(modId) !== slot) throw new Error('wound-volume: one module under two layouts of different size');
    cmds.push(['setBindGroup', slot, { $ref: group }]);
  }
  pass.cmds = cmds;
  return { m, made };
};

// ---------------------------------------------------------------------------------------------------------- bake
const paramGroup = (DIR, edit) => {
  const { m, made } = withGroup(DIR, [{ binding: 0, visibility: 2, texture: { sampleType: 'unfilterable-float' } }], (add, pass) => {
    writeFileSync(join(DIR, 'wv_param.bin'), Buffer.from(new Float32Array([1]).buffer));
    const tex = add({ kind: 'texture', desc: { size: [1, 1], format: 'r32float', dimension: '2d', mipLevelCount: 1, sampleCount: 1, viewFormats: [], usage: 4 } });
    pass.res[tex] = { mips: [{ file: 'wv_param.bin', width: 1, height: 1, bytesPerRow: 4, layers: 1 }] };
    const view = add({ kind: 'view', texture: { $ref: tex }, desc: {} });
    return { tex, entries: [{ binding: 0, resource: { $ref: view } }] };
  }, (code, slot, ord) => once(edit(code, ord), MAIN, `\n@group( ${slot} ) @binding( 0 ) var gWVParam : texture_2d<f32>;\nvar<private> gBakeT: f32 = -1.0;\nvar<private> gBakeId: f32 = 0.0;\nvar<private> gBakeB: f32 = 0.0;\nvar<private> gBakeA: f32 = 0.0;${MAIN}`));
  m.sweepTex = made.tex;
  return m;
};
const SITE = '  var hitPiece = 0;\n  var hitSplitF = 0.0;\n  for (var i = 0; i < 512; i = i + 1) {';
const site = (body) => (c) => once(c, SITE, `  if (true) {\n    let bt = textureLoad(gWVParam, vec2<i32>(0, 0), 0).r;\n${body}\n  }\n${SITE}`);
const bakeEdit = (rim) => (c, ord) => {
  const call = /dres = (mapBody\(camPos \+ rd \* t, [^\n]*?instCfg\)); \}\n/.exec(c);
  if (!call) throw new Error('wound-volume: the walk\'s mapBody call was not found');
  c = once(c, '  var d = dIn;\n  var near = 0.0;\n  // One sphere test before the loop', '  var d = -1.0;\n  var near = 0.0;\n  var wvB = 0.0;\n  var wvA = 0.0;\n  // One sphere test before the loop');
  // The chain keeps its rim bumps at full strength (the gate a point inside the body sees), in the list's own
  // order: a later crater cuts through an earlier one's bump. The second sweep sums the bumps on their own.
  c = once(c, '    let rimLocal = 1.0 - smoothstep(-amp * 0.3, amp * 0.7, dIn);', `    let rimLocal = ${rim === 'off' ? '0.0' : '1.0'};`);
  if (rim === 'sum') c = once(c, '    d = d - exp(-x * x) * amp * rimLocal;', '    wvB = wvB + exp(-x * x) * amp;\n    wvA = max(wvA, amp);\n    d = d - exp(-x * x) * amp * rimLocal;');
  c = once(c, '  return vec2<f32>(d, near);\n}', `  // The whole-body call only: the re-fold's calls run a limb's own wounds, a shorter chain with fewer bumps.\n  if (gWoundCluster == 0.0) {\n    if (d > gBakeT) { gBakeT = d; gBakeId = f32(gSlot) + ${256 * ord + 1}.0; }\n    if (wvB > gBakeB) { gBakeB = wvB; gBakeA = wvA; }\n  }\n  return vec2<f32>(d, near);\n}`);
  // The page clamps colour at 0, so the carve goes out as carve + 1. The fourth lane is the distance the pass turns
  // into depth: a deeper carve reads nearer, so it wins where two crowd types' proxies cover one pixel.
  return site(`    gWalkStep = 0.0;\n    gBakeT = -1.0;\n    gBakeId = 0.0;\n    gBakeB = 0.0;\n    gBakeA = 0.0;\n    let bres = ${call[1].replace('camPos + rd * t', 'camPos + rd * bt')};\n    return vec4<f32>(${rim === 'sum' ? 'gBakeB, gBakeA' : 'gBakeT + 1.0, gBakeId'} + bres.x * 1e-12, bt, 2.0 - clamp(gBakeT + 1.0, 0.0, 1.0));`)(c);
};
const raysEdit = site('    return vec4<f32>(rd * 0.5 + 0.5, 1.0 + bt * 1e-9);');
const camEdit = site('    return vec4<f32>(camPos * 0.01 + 0.5, 1.0 + bt * 1e-9);');

const sweep = (DIR, manifest, out, first, step, count) => {
  mkdirSync(out, { recursive: true });
  const res = JSON.parse(execFileSync('node', ['scripts/native-spike/sweep-chrome.mjs', CDP, DIR, manifest, out, String(first), String(step), String(count)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).trim().split('\n').pop());
  if (res.errors?.length) throw new Error(`wound-volume: ${manifest}: ${res.errors.slice(0, 3).join(' | ').slice(0, 2000)}`);
  return res;
};
const slice = (out, i) => { const b = readFileSync(join(out, `${i}.bin`)); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const solve = (A, b) => { // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
};
const toHalf = (() => {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  return (v) => {
    f[0] = v;
    const x = u[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, mnt = x & 0x7fffff;
    if (e <= 0) return s; // the values here are never subnormal halves worth keeping
    if (e >= 31) return s | 0x7c00;
    return s | (e << 10) | (mnt >>> 13);
  };
})();

function bake(DIR) {
  const tmp = join(DIR, 'wv');
  for (const [name, edit] of [['bake', bakeEdit('on')], ['bake-rim', bakeEdit('sum')], ['bake-carve', bakeEdit('off')], ['rays', raysEdit], ['cam', camEdit]]) writeFileSync(join(DIR, `manifest.wv-${name}.json`), JSON.stringify(paramGroup(DIR, edit)));
  const { width: W, height: H } = sweep(DIR, 'manifest.wv-rays.json', join(tmp, 'rays'), 1, 0, 1);
  sweep(DIR, 'manifest.wv-cam.json', join(tmp, 'cam'), 1, 0, 1);
  const rays = slice(join(tmp, 'rays'), 0), camPx = slice(join(tmp, 'cam'), 0);
  // Undo the encodings: a pixel that ran has a depth under the clear's 1 in its fourth lane.
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) { rays[i * 4 + c] = rays[i * 4 + c] * 2 - 1; camPx[i * 4 + c] = (camPx[i * 4 + c] - 0.5) * 100; }
  const valid = new Uint8Array(W * H);
  let cam = null, nValid = 0;
  for (let i = 0; i < W * H; i++) if (rays[i * 4 + 3] < 0.9999 && Math.abs(Math.hypot(rays[i * 4], rays[i * 4 + 1], rays[i * 4 + 2]) - 1) < 1e-3) { valid[i] = 1; nValid++; cam ??= [camPx[i * 4], camPx[i * 4 + 1], camPx[i * 4 + 2]]; }
  console.log(`rays: ${W} x ${H}, ${nValid} pixels reach the walk; camera ${cam.map((v) => v.toFixed(3)).join(', ')}`);
  // The pinhole: (1, x, y) is proportional to N (p - cam), fitted in a frame whose first axis is the mean ray.
  const mean = [0, 0, 0];
  for (let i = 0; i < W * H; i++) if (valid[i]) for (let c = 0; c < 3; c++) mean[c] += rays[i * 4 + c];
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const e0 = norm(mean), e1 = norm(cross(e0, Math.abs(e0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(e0, e1);
  const toE = (v) => [v[0] * e0[0] + v[1] * e0[1] + v[2] * e0[2], v[0] * e1[0] + v[1] * e1[1] + v[2] * e1[2], v[0] * e2[0] + v[1] * e2[1] + v[2] * e2[2]];
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  const acc = (row, rhs) => { for (let a = 0; a < 8; a++) { if (!row[a]) continue; Atb[a] += row[a] * rhs; for (let b = 0; b < 8; b++) AtA[a][b] += row[a] * row[b]; } };
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    const i = y * W + x; if (!valid[i]) continue;
    const v = toE([rays[i * 4], rays[i * 4 + 1], rays[i * 4 + 2]]), xs = (x + 0.5) / W, ys = (y + 0.5) / H;
    acc([xs * v[1], xs * v[2], -v[0], -v[1], -v[2], 0, 0, 0], -xs * v[0]);
    acc([ys * v[1], ys * v[2], 0, 0, 0, -v[0], -v[1], -v[2]], -ys * v[0]);
  }
  const u = solve(AtA, Atb);
  const N = [[1, u[0], u[1]], [u[2], u[3], u[4]], [u[5], u[6], u[7]]];
  const project = (px, py, pz) => { // world point -> [pixel x, pixel y, distance]; null behind the camera
    const v = toE([px - cam[0], py - cam[1], pz - cam[2]]);
    const w = N[0][0] * v[0] + N[0][1] * v[1] + N[0][2] * v[2];
    if (!(w > 1e-6)) return null;
    return [W * (N[1][0] * v[0] + N[1][1] * v[1] + N[1][2] * v[2]) / w - 0.5, H * (N[2][0] * v[0] + N[2][1] * v[1] + N[2][2] * v[2]) / w - 0.5, Math.hypot(v[0], v[1], v[2])];
  };
  let worst = 0;
  for (let i = 0; i < W * H; i += 37) if (valid[i]) { const q = project(cam[0] + rays[i * 4] * 2, cam[1] + rays[i * 4 + 1] * 2, cam[2] + rays[i * 4 + 2] * 2); worst = Math.max(worst, Math.hypot(q[0] - (i % W), q[1] - Math.floor(i / W))); }
  console.log(`pinhole fit: worst reprojection ${worst.toFixed(3)} px`);
  if (worst > 0.5) throw new Error('wound-volume: the pinhole fit is off');

  // Coarse sweep for the depth range that holds any carve, then the fine one.
  const coarse = join(tmp, 'coarse'), C0 = 0.2, CD = 0.1, CN = 120;
  sweep(DIR, 'manifest.wv-bake.json', coarse, C0, CD, CN);
  let kLo = CN, kHi = -1;
  for (let k = 0; k < CN; k++) { const s = slice(coarse, k); let any = false; for (let i = 0; i < W * H && !any; i++) any = Math.abs(s[i * 4 + 2] - (C0 + k * CD)) < 1e-3 && s[i * 4] - 1 > FLOOR + 0.01; if (any) { kLo = Math.min(kLo, k); kHi = Math.max(kHi, k); } }
  if (kHi < 0) throw new Error('wound-volume: no carve anywhere in the sweep');
  const perSlice = [];
  for (let k = 0; k < CN; k++) { const s = slice(coarse, k); let n = 0; for (let i = 0; i < W * H; i++) if (Math.abs(s[i * 4 + 2] - (C0 + k * CD)) < 1e-3 && s[i * 4] - 1 > FLOOR + 0.01) n++; if (n) perSlice.push(`${(C0 + k * CD).toFixed(1)}:${n}`); }
  console.log(`carved pixels by distance: ${perSlice.join(' ')}`);
  const T0 = Math.max(0.05, C0 + (kLo - 1) * CD), T1 = Math.min(MAXT, C0 + (kHi + 1) * CD), DT = 0.01, NT = Math.round((T1 - T0) / DT) + 1;
  console.log(`carve between ${T0.toFixed(2)} and ${T1.toFixed(2)} m of the camera: ${NT} slices of ${DT * 100} cm`);
  const fine = join(tmp, 'fine');
  sweep(DIR, 'manifest.wv-bake.json', fine, T0, DT, NT);
  const fineRim = join(tmp, 'rim');
  sweep(DIR, 'manifest.wv-bake-rim.json', fineRim, T0, DT, NT);
  const fineCarve = join(tmp, 'carve');
  sweep(DIR, 'manifest.wv-bake-carve.json', fineCarve, T0, DT, NT);
  const froB = new Float32Array(NT * W * H), froA = new Float32Array(NT * W * H), froC = new Float32Array(NT * W * H).fill(FLOOR);
  const fro = new Float32Array(NT * W * H).fill(NaN); // NaN = this pixel never ran at this slice
  const froId = new Uint16Array(NT * W * H);
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  let carved = 0;
  for (let k = 0; k < NT; k++) {
    const s = slice(fine, k), sr = slice(fineRim, k), sc = slice(fineCarve, k), t = T0 + k * DT;
    for (let i = 0; i < W * H; i++) {
      if (Math.abs(s[i * 4 + 2] - t) > 1e-3) continue;
      const v = Math.max(FLOOR, s[i * 4] - 1);
      fro[k * W * H + i] = v;
      if (Math.abs(sc[i * 4 + 2] - t) < 1e-3) froC[k * W * H + i] = Math.max(FLOOR, sc[i * 4] - 1);
      if (Math.abs(sr[i * 4 + 2] - t) < 1e-3) { froB[k * W * H + i] = sr[i * 4]; froA[k * W * H + i] = sr[i * 4 + 1]; }
      froId[k * W * H + i] = v > FLOOR + 1e-4 ? Math.round(s[i * 4 + 1]) : 0;
      if (v > FLOOR + 0.01 && valid[i] && t <= MAXT) { carved++; for (let c = 0; c < 3; c++) { const p = cam[c] + rays[i * 4 + c] * t; lo[c] = Math.min(lo[c], p); hi[c] = Math.max(hi[c], p); } }
    }
  }
  console.log(`froxels with a carve: ${carved}; world box ${lo.map((v) => v.toFixed(2)).join(', ')} to ${hi.map((v) => v.toFixed(2)).join(', ')}`);
  const sample = (px, py, t) => { // trilinear over the froxels, over the corners that ran
    const fk = (t - T0) / DT, x0 = Math.floor(px), y0 = Math.floor(py), k0 = Math.floor(fk);
    // The body of the heaviest carved corner owns the voxel; only its corners (and uncarved ones) are mixed.
    let own = 0, ownW = 0;
    for (let dk = 0; dk < 2; dk++) { const k = k0 + dk; if (k < 0 || k >= NT) continue; const wk = dk ? fk - k0 : 1 - (fk - k0);
      for (let dy = 0; dy < 2; dy++) { const y = y0 + dy; if (y < 0 || y >= H) continue; const wy = dy ? py - y0 : 1 - (py - y0);
        for (let dx = 0; dx < 2; dx++) { const x = x0 + dx; if (x < 0 || x >= W) continue; const wx = dx ? px - x0 : 1 - (px - x0);
          const id = froId[(k * H + y) * W + x], w = wk * wy * wx; if (id && w > ownW) { ownW = w; own = id; } } } }
    let sum = 0, wsum = 0, sumB = 0, maxA = 0, sumC = 0;
    for (let dk = 0; dk < 2; dk++) { const k = k0 + dk; if (k < 0 || k >= NT) continue; const wk = dk ? fk - k0 : 1 - (fk - k0);
      for (let dy = 0; dy < 2; dy++) { const y = y0 + dy; if (y < 0 || y >= H) continue; const wy = dy ? py - y0 : 1 - (py - y0);
        for (let dx = 0; dx < 2; dx++) { const x = x0 + dx; if (x < 0 || x >= W) continue; const wx = dx ? px - x0 : 1 - (px - x0);
          let v = fro[(k * H + y) * W + x]; if (v !== v) continue;
          const id = froId[(k * H + y) * W + x]; const mine = !id || id === own; if (!mine) v = FLOOR;
          const w = wk * wy * wx; sum += w * v; wsum += w;
          sumC += w * (mine ? froC[(k * H + y) * W + x] : FLOOR);
          if (mine) { sumB += w * froB[(k * H + y) * W + x]; maxA = Math.max(maxA, froA[(k * H + y) * W + x]); } } } }
    return wsum > 1e-6 ? [sum / wsum, own, sumB / wsum, maxA, sumC / wsum] : [FLOOR, 0, 0, 0, FLOOR];
  };
  const meta = {};
  for (const cm of SIZES) {
    const h = cm / 100, min = lo.map((v) => v - 3 * h), dims = hi.map((v, c) => Math.ceil((v + 3 * h - min[c]) / h));
    const cells = dims[0] * dims[1] * dims[2], out = new Uint16Array(cells * 4), ids = new Uint16Array(cells);
    let live = 0;
    for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
      const edge = x === 0 || y === 0 || z === 0 || x === dims[0] - 1 || y === dims[1] - 1 || z === dims[2] - 1;
      const q = edge ? null : project(min[0] + (x + 0.5) * h, min[1] + (y + 0.5) * h, min[2] + (z + 0.5) * h);
      const [v, id, b, a, cv] = q ? sample(q[0], q[1], q[2]) : [FLOOR, 0, 0, 0, FLOOR];
      const o = (z * dims[1] + y) * dims[0] + x;
      ids[o] = toHalf(id);
      out[o * 4 + 1] = toHalf(b);
      out[o * 4 + 2] = toHalf(a);
      out[o * 4 + 3] = toHalf(cv);
      if (cv > FLOOR + 1e-4) live++;
      out[o * 4] = toHalf(v);
    }
    const file = `wv_${cm}cm.bin`;
    writeFileSync(join(DIR, file), Buffer.from(out.buffer));
    writeFileSync(join(DIR, `wv_${cm}cm_id.bin`), Buffer.from(ids.buffer));
    meta[cm] = { file, idFile: `wv_${cm}cm_id.bin`, h, min, dims, texels: cells, live, megabytes: cells * 10 / 1e6 };
    console.log(`${cm} cm grid: ${dims.join(' x ')} = ${(cells / 1e6).toFixed(1)} M texels, ${(cells * 10 / 1e6).toFixed(0)} MB (rgba16float + an r16float id); ${live} texels (${(100 * live / cells).toFixed(1)} %) above the floor`);
  }
  writeFileSync(join(DIR, 'wv_meta.json'), JSON.stringify({ floor: FLOOR, slices: NT, t0: T0, dt: DT, grids: meta }, null, 1));
}

// ----------------------------------------------------------------------------------------------------------- run
function run(REPS, DIR, SHEETS) {
  const REPEAT = process.env.WV_REPEAT ?? '10', ROUNDS = process.env.WV_ROUNDS ?? '15';
  const ONLY = (process.env.WV_ONLY ?? '').split(',').filter(Boolean);
  const meta = JSON.parse(readFileSync(join(DIR, 'wv_meta.json'), 'utf8'));
  if (SHEETS) mkdirSync(SHEETS, { recursive: true });
  const f = (v) => { const s = String(v); return /[.e]/.test(s) ? s : `${s}.0`; };
  const volume = (cm, cond, rest = false) => () => {
    const g = meta.grids[cm];
    const read = (ord) => `  if (${cond}) {
${rest ? '    let wrp = restPoint(p, data, i32(gFoldBestIdx), p, band);\n    let wq = p + (wrp - p) * 1e-9;' : '    let wq = p;'}
    let wu = (wq - vec3<f32>(${g.min.map(f).join(', ')})) * vec3<f32>(${g.dims.map((d) => f(1 / (d * g.h))).join(', ')});
    let wid = textureLoad(gWVI, vec3<i32>(clamp(wu, vec3<f32>(0.0), vec3<f32>(0.9999)) * vec3<f32>(${g.dims.map(f).join(', ')})), 0).r;
    if (abs(wid - (f32(gSlot) + ${256 * ord + 1}.0)) > 0.5) { return vec2<f32>(dIn, 0.0); }
    let wv = textureSampleLevel(gWV, gWVS, wu, 0.0);
    if (wv.w < ${f(FLOOR + 0.002)} && wv.y < 1e-5) { return vec2<f32>(dIn, 0.0); }
    // What the list returns is the larger of the incoming distance less every rim bump, and the chain's own value.
    // The bumps are gated on the incoming distance (full inside the body, none outside): the chain was baked at
    // both ends of that gate (x with, w without) and is mixed between them.
    let wr = 1.0 - smoothstep(-wv.z * 0.3, wv.z * 0.7, dIn);
    let wc = mix(wv.w, wv.x, wr);
    let wb = dIn - wv.y * wr;
    return vec2<f32>(select(wb, smax(wb, wc, woundCfg.y), wc > ${f(FLOOR + 0.002)}), select(0.0, 1.0, wv.w > -0.1));
  }`;
    return withGroup(DIR, [{ binding: 0, visibility: 2, texture: { sampleType: 'float', viewDimension: '3d' } }, { binding: 1, visibility: 2, sampler: { type: 'filtering' } }, { binding: 2, visibility: 2, texture: { sampleType: 'float', viewDimension: '3d' } }], (add, pass) => {
      const tex = add({ kind: 'texture', desc: { size: g.dims, format: 'rgba16float', dimension: '3d', mipLevelCount: 1, sampleCount: 1, viewFormats: [], usage: 4 } });
      pass.res[tex] = { mips: [{ file: g.file, width: g.dims[0], height: g.dims[1], bytesPerRow: g.dims[0] * 8, layers: g.dims[2] }] };
      const view = add({ kind: 'view', texture: { $ref: tex }, desc: { dimension: '3d' } });
      const idTex = add({ kind: 'texture', desc: { size: g.dims, format: 'r16float', dimension: '3d', mipLevelCount: 1, sampleCount: 1, viewFormats: [], usage: 4 } });
      pass.res[idTex] = { mips: [{ file: g.idFile, width: g.dims[0], height: g.dims[1], bytesPerRow: g.dims[0] * 2, layers: g.dims[2] }] };
      const idView = add({ kind: 'view', texture: { $ref: idTex }, desc: { dimension: '3d' } });
      const samp = add({ kind: 'sampler', desc: { magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' } });
      return { entries: [{ binding: 0, resource: { $ref: view } }, { binding: 1, resource: { $ref: samp } }, { binding: 2, resource: { $ref: idView } }] };
    }, (code, slot, ord) => once(once(code, BOUND, `${BOUND}\n${read(ord)}`), MAIN, `\n@group( ${slot} ) @binding( 0 ) var gWV : texture_3d<f32>;\n@group( ${slot} ) @binding( 1 ) var gWVS : sampler;\n@group( ${slot} ) @binding( 2 ) var gWVI : texture_3d<f32>;${MAIN}`)).m;
  };
  const text = (...edits) => () => {
    const m = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
    const done = new Set();
    for (const c of m.passes[0].cmds) {
      if (c[0] !== 'setPipeline') continue;
      const modId = m.objects[c[1].$ref].desc.fragment.module.$ref;
      if (done.has(modId)) continue;
      done.add(modId);
      for (const e of edits) m.objects[modId].desc.code = e(m.objects[modId].desc.code);
    }
    return m;
  };
  const noWounds = (c) => once(c, BOUND, '  if (true) { return vec2<f32>(dIn, 0.0); }');
  const noRefold = (c) => once(c, '  if (!walkSkip && !cheapProbe && gNormalHint != 0.0 && (nearWound > 0.5 || dmg != carved) && gWoundOwners != 0u', '  if (false && !walkSkip && !cheapProbe && gNormalHint != 0.0 && (nearWound > 0.5 || dmg != carved) && gWoundOwners != 0u');
  const LEGS = [
    { name: 'ship' },
    { name: 'ship2' },
    { name: 'no-wounds', build: text(noWounds) },
    { name: 'no-refold', build: text(noRefold) },
    ...SIZES.flatMap((cm) => [
      { name: `walk-${cm}cm`, build: volume(cm, 'gWalkStep > 0.5') },
      { name: `probes-${cm}cm`, build: volume(cm, 'gWalkStep > 0.5 || gProbePass > 0.5') },
      { name: `all-${cm}cm`, build: volume(cm, 'true') },
    ]),
    { name: `all-${SIZES[0]}cm-rest`, build: volume(SIZES[0], 'true', true) },
  ].filter((l) => !ONLY.length || ONLY.includes(l.name) || l.name === 'ship');
  for (const leg of LEGS) {
    leg.manifest = 'manifest.json';
    if (!leg.build) continue;
    leg.manifest = `manifest.wv-${leg.name}.json`;
    writeFileSync(join(DIR, leg.manifest), JSON.stringify(leg.build()));
  }
  const replay = (leg, repeat = REPEAT, rounds = ROUNDS, sheet = '') => {
    let out;
    try {
      out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, DIR, repeat, rounds, leg.manifest, ...(sheet ? [sheet] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
    } catch (e) {
      out = String(e.stdout ?? '');
      if (!out.trim()) throw new Error(`wound-volume: ${leg.name} replay failed: ${String(e.stderr || e.message).slice(0, 2000)}`);
    }
    return JSON.parse(out.trim().split('\n').pop());
  };
  const info = {};
  let failed = false;
  for (const leg of LEGS) {
    const t0 = Date.now();
    const res = replay(leg, '2', '2', SHEETS && leg.build ? join(SHEETS, `${leg.name}.png`) : '');
    const p = res.parity?.[0] ?? {};
    info[leg.name] = { texels: p.differingTexels, over02: p.over02, over10: p.over10, hitFlips: p.hitFlips, maxDiff: p.maxDiff };
    console.log(`warm ${leg.name.padEnd(14)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  errors ${res.errors?.length ?? 0}  texels moved ${p.differingTexels}  colour >0.02 ${p.over02}  >0.1 ${p.over10}  hit flips ${p.hitFlips}  largest ${Number(p.maxDiff).toFixed(4)}`);
    if (res.errors?.length) { failed = true; for (const e of res.errors.slice(0, 4)) console.error(`  ERROR ${leg.name}: ${e.slice(0, 1500)}`); }
  }
  if (failed) { console.error('wound-volume: a leg replays with errors; nothing timed'); process.exit(1); }
  const file = `${DIR}-woundvolume.json`;
  const reps = [];
  for (let rep = 0; rep < REPS; rep++) {
    const order = LEGS.map((_, i) => LEGS[(i + rep) % LEGS.length]);
    const row = {};
    for (const leg of order) row[leg.name] = replay(leg).medianMs;
    reps.push(row);
    console.log(`  rep ${String(rep + 1).padStart(2)}  ${LEGS.map((l) => `${l.name} ${row[l.name].toFixed(2)}`).join('  ')}`);
    writeFileSync(file, JSON.stringify({ dir: DIR, grids: meta.grids, info, runs: reps }, null, 1));
  }
  if (!reps.length) return;
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const ship = med(reps.map((r) => r.ship));
  const table = [];
  console.log(`\n${'leg'.padEnd(15)}${'ms'.padStart(8)}${'against ship'.padStart(14)}${'range'.padStart(18)}${''.padStart(8)}`);
  for (const leg of LEGS) {
    const d = reps.map((r) => r[leg.name] - r.ship);
    const t = { name: leg.name, ms: med(reps.map((r) => r[leg.name])), diffMs: med(d), min: Math.min(...d), max: Math.max(...d) };
    table.push(t);
    console.log(`${leg.name.padEnd(15)}${t.ms.toFixed(2).padStart(8)}${t.diffMs.toFixed(2).padStart(14)}${`${t.min.toFixed(2)}..${t.max.toFixed(2)}`.padStart(18)}${`${(100 * t.diffMs / ship).toFixed(0)} %`.padStart(8)}`);
  }
  writeFileSync(file, JSON.stringify({ dir: DIR, grids: meta.grids, info, runs: reps, shipMs: ship, table }, null, 1));
  console.log(`wrote ${file}`);
}

if (MODE === 'bake') bake((process.argv[3] ?? '.scratch/compute/mobw-ship').replace(/\/+$/, ''));
else if (MODE === 'run') run(Number(process.argv[3] ?? 5), (process.argv[4] ?? '.scratch/compute/mobw-ship').replace(/\/+$/, ''), process.argv[5] ?? '');
else { console.error('usage: wound-volume.mjs bake <dir> | run <reps> <dir> [sheetDir]'); process.exit(2); }
