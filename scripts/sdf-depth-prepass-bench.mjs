// scripts/sdf-depth-prepass-bench.mjs — close-up task 3 timing, taken AFTER
// the census (a faster frame that has deleted a body is not a result).
//
// Legs: prepass off (ship default) vs on, interleaved, fresh page per run,
// ship defaults pinned + GAME_HULL_EXIT_BOUND on (task 1b shipped it — the
// baseline is the CURRENT ship state, not the pre-1b one). Wounded
// fill-screen staging is the headline (Question A: the walk is 41% of that
// frame); rooms 3/4 standoff are the multi-body views.
//
// Each leg reports the GPU-fenced closeup throughput (p50/mean) AND the
// occupancy steps read right before timing (mode 4, depth-winner caveat: it
// records only the winning fragment's walk, so where proxy boxes overlap the
// step numbers are indicative, not exact — the census owns correctness).
//
// Usage: node scripts/sdf-depth-prepass-bench.mjs 5397 9397 [scene]
//   scene: closeup (default) | room3 | room4
import { mkdirSync, writeFileSync } from 'node:fs';
import { runInterleaved } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5397);
const CDP = Number(process.argv[3] ?? 9397);
const SCENE = process.argv[4] ?? 'closeup';
const OUT = process.env.BENCH_OUT ?? '/tmp/sdf-depth-prepass-bench';
const REPS = Number(process.env.BENCH_REPS ?? 6);
mkdirSync(OUT, { recursive: true });

const roomStageJs = (room) => `
  __sdfGame.teleport(${room});
  const rc = __sdfGame.pose().pos;
  const mine = __sdfGame.zombies().filter(q => q.room === ${room});
  if (!mine.length) return { error: 'no bodies in room ${room}' };
  const cx = mine.reduce((n, z) => n + z.pos[0], 0) / mine.length;
  const cz = mine.reduce((n, z) => n + z.pos[2], 0) / mine.length;
  __sdfGame.freeze(true);
  const dx = cx - rc[0], dz = cz - rc[2];
  const len = Math.hypot(dx, dz) || 1;
  const px = cx + (dx / len) * 4.0, pz = cz + (dz / len) * 4.0;
  __sdfGame.setPose(px, pz, Math.atan2(cx - px, -(cz - pz)), Math.atan2(1.0 - 1.62, Math.hypot(cx - px, cz - pz)), 0);
  __sdfGame.step(3);
  return { d: 'room${room}-standoff', cov: null, body: mine.length };
`;

const opts = {
  vite: VITE, cdp: CDP, width: 1280, height: 800,
  url: `http://localhost:${VITE}/sdf-game.html?frozen=1&bench=${SCENE}`,
  crashRetries: 3,
  loadGate: { maxRise: 8, maxAbs: 24 },
  wounds: true,
  ...(SCENE === 'closeup' ? {} : { stageJs: roomStageJs(SCENE === 'room3' ? 3 : 4) }),
};

const legs = {
  off: { flat: false, exitBound: true, legJs: '__sdfGame.setDepthPrepass(false);' },
  on: { flat: false, exitBound: true, legJs: '__sdfGame.setDepthPrepass(true);' },
};

const r = await runInterleaved(legs, REPS, opts);

// medians per leg
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const summary = {};
for (const leg of Object.keys(legs)) {
  const rows = r.rows.filter((x) => x.leg === leg);
  summary[leg] = {
    kept: rows.length,
    p50: median(rows.map((x) => x.p50)),
    mean: median(rows.map((x) => x.mean)),
    p95: median(rows.map((x) => x.p95)),
    meanStepsHit: median(rows.map((x) => x.meanStepsHit)),
    missStepShare: median(rows.map((x) => x.missStepShare)),
    cov: median(rows.map((x) => x.coverage)),
    bodies: median(rows.map((x) => x.bodies)),
    loads: rows.map((x) => +x.load1.toFixed(1)),
  };
}
const offP = summary.off.p50, onP = summary.on.p50;
console.log(`\n=== ${SCENE} — prepass off vs on (interleaved, ${REPS} reps, ${r.loadRejected} load-rejected, ${r.crashRetries} crash retries) ===`);
console.log(`off: p50 ${offP?.toFixed(2)} ms  mean ${summary.off.mean?.toFixed(2)}  msh ${summary.off.meanStepsHit}  cov ${summary.off.cov}`);
console.log(`on : p50 ${onP?.toFixed(2)} ms  mean ${summary.on.mean?.toFixed(2)}  msh ${summary.on.meanStepsHit}  cov ${summary.on.cov}`);
console.log(`delta p50: ${offP != null && onP != null ? ((onP - offP)).toFixed(2) : 'n/a'} ms (${offP ? (((onP - offP) / offP) * 100).toFixed(1) : '?'}%)`);
console.log('loads per row:', JSON.stringify({ off: summary.off.loads, on: summary.on.loads }));

writeFileSync(`${OUT}/bench-${SCENE}.json`, JSON.stringify({ when: new Date().toISOString(), scene: SCENE, reps: REPS, summary, rows: r.rows, crashRetries: r.crashRetries, loadRejected: r.loadRejected }, null, 2));
console.log(`wrote ${OUT}/bench-${SCENE}.json`);
process.exit(0);
