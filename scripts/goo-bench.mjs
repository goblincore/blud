// scripts/goo-bench.mjs — close-up task 4 (the goo layer): Phase-0 per-pass
// attribution and the per-item A/B, on the live firefight.
//
// PHASE 0 (attribution). Legs on the SAME firefight script (room 4:
// walk → fire → gib), interleave + fresh page per run, load-gated:
//
//   goo-off     setGoo(false)            — the layer out of the frame path
//   ship        nothing                  — the shipped chain
//   no-surface  passGate.surface=false   — density+blur only
//   no-density  passGate.density=false   — blur+surface only
//   blur-on     blurPx 2.5               — the two blur passes added
//
// Per-pass costs are the deltas per segment; the walk segment (no blood yet)
// is the idle frame. Coverage is read from the density target after each run
// (gooProbe: nonZero fraction, mean, max) alongside the particle census, so
// every cost row carries its covered-area and count — the "area, not count"
// question is answered by correlating across rooms/segments and by the
// `bigblobs` leg (sizeScale doubled: same count, ~4x blob area).
//
// AB (items). --item=surface|minmax|fade runs just the on/off pair for that
// item, same machinery:
//   surface  setGooPerf({ surfaceAtDensityRes: true })
//   minmax   setGooPerf({ minTexelRadius: 1, areaPriority: true })
//   fade     setGooPerf({ splatFadeTail: 128 })
//
// Usage:
//   LAB_VITE_PORT=5397 LAB_CDP_PORT=9397 node scripts/goo-bench.mjs 5397 9397 phase0
//   ... node scripts/goo-bench.mjs 5397 9397 ab --item=surface
import { mkdirSync, writeFileSync } from 'node:fs';
import { runInterleaved } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5397);
const CDP = Number(process.argv[3] ?? 9397);
const MODE = process.argv[4] ?? 'phase0';
const ITEM = (process.argv.find((a) => a.startsWith('--item=')) ?? '--item=surface').split('=')[1];
const OUT = process.env.BENCH_OUT ?? '/tmp/sdf-goo';
const REPEATS = Number(process.env.BENCH_REPEATS ?? 5);
const W = 1280, H = 800;
const ROOM = Number(process.env.GOO_ROOM ?? 4);

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const WATCHDOG_MIN = Number(process.env.BENCH_WATCHDOG_MIN ?? 75);
const CLOSE = process.argv.includes('--close');
const FLOOR = process.argv.includes('--floor');
setTimeout(() => { console.error(`FAIL: watchdog (${WATCHDOG_MIN} min)`); process.exit(3); }, WATCHDOG_MIN * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;
console.log(`goo-bench ${MODE}${MODE === 'ab' ? ` item=${ITEM}` : ''} ${url}  room=${ROOM} repeats=${REPEATS}`);

// The firefight script: walk (idle — the sim is still empty), fire (impact
// gouts + wound emitters begin), gib (slug severs: chunks, trails, stump
// gush, splat accumulation). One barrel every 40 frames (the measured
// schedule — see game-bench-scenario.ts), one slug.
const BENCH = { kind: 'firefight', room: ROOM, walkFrames: 120, fireFrames: 120, gibFrames: 150 };

// --close / --floor: the SPEC's scene is the close-up (room-4 gameplay range
// carries ~1% goo coverage, and the phase-0 legs there moved less than their
// own spread). Same legs and seam machinery; the STAGING swaps to a
// deterministic close-range state and the bench falls back to the harness's
// closeup defaults (freeze at frame 0, no actions, 240 frames). Mirrors
// goo-capture.mjs's STAGE.burst / STAGE.floor so bench rows and captures
// photograph the same scene. closeupFrames 240 ≈ 4 s of spray decay.
const CLOSE_STAGE = `
  __sdfGame.teleport(1);
  const z = __sdfGame.zombies().find(q => q.room === 1);
  if (!z) return { error: 'no body in room 1' };
  const d = 1.1;
  __sdfGame.setPose(z.pos[0], z.pos[2] + d, 0, 0.05, 0);
  __sdfGame.step(10);
  __sdfGame.fireSlug();
  __sdfGame.step(12);
  __sdfGame.setBleed(true);
  __sdfGame.setGoo(true);
  __sdfGame.step(14);
  return { scene: 'burst-close', dist: d };
`;
const FLOOR_STAGE = `
  __sdfGame.teleport(1);
  const z = __sdfGame.zombies().find(q => q.room === 1);
  if (!z) return { error: 'no body in room 1' };
  __sdfGame.setPose(z.pos[0], z.pos[2] + 2.2, 0, -0.15, 0);
  __sdfGame.step(5);
  const base = __sdfGame.pose();
  let stamped = 0;
  for (let k = 0; k < 12; k++) {
    const yaw = base.yaw + (k - 5.5) * 0.045;
    __sdfGame.setPose(base.pos[0], base.pos[2], yaw, base.pitch, 0);
    const p = __sdfGame.predictSlugHit();
    if (p.actorId < 0 || !p.hit) continue;
    if (__sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
      p.dir[0], p.dir[1], p.dir[2], 'slug', p.actorId)) stamped++;
    __sdfGame.step(30);
  }
  __sdfGame.step(2400);
  __sdfGame.setGoo(true);
  __sdfGame.setPose(base.pos[0], base.pos[2], base.yaw, -0.35, 0);
  __sdfGame.step(3);
  return { scene: 'floor-close', stamped, splats: __sdfGame.bleed.splats, droplets: __sdfGame.bleed.droplets };
`;

// Every leg: no closeup staging (the firefight stages itself), flat albedo
// OFF, and its own seam application in legJs.
const noStage = { wounds: false, flat: false, stageJs: 'return { d: null, cov: null, body: null, scene: "firefight" };' };
const LEGS = (CLOSE || FLOOR ? closeLegs() : MODE === 'ab' ? abLegs() : phase0Legs());
function abLegs() {
  const on = {
    ...noStage, benchArgs: BENCH,
    legJs: ITEM === 'surface' ? '__sdfGame.setGooPerf({ surfaceAtDensityRes: true });'
      : ITEM === 'minmax' ? '__sdfGame.setGooPerf({ minTexelRadius: 1, areaPriority: true });'
      : '__sdfGame.setGooPerf({ splatFadeTail: 128 });',
  };
  return { off: { ...noStage, benchArgs: BENCH }, on };
}
function phase0Legs() {
  return {
    goooff:     { ...noStage, benchArgs: BENCH, legJs: '__sdfGame.setGoo(false);' },
    ship:       { ...noStage, benchArgs: BENCH },
    nosurface:  { ...noStage, benchArgs: BENCH, legJs: '__sdfGame.setGooPerf({ passGate: { surface: false } });' },
    nodensity:  { ...noStage, benchArgs: BENCH, legJs: '__sdfGame.setGooPerf({ passGate: { density: false } });' },
    bluron:     { ...noStage, benchArgs: BENCH, legJs: '__sdfGame.setGooTuning({ blurPx: 2.5 });' },
    bigblobs:   { ...noStage, benchArgs: { ...BENCH, room: 2 }, legJs: '__sdfGame.setGooTuning({ sizeScale: 0.28 });' },
  };
}
// Close-range variants: benchArgs pin a SHORT warmup-free window — the
// staged burst decays in ~1.5 s, and the default warmup 120 + closeupFrames
// 240 measured only the decayed tail (first run: drop 2, cov 0.1% — the
// spray was gone before sampling began). warmup 10 + 80 frames ≈ 1.3 s of
// peak-to-early-decay spray; the floor stage is the STEADY heavy state.
function closeBench() { return { kind: 'closeup', mode: 'throughput', warmup: 10, chunkFrames: 10, closeupFrames: 80 }; }
function closeLegs() {
  const base = () => ({ ...noStage, benchArgs: closeBench() });
  if (MODE === 'ab') {
    const on = { ...base(), legJs: ITEM === 'surface' ? '__sdfGame.setGooPerf({ surfaceAtDensityRes: true });'
      : ITEM === 'minmax' ? '__sdfGame.setGooPerf({ minTexelRadius: 1, areaPriority: true });'
      : '__sdfGame.setGooPerf({ splatFadeTail: 128 });' };
    return { off: base(), on };
  }
  return {
    goooff:     { ...base(), legJs: '__sdfGame.setGoo(false);' },
    ship:       base(),
    nosurface:  { ...base(), legJs: '__sdfGame.setGooPerf({ passGate: { surface: false } });' },
    nodensity:  { ...base(), legJs: '__sdfGame.setGooPerf({ passGate: { density: false } });' },
    bluron:     { ...base(), legJs: '__sdfGame.setGooTuning({ blurPx: 2.5 });' },
  };
}

let out;
try {
  out = await runInterleaved(LEGS, REPEATS, {
    url,
    vite: VITE, cdp: CDP, width: W, height: H,
    crashRetries: 3,
    loadGate: { maxRise: 8.0, maxAbs: 24.0 },
    minKept: REPEATS,
    makeupCap: 3,
    ...(CLOSE || FLOOR ? { stageJs: FLOOR ? FLOOR_STAGE : CLOSE_STAGE } : {}),
    onRow: async (row, { evaluate: ev }) => {
      // Post-run readback on the LAST benched frame: the density field's
      // covered area (the "area, not count" axis) and the sim census.
      // Runtime.evaluate has no top-level await — the bare `await` version of
      // this threw a syntax error that the .catch swallowed as `cov ?` on
      // every row. Wrap it; keep it single-line (the multiline-evaluate trap).
      const probe = await ev('(async () => JSON.stringify(await __sdfGame.gooProbe()))()').then(JSON.parse).catch(() => null);
      const bleed = await ev('JSON.stringify(__sdfGame.bleed)').then(JSON.parse).catch(() => null);
      const goo = await ev('JSON.stringify(__sdfGame.goo)').then(JSON.parse).catch(() => null);
      row.probe = probe && {
        covFrac: +((probe.density.nonZero / (probe.density.w * probe.density.h)) * 1).toFixed(5),
        meanDens: +probe.density.mean.toFixed(4),
        maxDens: +probe.density.max.toFixed(2),
      };
      row.droplets = bleed?.droplets ?? null;
      row.splats = bleed?.splats ?? null;
      row.liveCount = goo?.liveCount ?? null;
      process.stdout.write(`  rep${row.rep} ${row.leg}: p50 ${row.p50.toFixed(2)}  cov ${row.probe ? (row.probe.covFrac * 100).toFixed(1) + '%' : '?'}  live ${row.liveCount}  drop ${row.droplets}  splat ${row.splats}  uptime ${row.uptime.toFixed(0)}s  load ${row.load1Start.toFixed(1)}→${row.load1.toFixed(1)}\n`);
    },
  });
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
const { rows, crashRetries, loadRejected, makeupReps, kept } = out;
console.log(`\nstability: kept ${JSON.stringify(kept)}  crashRetries ${crashRetries}  loadRejected ${loadRejected}  makeupReps ${makeupReps}`);

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const SEGNAMES = [...new Set(rows.flatMap((r) => Object.keys(r.segs ?? {})))];
const summary = {};
for (const leg of Object.keys(LEGS)) {
  const rs = rows.filter((r) => r.leg === leg);
  if (rs.length === 0) { console.warn(`  (leg ${leg}: zero rows survived)`); continue; }
  summary[leg] = {};
  for (const seg of SEGNAMES) {
    const vals = rs.map((r) => r.segs?.[seg]?.p50).filter((v) => v != null);
    if (vals.length) summary[leg][seg] = { p50: med(vals), min: Math.min(...vals), max: Math.max(...vals), spread: +(((Math.max(...vals) - Math.min(...vals)) / Math.min(...vals)) * 100).toFixed(1) };
  }
  summary[leg].cov = med(rs.map((r) => r.probe?.covFrac).filter((v) => v != null));
  summary[leg].live = med(rs.map((r) => r.liveCount).filter((v) => v != null));
  summary[leg].droplets = med(rs.map((r) => r.droplets).filter((v) => v != null));
  summary[leg].splats = med(rs.map((r) => r.splats).filter((v) => v != null));
}

console.log(`\n## per-segment p50 (ms)${MODE === 'ab' ? ` — item ${ITEM}` : ''}`);
for (const [leg, s] of Object.entries(summary)) {
  const segStr = SEGNAMES.map((k) => `${k} ${s[k] ? `${s[k].p50.toFixed(2)} [${s[k].min.toFixed(2)}..${s[k].max.toFixed(2)}] sp${s[k].spread}%` : '—'}`).join('  ');
  console.log(`  ${leg.padEnd(10)} ${segStr}  cov ${s.cov != null ? (s.cov * 100).toFixed(1) + '%' : '?'}  live ${s.live}  drop ${s.droplets}  splat ${s.splats}`);
}
if (MODE === 'phase0') {
  const d = (a, b, seg) => summary[a]?.[seg]?.p50 != null && summary[b]?.[seg]?.p50 != null
    ? +(summary[a][seg].p50 - summary[b][seg].p50).toFixed(2) : null;
  console.log('\n## attribution (deltas of p50, ms)');
  for (const seg of SEGNAMES) {
    const shipSeg = summary.ship?.[seg]?.p50;
    if (shipSeg == null) continue;
    const parts = [
      `fixed+density ${d('ship', 'goooff', seg)}`,
      `surface ${d('ship', 'nosurface', seg)}`,
      `density ${d('ship', 'nodensity', seg)}`,
      `blur ${d('bluron', 'ship', seg)}`,
    ];
    console.log(`  ${seg.padEnd(5)} ship ${shipSeg.toFixed(2)}  |  ${parts.join('  ')}`);
  }
  console.log('\n## area-vs-count (correlate cost with covFrac and live/droplets)');
  for (const [leg, s] of Object.entries(summary)) {
    const segName = SEGNAMES.find((k) => s[k] != null);
    if (!segName) continue;
    console.log(`  ${leg.padEnd(10)} ${segName} ${s[segName].p50.toFixed(2)} ms  cov ${(s.cov * 100).toFixed(1)}%  live ${s.live}  drop ${s.droplets}`);
  }
}
const file = `${OUT}/goo-${MODE}${MODE === 'ab' ? `-${ITEM}` : ''}${CLOSE ? '-close' : ''}${FLOOR ? '-floor' : ''}.json`;
writeFileSync(file, JSON.stringify({ meta: { url, MODE, ITEM, ROOM, repeats: REPEATS, when: new Date().toISOString(), bench: BENCH }, rows, summary, stability: { kept, crashRetries, loadRejected, makeupReps } }, null, 2));
console.log(`\nwrote ${file}`);
process.exit(0);
