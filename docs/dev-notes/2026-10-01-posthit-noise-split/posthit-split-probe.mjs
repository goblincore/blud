// posthit-split-probe.mjs — research probe (2026-10-01), NOT a gate.
// Question: of the post-hit chain (shaded - walk), how much is procedural NOISE?
// One page, ship scale 0.5, frozen close-up (same staging as
// docs/dev-notes/2026-09-21-multiscale-march/closeup-multiscale-probe.mjs).
//   half A: alternate ship / flat
//   then zero the noise lanes (surfCfg2.y micro-detail, surfCfg2.z mottle,
//   marchCfg.z silhouette fbm in normal taps + probes) — every one is branch-guarded
//   half B: alternate nonoise / flat
// flat (setFlatAlbedo) skips the whole post-hit chain, so it is the shared
// reference across both halves and doubles as a drift check.
// Usage: node posthit-split-probe.mjs <vitePort> <cdpPort> <repoRoot>
import { writeFileSync, mkdirSync } from 'node:fs';
const [, , VITE, CDP, ROOT] = process.argv;
const lib = await import(`${ROOT}/scripts/lib/sdf-closeup-stage.mjs`);
const { connectGame, bootCloseupPage, stageCloseUp, stampFacingWounds, sleep } = lib;

const OUT = process.env.PROBE_OUT ?? '.';
mkdirSync(OUT, { recursive: true });
const BLOCKS = Number(process.env.PROBE_BLOCKS ?? 3);
const FRAMES = Number(process.env.PROBE_FRAMES ?? 90);
const WOUNDED = process.env.PROBE_WOUNDS === '1';
const ROOM = Number(process.env.PROBE_ROOM ?? 1);

const { evaluate, send } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: 1280, height: 800 });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });
for (let i = 0; i < 120; i++) {
  const info = await evaluate('JSON.stringify(__sdfGame.upscaleInfo?.() ?? null)');
  if (info && info !== 'null' && JSON.parse(info).enabled !== false) break;
  await sleep(500);
}
await evaluate('__sdfGame.setFrameCap(0); __sdfGame.setWoundTuning({ spillChance: 0 }); 1');
const staged = await stageCloseUp(evaluate, { settleTries: 2400, room: ROOM });
console.log('staged', JSON.stringify(staged));
let wounds = null;
if (WOUNDED) { wounds = await stampFacingWounds(evaluate, {}); console.log('wounds', JSON.stringify(wounds)); }
const bootInfo = await evaluate(`JSON.stringify({ up: __sdfGame.upscaleInfo?.(), bodies: __sdfGame.bodiesOnScreen, zombies: __sdfGame.zombies().length })`);
console.log('boot', bootInfo);
const uptime = (await import('node:child_process')).execSync('uptime').toString().trim();
console.log('uptime', uptime);

const leg = (flat) => evaluate(`(() => { __sdfGame.setSdfScale(0.5); __sdfGame.setFlatAlbedo(${flat}); __sdfGame.step(3); return 1; })()`);
const measure = async (label) => {
  const r = await evaluate(`(async () => {
    const r = await __sdfGame.bench({ kind: 'closeup', mode: 'passes', closeupFrames: ${FRAMES}, warmup: 20, label: '${label}' });
    const lab = r.passes?.overall?.labels ?? {};
    const pick = {};
    for (const k of Object.keys(lab)) pick[k] = lab[k].p50;
    return JSON.stringify({ valid: r.valid, frameP50: r.overall.p50, passes: pick });
  })()`, 600_000);
  return JSON.parse(r);
};

const rows = [];
const run = async (half, names) => {
  for (let b = 0; b < BLOCKS; b++) {
    for (let k = 0; k < names.length; k++) {
      const name = names[(k + b) % names.length];
      await leg(name === 'flat');
      const r = await measure(name);
      rows.push({ half, block: b, leg: name, ...r });
      console.log(half, b, name.padEnd(8), 'frame', r.frameP50?.toFixed(2), 'march', r.passes['sdf:march']?.toFixed(2), 'valid', r.valid);
    }
  }
};
await run('A', ['ship', 'flat']);
await evaluate(`(() => { __sdfGame.setUniformAll('surfCfg2', 1, 0); __sdfGame.setUniformAll('surfCfg2', 2, 0); __sdfGame.setUniformAll('marchCfg', 2, 0); __sdfGame.step(3); return 1; })()`);
await run('B', ['nonoise', 'flat']);

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pick = (half, name, key) => med(rows.filter(r => r.half === half && r.leg === name).map(r => key === 'frame' ? r.frameP50 : r.passes[key]).filter(Number.isFinite));
const summary = {
  wounded: WOUNDED, room: ROOM, uptime, staged, wounds,
  march: {
    ship: pick('A', 'ship', 'sdf:march'), flatA: pick('A', 'flat', 'sdf:march'),
    nonoise: pick('B', 'nonoise', 'sdf:march'), flatB: pick('B', 'flat', 'sdf:march'),
  },
  frame: {
    ship: pick('A', 'ship', 'frame'), flatA: pick('A', 'flat', 'frame'),
    nonoise: pick('B', 'nonoise', 'frame'), flatB: pick('B', 'flat', 'frame'),
  },
  rows,
};
const m = summary.march;
summary.derived = {
  postHitShip: m.ship - m.flatA,
  postHitNoNoise: m.nonoise - m.flatB,
  noiseCost: (m.ship - m.flatA) - (m.nonoise - m.flatB),
  flatDrift: m.flatB - m.flatA,
};
console.log('SUMMARY', JSON.stringify({ march: summary.march, frame: summary.frame, derived: summary.derived }));
writeFileSync(`${OUT}/posthit-split-room${ROOM}-${WOUNDED ? 'wounded' : 'clean'}.json`, JSON.stringify(summary, null, 2));
process.exit(0);
