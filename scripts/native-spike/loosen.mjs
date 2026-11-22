// scripts/native-spike/loosen.mjs
//
// CHEAPER FIELD CALLS ON THE MOB, EXACT AND LOOSE (docs/dev-notes/2026-11-10-silhouette-spike/LOOSEN.md). A captured
// `sdf:march` pass replayed with its fragment shader's text edited, each leg timed against the shipped pass by
// alternation and compared with the game's own readback of the frame.
//
//   lean-sample    EXACT: the lean walk chosen per SAMPLE. A pixel with wounded bodies in its table takes mapLean for
//                  every sample outside all of their wound bounds (up to 8 spheres, listed once per pixel).
//   lean-wound-25  the same against each WOUND's own reach, with applyWounds' 0.25 m slack; lean-wound-2 with 2 cm
//                  (LOOSE: a sample deeper than 2 cm inside the body can lose a wound's fillet).
//   probes-lean    LOOSE: the AO and scatter probes call mapLean (they ignore wounds, bones and an open head).
//   no-fd          LOOSE: where the analytic normal gives up, its own gradient is used; no finite-difference taps.
//   no-wshadow     LOOSE: no wound soft shadow.
//   loose          the three loose ones together; all = those and lean-sample.
//   count          not timed: hit pixels' walk steps, and how many of them lean-sample sends to mapLean.
//
//   node scripts/native-spike/loosen.mjs <reps> <captureDir> [sheetDir]
//   LOOSE_CDP (default 9391), LOOSE_REPEAT (10), LOOSE_ROUNDS (15), LOOSE_ONLY (comma list)
//
// Writes <captureDir>-loosen.json, and with sheetDir one PNG a leg: the game's frame | the leg's | difference x 8.
// Run through servers.sh, under the GPU lock. The capture is the FRAGMENT march.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPS = Number(process.argv[2] ?? 5);
const DIR = (process.argv[3] ?? '.scratch/compute/mobw-ship').replace(/\/+$/, '');
const SHEETS = process.argv[4] ?? '';
const CDP = process.env.LOOSE_CDP ?? '9391';
const REPEAT = process.env.LOOSE_REPEAT ?? '10';
const ROUNDS = process.env.LOOSE_ROUNDS ?? '15';
const ONLY = (process.env.LOOSE_ONLY ?? '').split(',').filter(Boolean);
if (SHEETS) mkdirSync(SHEETS, { recursive: true });

const once = (code, find, repl) => {
  const n = code.split(find).length - 1;
  if (n !== 1) throw new Error(`loosen: expected 1 match, found ${n}, for: ${find.slice(0, 70)}`);
  return code.replace(find, () => repl);
};

const WALK = '    if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else {';
const E = {
  // The per-pixel test's other three conditions, kept; a wounded slot adds its bound sphere's ray interval.
  leanSample: (margin = null) => (c) => {
    c = once(c, '  // OCCLUDER PRE-PASS. occT is the distance', `  var leanSoft = false;
  var leanT0 = 1e9;
  var leanT1 = -1e9;
  if (!leanOk && gTileActive > 0.5 && debugCfg.x > -0.5 && !(gWoundListOn > 0.5 && gWoundN > 0)) {
    leanSoft = true;
    let sBase = i32(instCfg.z);
    var sRun = 0;
    for (var sk = 0; sk < 64; sk = sk + 1) {
      if (sk >= gPixN) { break; }
      let sFirst = sRun;
      sRun = tileRunEnd(sFirst);
      let srb = (sBase + i32(gTileRef[sFirst] >> 8u)) * 22;
      if ((*inst)[srb + 4].w < 0.5) { continue; }
      let sc2 = (*inst)[srb + 1];
      let ssn = (*inst)[srb + 17].xyz;
      if (dot(ssn, ssn) > 0.5 || (*inst)[srb + 10].w > 0.5 || (sc2.y > 0.5 && sc2.x > 0.0)) { leanSoft = false; break; }
      if (!((*inst)[srb + 8].w < 0.5)) {
${margin === null ? `        let swb = (*inst)[srb + 2];
        let soc = swb.xyz - camPos;
        let stc = dot(soc, rd);
        let sr = swb.w + 0.002;
        // Only a sphere the ray enters can hold a sample. More than 8 of them: the pixel stays on mapBody.
        if (!(sr * sr - (dot(soc, soc) - stc * stc) <= 0.0)) {
          if (gLSphN >= 8) { leanSoft = false; break; }
          gLSph[gLSphN] = vec4<f32>(swb.xyz, sr * sr);
          gLSphN = gLSphN + 1;
          leanT0 = min(leanT0, swb.w);
          leanT1 = max(leanT1, swb.w);
        }` : `        // EACH WOUND'S OWN REACH (applyWounds' expression, its slack replaced by a fixed margin), not the body's bound.
        let sBand = i32((*inst)[srb + 3].w);
        let sN = min(i32((*inst)[srb + 8].w), 32);
        for (var wi = 0; wi < 32; wi = wi + 1) {
          if (wi >= sN) { break; }
          let sw = textureLoad(data, vec2<i32>(wi, 5 + sBand), 0);
          let sr = ${margin.includes('sw.w') ? margin : `sw.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + ${margin}`};
          let soc = sw.xyz - camPos;
          let stc = max(dot(soc, rd), 0.0);
          if (dot(soc, soc) - stc * stc > sr * sr) { continue; }
          if (gLSphN >= 8) { leanSoft = false; break; }
          gLSph[gLSphN] = vec4<f32>(sw.xyz, sr * sr);
          gLSphN = gLSphN + 1;
          leanT0 = min(leanT0, sr);
          leanT1 = max(leanT1, sr);
        }
        if (!leanSoft) { break; }`}
      }
    }
  }
  // OCCLUDER PRE-PASS. occT is the distance`);
    c = once(c, WALK, `    gLSteps = gLSteps + 1.0;
    var leanNow = leanOk;
    if (leanSoft) {
      leanNow = true;
      let lq = camPos + rd * t;
      for (var li = 0; li < 8; li = li + 1) {
        if (li >= gLSphN) { break; }
        let ld = lq - gLSph[li].xyz;
        if (dot(ld, ld) <= gLSph[li].w) { leanNow = false; break; }
      }
    }
    if (leanNow) { gLLean = gLLean + 1.0; dres = mapLean(camPos + rd * t, data, inst, instCfg); } else {`);
    return once(c, '\n@fragment\nfn main(', '\nvar<private> gLLean: f32 = 0.0;\nvar<private> gLSteps: f32 = 0.0;\nvar<private> gLSph: array<vec4<f32>, 8>;\nvar<private> gLSphN: i32 = 0;\n@fragment\nfn main(');
  },
  count: (c) => once(c, '  if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }', '  if (true) { return vec4<f32>(gLSteps, gLLean, 2.0, t); }'),
  countWith: (r, g) => (c) => once(c, '  if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }', `  if (true) { return vec4<f32>(${r}, ${g}, 2.0, t); }`),
  probesLean: (c) => {
    const m = /      let probeD = mapBody\((select\(p \+ n \* 0\.06, p \+ L \* 0\.06, k == 0\)), [^\n]*\)\.x;\n/.exec(c);
    if (!m) throw new Error('loosen: the probes\' mapBody call was not found');
    return once(c, m[0], `      let probeD = mapLean(${m[1]}, data, inst, instCfg).x;\n`);
  },
  noFd: (c) => once(c, '  if (!ngValid || debugNormal12) {', '  if (!ngValid) { let ngLoose = dot(ng0, ng0); if (ngLoose > 1e-12 && ngLoose < 1e12) { nFD = normalize(ng0); } }\n  if (false) {'),
  ng0Always: (c) => once(c, '    if (ngReason == 0) {\n      var candidate = ng.yzw;', '    ng0 = ng.yzw;\n    if (ngReason == 0) {\n      var candidate = ng.yzw;'),
  noWoundShadow: (c) => once(c, '  var res = 1.0;\n  var t = 0.02;', '  var res = 1.0;\n  if (true) { return 1.0; }\n  var t = 0.02;'),
};

const LEGS = [
  { name: 'ship', edits: [] },
  { name: 'ship2', edits: [] },
  { name: 'lean-sample', edits: [E.leanSample()] },
  { name: 'lean-wound-25', edits: [E.leanSample('0.25')] },
  { name: 'lean-wound-2', edits: [E.leanSample('0.02')] },
  { name: 'probes-lean', edits: [E.probesLean] },
  { name: 'no-fd', edits: [E.ng0Always, E.noFd] },
  { name: 'no-wshadow', edits: [E.noWoundShadow] },
  { name: 'loose', edits: [E.probesLean, E.ng0Always, E.noFd, E.noWoundShadow] },
  { name: 'all', edits: [E.leanSample(), E.probesLean, E.ng0Always, E.noFd, E.noWoundShadow] },
  { name: 'count', edits: [E.leanSample(), E.count], timed: false },
  { name: 'count-w25', edits: [E.leanSample('0.25'), E.count], timed: false },
  { name: 'count-w2', edits: [E.leanSample('0.02'), E.count], timed: false },
  ...[['t10', 'sw.w * 1.0 + 0.02'], ['t15', 'sw.w * 1.5 + 0.02'], ['t20', 'sw.w * 2.0 + 0.03']].flatMap(([n, e]) => [
    { name: `lean-${n}`, edits: [E.leanSample(e)] },
    { name: `count-${n}`, edits: [E.leanSample(e), E.count], timed: false, steps: true },
    { name: `all-${n}`, edits: [E.leanSample(e), E.probesLean, E.ng0Always, E.noFd, E.noWoundShadow] },
  ]),
  { name: 'count-ww', edits: [E.leanSample('sw.w'), E.countWith('select(0.0, leanT0, gLSphN > 0)', 'select(0.0, leanT1, gLSphN > 0)')], timed: false },
  { name: 'count-w2-r', edits: [E.leanSample('0.02'), E.countWith('select(0.0, leanT0, gLSphN > 0)', 'select(0.0, leanT1, gLSphN > 0)')], timed: false },
  { name: 'count-w2-c', edits: [E.leanSample('0.02'), E.countWith('select(0.0, 1.0, gLSphN > 0)', 'gInstWoundCount')], timed: false },
  { name: 'count-w2-n', edits: [E.leanSample('0.02'), E.countWith('select(0.0, 1.0, leanSoft)', 'f32(gLSphN)')], timed: false },
  { name: 'all-w2', edits: [E.leanSample('0.02'), E.probesLean, E.ng0Always, E.noFd, E.noWoundShadow] },
  { name: 'count-why', edits: [E.leanSample(), E.countWith('select(0.0, 1.0, leanSoft)', 'select(0.0, 1.0, gWoundListOn > 0.5 && gWoundN > 0)')], timed: false },
  { name: 'count-span', edits: [E.leanSample(), E.countWith('select(0.0, 1.0, leanOk)', 'f32(gLSphN)')], timed: false },
  { name: 'count-reach', edits: [E.leanSample(), E.countWith('select(0.0, leanT0, gLSphN > 0)', 'select(0.0, leanT1, gLSphN > 0)')], timed: false },
].filter((l) => !ONLY.length || ONLY.includes(l.name) || l.name === 'ship');

for (const leg of LEGS) {
  leg.manifest = 'manifest.json';
  if (!leg.edits.length) continue;
  const m = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
  const done = new Set();
  for (const c of m.passes[0].cmds) {
    if (c[0] !== 'setPipeline') continue;
    const modId = m.objects[c[1].$ref].desc.fragment.module.$ref;
    if (done.has(modId)) continue;
    done.add(modId);
    let code = m.objects[modId].desc.code;
    for (const e of leg.edits) code = e(code);
    m.objects[modId].desc.code = code;
  }
  leg.manifest = `manifest.loosen-${leg.name}.json`;
  writeFileSync(join(DIR, leg.manifest), JSON.stringify(m));
}

const run = (leg, repeat = REPEAT, rounds = ROUNDS, sheet = '') => {
  let out;
  try {
    out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, DIR, repeat, rounds, leg.manifest, ...(sheet ? [sheet] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (e) {
    out = String(e.stdout ?? '');
    if (!out.trim()) throw new Error(`loosen: ${leg.name} replay failed: ${String(e.stderr || e.message).slice(0, 2000)}`);
  }
  return JSON.parse(out.trim().split('\n').pop());
};
const info = {};
let failed = false;
for (const leg of LEGS) {
  const t0 = Date.now();
  const res = run(leg, '2', '2', SHEETS && leg.edits.length ? join(SHEETS, `${leg.name}.png`) : '');
  const p = res.parity?.[0] ?? {};
  info[leg.name] = { texels: p.differingTexels, over02: p.over02, over10: p.over10, hitFlips: p.hitFlips, maxDiff: p.maxDiff, meanDiff: p.meanDiff, classes: p.classes };
  console.log(`warm ${leg.name.padEnd(12)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  errors ${res.errors?.length ?? 0}  texels moved ${p.differingTexels}  colour >0.02 ${p.over02}  >0.1 ${p.over10}  hit flips ${p.hitFlips}  largest ${Number(p.maxDiff).toPrecision(3)}`);
  if (leg.steps || leg.name === 'count' || leg.name === 'count-w25' || leg.name === 'count-w2') console.log(`     hit pixels ${p.classes?.[2]?.pixels}: walk steps ${p.classes?.[2]?.r}, of them lean ${p.classes?.[2]?.g}`);
  else if (leg.name.startsWith('count-')) console.log(`     hit pixels ${p.classes?.[2]?.pixels}: r ${p.classes?.[2]?.r}, g ${p.classes?.[2]?.g}`);
  if (res.errors?.length) { failed = true; for (const e of res.errors.slice(0, 4)) console.error(`  ERROR ${leg.name}: ${e.slice(0, 1500)}`); }
}
if (failed) { console.error('loosen: a leg replays with errors; nothing timed'); process.exit(1); }

const timed = LEGS.filter((l) => l.timed !== false);
const file = `${DIR}-loosen.json`;
const reps = [];
for (let rep = 0; rep < REPS; rep++) {
  const order = timed.map((_, i) => timed[(i + rep) % timed.length]);
  const row = {};
  for (const leg of order) row[leg.name] = run(leg).medianMs;
  reps.push(row);
  console.log(`  rep ${String(rep + 1).padStart(2)}  ${timed.map((l) => `${l.name} ${row[l.name].toFixed(2)}`).join('  ')}`);
  writeFileSync(file, JSON.stringify({ dir: DIR, info, runs: reps }, null, 1));
}
if (!reps.length) process.exit(0);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const ship = med(reps.map((r) => r.ship));
const table = [];
console.log(`\n${'leg'.padEnd(13)}${'ms'.padStart(8)}${'against ship'.padStart(14)}${'range'.padStart(18)}${''.padStart(8)}`);
for (const leg of timed) {
  const d = reps.map((r) => r[leg.name] - r.ship);
  const t = { name: leg.name, ms: med(reps.map((r) => r[leg.name])), diffMs: med(d), min: Math.min(...d), max: Math.max(...d) };
  table.push(t);
  console.log(`${leg.name.padEnd(13)}${t.ms.toFixed(2).padStart(8)}${t.diffMs.toFixed(2).padStart(14)}${`${t.min.toFixed(2)}..${t.max.toFixed(2)}`.padStart(18)}${`${(100 * t.diffMs / ship).toFixed(0)} %`.padStart(8)}`);
}
writeFileSync(file, JSON.stringify({ dir: DIR, info, runs: reps, shipMs: ship, table }, null, 1));
console.log(`wrote ${file}`);
