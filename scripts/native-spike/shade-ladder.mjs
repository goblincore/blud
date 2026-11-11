// scripts/native-spike/shade-ladder.mjs
//
// THE SHADING AFTER THE HIT, TAKEN APART (docs/dev-notes/2026-11-10-silhouette-spike/SHADING.md). A captured
// `sdf:march` pass is replayed with the march's post-hit chain CUT at one point after another: at a cut the pixel
// returns what it has computed so far (so none of it is dead code) and nothing below the cut runs. A stage's cost is
// the difference between two neighbouring cuts.
//
//   flat      the walk alone (the flat-albedo seam, forced on)
//   ng        + piece and material rows, the rest anchor, the analytic normal (ngBody)
//   normal    + the finite-difference normal where the analytic one gave up (calcNormal, four field calls), skin
//             detail, cloth folds
//   masks     + the wound and char masks
//   material  + the albedo chain: tissue, face sheet, grain, the body normal map, gore, burn, wet and gloss
//   lights    + the key light and the shared light list (bodyLights)
//   probes    + the scatter and AO probes (up to two field calls)
//   wshadow   + the wound soft shadow / self shadow (a short march)
//   ambient   + the level shadow and the ambient: six-wall bounce, probe grid, bounce spot, dynamic probes
//   ship      + the compose: everything, as the game drew it
//
// and two REMOVALS from the shipped pass, as a cross-check of the cuts: no-probes, no-fd.
//
//   node scripts/native-spike/shade-ladder.mjs <reps> <captureDir>
//   SHADE_CDP (default 9391), SHADE_REPEAT (10), SHADE_ROUNDS (15), SHADE_ONLY (comma list of legs)
//
// Writes <captureDir>-shade.json. Run through servers.sh, under the GPU lock. The capture is the FRAGMENT march.
// What a cut keeps alive is what its return names: a value computed above a cut but named only by a later one is
// charged to the later stage.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPS = Number(process.argv[2] ?? 5);
const DIR = (process.argv[3] ?? '.scratch/compute/mob-ship').replace(/\/+$/, '');
const CDP = process.env.SHADE_CDP ?? '9391';
const REPEAT = process.env.SHADE_REPEAT ?? '10';
const ROUNDS = process.env.SHADE_ROUNDS ?? '15';
const ONLY = (process.env.SHADE_ONLY ?? '').split(',').filter(Boolean);

/** Replace exactly one occurrence, or throw: a leg that silently edits nothing measures nothing. */
const once = (code, find, repl) => {
  const n = code.split(find).length - 1;
  if (n !== 1) throw new Error(`shade-ladder: expected 1 match, found ${n}, for: ${find.slice(0, 70)}`);
  return code.replace(find, () => repl);
};

// What each cut returns, cumulative: every value the chain has produced so far that something below reads.
const K_NG = 'n + ng0 + anchor * 0.01 + primAlbedo + vec3<f32>(gloss + painted + metal + cloth + primGlow + cutFace + primClipT.x)';
const K_NORMAL = `${K_NG} + nFD + nSmooth + vec3<f32>(clothValley + clothInside)`;
const K_MASKS = `${K_NORMAL} + wmBoth + vec3<f32>(cm)`;
const K_MATERIAL = `${K_MASKS} + albedo + glow + vec3<f32>(wet + specPow + faceGlow + gore + woundGlint + cutWet)`;
const K_LIGHTS = `${K_MATERIAL} + listDiff + listSpec + listRim + L + Lk + keyC * keyI + vec3<f32>(listDomFloor + listBeam + listTorchShare + beamAmt)`;
const K_PROBES = `${K_LIGHTS} + scatter + vec3<f32>(ao + shine + fres + diff)`;
const K_WSHADOW = `${K_PROBES} + vec3<f32>(wShadow)`;
const K_AMBIENT = `${K_WSHADOW} + amb + vec3<f32>(lvl)`;
const cut = (anchor, keep) => (c) => once(c, anchor, `  if (true) { return vec4<f32>(${keep}, t); }\n${anchor}`);

const LEGS = [
  { name: 'ship', edits: [] },
  { name: 'ship2', edits: [] },
  { name: 'flat', edits: [(c) => once(c, '  if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }', '  if (true) { return vec4<f32>(baseColor, t); }')] },
  { name: 'ng', edits: [cut('  let debugNormal12 = debugCfg.x > 11.5 && debugCfg.x < 12.5;', K_NG)] },
  { name: 'normal', edits: [cut('  if (normalGradientCfg.y > 0.5) { return vec4<f32>(n * 0.5 + 0.5, t); }', K_NORMAL)] },
  { name: 'masks', edits: [cut('  let wm = wmBoth.x;', K_MASKS)] },
  { name: 'material', edits: [cut('  var L = normalize(lightDir);', K_MATERIAL)] },
  { name: 'lights', edits: [cut('  let V = -rd;', K_LIGHTS)] },
  { name: 'probes', edits: [cut('  var wShadow = 1.0;', K_PROBES)] },
  { name: 'wshadow', edits: [cut('  var lvl = 1.0;', K_WSHADOW)] },
  { name: 'ambient', edits: [cut('  let metalTintLum = ', K_AMBIENT)] },
  { name: 'no-probes', edits: [(c) => once(c, '    if (select(lodCfg.x > 0.5, surfCfg.w > 0.0, k == 0)) {', '    if (false && select(lodCfg.x > 0.5, surfCfg.w > 0.0, k == 0)) {')] },
  { name: 'no-fd', edits: [(c) => once(c, '  if (!ngValid || debugNormal12) {', '  if (!ngValid) { nFD = ng0; }\n  if (false) {')] },
].filter((l) => !ONLY.length || ONLY.includes(l.name) || l.name === 'ship');

const buildLeg = (leg) => {
  if (!leg.edits.length) return 'manifest.json';
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
  const out = `manifest.shade-${leg.name}.json`;
  writeFileSync(join(DIR, out), JSON.stringify(m));
  return out;
};
for (const leg of LEGS) leg.manifest = buildLeg(leg);

const run = (leg, repeat = REPEAT, rounds = ROUNDS) => {
  let out;
  try {
    out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, DIR, repeat, rounds, leg.manifest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (e) {
    out = String(e.stdout ?? '');
    if (!out.trim()) throw new Error(`shade-ladder: ${leg.name} replay failed: ${String(e.stderr || e.message).slice(0, 2000)}`);
  }
  return JSON.parse(out.trim().split('\n').pop());
};
let failed = false;
for (const leg of LEGS) {
  const t0 = Date.now();
  const res = run(leg, '2', '2');
  console.log(`warm ${leg.name.padEnd(10)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  errors ${res.errors?.length ?? 0}`);
  if (res.errors?.length) { failed = true; for (const e of res.errors.slice(0, 4)) console.error(`  ERROR ${leg.name}: ${e.slice(0, 1500)}`); }
}
if (failed) { console.error('shade-ladder: a leg replays with errors; nothing timed'); process.exit(1); }

const file = `${DIR}-shade.json`;
const reps = [];
for (let rep = 0; rep < REPS; rep++) {
  const order = LEGS.map((_, i) => LEGS[(i + rep) % LEGS.length]);
  const row = {};
  for (const leg of order) row[leg.name] = run(leg).medianMs;
  reps.push(row);
  console.log(`  rep ${String(rep + 1).padStart(2)}  ${LEGS.map((l) => `${l.name} ${row[l.name].toFixed(2)}`).join('  ')}`);
  writeFileSync(file, JSON.stringify({ dir: DIR, runs: reps }, null, 1));
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const ship = med(reps.map((r) => r.ship));
const has = (n) => LEGS.some((l) => l.name === n);
const chain = ['flat', 'ng', 'normal', 'masks', 'material', 'lights', 'probes', 'wshadow', 'ambient', 'ship'].filter(has);
const table = [];
console.log(`\n${'cut'.padEnd(10)}${'ms'.padStart(8)}${'stage ms'.padStart(10)}${'range'.padStart(18)}${'of the pass'.padStart(13)}`);
chain.forEach((name, i) => {
  const prev = chain[i - 1];
  const own = prev ? reps.map((r) => r[name] - r[prev]) : null;
  const t = { name, ms: med(reps.map((r) => r[name])), stageMs: own ? med(own) : null, min: own ? Math.min(...own) : null, max: own ? Math.max(...own) : null };
  table.push(t);
  console.log(`${name.padEnd(10)}${t.ms.toFixed(2).padStart(8)}${(own ? t.stageMs.toFixed(2) : '').padStart(10)}${(own ? `${t.min.toFixed(2)}..${t.max.toFixed(2)}` : '').padStart(18)}${(own ? `${(100 * t.stageMs / ship).toFixed(0)} %` : '').padStart(13)}`);
});
const removals = [];
for (const name of ['ship2', 'no-probes', 'no-fd'].filter(has)) {
  const d = reps.map((r) => r[name] - r.ship);
  const t = { name, ms: med(reps.map((r) => r[name])), diffMs: med(d), min: Math.min(...d), max: Math.max(...d) };
  removals.push(t);
  console.log(`${name.padEnd(10)}${t.ms.toFixed(2).padStart(8)}  against ship ${t.diffMs.toFixed(2)} (${t.min.toFixed(2)}..${t.max.toFixed(2)})`);
}
writeFileSync(file, JSON.stringify({ dir: DIR, runs: reps, shipMs: ship, table, removals }, null, 1));
console.log(`wrote ${file}`);
