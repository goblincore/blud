// scripts/native-spike/wound-bound.mjs
//
// WHAT A WOUNDED BODY'S WALK COULD SAVE (docs/dev-notes/2026-11-10-silhouette-spike/WOUNDS-WALK.md). A captured
// `sdf:march` pass of a wounded mob, replayed with its fragment shader's text edited. A pixel is SOFT when wounds are
// the only thing keeping it off the lean walk (no open head split, baked volume or bare-bones fold in its table).
//
//   walk-lean   CEILING, picture wrong: a soft pixel's walk takes mapLean for every step. No field that also applied
//               wounds could be cheaper than this.
//   no-wounds   picture wrong: applyWounds returns at its first line, everywhere. What the wound code itself costs
//               inside mapBody (walk and shading together).
//   no-refold   LOOSE: mapBody's owner re-fold never runs (a limb under another limb's crater is not re-folded).
//   refold-lean no-refold and walk-lean together.
//   nw-walk     picture wrong: wounds off in the walk's own field calls. nw-shade: off in every other call.
//   no-near     LOOSE: applyWounds never reports "near a wound" (the walk's short steps there, the re-fold's trigger,
//               the hit's wound shading).
//   tight-N     LOOSE: a wound row is skipped beyond N/10 radii (shipped: two radii, for the near flag alone).
//   shell-N     THE SHELL WALK: a soft pixel's step calls mapLean first and goes on to mapBody only when the clean
//               body is within N cm. A wound carves (the field only grows) and its rim bump adds less than a
//               centimetre, so the clean field is a lower bound of the wounded one outside a thin shell.
//   count-*     not timed: hit pixels' walk steps and how many of them stayed on mapLean.
//
//   node scripts/native-spike/wound-bound.mjs <reps> <captureDir> [sheetDir]
//   WB_CDP (default 9391), WB_REPEAT (10), WB_ROUNDS (15), WB_ONLY (comma list)
//
// Writes <captureDir>-woundbound.json. Run through servers.sh, under the GPU lock. The capture is the FRAGMENT march.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPS = Number(process.argv[2] ?? 5);
const DIR = (process.argv[3] ?? '.scratch/compute/mobw-ship').replace(/\/+$/, '');
const SHEETS = process.argv[4] ?? '';
const CDP = process.env.WB_CDP ?? '9391';
const REPEAT = process.env.WB_REPEAT ?? '10';
const ROUNDS = process.env.WB_ROUNDS ?? '15';
const ONLY = (process.env.WB_ONLY ?? '').split(',').filter(Boolean);
if (SHEETS) mkdirSync(SHEETS, { recursive: true });

const once = (code, find, repl) => {
  const n = code.split(find).length - 1;
  if (n !== 1) throw new Error(`wound-bound: expected 1 match, found ${n}, for: ${find.slice(0, 70)}`);
  return code.replace(find, () => repl);
};
const WALK = '    if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else {';
const FLAT = '  if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }';
// leanSoft: the per-pixel lean test with its wound condition left out.
const soft = (c) => {
  c = once(c, '  // OCCLUDER PRE-PASS. occT is the distance', `  var leanSoft = false;
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
    }
  }
  gWBSoft = select(0.0, 1.0, leanSoft);
  // OCCLUDER PRE-PASS. occT is the distance`);
  return once(c, '\n@fragment\nfn main(', '\nvar<private> gLLean: f32 = 0.0;\nvar<private> gLSteps: f32 = 0.0;\nvar<private> gWBSoft: f32 = 0.0;\n@fragment\nfn main(');
};
const E = {
  walkLean: (c) => once(soft(c), WALK, `    gLSteps = gLSteps + 1.0;
    if (leanSoft) { gLLean = gLLean + 1.0; }
    if (leanOk || leanSoft) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else {`),
  shell: (m) => (c) => once(soft(c), WALK, `    gLSteps = gLSteps + 1.0;
    var shellFar = false;
    if (leanSoft) { dres = mapLean(camPos + rd * t, data, inst, instCfg); shellFar = dres.x > ${m}; }
    if (shellFar) { gLLean = gLLean + 1.0; } else if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else {`),
  noWounds: (c) => once(c, '  if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }', '  if (true) { return vec2<f32>(dIn, 0.0); }'),
  // The owner re-fold never runs: a wound still carves, but a limb under somebody else's crater is not re-folded.
  noRefold: (c) => once(c, '  if (!walkSkip && !cheapProbe && gNormalHint != 0.0 && (nearWound > 0.5 || dmg != carved) && gWoundOwners != 0u', '  if (false && !walkSkip && !cheapProbe && gNormalHint != 0.0 && (nearWound > 0.5 || dmg != carved) && gWoundOwners != 0u'),
  // Wound rows read (one load and a length each) and rows inside their reach (the crater code), over the walk.
  rows: (c) => {
    c = once(c, '    let w = textureLoad(data, vec2<i32>(i, 5 + band), 0);\n    let r = length(p - w.xyz);', '    let w = textureLoad(data, vec2<i32>(i, 5 + band), 0);\n    gWBRows = gWBRows + 1.0;\n    let r = length(p - w.xyz);');
    c = once(c, '    let wFlags = textureLoad(data, vec2<i32>(i, 19 + band), 0);', '    gWBHeavy = gWBHeavy + 1.0;\n    let wFlags = textureLoad(data, vec2<i32>(i, 19 + band), 0);');
    c = once(c, '  if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }', '  gWBCalls = gWBCalls + 1.0;\n  if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }');
    return once(c, '\nfn applyWounds (', '\nvar<private> gWBRows: f32 = 0.0;\nvar<private> gWBHeavy: f32 = 0.0;\nvar<private> gWBCalls: f32 = 0.0;\nfn applyWounds (');
  },
  // TIGHT REACH (loose): a row beyond k radii (+ the fillet and the running depth) skips the crater code; the near
  // flag, which is what holds the shipped reach at two radii, is set from the distance alone.
  tight: (k) => (c) => once(c, '    if (perfCfg.y > 0.5 && r > reach) { continue; }', `    if (perfCfg.y > 0.5 && r > reach) { continue; }
    if (r > w.w * ${k} + 4.0 * woundCfg.y + slack) { if (r < w.w * 2.0) { near = 1.0; } continue; }`),
  // Wounds off in the walk's own calls only, or everywhere but those; and the near flag never raised.
  nwWalk: (c) => once(c, '  if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }', '  if (gWalkStep > 0.5 || length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }'),
  nwShade: (c) => once(c, '  if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }', '  if (gWalkStep < 0.5 || length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }'),
  noNear: (c) => once(c, '  return vec2<f32>(d, near);', '  return vec2<f32>(d, 0.0);'),
  steps: (c) => once(once(c, '    if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else {', '    gLSteps = gLSteps + 1.0;\n    if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else {'), '\n@fragment\nfn main(', '\nvar<private> gLSteps: f32 = 0.0;\n@fragment\nfn main('),
  count: (r, g) => (c) => once(c, FLAT, `  if (true) { return vec4<f32>(${r}, ${g}, 2.0, t); }`),
};
const LEGS = [
  { name: 'ship', edits: [] },
  { name: 'ship2', edits: [] },
  { name: 'walk-lean', edits: [E.walkLean] },
  { name: 'no-wounds', edits: [E.noWounds] },
  { name: 'no-refold', edits: [E.noRefold] },
  { name: 'refold-lean', edits: [E.noRefold, E.walkLean] },
  { name: 'tight-15', edits: [E.tight('1.5')] },
  { name: 'tight-12', edits: [E.tight('1.2')] },
  { name: 'tight-10', edits: [E.tight('1.0')] },
  { name: 'count-rows-15', edits: [E.tight('1.5'), E.rows, E.count('gWBRows', 'gWBHeavy')], timed: false },
  { name: 'count-rows-12', edits: [E.tight('1.2'), E.rows, E.count('gWBRows', 'gWBHeavy')], timed: false },
  { name: 'count-rows-10', edits: [E.tight('1.0'), E.rows, E.count('gWBRows', 'gWBHeavy')], timed: false },
  { name: 'nw-walk', edits: [E.nwWalk] },
  { name: 'nw-shade', edits: [E.nwShade] },
  { name: 'no-near', edits: [E.noNear] },
  { name: 'count-steps', edits: [E.steps, E.count('gLSteps', '1.0')], timed: false },
  { name: 'count-steps-nonear', edits: [E.noNear, E.steps, E.count('gLSteps', '1.0')], timed: false },
  { name: 'count-steps-nw', edits: [E.noWounds, E.steps, E.count('gLSteps', '1.0')], timed: false },
  { name: 'shell-1', edits: [E.shell('0.01')] },
  { name: 'shell-3', edits: [E.shell('0.03')] },
  { name: 'shell-6', edits: [E.shell('0.06')] },
  { name: 'count-soft', edits: [E.walkLean, E.count('gLSteps', 'gLLean')], timed: false },
  { name: 'count-shell-1', edits: [E.shell('0.01'), E.count('gLSteps', 'gLLean')], timed: false },
  { name: 'count-shell-3', edits: [E.shell('0.03'), E.count('gLSteps', 'gLLean')], timed: false },
  { name: 'count-shell-6', edits: [E.shell('0.06'), E.count('gLSteps', 'gLLean')], timed: false },
  { name: 'count-pix', edits: [E.walkLean, E.count('gWBSoft', 'select(0.0, 1.0, leanOk)')], timed: false },
  { name: 'count-rows', edits: [E.rows, E.count('gWBRows', 'gWBHeavy')], timed: false },
  { name: 'count-calls', edits: [E.rows, E.walkLean, E.count('gWBCalls', 'gLSteps')], timed: false },
  { name: 'count-cfg', edits: [E.count('perfCfg.y', 'gWoundExact')], timed: false },
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
  leg.manifest = `manifest.wb-${leg.name}.json`;
  writeFileSync(join(DIR, leg.manifest), JSON.stringify(m));
}
const run = (leg, repeat = REPEAT, rounds = ROUNDS, sheet = '') => {
  let out;
  try {
    out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, DIR, repeat, rounds, leg.manifest, ...(sheet ? [sheet] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (e) {
    out = String(e.stdout ?? '');
    if (!out.trim()) throw new Error(`wound-bound: ${leg.name} replay failed: ${String(e.stderr || e.message).slice(0, 2000)}`);
  }
  return JSON.parse(out.trim().split('\n').pop());
};
const info = {};
let failed = false;
for (const leg of LEGS) {
  const t0 = Date.now();
  const res = run(leg, '2', '2', SHEETS && leg.edits.length && leg.timed !== false ? join(SHEETS, `${leg.name}.png`) : '');
  const p = res.parity?.[0] ?? {};
  info[leg.name] = { texels: p.differingTexels, over02: p.over02, over10: p.over10, hitFlips: p.hitFlips, maxDiff: p.maxDiff, classes: p.classes };
  console.log(`warm ${leg.name.padEnd(14)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  errors ${res.errors?.length ?? 0}  texels moved ${p.differingTexels}  colour >0.02 ${p.over02}  >0.1 ${p.over10}  hit flips ${p.hitFlips}  largest ${Number(p.maxDiff).toFixed(4)}`);
  if (leg.name.startsWith('count-')) console.log(`     hit pixels ${p.classes?.[2]?.pixels}: r ${p.classes?.[2]?.r}, g ${p.classes?.[2]?.g}`);
  if (res.errors?.length) { failed = true; for (const e of res.errors.slice(0, 4)) console.error(`  ERROR ${leg.name}: ${e.slice(0, 1500)}`); }
}
if (failed) { console.error('wound-bound: a leg replays with errors; nothing timed'); process.exit(1); }
const timed = LEGS.filter((l) => l.timed !== false);
const file = `${DIR}-woundbound.json`;
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
