// scripts/native-spike/ladder.mjs
//
// THE COST LADDER (docs/dev-notes/2026-11-09-sdf-perf-research): where does the march's walk
// spend its time? One captured `sdf:march` pass (capture.mjs), replayed in the lab Chrome with
// the fragment shader's TEXT edited one rung at a time, in alternation.
//
//   ship           the pass as the game drew it
//   flat           the same frame with the flat-albedo seam on: per-pixel setup + the walk, no shading
//   flat-noop      flat with a comment appended: the A/A floor (a different text, the same work)
//   steps0         the walk's loop never runs: per-pixel setup alone
//   walk2x/3x      one / two extra mapBody calls a step, results unused: the walk's field calls, priced
//   inst-once      loadInstance returns at once for a slot that is already loaded
//   no-carves      applyCarves returns its input (a wrong picture: its ceiling)
//   no-wounds      applyWounds returns its input
//   no-refold, no-bones, strip-all   branches a clean body never takes, removed from mapBody
//   ship-lean      the shipped frame (shading and all) with the walk on mapLean
//   setup, setup-notemp, setup-leanprobe   the loop never runs and a miss writes its start bounds: the per-pixel
//                  setup with the temporal start's probe calls, without them, and with them on mapLean
//   lean-all       lean, and the temporal probe on mapLean too
//   lean-branch    mapLean or mapBody chosen per pixel, in the loop and in the temporal probe
//   lean           the walk calls mapLean: the tile-list fold and the carves, three record reads a
//                  slot, none of mapBody's other bookkeeping
//   lean2x         lean with one extra mapLean a step
//   lean-direct    mapLean reads the tile entries from the storage buffer, not the private arrays
//   count          not timed: steps and primitive folds per pixel, read back from the target
//
// Captures: SPIKE_VARIANTS='ship=0;flat=__sdfGame.setFlatAlbedo(true)' capture.mjs ... <out>
// gives <out>-ship and <out>-flat from one boot. Run under servers.sh so the Chrome stays up:
//
//   scripts/native-spike/servers.sh node scripts/native-spike/ladder.mjs <out> [reps] [rung,rung,...]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? '.scratch/ladder/cap';
const REPS = Number(process.argv[3] ?? 5);
const ONLY = (process.argv[4] ?? '').split(',').filter(Boolean);
const REPEAT = process.env.SPIKE_REPEAT ?? '10';
const ROUNDS = process.env.SPIKE_ROUNDS ?? '15';
const CDP = process.env.LAB_CDP_PORT ?? '9291';

/** Replace exactly one occurrence, or throw: a rung that silently edits nothing measures nothing. */
const once = (code, find, repl) => {
  const n = code.split(find).length - 1;
  if (n !== 1) throw new Error(`ladder: expected 1 match, found ${n}, for: ${find.slice(0, 70)}`);
  return code.replace(find, () => repl);
};

const WALK_CALL = /    let dres = mapBody\(camPos \+ rd \* t, ([^\n]*)\);\n/;
const walkArgs = (code) => {
  const m = WALK_CALL.exec(code);
  if (!m) throw new Error('ladder: the walk\'s mapBody call was not found');
  return m[1];
};

// The walk's field call for a body that has no wounds, no open head and no baked volume: the
// tile-list fold, the carves, the upper-bound cull, and the globals the walk reads afterwards.
const mapLean = ({ carves = true, direct = false }) => `
fn mapLean ( pIn: vec3<f32>, data: texture_2d<f32>, inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32> ) -> vec4<f32> {
  var dUnion = 1e9;
  var bestSlot = gSlot;
  var bestIdxU = -1.0;
  var bestU = 1e9;
  var bestDistortU = 1.0;
  var foldU = 1e9;
  let base = i32(instCfg.z);
${direct ? `  var cur = -1;
  var live = false;
  var counts = vec4<f32>(0.0);
  var band = 0;
  var d = 1e9;
  for (var e = 0u; e <= gLeanN; e = e + 1u) {
    var s = -2;
    var b = vec4<f32>(0.0);
    var g = vec4<f32>(0.0);
    var keep = false;
    if (e < gLeanN) {
      keep = ((select(gLeanMask0, gLeanMask1, e >= 32u) >> (e & 31u)) & 1u) != 0u;
      if (!keep) { continue; }
      let lin = (gLeanHead + e) * 3u;
      let m = NodeBuffer_2309.value[lin + 2u];
      b = vec4<f32>(NodeBuffer_2309.value[lin].xyz + m.yzw, NodeBuffer_2309.value[lin].w - length(m.yzw));
      g = NodeBuffer_2309.value[lin + 1u];
      s = i32(m.x);
    }
    if (s != cur) {
      if (live) {
        gCullRef = 1e9;
        let foldSlot = d;
        ${carves ? 'd = applyCarves(d, pIn, data, counts, band);' : ''}
        if (d < dUnion) { dUnion = d; bestSlot = base + cur; bestIdxU = gFoldBestIdx; bestU = gFoldBest; bestDistortU = gFoldBestDistort; foldU = foldSlot; }
      }
      live = false;
      cur = s;
      if (s >= 0) {
        let rb = (base + s) * 22;
        let wa = (*inst)[rb + 4];
        if (wa.w >= 0.5) {
          live = true;
          counts = (*inst)[rb + 0];
          let ab = (*inst)[rb + 3];
          band = i32(ab.w);
          gWindDrift = wa.xyz;
          gBodyAnchor = ab.xyz;
          d = 1e9;
          gFoldBest = 1e9; gFoldBestIdx = -1.0; gFoldBestDistort = 1.0;
          gCullRef = select(1e9, gCullUB, base + s == gCullSlot && gCullPiece == 0);
        }
      }
    }
    if (keep && live) { d = foldGroup(d, pIn, data, counts, band, b, g); }
  }` : `  for (var k = 0; k < 64; k = k + 1) {
    if (k >= gPixN) { break; }
    let s = gPixSlot[k];
    let rb = (base + s) * 22;
    let wa = (*inst)[rb + 4];
    if (wa.w < 0.5) { continue; }
    let counts = (*inst)[rb + 0];
    let ab = (*inst)[rb + 3];
    let band = i32(ab.w);
    gWindDrift = wa.xyz;
    gBodyAnchor = ab.xyz;
    var d = 1e9;
    gFoldBest = 1e9; gFoldBestIdx = -1.0; gFoldBestDistort = 1.0;
    gCullRef = select(1e9, gCullUB, base + s == gCullSlot && gCullPiece == 0);
    for (var e = gPixFirst[k]; e < gPixEnd[k]; e = e + 1) {
      d = foldGroup(d, pIn, data, counts, band, gTileBounds[e], gTileGrp[e]);
    }
    gCullRef = 1e9;
    let foldSlot = d;
    ${carves ? 'd = applyCarves(d, pIn, data, counts, band);' : ''}
    if (d < dUnion) { dUnion = d; bestSlot = base + s; bestIdxU = gFoldBestIdx; bestU = gFoldBest; bestDistortU = gFoldBestDistort; foldU = foldSlot; }
  }`}
  gLastFold = foldU;
  gLastFoldSlot = bestSlot;
  gLastFoldPiece = 0;
  gFoldBest = bestU;
  gFoldBestIdx = bestIdxU;
  gFoldBestDistort = bestDistortU;
  gHitSlot = bestSlot;
  gHitPiece = 0;
  gHitSplitF = dUnion;
  gRefoldWin = 0.0;
  gWalkAttempted = 0.0;
  return vec4<f32>(dUnion, bestIdxU, 0.0, dUnion);
}
var<private> gLeanHead: u32 = 0u;
var<private> gLeanN: u32 = 0u;
var<private> gLeanMask0: u32 = 0u;
var<private> gLeanMask1: u32 = 0u;
`;

const E = {
  noop: (c) => `${c}\n// ladder: no-op\n`,
  stepCap: (n) => (c) => once(c, 'if (i >= steps) { break; }', `if (i >= steps || i >= ${n}) { break; }`),
  // k extra field calls a step, BEFORE the real one so the real call's globals are the ones the walk reads. The
  // results reach d through a min that can never win, which the compiler cannot know.
  walkX: (k, callee = 'mapBody') => (c) => {
    const args = callee === 'mapBody' ? walkArgs(c) : 'data, inst, instCfg';
    const find = callee === 'mapBody' ? WALK_CALL.exec(c)[0] : '    let dres = mapLean(camPos + rd * t, data, inst, instCfg);\n';
    let extra = '';
    let fold = '';
    for (let i = 1; i <= k; i++) {
      extra += `    let dresX${i} = ${callee}(camPos + rd * t + vec3<f32>(${i}e-5), ${args});\n`;
      fold += ` d = min(d, dresX${i}.x + 1000.0);`;
    }
    c = once(c, find, extra + find);
    return once(c, '    var d = dres.x;\n    hitBest = i32(dres.y);', `    var d = dres.x;${fold}\n    hitBest = i32(dres.y);`);
  },
  instOnce: (c) => {
    c = once(c, '  let base = slot * 22;\n  gSlot = slot;', '  if (slot == gInstLoaded) { return; }\n  gInstLoaded = slot;\n  let base = slot * 22;\n  gSlot = slot;');
    return once(c, 'var<private> gCullUB: f32 = 1e9;', 'var<private> gInstLoaded: i32 = -1;\nvar<private> gCullUB: f32 = 1e9;');
  },
  noCarves: (c) => once(c, '  var d = dIn;\n  if (counts.z < 0.5) { return d; }', '  var d = dIn;\n  if (true) { return d; }'),
  noWounds: (c) => once(c, ') -> vec2<f32> {\n  var d = dIn;\n  var near = 0.0;', ') -> vec2<f32> {\n  var d = dIn;\n  var near = 0.0;\n  if (true) { return vec2<f32>(dIn, 0.0); }'),
  // The branches below are never taken on a clean body. Removing them prices their PRESENCE in the walk's field call.
  noRefold: (c) => once(c, 'if (!walkSkip && !cheapProbe && gNormalHint != 0.0', 'if (false && !walkSkip && !cheapProbe && gNormalHint != 0.0'),
  noBones: (c) => once(c, '    dmg = applyBones(dmg, p, data, counts, counts2.x, band, segVolumeAtlas, segVolumeMeta);', '    dmg = dmg + 0.0;'),
  noVolume: (c) => once(c, '    d = sampleHandVolume(p, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip);', '    d = 1e9;'),
  lean: (opts = {}) => (c) => {
    c = once(c, WALK_CALL.exec(c)[0], '    let dres = mapLean(camPos + rd * t, data, inst, instCfg);\n');
    if (opts.direct) {
      // The preload leaves the tile's head, its length and which entries survived the per-ray compaction.
      c = once(c, '    let n = min(head.y, 64u);', '    let n = min(head.y, 64u);\n    gLeanHead = head.x;\n    gLeanN = n;');
      c = once(c, '      gTileSlot[w] = entMeta.x;', '      gTileSlot[w] = entMeta.x;\n      if (e < 32) { gLeanMask0 = gLeanMask0 | (1u << u32(e)); } else { gLeanMask1 = gLeanMask1 | (1u << u32(e - 32)); }');
    }
    return once(c, '\n@fragment\nfn main(', `${mapLean(opts)}\n@fragment\nfn main(`);
  },
  // The temporal start's probe (up to four field calls a pixel, before the walk) on mapLean too.
  leanProbe: (c) => {
    const m = /        dres0 = mapBody\(camPos \+ rd \* s, [^\n]*\);\n/.exec(c);
    if (!m) throw new Error('ladder: the temporal probe\'s mapBody call was not found');
    return once(c, m[0], '        dres0 = mapLean(camPos + rd * s, data, inst, instCfg);\n');
  },
  noTemporal: (c) => once(c, '  if (temp.y > 0.0\n', '  if (false && temp.y > 0.0\n'),
  // The shape a shipped fast path would have: both calls in the loop, chosen per pixel by a value the compiler
  // cannot fold. (The test here reads the setup's slot only; a real one must cover every slot of the pixel.)
  leanBranch: (c) => {
    const call = WALK_CALL.exec(c)[0];
    c = once(c, call, `    var dres = vec4<f32>(0.0);\n    if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else { dres = mapBody(camPos + rd * t, ${walkArgs(c)}); }\n`);
    // ... and the temporal probe the same way; leanOk has to exist before it.
    const probe = /        dres0 = mapBody\(camPos \+ rd \* s, ([^\n]*)\);\n/.exec(c);
    c = once(c, probe[0], `        if (leanOk) { dres0 = mapLean(camPos + rd * s, data, inst, instCfg); } else { dres0 = mapBody(camPos + rd * s, ${probe[1]}); }\n`);
    c = once(c, '  var tempStart = 0.0;', '  let leanOk = gInstWoundCount < 0.5 && !gInstSplitOpen && gInstVolPose0.w < 0.5 && gInstCounts2.y < 0.5;\n  var tempStart = 0.0;');
    return once(c, '\n@fragment\nfn main(', `${mapLean({})}\n@fragment\nfn main(`);
  },
  // A missed ray writes its start bounds instead of discarding, so a loop that never runs (stepCap 0) still has to
  // compute the setup: without this the compiler removes the whole shader (steps0 with the probe off read 0.14 ms).
  keepSetup: (c) => once(c, '    discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0);\n  }\n  // Reload the slot', '    return vec4<f32>(t, tMax, gTileN + f32(gWoundN) + f32(gPixN), -1.0);\n  }\n  // Reload the slot'),
  // Steps and primitive folds per pixel into the colour target: b = 1 a ray that walked and missed, 2 a hit.
  count: (c) => {
    c = once(c, '  if (debugCfg.x > 0.5) { gDebugMode = debugCfg.x; gDebugPrims = 0.0;', '  if (true) { gDebugMode = 1.0; gDebugPrims = 0.0;');
    c = once(c, '    if (debugCfg.x > 0.5) { gDebugSteps = gDebugSteps + 1.0; }', '    gDebugSteps = gDebugSteps + 1.0;');
    c = once(c, '    discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0);\n  }\n  // Reload the slot', '    return vec4<f32>(gDebugSteps, gDebugPrims, 1.0, -1.0);\n  }\n  // Reload the slot');
    return once(c, '  if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }', '  if (debugCfg.y > 0.5) { return vec4<f32>(gDebugSteps, gDebugPrims, 2.0, t); }');
  },
};

const RUNGS = [
  { name: 'ship', cap: 'ship', edits: [] },
  { name: 'ship-inst-once', cap: 'ship', edits: [E.instOnce] },
  { name: 'flat', cap: 'flat', edits: [] },
  { name: 'flat-noop', cap: 'flat', edits: [E.noop] },
  { name: 'steps0', cap: 'flat', edits: [E.stepCap(0)] },
  { name: 'walk2x', cap: 'flat', edits: [E.walkX(1)] },
  { name: 'walk3x', cap: 'flat', edits: [E.walkX(2)] },
  { name: 'inst-once', cap: 'flat', edits: [E.instOnce] },
  { name: 'no-carves', cap: 'flat', edits: [E.noCarves] },
  { name: 'no-wounds', cap: 'flat', edits: [E.noWounds] },
  { name: 'no-refold', cap: 'flat', edits: [E.noRefold] },
  { name: 'no-bones', cap: 'flat', edits: [E.noBones] },
  { name: 'strip-all', cap: 'flat', edits: [E.instOnce, E.noWounds, E.noRefold, E.noBones, E.noVolume] },
  { name: 'lean', cap: 'flat', edits: [E.lean()] },
  { name: 'lean2x', cap: 'flat', edits: [E.lean(), E.walkX(1, 'mapLean')] },
  { name: 'lean-nocarves', cap: 'flat', edits: [E.lean({ carves: false })] },
  { name: 'lean-direct', cap: 'flat', edits: [E.lean({ direct: true })] },
  { name: 'lean-direct2x', cap: 'flat', edits: [E.lean({ direct: true }), E.walkX(1, 'mapLean')] },
  { name: 'ship-lean', cap: 'ship', edits: [E.lean()] },
  { name: 'ship-lean-direct', cap: 'ship', edits: [E.lean({ direct: true })] },
  { name: 'steps0-notemp', cap: 'flat', edits: [E.stepCap(0), E.noTemporal] },
  { name: 'setup', cap: 'flat', edits: [E.stepCap(0), E.keepSetup] },
  { name: 'setup-notemp', cap: 'flat', edits: [E.stepCap(0), E.keepSetup, E.noTemporal] },
  { name: 'setup-leanprobe', cap: 'flat', edits: [E.stepCap(0), E.keepSetup, E.lean(), E.leanProbe] },
  { name: 'lean-all', cap: 'flat', edits: [E.lean(), E.leanProbe] },
  { name: 'lean-branch', cap: 'flat', edits: [E.leanBranch] },
  { name: 'ship-lean-all', cap: 'ship', edits: [E.lean(), E.leanProbe] },
  { name: 'ship-lean-branch', cap: 'ship', edits: [E.leanBranch] },
  { name: 'count', cap: 'flat', edits: [E.count], timed: false },
  { name: 'lean-count', cap: 'flat', edits: [E.lean(), E.count], timed: false },
].filter((r) => ONLY.length === 0 || ONLY.includes(r.name));

// One manifest per rung, beside its capture's own.
for (const r of RUNGS) {
  r.dir = `${OUT}-${r.cap}`;
  r.manifest = r.edits.length === 0 ? 'manifest.json' : `manifest.${r.name}.json`;
  if (r.edits.length === 0) continue;
  const manifest = JSON.parse(readFileSync(join(r.dir, 'manifest.json'), 'utf8'));
  let edited = 0;
  for (const o of Object.values(manifest.objects)) {
    if (o.kind !== 'shaderModule' || !/\bfn mapBody\b/.test(o.desc.code)) continue;
    for (const edit of r.edits) o.desc.code = edit(o.desc.code);
    edited++;
  }
  if (edited !== 1) throw new Error(`ladder: ${r.name} edited ${edited} shader modules, expected 1`);
  writeFileSync(join(r.dir, r.manifest), JSON.stringify(manifest));
}

const run = (r, repeat = REPEAT, rounds = ROUNDS) => {
  const out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, r.dir, repeat, rounds, r.manifest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.trim().split('\n').pop());
};

// A first run of each: the cold Metal compile of an edited march shader is tens of seconds.
const info = {};
for (const r of RUNGS) {
  const t0 = Date.now();
  try {
    const res = run(r, '2', '2');
    info[r.name] = { parity: res.parity[0], errors: res.errors };
    const p = res.parity[0] ?? {};
    console.log(`warm ${r.name.padEnd(16)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  differing ${(100 * (p.differingFrac ?? NaN)).toFixed(2)} %  max ${(p.maxDiff ?? NaN).toPrecision(3)}${res.errors.length ? `  ERRORS ${res.errors[0].slice(0, 200)}` : ''}`);
    if (p.classes) console.log(`     classes ${JSON.stringify(p.classes)}`);
  } catch (e) {
    console.log(`warm ${r.name.padEnd(16)} FAILED: ${String(e.stderr || e.message).slice(0, 600)}`);
    r.failed = true;
  }
}

const timed = RUNGS.filter((r) => r.timed !== false && !r.failed);
const runs = Object.fromEntries(timed.map((r) => [r.name, []]));
for (let rep = 0; rep < REPS; rep++) {
  const order = timed.map((_, i) => timed[(i + rep) % timed.length]);
  for (const r of order) {
    const res = run(r);
    runs[r.name].push({ medianMs: res.medianMs, minMs: res.minMs });
    console.log(`  rep ${rep + 1} ${r.name.padEnd(16)} median ${res.medianMs.toFixed(2)} ms  min ${res.minMs.toFixed(2)}`);
  }
}

const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
// On a shared machine a disturbed repeat only ever reads slow, so the quietest repeats are the measurement:
// `quiet` is the median of the two lowest repeat medians.
console.log(`\n${'rung'.padEnd(18)}${'quiet ms'.padStart(9)}${'median ms'.padStart(10)}${'best ms'.padStart(9)}${'range of medians'.padStart(19)}`);
const table = [];
for (const [name, rs] of Object.entries(runs)) {
  if (rs.length === 0) continue;
  const m = rs.map((x) => x.medianMs);
  const sorted = [...m].sort((x, y) => x - y);
  const row = { rung: name, quietMs: (sorted[0] + (sorted[1] ?? sorted[0])) / 2, medianMs: med(m), bestMs: Math.min(...rs.map((x) => x.minMs)), lo: Math.min(...m), hi: Math.max(...m) };
  table.push(row);
  console.log(`${name.padEnd(18)}${row.quietMs.toFixed(2).padStart(9)}${row.medianMs.toFixed(2).padStart(10)}${row.bestMs.toFixed(2).padStart(9)}${`${row.lo.toFixed(2)}..${row.hi.toFixed(2)}`.padStart(19)}`);
}
writeFileSync(`${OUT}-ladder.json`, JSON.stringify({ reps: REPS, repeat: Number(REPEAT), rounds: Number(ROUNDS), table, runs, info }, null, 1));
