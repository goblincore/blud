// scripts/zombie-hands-bench.mjs — what a zombie hand design costs, A/B by alternation (zombie hands redo, 2026-11-22).
//
// The owner's third reason for rejecting the mesh grabber hands (2026-11-22) was "the game feels slower". This prices
// a hand design in the place it bites: the arena (`?level=arena&spawn=zombie`, one big lit room) with a CROWD of
// zombies spawned round the player (`__sdfGame.spawnCrowd`), LIVE (the sim ticks, so kit pose, light picks and actor
// CPU are in the number; a frozen bench never sees them -- dualmem warning, 2026-09-25).
//
// TREES ARE LEGS. Each leg is a dev server on its own port serving one worktree (e.g. the kit at 3ecac0b60 and this
// branch). Legs ALTERNATE round by round (A B A B ...), each a fresh page boot, so a thermal or load drift lands on both.
// Per leg: boot-to-ready seconds (pipeline prewarm + kit loads), then __sdfGame.bench in 'passes' mode with the player
// held and no shots: the fenced frame, every GPU pass by label and the CPU's tick/draw phases.
//
//   node scripts/zombie-hands-bench.mjs <cdpPort> <name>@<vitePort> <name>@<vitePort> ...
// Env: ROUNDS (4), CROWD (12), SPACING (1.1), DIST (3.2: player to the crowd's near edge), OUT (.lab-tmp/hands-bench),
//   LOAD_MAX (6: each leg waits for the 1-minute load average to fall to it; the row records it before and after)
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { connectGame, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const CDP = Number(process.argv[2]);
const LEGS = process.argv.slice(3).map((s) => { const [name, port] = s.split('@'); return { name, port: Number(port) }; });
const ROUNDS = Number(process.env.ROUNDS ?? 4);
const CROWD = Number(process.env.CROWD ?? 12);
const SPACING = Number(process.env.SPACING ?? 1.1);
const DIST = Number(process.env.DIST ?? 3.2);
const OUT = process.env.OUT ?? '.lab-tmp/hands-bench';
const LOAD_MAX = Number(process.env.LOAD_MAX ?? 6);
mkdirSync(OUT, { recursive: true });
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
if (!CDP || LEGS.length < 1) fail('usage: node scripts/zombie-hands-bench.mjs <cdpPort> name@port ...');

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };

const { send, evaluate } = await connectGame({ vite: LEGS[0].port, cdp: CDP, width: 1280, height: 800, onFail: fail });

async function runLeg(leg, round) {
  // LOAD GATE: other work on this machine swings a leg by 2x; wait (at most 10 min) for the 1-minute load to settle.
  for (const t0 = Date.now(); loadavg()[0] > LOAD_MAX && Date.now() - t0 < 600000;) await sleep(5000);
  const load0 = loadavg()[0];
  const t0 = Date.now();
  await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${leg.port}/sdf-game.html?level=arena&spawn=zombie&seed=1` });
  for (let i = 0; i < 600; i++) {
    if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') === 'ready') break;
    await sleep(500);
  }
  const bootSec = (Date.now() - t0) / 1000;
  // The crowd, then the player DIST m back from its near edge, facing its middle.
  const staged = JSON.parse(await evaluate(`(() => {
    const r = __sdfGame.spawnCrowd('zombie', ${CROWD}, { spacing: ${SPACING} });
    const a = __sdfGame.actorTrace();
    let cx = 0, cz = 0, minZ = Infinity;
    for (const x of a) { cx += x.pos[0]; cz += x.pos[2]; minZ = Math.min(minZ, x.pos[2]); }
    cx /= a.length; cz /= a.length;
    const px = cx, pz = minZ - ${DIST};
    __sdfGame.placePlayer({ x: px, z: pz, yaw: Math.PI, pitch: -0.05 });
    return JSON.stringify({ ok: r.ok, actors: a.length });
  })()`));
  await sleep(2500);
  await evaluate(`__sdfGame.bench({ mode: "passes", warmup: 30, chunkFrames: 10, walkFrames: 240, fireFrames: 20, gibFrames: 20, holdPlayer: true, noShots: true, label: ${JSON.stringify(leg.name)} })`, 10 * 60_000);
  const r = JSON.parse(await evaluate('JSON.stringify(window.__gameBench)'));
  if (!r.valid) fail(`${leg.name}: ${r.hiddenSteps} hidden frames (a hidden page renders nothing)`);
  const passes = {};
  // Exclusive ms per GPU pass label and the CPU phases ('cpu:*'), means over the leg (game-bench PassSegmentSummary).
  for (const [k, v] of Object.entries(r.passes?.overall?.labels ?? {})) passes[k] = v.mean;
  const row = { round, leg: leg.name, load0, load1: loadavg()[0], bootSec, staged, frameP50: r.overall.p50, frameP95: r.overall.p95, gpuSpan: r.passes?.overall?.span?.mean, passes };
  appendFileSync(`${OUT}/rows.jsonl`, JSON.stringify(row) + '\n');
  console.log(`r${round} ${leg.name.padEnd(10)} boot ${bootSec.toFixed(1)} s  bodies ${staged.actors}  frame p50 ${r.overall.p50.toFixed(2)} p95 ${r.overall.p95.toFixed(2)} ms`);
  return row;
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  const order = round % 2 ? [...LEGS].reverse() : LEGS;
  for (const leg of order) rows.push(await runLeg(leg, round));
}
// Round 0 is each origin's cold compile: boot time and frames from it are reported apart.
const summary = {};
for (const leg of LEGS) {
  const mine = rows.filter((r) => r.leg === leg.name);
  const warm = mine.filter((r) => r.round > 0);
  summary[leg.name] = {
    coldBootSec: mine[0]?.bootSec,
    warmBootSecMedian: median(warm.map((r) => r.bootSec)),
    frameP50Median: median(mine.map((r) => r.frameP50)),
    frameP95Median: median(mine.map((r) => r.frameP95)),
    perRound: mine.map((r) => +r.frameP50.toFixed(2)),
    passMedians: Object.fromEntries([...new Set(mine.flatMap((r) => Object.keys(r.passes)))].sort()
      .map((k) => [k, +median(mine.map((r) => r.passes[k] ?? 0)).toFixed(3)])),
  };
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify({ CROWD, SPACING, DIST, ROUNDS, summary }, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
