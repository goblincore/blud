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
//   wounds-guard   applyWounds skipped by a runtime test on the wound count; wounds-nocut, wounds-noamp: parts of it removed
//   lean-sample    mapLean or mapBody chosen per SAMPLE: mapLean outside the body's wound bound
//   air-near-1/-2  the same gate at 1 / 2 cm with the skipped sample still flagged near a wound (the sound form)
//   walk-near-2/-4/-6  the cautious gate for the walk's own field calls only
//   air-gate-2/-4  applyWounds skipped for samples more than 2 / 4 cm outside the pre-wound body
//   ship-no-wshadow, ship-no-probes, ship-no-fd, ship-no-posthit-field   the post-hit field calls removed
//   ship-ng-exact, ship-ng-owned, ship-ng-both   the analytic normal kept on a wounded body (see the edits)
//   ship-ng-cut, ship-ng-all   a cut bounded by its slab in the analytic normal; that with the two above
//   count-pred-*, count-verify-*, onecall, ship-onecall, count-onecall   the one-call prototype (ONE-CALL.md)
//   arr32/16/8, cap1-arr*   the per-pixel tile arrays sized down from 64 (see the edit)
//   count-nearhit  not timed: hits whose accepting sample was near a wound, and hits where a limb's re-fold won
//   count, count-rows, count-miss, count-lean   not timed: per-ray counters read back from the target (steps and
//                  folds; wound rows and re-folds; steps after a ray's closest approach and whether that was
//                  within two pixel footprints; steps and how many of them took mapLean)
//
// THE LEAN WALK (lean-walk-flag.ts) is on by default since 2026-11-09, and the rungs below edit the march's text as it
// was WITHOUT it: capture with SPIKE_QUERY=leanwalk=0.
// Captures: SPIKE_QUERY=leanwalk=0 SPIKE_VARIANTS='ship=0;flat=__sdfGame.setFlatAlbedo(true)' capture.mjs ... <out>
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
// LADDER_SCENE prefixes the capture names: '' reads <out>-ship and <out>-flat, 'w20' reads <out>-w20ship and
// <out>-w20flat (a wounded body; see the header of docs/dev-notes/2026-11-09-sdf-perf-research/WOUNDS.md).
const SCENE = process.env.LADDER_SCENE ?? '';

/** Replace exactly one occurrence, or throw: a rung that silently edits nothing measures nothing. */
const once = (code, find, repl) => {
  const n = code.split(find).length - 1;
  if (n !== 1) throw new Error(`ladder: expected 1 match, found ${n}, for: ${find.slice(0, 70)}`);
  return code.replace(find, () => repl);
};

const WALK_CALL = /    let dres = mapBody\(camPos \+ rd \* t, ([^\n]*)\);\n/;
const walkArgs = (code) => {
  const m = WALK_CALL.exec(code);
  if (!m) throw new Error('ladder: the walk\'s mapBody call was not found (capture with SPIKE_QUERY=leanwalk=0: the rungs edit the march without the lean walk)');
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

// THE ONE-CALL PROTOTYPE (docs/dev-notes/2026-11-09-sdf-perf-research/ONE-CALL.md). ladPredict finds where this
// pixel's ray met the surface LAST frame: it takes a guess along the ray, projects it into last frame's screen,
// reads the depth drawn there, rebuilds that world point and takes its distance along the ray, three times. It
// returns that distance and how far the point lies off the ray, in pixel footprints. Camera motion only: a body
// that moved is a point in the wrong place, which the field call that follows will say.
const LAD_PREDICT = `
fn ladInv4 ( m: mat4x4<f32> ) -> mat4x4<f32> {
  let a00 = m[0][0]; let a01 = m[0][1]; let a02 = m[0][2]; let a03 = m[0][3];
  let a10 = m[1][0]; let a11 = m[1][1]; let a12 = m[1][2]; let a13 = m[1][3];
  let a20 = m[2][0]; let a21 = m[2][1]; let a22 = m[2][2]; let a23 = m[2][3];
  let a30 = m[3][0]; let a31 = m[3][1]; let a32 = m[3][2]; let a33 = m[3][3];
  let b00 = a00 * a11 - a01 * a10; let b01 = a00 * a12 - a02 * a10; let b02 = a00 * a13 - a03 * a10;
  let b03 = a01 * a12 - a02 * a11; let b04 = a01 * a13 - a03 * a11; let b05 = a02 * a13 - a03 * a12;
  let b06 = a20 * a31 - a21 * a30; let b07 = a20 * a32 - a22 * a30; let b08 = a20 * a33 - a23 * a30;
  let b09 = a21 * a32 - a22 * a31; let b10 = a21 * a33 - a23 * a31; let b11 = a22 * a33 - a23 * a32;
  let id = 1.0 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return mat4x4<f32>(
    vec4<f32>(a11 * b11 - a12 * b10 + a13 * b09, a02 * b10 - a01 * b11 - a03 * b09, a31 * b05 - a32 * b04 + a33 * b03, a22 * b04 - a21 * b05 - a23 * b03) * id,
    vec4<f32>(a12 * b08 - a10 * b11 - a13 * b07, a00 * b11 - a02 * b08 + a03 * b07, a32 * b02 - a30 * b05 - a33 * b01, a20 * b05 - a22 * b02 + a23 * b01) * id,
    vec4<f32>(a10 * b10 - a11 * b08 + a13 * b06, a01 * b08 - a00 * b10 - a03 * b06, a30 * b04 - a31 * b02 + a33 * b00, a21 * b02 - a20 * b04 - a23 * b00) * id,
    vec4<f32>(a11 * b07 - a10 * b09 - a12 * b06, a00 * b09 - a01 * b07 + a02 * b06, a31 * b01 - a30 * b03 - a32 * b00, a20 * b03 - a21 * b01 + a22 * b00) * id);
}
fn ladPredict ( lastTex: texture_2d<f32>, lastInvVp: mat4x4<f32>, camPos: vec3<f32>, rd: vec3<f32>, t0: f32, foot: f32, edgeM: f32 ) -> vec2<f32> {
  let lastVp = ladInv4(lastInvVp);
  let dims = vec2<f32>(textureDimensions(lastTex, 0));
  var t = t0;
  var perp = 1e9;
  var cLast = vec2<i32>(0, 0);
  for (var k = 0; k < 3; k = k + 1) {
    let cl = lastVp * vec4<f32>(camPos + rd * t, 1.0);
    if (cl.w <= 1e-6) { return vec2<f32>(0.0, 1e9); }
    let n = cl.xy / cl.w;
    if (abs(n.x) >= 1.0 || abs(n.y) >= 1.0) { return vec2<f32>(0.0, 1e9); }
    let c = clamp(vec2<i32>(floor((n * 0.5 + 0.5) * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
    let d = textureLoad(lastTex, c, 0).a;
    if (d >= 1.0) { return vec2<f32>(0.0, 1e9); }
    let w = lastInvVp * vec4<f32>((vec2<f32>(c) + 0.5) / dims * 2.0 - 1.0, d, 1.0);
    let p = w.xyz / w.w - camPos;
    let tn = dot(p, rd);
    if (tn <= 0.0) { return vec2<f32>(0.0, 1e9); }
    perp = sqrt(max(dot(p, p) - tn * tn, 0.0)) / max(tn * foot, 1e-9);
    t = tn;
    cLast = c;
  }
  // THE EDGE GUARD (edgeM > 0): no prediction from a texel beside a silhouette or a depth step of more than
  // edgeM metres in last frame's picture. There a neighbouring texel is another surface, and a point one texel
  // off the ray can lie behind the thing the ray really meets.
  if (edgeM > 0.0) {
    for (var q = 0; q < 4; q = q + 1) {
      let o = select(select(select(vec2<i32>(0, -1), vec2<i32>(0, 1), q == 2), vec2<i32>(-1, 0), q == 1), vec2<i32>(1, 0), q == 0);
      let cq = clamp(cLast + o, vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
      let dq = textureLoad(lastTex, cq, 0).a;
      if (dq >= 1.0) { return vec2<f32>(0.0, 1e9); }
      let wq = lastInvVp * vec4<f32>((vec2<f32>(cq) + 0.5) / dims * 2.0 - 1.0, dq, 1.0);
      if (abs(dot(wq.xyz / wq.w - camPos, rd) - t) > edgeM) { return vec2<f32>(0.0, 1e9); }
    }
  }
  return vec2<f32>(t, perp);
}
`;
// The prediction's first guess: the same pixel's point last frame where there is one, else just inside the hull.
const LAD_T0 = 'select(max(shellIn, bodyEntry) + 0.03, temp.y, temp.y > 0.0)';
// A prediction is USED when its point lies within 1.5 footprints of the ray and no further than 12 cm past the
// hull's entry: the hull is this frame's, so a body that moved in front of last frame's surface fails the test.
const LAD_USE = 'ladP.x > 0.0 && ladP.y < 1.5 && ladP.x - max(shellIn, bodyEntry) <= 0.12';

const E = {
  ladFns: (c) => once(c, '\n@fragment\nfn main(', `${LAD_PREDICT}\n@fragment\nfn main(`),
  // COUNTS at the flat seam, where t is the walk's own hit: the prediction, the accept tolerance at that depth,
  // and the field's value AT the predicted point (one more mapBody call: the verification itself).
  ladAtHit: (verify, edge = '0.0') => (c) => once(c, '  if (debugCfg.y > 0.5) { return', `  let ladP = ladPredict(lastTex, lastInvVp, camPos, rd, ${LAD_T0}, aaCfg.x, ${edge});
  let ladEps = max(hitEpsBase, t * select(aaK, aaCfg.x * mix(aaCfg.z, aaCfg.y, smoothstep(aaCfg.w * 0.5, aaCfg.w, t)), aaCfg.z > 0.0));
  let ladUse = ${LAD_USE};
  let ladErr = ladP.x - t;
  ${verify ? `let ladD = mapBody(camPos + rd * ladP.x, ${walkArgs(c)}).x;` : 'let ladD = 0.0;'}
  if (debugCfg.y > 0.5) { return`),
  // THE ONE-CALL WALK: the walk's first sample is the predicted point. Within the accept tolerance it is the hit,
  // in one field call; in front of the surface the walk carries on from there; behind it (the body came nearer)
  // the walk starts over at its usual start. The temporal start's probe is off (noTemporal goes with this).
  // snap: an accepted first sample steps on by its own field value (never past the surface), so the hit does not
  // sit wherever inside the tolerance last frame's did. edge: the edge guard's depth step, metres ('0.0' = off).
  // loose: the predicted sample is accepted inside the tolerance the last-step secant already grants a hit it never
  // evaluates (perfCfg.w hit-epsilons). Last frame's hits mostly ARE such jumps, so their points sit outside the
  // plain epsilon and the strict test sends nearly every predicted pixel round the loop a second time.
  oneCall: ({ snap = false, edge = '0.0', loose = false } = {}) => (c) => {
    if (loose) c = once(c, '      let hitEps = max(hitEpsBase, t * aaKt / distort);', '      let hitEps = max(hitEpsBase, t * aaKt / distort) * select(1.0, max(perfCfg.w, 1.0), ladOne && i == 0 && !nearWound);');
    c = once(c, '  var t = clamp(max(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), winFar), 0.0, tMax);\n', `  var t = clamp(max(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), winFar), 0.0, tMax);
  let ladP = ladPredict(lastTex, lastInvVp, camPos, rd, ${LAD_T0}, aaCfg.x, ${edge});
  let ladHome = t;
  var ladOne = ${LAD_USE} && ladP.x >= t && ladP.x <= tMax;
  var ladFirst = false;
  if (ladOne) { t = ladP.x; }
`);
    c = once(c, '    var d = dres.x;\n    hitBest = i32(dres.y);', '    var d = dres.x;\n    if (ladOne && i == 0 && d < -hitEpsBase) { t = ladHome; ladOne = false; continue; }\n    ladFirst = ladOne && i == 0;\n    hitBest = i32(dres.y);');
    if (snap) c = once(c, '  if (!hit) {\n    // NEAR-MISS EDGE', '  if (hit && ladFirst) { t = t + max(hitField.x, 0.0); }\n  if (!hit) {\n    // NEAR-MISS EDGE');
    return c;
  },
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
  // Two per-ray counters into the colour target, read back by replay.html: b = 1 a ray that walked and missed,
  // 2 a hit. count: steps and primitive folds. A missed ray's pair can be given separately (it returns before the
  // flat seam, where a hit's values may not exist yet).
  countWith: (rExpr, gExpr, missR = rExpr, missG = gExpr) => (c) => {
    c = once(c, '  if (debugCfg.x > 0.5) { gDebugMode = debugCfg.x; gDebugPrims = 0.0;', '  if (true) { gDebugMode = 1.0; gDebugPrims = 0.0;');
    c = once(c, '    if (debugCfg.x > 0.5) { gDebugSteps = gDebugSteps + 1.0; }', '    gDebugSteps = gDebugSteps + 1.0;');
    c = once(c, '    discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0);\n  }\n  // Reload the slot', `    return vec4<f32>(${missR}, ${missG}, 1.0, -1.0);\n  }\n  // Reload the slot`);
    return once(c, '  if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }', `  if (debugCfg.y > 0.5) { return vec4<f32>(${rExpr}, ${gExpr}, 2.0, t); }`);
  },
  // Per ray: the step at which it came closest to a surface, where along the ray, and how close in pixel footprints.
  trackClosest: (c) => {
    c = once(c, '    let radius = abs(d);', '    let radius = abs(d);\n    if (radius < gLMin) { gLMin = radius; gLAt = gDebugSteps; gLT = t; gLFoot = radius * distort / max(t * aaCfg.x, 1e-6); }');
    return once(c, '\n@fragment\nfn main(', '\nvar<private> gLMin: f32 = 1e9;\nvar<private> gLAt: f32 = 0.0;\nvar<private> gLFoot: f32 = 1e9;\nvar<private> gLT: f32 = 0.0;\n@fragment\nfn main(');
  },
  // WOUNDS. The call skipped by a runtime test on the record's wound count (the code stays in the shader):
  woundsGuard: (c) => once(c, '  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band);', '  var dmgRes = vec2<f32>(carved, 0.0);\n  if (gInstWoundCount > 0.5) { dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band); }'),
  // ... the cut-wound branch removed (the same picture where no wound is a cut) ...
  woundsNoCut: (c) => once(c, '    if ((i32(wFlags.x) & 32) != 0) {', '    if (false && (i32(wFlags.x) & 32) != 0) {'),
  // ... and the per-owner amplitude array's writes removed (the re-fold's pre-scan then reads zeros).
  woundsNoAmp: (c) => {
    c = once(c, '      if (gWoundCluster == 0.0) { gWoundAmp[u32(owner)] = gWoundAmp[u32(owner)] + cutAmp; }\n', '');
    return once(c, '    if (gWoundCluster == 0.0) { gWoundAmp[u32(owner)] = gWoundAmp[u32(owner)] + amp; }\n', '');
  },
  // THE AIR GATE: a sample further than T metres outside the body as it was before its wounds (the fold and the
  // carves) skips applyWounds, and with it the re-fold and the bones, which are gated on being near a wound.
  airGate: (T) => (c) => once(c, '  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band);', `  var dmgRes = vec2<f32>(carved, 0.0);\n  if (carved <= ${T}) { dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band); }`),
  // THE SAME GATE, KEEPING THE WALK CAUTIOUS: the skipped sample still reports "near a wound" (0.8: over the
  // walk's 0.5, under the bone fold's 0.875), so no secant accept is taken from it. With near 0 (airGate above) the
  // walk accepts hits on the skin that a crater removed. A clean body, and a sample outside the wound bound, go
  // through applyWounds as before.
  airNear: (T) => (c) => once(c, '  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band);', `  var dmgRes = vec2<f32>(carved, 0.8);\n  if (carved <= ${T} || gInstWoundCount < 0.5 || length(p - woundBound.xyz) > woundBound.w) { dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band); }`),
  // ... FOR THE WALK'S OWN CALLS ONLY (gWalkStep): the normal's taps, the AO and scatter probes and the wound
  // shadow sample the field centimetres off the surface on purpose, and must see the wounds there.
  walkNear: (T) => (c) => once(c, '  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band);', `  var dmgRes = vec2<f32>(carved, 0.8);\n  if (gWalkStep < 0.5 || carved <= ${T} || gInstWoundCount < 0.5 || length(p - woundBound.xyz) > woundBound.w) { dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band); }`),
  // ... and how many of the walk's samples that would be.
  countAir: (T) => (c) => {
    c = once(c, '  let carved = applyCarves(d, p, data, counts, band);', `  let carved = applyCarves(d, p, data, counts, band);\n  if (gWalkStep > 0.5 && carved > ${T}) { gLAir = gLAir + 1.0; }`);
    return once(c, '\n@fragment\nfn main(', '\nvar<private> gLAir: f32 = 0.0;\n@fragment\nfn main(');
  },
  // POST-HIT (the shipped frame only): the wound soft shadow's march (up to 14 field calls on a hit near a
  // wound), the AO and scatter probes (2 calls), and the finite-difference normal (4 calls where the analytic
  // gradient bails). Each removed is a wrong picture: its ceiling.
  noWoundShadow: (c) => once(c, '  var res = 1.0;\n  var t = 0.02;', '  var res = 1.0;\n  if (true) { return 1.0; }\n  var t = 0.02;'),
  noProbes: (c) => once(c, '    if (select(lodCfg.x > 0.5, surfCfg.w > 0.0, k == 0)) {', '    if (false && select(lodCfg.x > 0.5, surfCfg.w > 0.0, k == 0)) {'),
  noFdNormal: (c) => once(c, '  if (!ngValid || debugNormal12) {', '  if (!ngValid) { nFD = ng0; }\n  if (false) {'),
  // THE ANALYTIC NORMAL ON A WOUNDED BODY. ngWounds still reaches a fixed 0.25 m past every wound (applyWounds
  // went to the exact reach on 2026-10-08), and any OWNED wound in that reach sends the pixel to calcNormal's
  // four taps. ngExact gives it applyWounds' own reach; ngOwned lets an owned wound stay analytic where no limb
  // won the re-fold at the hit (the existing counts2.z + 64 switch, forced on).
  ngExact: (c) => once(c, '    let reach = w.w * max(2.0, 2.0 * cfg.w + 3.0 * cfg2.x) + 4.0 * cfg.y + 0.25;', '    let reach = w.w * max(2.0, 2.0 * cfg.w + 3.0 * cfg2.x) + 4.0 * cfg.y + max(0.0, -d.x);'),
  ngOwned: (c) => once(c, 'gNgOwnedOk = select(0.0, 1.0, gInstCounts2.z % 128.0 > 63.5 && hitRefold == 0.0);', 'gNgOwnedOk = select(0.0, 1.0, hitRefold == 0.0);'),
  // A CUT'S BOUND. ngWounds sends a pixel to the taps when a cut is within the SPHERE round its whole slot (at
  // least twice its half-length). applyWounds' own cut branch only touches the field in a thin slab: within
  // 1.2 half-lengths along the slot and a few kerf widths across it (the carve inside the kerf, the lip a Gaussian
  // of width 1.5 kerf beyond 1.7 kerf). A pixel outside that slab skips the cut, as it skips a wound out of reach.
  ngCutSlab: (c) => once(c, '    if ((i32(flagsRow.x) & 32) != 0) { gNgReason = 1; return d; }', `    if ((i32(flagsRow.x) & 32) != 0) {
      let cCap = textureLoad(data, vec2<i32>(i, 18 + gBand), 0);
      if (length(cCap.xyz) < 0.5) { continue; }
      let cCut = textureLoad(data, vec2<i32>(i, 25 + gBand), 0);
      let cIn = cCap.xyz / max(length(cCap.xyz), 1e-6);
      let cAl = cCut.xyz - cIn * dot(cCut.xyz, cIn);
      let cAlong = cAl / max(length(cAl), 1e-6);
      let cSide = cross(cAlong, cIn);
      if (abs(dot(v, cSide)) > cCut.w * 7.7 + R || abs(dot(v, cAlong)) > w.w * 1.2 + R) { continue; }
      gNgReason = 1; return d;
    }`),
  // WHY a pixel took the taps: the shading normal's own reason code (0 analytic, 1 unsupported, 2 degenerate,
  // 3 near a kink, 4 bones, 6 volume, 7 no owner, 8 open head), two codes a rung, as r and g under class 2.
  ngReasons: (a, b) => (c) => once(c, '  if (normalGradientCfg.y > 1.5) {', `  if (true) { return vec4<f32>(select(0.0, 1.0, ngReason == ${a}), select(0.0, 1.0, ngReason == ${b}), 2.0, t); }\n  if (normalGradientCfg.y > 1.5) {`),
  // THE PER-PIXEL TILE ARRAYS. Seven private arrays of 64 hold the pixel's tile entries and its slot table: 3.3 KB
  // that every fragment gets zeroed (WGSL zero-initialises private variables) and then fills. arrays(n) sizes them
  // to n and clamps the tile's entry count to n: the same picture wherever no tile lists more than n entries.
  arrays: (n) => (c) => {
    for (const [name, type] of [['gTileBounds', 'vec4<f32>'], ['gTileGrp', 'vec4<f32>'], ['gTileBand', 'f32'], ['gTileSlot', 'f32'], ['gPixSlot', 'i32'], ['gPixFirst', 'i32'], ['gPixEnd', 'i32']]) {
      c = once(c, `var<private> ${name}: array<${type}, 64>;`, `var<private> ${name}: array<${type}, ${n}>;`);
    }
    return once(c, '    let n = min(head.y, 64u);', `    let n = min(head.y, ${n}u);`);
  },
  // PER SAMPLE: outside the body's wound bound applyWounds returns its input and nothing downstream of it runs, so
  // the sample is mapLean's. (Reads the loaded slot's record: one body per pixel only.)
  leanSample: (c) => {
    const ok = (p) => `(!gInstSplitOpen && gInstVolPose0.w < 0.5 && gInstCounts2.y < 0.5 && (gInstWoundCount < 0.5 || length(${p} - gInstWoundBound.xyz) > gInstWoundBound.w))`;
    const call = WALK_CALL.exec(c)[0];
    c = once(c, call, `    var dres = vec4<f32>(0.0);\n    if ${ok('(camPos + rd * t)')} { gLLean = gLLean + 1.0; dres = mapLean(camPos + rd * t, data, inst, instCfg); } else { dres = mapBody(camPos + rd * t, ${walkArgs(c)}); }\n`);
    const probe = /        dres0 = mapBody\(camPos \+ rd \* s, ([^\n]*)\);\n/.exec(c);
    c = once(c, probe[0], `        if ${ok('(camPos + rd * s)')} { dres0 = mapLean(camPos + rd * s, data, inst, instCfg); } else { dres0 = mapBody(camPos + rd * s, ${probe[1]}); }\n`);
    return once(c, '\n@fragment\nfn main(', `${mapLean({})}\nvar<private> gLLean: f32 = 0.0;\n@fragment\nfn main(`);
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
  { name: 'wounds-guard', cap: 'flat', edits: [E.woundsGuard] },
  { name: 'wounds-nocut', cap: 'flat', edits: [E.woundsNoCut] },
  { name: 'wounds-noamp', cap: 'flat', edits: [E.woundsNoAmp] },
  { name: 'lean-sample', cap: 'flat', edits: [E.leanSample] },
  { name: 'ship-lean-sample', cap: 'ship', edits: [E.leanSample] },
  { name: 'ship-wounds-nocut', cap: 'ship', edits: [E.woundsNoCut] },
  { name: 'count', cap: 'flat', edits: [E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  { name: 'lean-count', cap: 'flat', edits: [E.lean(), E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  { name: 'count-rows', cap: 'flat', edits: [E.countWith('gDebugWoundRows', 'gDebugRefolds')], timed: false },
  { name: 'count-miss', cap: 'flat', edits: [E.trackClosest, E.countWith('(gDebugSteps - gLAt)', 'select(0.0, 1.0, gLFoot < 2.0)')], timed: false },
  { name: 'count-miss-a', cap: 'flat', edits: [E.trackClosest, E.countWith('select(0.0, 1.0, gLMin > 0.005)', 'select(0.0, 1.0, gLMin > 0.01)')], timed: false },
  { name: 'count-miss-b', cap: 'flat', edits: [E.trackClosest, E.countWith('select(0.0, 1.0, gLMin > 0.02)', 'select(0.0, 1.0, gLMin > 0.04)')], timed: false },
  { name: 'count-miss-c', cap: 'flat', edits: [E.trackClosest, E.countWith('(t - gLT)', '(gLT - max(shellIn, bodyEntry))')], timed: false },
  { name: 'count-miss-d', cap: 'flat', edits: [E.trackClosest, E.countWith('(tMax - max(shellIn, bodyEntry))', 'gLFoot')], timed: false },
  { name: 'count-air-1', cap: 'flat', edits: [E.countAir('0.01'), E.countWith('gDebugSteps', 'gLAir')], timed: false },
  { name: 'count-air-2', cap: 'flat', edits: [E.countAir('0.02'), E.countWith('gDebugSteps', 'gLAir')], timed: false },
  { name: 'count-air-4', cap: 'flat', edits: [E.countAir('0.04'), E.countWith('gDebugSteps', 'gLAir')], timed: false },
  { name: 'air-gate-2', cap: 'flat', edits: [E.airGate('0.02')] },
  { name: 'air-gate-4', cap: 'flat', edits: [E.airGate('0.04')] },
  { name: 'ship-air-gate-2', cap: 'ship', edits: [E.airGate('0.02')] },
  { name: 'ship-air-gate-4', cap: 'ship', edits: [E.airGate('0.04')] },
  { name: 'air-near-1', cap: 'flat', edits: [E.airNear('0.01')] },
  { name: 'air-near-2', cap: 'flat', edits: [E.airNear('0.02')] },
  { name: 'ship-air-near-1', cap: 'ship', edits: [E.airNear('0.01')] },
  { name: 'ship-air-near-2', cap: 'ship', edits: [E.airNear('0.02')] },
  { name: 'count-near-2', cap: 'flat', edits: [E.airNear('0.02'), E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  { name: 'count-near-2-rows', cap: 'flat', edits: [E.airNear('0.02'), E.countWith('gDebugWoundRows', 'gDebugRefolds')], timed: false },
  { name: 'count-near-1-rows', cap: 'flat', edits: [E.airNear('0.01'), E.countWith('gDebugWoundRows', 'gDebugSteps')], timed: false },
  { name: 'walk-near-2', cap: 'flat', edits: [E.walkNear('0.02')] },
  { name: 'ship-walk-near-2', cap: 'ship', edits: [E.walkNear('0.02')] },
  { name: 'count-walk-near-2', cap: 'flat', edits: [E.walkNear('0.02'), E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  { name: 'count-walk-near-2-rows', cap: 'flat', edits: [E.walkNear('0.02'), E.countWith('gDebugWoundRows', 'gDebugRefolds')], timed: false },
  { name: 'walk-near-4', cap: 'flat', edits: [E.walkNear('0.04')] },
  { name: 'ship-walk-near-4', cap: 'ship', edits: [E.walkNear('0.04')] },
  { name: 'count-walk-near-4', cap: 'flat', edits: [E.walkNear('0.04'), E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  { name: 'count-walk-near-4-rows', cap: 'flat', edits: [E.walkNear('0.04'), E.countWith('gDebugWoundRows', 'gDebugRefolds')], timed: false },
  { name: 'walk-near-6', cap: 'flat', edits: [E.walkNear('0.06')] },
  { name: 'ship-walk-near-6', cap: 'ship', edits: [E.walkNear('0.06')] },
  { name: 'count-walk-near-6', cap: 'flat', edits: [E.walkNear('0.06'), E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  { name: 'count-walk-near-6-rows', cap: 'flat', edits: [E.walkNear('0.06'), E.countWith('gDebugWoundRows', 'gDebugRefolds')], timed: false },
  { name: 'ship-no-wshadow', cap: 'ship', edits: [E.noWoundShadow] },
  { name: 'ship-no-probes', cap: 'ship', edits: [E.noProbes] },
  { name: 'ship-no-fd', cap: 'ship', edits: [E.noFdNormal] },
  { name: 'ship-no-posthit-field', cap: 'ship', edits: [E.noWoundShadow, E.noProbes, E.noFdNormal] },
  { name: 'count-nearhit', cap: 'flat', edits: [E.countWith('select(0.0, 1.0, hitNearWound)', 'select(0.0, 1.0, hitRefold != 0.0)')], timed: false },
  { name: 'ship-ng-exact', cap: 'ship', edits: [E.ngExact] },
  { name: 'ship-ng-owned', cap: 'ship', edits: [E.ngOwned] },
  { name: 'ship-ng-both', cap: 'ship', edits: [E.ngExact, E.ngOwned] },
  // ACROSS FRAMES in one rotation (run with LADDER_SCENE unset): two invocations of this script do not share a
  // machine state, so one frame's milliseconds cannot be set against another's unless both ran in the same repeats.
  ...['', 'pel', 'chop', 'split', 'w5', 'w20'].flatMap((sc) => [
    { name: `x-${sc || 'clean'}-ship`, cap: `${sc}ship`, edits: [] },
    { name: `x-${sc || 'clean'}-flat`, cap: `${sc}flat`, edits: [] },
  ]),
  { name: 'ship-ng-cut', cap: 'ship', edits: [E.ngCutSlab] },
  { name: 'ship-ng-all', cap: 'ship', edits: [E.ngCutSlab, E.ngExact, E.ngOwned] },
  { name: 'count-ng-01', cap: 'ship', edits: [E.ngReasons(0, 1)], timed: false },
  { name: 'count-ngall-01', cap: 'ship', edits: [E.ngCutSlab, E.ngExact, E.ngOwned, E.ngReasons(0, 1)], timed: false },
  { name: 'count-ng-23', cap: 'ship', edits: [E.ngReasons(2, 3)], timed: false },
  { name: 'count-ngall-23', cap: 'ship', edits: [E.ngCutSlab, E.ngExact, E.ngOwned, E.ngReasons(2, 3)], timed: false },
  { name: 'count-ng-48', cap: 'ship', edits: [E.ngReasons(4, 8)], timed: false },
  { name: 'count-ngall-48', cap: 'ship', edits: [E.ngCutSlab, E.ngExact, E.ngOwned, E.ngReasons(4, 8)], timed: false },
  { name: 'count-ng-67', cap: 'ship', edits: [E.ngReasons(6, 7)], timed: false },
  { name: 'count-ngall-67', cap: 'ship', edits: [E.ngCutSlab, E.ngExact, E.ngOwned, E.ngReasons(6, 7)], timed: false },
  // THE TEMPORAL START switched off (the game's own ?tstart=0): its probe is one to four field calls a pixel, and
  // with the hull on its start rarely beats the hull's entry.
  { name: 'no-temporal', cap: 'flat', edits: [E.noTemporal] },
  { name: 'ship-no-temporal', cap: 'ship', edits: [E.noTemporal] },
  { name: 'count-no-temporal', cap: 'flat', edits: [E.noTemporal, E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  // ONE-CALL PROTOTYPE (captures taken in motion; LADDER_SCENE = still, strafe, turn, anim).
  { name: 'count-pred-a', cap: 'flat', edits: [E.ladFns, E.ladAtHit(false), E.countWith('select(0.0, 1.0, ladP.x > 0.0 && ladP.y < 1.5)', 'select(0.0, 1.0, ladUse)', '0.0', '0.0')], timed: false },
  { name: 'count-pred-b', cap: 'flat', edits: [E.ladFns, E.ladAtHit(false), E.countWith('select(0.0, 1.0, ladUse && abs(ladErr) < ladEps)', 'select(0.0, 1.0, temp.y > 0.0 && abs(temp.y - t) < ladEps)', '0.0', '0.0')], timed: false },
  { name: 'count-verify-a', cap: 'flat', edits: [E.ladFns, E.ladAtHit(true), E.countWith('select(0.0, 1.0, ladUse && ladD < ladEps && ladD >= -hitEpsBase)', 'select(0.0, 1.0, ladUse && ladD < -hitEpsBase)', '0.0', '0.0')], timed: false },
  { name: 'count-verify-b', cap: 'flat', edits: [E.ladFns, E.ladAtHit(true), E.countWith('select(0.0, 1.0, ladUse && ladD >= ladEps)', 'select(0.0, 1.0, ladUse && ladD >= ladEps && ladD < 0.03)', '0.0', '0.0')], timed: false },
  { name: 'count-verify-e', cap: 'flat', edits: [E.ladFns, E.ladAtHit(true, '0.03'), E.countWith('select(0.0, 1.0, ladUse)', 'select(0.0, 1.0, ladUse && ladD < ladEps && ladD >= -hitEpsBase)', '0.0', '0.0')], timed: false },
  { name: 'onecall', cap: 'flat', edits: [E.ladFns, E.noTemporal, E.oneCall()] },
  { name: 'ship-onecall', cap: 'ship', edits: [E.ladFns, E.noTemporal, E.oneCall()] },
  { name: 'count-onecall', cap: 'flat', edits: [E.ladFns, E.noTemporal, E.oneCall(), E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  { name: 'onecall-es', cap: 'flat', edits: [E.ladFns, E.noTemporal, E.oneCall({ snap: true, edge: '0.03' })] },
  { name: 'ship-onecall-es', cap: 'ship', edits: [E.ladFns, E.noTemporal, E.oneCall({ snap: true, edge: '0.03' })] },
  { name: 'ship-onecall-s', cap: 'ship', edits: [E.ladFns, E.noTemporal, E.oneCall({ snap: true })] },
  { name: 'onecall-esl', cap: 'flat', edits: [E.ladFns, E.noTemporal, E.oneCall({ snap: true, edge: '0.03', loose: true })] },
  { name: 'ship-onecall-esl', cap: 'ship', edits: [E.ladFns, E.noTemporal, E.oneCall({ snap: true, edge: '0.03', loose: true })] },
  { name: 'count-onecall-esl', cap: 'flat', edits: [E.ladFns, E.noTemporal, E.oneCall({ snap: true, edge: '0.03', loose: true }), E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  { name: 'count-onecall-es', cap: 'flat', edits: [E.ladFns, E.noTemporal, E.oneCall({ snap: true, edge: '0.03' }), E.countWith('gDebugSteps', 'gDebugPrims')], timed: false },
  // THE WALK BY STEP COUNT: the loop capped at n steps, a capped ray writing where it got to (so nothing is
  // removed as dead). cap0 is the per-pixel setup; each further cap adds one field call to every ray still walking.
  ...[0, 1, 2, 3, 4, 6].map((n) => ({ name: `cap${n}`, cap: 'flat', edits: [E.stepCap(n), E.keepSetup, E.noTemporal] })),
  { name: 'arr32', cap: 'flat', edits: [E.arrays(32)] },
  { name: 'ship-arr32', cap: 'ship', edits: [E.arrays(32)] },
  { name: 'cap1-arr32', cap: 'flat', edits: [E.stepCap(1), E.keepSetup, E.noTemporal, E.arrays(32)] },
  { name: 'arr16', cap: 'flat', edits: [E.arrays(16)] },
  { name: 'ship-arr16', cap: 'ship', edits: [E.arrays(16)] },
  { name: 'cap1-arr16', cap: 'flat', edits: [E.stepCap(1), E.keepSetup, E.noTemporal, E.arrays(16)] },
  { name: 'arr8', cap: 'flat', edits: [E.arrays(8)] },
  { name: 'ship-arr8', cap: 'ship', edits: [E.arrays(8)] },
  { name: 'cap1-arr8', cap: 'flat', edits: [E.stepCap(1), E.keepSetup, E.noTemporal, E.arrays(8)] },
  { name: 'count-tile', cap: 'flat', edits: [E.countWith('gTileN', 'f32(gPixN)', 'gTileN', 'f32(gPixN)')], timed: false },
  { name: 'count-lean', cap: 'flat', edits: [E.leanSample, E.countWith('gDebugSteps', 'gLLean')], timed: false },
].filter((r) => ONLY.length === 0 || ONLY.includes(r.name));

// One manifest per rung, beside its capture's own.
for (const r of RUNGS) {
  r.dir = `${OUT}-${SCENE}${r.cap}`;
  r.manifest = r.edits.length === 0 ? 'manifest.json' : `manifest.${r.name}.json`;
  if (r.edits.length === 0) continue;
  const manifest = JSON.parse(readFileSync(join(r.dir, 'manifest.json'), 'utf8'));
  let edited = 0;
  for (const o of Object.values(manifest.objects)) {
    if (o.kind !== 'shaderModule' || !/\bfn mapBody\b/.test(o.desc.code)) continue;
    for (const edit of r.edits) o.desc.code = edit(o.desc.code);
    edited++;
  }
  // One module on a single-type frame; a crowd frame draws one program per crowd type, and each gets the edit.
  if (edited < 1) throw new Error(`ladder: ${r.name} found no march shader module to edit`);
  writeFileSync(join(r.dir, r.manifest), JSON.stringify(manifest));
}

// LADDER_SHEETS=<dir>: each rung's first run also writes <dir>/<scene><rung>.png: the game's frame, the rung's,
// and their difference times 8.
const SHEETS = process.env.LADDER_SHEETS ?? '';
const run = (r, repeat = REPEAT, rounds = ROUNDS, sheet = false) => {
  const out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, r.dir, repeat, rounds, r.manifest, ...(sheet ? [join(SHEETS, `${SCENE}${r.name}.png`)] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.trim().split('\n').pop());
};

// A first run of each: the cold Metal compile of an edited march shader is tens of seconds.
const info = {};
for (const r of RUNGS) {
  const t0 = Date.now();
  try {
    const res = run(r, '2', '2', !!SHEETS);
    info[r.name] = { parity: res.parity[0], errors: res.errors };
    const p = res.parity[0] ?? {};
    console.log(`warm ${r.name.padEnd(16)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  differing ${(100 * (p.differingFrac ?? NaN)).toFixed(2)} %  max ${(p.maxDiff ?? NaN).toPrecision(3)}  mean ${(p.meanDiff ?? NaN).toPrecision(3)}  px>0.02 ${p.over02}  px>0.1 ${p.over10}${res.errors.length ? `  ERRORS ${res.errors[0].slice(0, 200)}` : ''}`);
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
writeFileSync(`${OUT}-${SCENE}ladder.json`, JSON.stringify({ reps: REPS, repeat: Number(REPEAT), rounds: Number(ROUNDS), table, runs, info }, null, 1));
