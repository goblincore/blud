// scripts/native-spike/lean-ab.mjs
//
// THE LEAN WALK'S TIMING (docs/superpowers/specs/2026-11-09-march-lean-walk-design.md): captured `sdf:march`
// passes (capture.mjs) replayed in the lab Chrome (replay-chrome.mjs, exactly as ladder.mjs runs it), in
// ALTERNATION, with the order rotated each repeat. ladder.mjs edits one capture's shader text; this compares
// SEVERAL captures as recorded (flag off, flag on, flag on with the runtime switch held), so each leg is the
// program the game really compiled.
//
//   node scripts/native-spike/lean-ab.mjs <reps> name=<captureDir> name=<captureDir> ...
//
// The first named capture is the BASE. On this shared fanless machine absolute times drift by several ms over a
// session (LADDER.md, "Noise"), so the numbers that matter are each capture's difference from the base measured IN
// THE SAME REPEAT, and then the median / min / max of those paired differences over the repeats. A name given twice
// with the same directory (`off=<dir> off2=<dir>`) is the A/A control: its paired differences are the floor.
//
// Each capture is run once first, untimed (a cold Metal compile is tens of seconds): the seconds and its parity
// against the game's own readback of that frame (replay.html's check, the ladder's "identical" = 0 differing, max 0)
// are printed. Then <reps> rotations, SPIKE_REPEAT copies of the pass a submit (default 10) and SPIKE_ROUNDS rounds
// (default 15), the median of a run. Everything lands in `<first captureDir>-lean-ab.json`.
//
// CAPTURES for the three scenes (one boot each; SPIKE_QUERY and SPIKE_VARIANTS compose: the query is the boot URL,
// the variants are captures of that one staged frame). Under the GPU lock, LAB_TMP=.lab-tmp.
//
// THE HULL EXIT BOUND, two forms of every command. capture.mjs pins applyShipDefaults, which turns the bound OFF
// (the march-hash.mjs regime); the game SHIPS it on. The shipped-setting form adds the prelude
// XB='__sdfGame.setHullExitBound(true); __sdfGame.step(2);' (composed in front of any wound prelude: SPIKE_PRELUDE
// is evaluated as one script, the value of the last statement is ignored). NAMING CONVENTION: the capture
// directory ends in -xb0 (bound off) or -xb1 (bound on) before capture.mjs's -<variant> suffix, and lean-ab reads
// the setting back from each capture's manifest (meta.scene.prelude) into its label, so a number in the report or
// the JSON always says which setting it was taken with. A leg written name=<dir>#<text> adds free text to the label.
//
//   S='scripts/native-spike/servers.sh node scripts/native-spike/capture.mjs 5291 9291'
//   ON='on=__sdfGame.setLeanWalk(true);held=__sdfGame.setLeanWalk(false);census=__sdfGame.setMarchDebugMode(23)'
//   XB='__sdfGame.setHullExitBound(true); __sdfGame.step(2);'
//   WOUND='(() => { __sdfGame.setWoundTuning({ spillChance: 0 }); const m = __sdfGameDebug.normalCaptureState().camera; const r3 = (v) => Math.round(v * 1000) / 1000; const eye = [r3(m[12]), r3(m[13]), r3(m[14])]; let n = 0; for (const [a, b, kind] of [[0, 0, "slug"], [0.15, 0.1, "pellet"], [-0.12, -0.12, "pellet"]]) { let d = [0, 1, 2].map((i) => -m[8 + i] + a * m[i] + b * m[4 + i]); const L = Math.hypot(d[0], d[1], d[2]); d = d.map((v) => r3(v / L)); if (__sdfGame.stampWoundAt(eye[0], eye[1], eye[2], d[0], d[1], d[2], kind, 1)) n++; } __sdfGame.step(5); if (!n) throw new Error("no wound stamped on body 1"); return n; })()'
//   (WOUND: three shots at body 1, the close-up's body, from the eye along the view axis and beside it. march-hash.mjs's
//   fixed room1-wounded rays are for ITS page and missed on this one.)
//
//   # clean close-up (the ladder's frame): flag off; flag on with the switch released (-on) and held (-held)
//   LAB_TMP=.lab-tmp $S .scratch/lean/closeup-xb0-off
//   LAB_TMP=.lab-tmp SPIKE_QUERY=leanwalk SPIKE_VARIANTS="$ON" $S .scratch/lean/closeup-xb0
//   LAB_TMP=.lab-tmp SPIKE_PRELUDE="$XB" $S .scratch/lean/closeup-xb1-off
//   LAB_TMP=.lab-tmp SPIKE_PRELUDE="$XB" SPIKE_QUERY=leanwalk SPIKE_VARIANTS="$ON" $S .scratch/lean/closeup-xb1
//   # crowd (capture.mjs's SPIKE_SCENE=crowd: 12 zombies in room 1's far half)
//   LAB_TMP=.lab-tmp SPIKE_SCENE=crowd $S .scratch/lean/crowd-xb0-off
//   LAB_TMP=.lab-tmp SPIKE_SCENE=crowd SPIKE_QUERY=leanwalk SPIKE_VARIANTS="$ON" $S .scratch/lean/crowd-xb0
//   LAB_TMP=.lab-tmp SPIKE_SCENE=crowd SPIKE_PRELUDE="$XB" $S .scratch/lean/crowd-xb1-off
//   LAB_TMP=.lab-tmp SPIKE_SCENE=crowd SPIKE_PRELUDE="$XB" SPIKE_QUERY=leanwalk SPIKE_VARIANTS="$ON" $S .scratch/lean/crowd-xb1
//   # wounded close-up
//   LAB_TMP=.lab-tmp SPIKE_PRELUDE="$WOUND" $S .scratch/lean/wounded-xb0-off
//   LAB_TMP=.lab-tmp SPIKE_PRELUDE="$WOUND" SPIKE_QUERY=leanwalk SPIKE_VARIANTS="$ON" $S .scratch/lean/wounded-xb0
//   LAB_TMP=.lab-tmp SPIKE_PRELUDE="$XB $WOUND" $S .scratch/lean/wounded-xb1-off
//   LAB_TMP=.lab-tmp SPIKE_PRELUDE="$XB $WOUND" SPIKE_QUERY=leanwalk SPIKE_VARIANTS="$ON" $S .scratch/lean/wounded-xb1
//
// The flag-off and flag-on captures are separate boots, so they are separate stagings of the same frozen scene, and
// timing one against the other compares frames as well as programs. So the flag-off leg is the flag-on boot's FRAME
// replayed with the flag-off capture's PROGRAM: name=<frameDir>@<programDir>. The on / held pair is one frame, one
// boot. A census variant (census=__sdfGame.setMarchDebugMode(23), last in SPIKE_VARIANTS) records the per-pixel
// choice of that same frame: node scripts/native-spike/lean-census.mjs <dir>-census.
// Then, per scene and setting, with the base listed twice (the A/A control):
//
//   LAB_TMP=.lab-tmp scripts/native-spike/servers.sh node scripts/native-spike/lean-ab.mjs 6 \
//     off=.scratch/lean/closeup-xb1-on@.scratch/lean/closeup-xb1-off off2=.scratch/lean/closeup-xb1-on@.scratch/lean/closeup-xb1-off \
//     on=.scratch/lean/closeup-xb1-on held=.scratch/lean/closeup-xb1-held
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPS = Number(process.argv[2]);
const LEGS = process.argv.slice(3).map((a) => {
  const i = a.indexOf('=');
  if (i <= 0) throw new Error(`lean-ab: expected name=<captureDir>, got ${a}`);
  const [spec, note = ''] = a.slice(i + 1).split('#');
  const [dir, shaderFrom = ''] = spec.split('@');
  return { name: a.slice(0, i), dir, shaderFrom, note };
});
if (!(REPS > 0) || LEGS.length < 2) {
  console.error('usage: node scripts/native-spike/lean-ab.mjs <reps> base=<captureDir> name=<captureDir> ...');
  process.exit(2);
}
if (new Set(LEGS.map((l) => l.name)).size !== LEGS.length) throw new Error('lean-ab: leg names must be distinct');
const REPEAT = process.env.SPIKE_REPEAT ?? '10';
const ROUNDS = process.env.SPIKE_ROUNDS ?? '15';
const CDP = process.env.LAB_CDP_PORT ?? '9291';
const BASE = LEGS[0].name;

// Each capture's label: what its manifest says it was staged with (capture.mjs's meta.scene), the hull exit bound
// read from the prelude, and the leg's free text. The setting is in every printed line and in the JSON.
for (const leg of LEGS) {
  const mf = join(leg.dir, 'manifest.json');
  if (!existsSync(mf)) throw new Error(`lean-ab: no capture at ${leg.dir}`);
  const sc = JSON.parse(readFileSync(mf, 'utf8')).meta?.scene ?? {};
  const xb = /setHullExitBound\(\s*true\s*\)/.test(sc.prelude ?? '') ? 1 : 0;
  leg.hullExitBound = xb === 1;
  leg.scene = { scene: sc.scene, query: sc.query, variant: sc.variant?.name ?? '', prelude: sc.prelude ?? '' };
  leg.label = [`${sc.scene ?? '?'}`, sc.query ? `?${sc.query}` : 'no flag', sc.variant?.name || null, `xb${xb}`, leg.note || null].filter(Boolean).join(' ');
}

// name=<dir>@<shaderDir>: replay <dir>'s FRAME with <shaderDir>'s march PROGRAM (the shader module that declares
// mapBody), so two programs are timed on one staged frame. Two boots do not stage the same frame (capture.mjs), and a
// flag-off capture against a flag-on one compares frames as well as programs; this compares programs only. The two
// texts may differ only in the lean walk's own lines (checked), so every binding the frame carries still fits.
const marchModules = (manifest) => Object.values(manifest.objects).filter((o) => o.kind === 'shaderModule' && /\bfn mapBody\b/.test(o.desc.code));
// Lines of one text missing from the other, both ways. The flag-off and flag-on texts of one program differ by the
// two call lines (off only) and by mapLean, the per-pixel test and the census (on only): about 60 lines of 5000 (two variants of the march differ by 75 or more).
const textDistance = (x, y) => {
  const a = new Set(x.split('\n')), b = new Set(y.split('\n'));
  let n = 0;
  for (const l of a) if (!b.has(l)) n++;
  for (const l of b) if (!a.has(l)) n++;
  return n;
};
for (const leg of LEGS) {
  leg.manifest = 'manifest.json';
  if (!leg.shaderFrom) continue;
  const manifest = JSON.parse(readFileSync(join(leg.dir, 'manifest.json'), 'utf8'));
  const theirs = marchModules(JSON.parse(readFileSync(join(leg.shaderFrom, 'manifest.json'), 'utf8'))).map((o) => o.desc.code);
  const mine = marchModules(manifest);
  if (mine.length === 0 || mine.length !== theirs.length) throw new Error(`lean-ab: ${leg.name}: ${leg.dir} has ${mine.length} march programs, ${leg.shaderFrom} has ${theirs.length}`);
  // A crowd frame draws several march programs (one per crowd type and material variant): each takes its nearest
  // counterpart, which must be that near and must be taken once.
  const taken = new Set();
  leg.swapped = [];
  for (const mod of mine) {
    let best = -1, bestD = Infinity;
    theirs.forEach((code, i) => { const d = textDistance(mod.desc.code, code); if (d < bestD) { bestD = d; best = i; } });
    if (bestD > 70) throw new Error(`lean-ab: ${leg.name}: a march program of ${leg.dir} has no counterpart in ${leg.shaderFrom} (nearest differs in ${bestD} lines)`);
    if (taken.has(best)) throw new Error(`lean-ab: ${leg.name}: two march programs of ${leg.dir} map to one of ${leg.shaderFrom}`);
    taken.add(best);
    leg.swapped.push({ lines: bestD, bytes: [mod.desc.code.length, theirs[best].length] });
    mod.desc.code = theirs[best];
  }
  leg.manifest = `manifest.${leg.name}.json`;
  writeFileSync(join(leg.dir, leg.manifest), JSON.stringify(manifest));
  leg.label = `${leg.label} [frame of ${leg.dir}, program of ${leg.shaderFrom}]`;
}

// replay-chrome.mjs exits 1 when the replay reported errors; its JSON line is still the last line of stdout.
const run = (leg, repeat = REPEAT, rounds = ROUNDS) => {
  let out;
  try {
    out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, leg.dir, repeat, rounds, leg.manifest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = String(e.stdout ?? '');
    if (!out.trim()) throw new Error(`lean-ab: ${leg.name} replay failed: ${String(e.stderr || e.message).slice(0, 600)}`);
  }
  return JSON.parse(out.trim().split('\n').pop());
};

// Warm each capture once: the cold compile, and the parity of the replay against the game's own readback.
const info = {};
for (const leg of LEGS) {
  const t0 = Date.now();
  const res = run(leg, '2', '2');
  const p = res.parity?.[0] ?? {};
  info[leg.name] = { dir: leg.dir, warmS: (Date.now() - t0) / 1000, parity: res.parity, errors: res.errors };
  console.log(`warm ${leg.name.padEnd(10)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  differing ${(100 * (p.differingFrac ?? NaN)).toFixed(2)} %  max ${(p.maxDiff ?? NaN).toPrecision(3)}  [${leg.label}] ${leg.dir}${res.errors?.length ? `  ERRORS ${res.errors[0].slice(0, 200)}` : ''}`);
  if (res.errors?.length) { console.error(`lean-ab: ${leg.name} replays with errors; nothing timed`); process.exit(1); }
}

// Rotations: repeat r starts at leg r (mod n), so no leg is always first (coolest) or last.
const reps = [];
for (let rep = 0; rep < REPS; rep++) {
  const order = LEGS.map((_, i) => LEGS[(i + rep) % LEGS.length]);
  const row = { rep: rep + 1, order: order.map((l) => l.name), ms: {}, minMs: {} };
  for (const leg of order) {
    const res = run(leg);
    row.ms[leg.name] = res.medianMs;
    row.minMs[leg.name] = res.minMs;
  }
  row.diff = Object.fromEntries(LEGS.slice(1).map((l) => [l.name, row.ms[l.name] - row.ms[BASE]]));
  reps.push(row);
  console.log(`  rep ${String(rep + 1).padStart(2)}  ${LEGS.map((l) => `${l.name} ${row.ms[l.name].toFixed(2)}${l.name === BASE ? '' : ` (${row.diff[l.name] >= 0 ? '+' : ''}${row.diff[l.name].toFixed(2)})`}`).join('  ')}`);
}

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const baseMed = med(reps.map((r) => r.ms[BASE]));
const table = [];
console.log(`\nthe paired differences: each repeat's leg median minus ${BASE}'s in the same repeat (base median ${baseMed.toFixed(2)} ms)`);
console.log(`${'leg'.padEnd(10)}${'median ms'.padStart(10)}${'range of medians'.padStart(18)}${'diff med'.padStart(10)}${'min'.padStart(8)}${'max'.padStart(8)}${'med %'.padStart(8)}${'min %'.padStart(8)}${'max %'.padStart(8)}`);
for (const leg of LEGS) {
  const m = reps.map((r) => r.ms[leg.name]);
  const row = { leg: leg.name, label: leg.label, hullExitBound: leg.hullExitBound, dir: leg.dir, medianMs: med(m), lo: Math.min(...m), hi: Math.max(...m) };
  if (leg.name !== BASE) {
    const d = reps.map((r) => r.diff[leg.name]);
    Object.assign(row, { diffMedianMs: med(d), diffMinMs: Math.min(...d), diffMaxMs: Math.max(...d) });
    Object.assign(row, { diffMedianPct: 100 * row.diffMedianMs / baseMed, diffMinPct: 100 * row.diffMinMs / baseMed, diffMaxPct: 100 * row.diffMaxMs / baseMed });
  }
  table.push(row);
  const f = (v, n = 2) => (v === undefined ? '' : `${v >= 0 ? '+' : ''}${v.toFixed(n)}`);
  console.log(`${leg.name.padEnd(10)}${row.medianMs.toFixed(2).padStart(10)}${`${row.lo.toFixed(2)}..${row.hi.toFixed(2)}`.padStart(18)}`
    + `${f(row.diffMedianMs).padStart(10)}${f(row.diffMinMs).padStart(8)}${f(row.diffMaxMs).padStart(8)}${f(row.diffMedianPct, 1).padStart(8)}${f(row.diffMinPct, 1).padStart(8)}${f(row.diffMaxPct, 1).padStart(8)}  ${leg.label}`);
}
const file = `${LEGS[0].dir.replace(/\/+$/, '')}-lean-ab.json`;
writeFileSync(file, JSON.stringify({ reps: REPS, repeat: Number(REPEAT), rounds: Number(ROUNDS), base: BASE, legs: LEGS, baseMedianMs: baseMed, table, runs: reps, info }, null, 1));
console.log(`\nwrote ${file}`);
