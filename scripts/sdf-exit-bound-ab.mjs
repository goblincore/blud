// scripts/sdf-exit-bound-ab.mjs — STEP 3's timing half (close-up task 1b).
// Runs ONLY after scripts/sdf-exit-bound-census.mjs has come back CLEAN:
// census first, timing second. Bound OFF vs ON, interleaved, frozen room-4
// standoff scene (the multi-body view where r2 measured the win and the
// census killed the feature). Two legs, not four — the lever has exactly two
// states — with the same load-gate discipline as the close-up bench (the
// library's stable mode): min of 4 kept reps per leg, rejected rows re-run in
// counted makeup reps.
//
// The counters are part of the verdict and are load-immune: the timing rows
// carry occupancy's missStepShare/meanStepsHit alongside p50, so a noisy
// timing table can still be judged against a counter that cannot hear the
// machine.
//
// Usage: LAB_VITE_PORT=5389 LAB_CDP_PORT=9389 node scripts/sdf-exit-bound-ab.mjs 5389 9389
import { mkdirSync, writeFileSync } from 'node:fs';
import { runInterleaved } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5389);
const CDP = Number(process.argv[3] ?? 9389);
const OUT = process.env.AB_OUT ?? '/tmp/sdf-exit-ab';
const REPEATS = Number(process.env.BENCH_REPEATS ?? 4);
const W = 1280, H = 800;

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (30 min)'); process.exit(3); }, 30 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;
console.log(`exit-bound A/B ${url}  (repeats=${REPEATS})`);

// Room-4 standoff — the census's own staging (bodies frozen at spawn, camera
// 4 m beyond the group facing it). NOT the room centre: the bare teleport
// drops the player inside the spawn cluster where the mode-4 depth-winner
// bias makes the occupancy readback blind (see the census driver's header).
const STAGE_JS = `
  __sdfGame.teleport(4);
  const rc = __sdfGame.pose().pos;
  const mine = __sdfGame.zombies().filter(q => q.room === 4);
  if (!mine.length) return { error: 'no bodies in room 4' };
  const cx = mine.reduce((n, z) => n + z.pos[0], 0) / mine.length;
  const cz = mine.reduce((n, z) => n + z.pos[2], 0) / mine.length;
  __sdfGame.freeze(true);
  const dx = cx - rc[0], dz = cz - rc[2];
  const len = Math.hypot(dx, dz) || 1;
  const px = cx + (dx / len) * 4.0, pz = cz + (dz / len) * 4.0;
  __sdfGame.setPose(px, pz, Math.atan2(cx - px, -(cz - pz)), Math.atan2(1.0 - 1.62, Math.hypot(cx - px, cz - pz)), 0);
  return { ok: true, player: [px, pz], centroid: [cx, cz] };
`;

const LEGS = {
  'bound-off': { wounds: false, flat: false, exitBound: false },
  'bound-on': { wounds: false, flat: false, exitBound: true },
};

let out;
try {
  out = await runInterleaved(LEGS, REPEATS, {
    url,
    vite: VITE, cdp: CDP, width: W, height: H,
    stageJs: STAGE_JS,
    crashRetries: 3,
    loadGate: { maxRise: 8.0, maxAbs: 24.0 },
    minKept: REPEATS,
    makeupCap: 3,
    onRow: async (row) => {
      process.stdout.write(`  rep${row.rep} ${row.leg}: p50 ${row.p50.toFixed(2)} ms  missStepShare ${row.missStepShare.toFixed(4)}  meanStepsHit ${row.meanStepsHit.toFixed(2)}  bodies ${row.bodies}  load ${row.load1Start.toFixed(1)}→${row.load1.toFixed(1)}\n`);
    },
  });
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
const { rows, crashRetries, loadRejected, makeupReps, kept } = out;
console.log(`\nstability: kept ${JSON.stringify(kept)}  crashRetries ${crashRetries}  loadRejected ${loadRejected}  makeupReps ${makeupReps}`);

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const summary = {};
for (const leg of Object.keys(LEGS)) {
  const rs = rows.filter((r) => r.leg === leg);
  if (rs.length === 0) fail(`leg ${leg}: zero rows survived the load gate`);
  const vals = rs.map((r) => r.p50);
  summary[leg] = {
    p50: med(vals), min: Math.min(...vals), max: Math.max(...vals),
    spreadPct: ((Math.max(...vals) - Math.min(...vals)) / Math.min(...vals)) * 100,
    missStepShare: med(rs.map((r) => r.missStepShare)),
    meanStepsHit: med(rs.map((r) => r.meanStepsHit)),
    bodies: rs[0].bodies,
    load1: med(rs.map((r) => r.load1)),
  };
  const s = summary[leg];
  console.log(`  ${leg.padEnd(10)} p50 ${s.p50.toFixed(2)} ms  [${s.min.toFixed(2)}..${s.max.toFixed(2)}]  spread ${s.spreadPct.toFixed(1)}%  missStepShare ${s.missStepShare}  meanStepsHit ${s.meanStepsHit}  bodies ${s.bodies}  load ${s.load1.toFixed(1)}`);
}

writeFileSync(`${OUT}/exit-bound-ab.json`, JSON.stringify({
  url, W, H, repeats: REPEATS, when: new Date().toISOString(),
  stability: { kept, crashRetries, loadRejected, makeupReps }, rows, summary,
}, null, 2));
console.log(`\nwrote ${OUT}/exit-bound-ab.json`);
process.exit(0);
