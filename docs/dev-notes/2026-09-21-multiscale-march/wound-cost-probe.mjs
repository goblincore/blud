// wound-cost-probe.mjs — where does the resolution-independent wound cost live? (2026-09-21)
//
// One page, uncapped, frozen. Wounds are irreversible, so the wound COUNT is sequential
// (0 -> 1 -> ... -> 5) but inside each count the legs alternate:
//   face/away  x  march scale 0.5 / 0.25
// `away` = same position, camera yawed 180 degrees: no body pixels. If the wound cost
// survives there it is per-FRAME work, not per-pixel.
//
// Usage: node wound-cost-probe.mjs <vitePort> <cdpPort> <repoRoot>
import { writeFileSync } from 'node:fs';
const [, , VITE = '5391', CDP = '9391', ROOT] = process.argv;
const { connectGame, bootCloseupPage, stageCloseUp, WOUND_OFFSETS, sleep } = await import(`${ROOT}/scripts/lib/sdf-closeup-stage.mjs`);
const OUT = process.env.PROBE_OUT ?? '.';
const FRAMES = Number(process.env.PROBE_FRAMES ?? 60);
const REPS = Number(process.env.PROBE_REPS ?? 2);

const { send, evaluate } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: 1280, height: 800 });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });
for (let i = 0; i < 120; i++) {
  const on = await evaluate('__sdfGame.upscaleInfo?.()?.on === true');
  if (on) break;
  await sleep(500);
}
await evaluate('__sdfGame.setFrameCap(0); __sdfGame.setWoundTuning({ spillChance: 0 }); 1');
const staged = await stageCloseUp(evaluate, { settleTries: 2400 });
const pose = JSON.parse(await evaluate('JSON.stringify(__sdfGame.pose())'));
console.log('staged', JSON.stringify(staged), 'pose', JSON.stringify(pose));

const setView = (away) => evaluate(`(() => { __sdfGame.setPose(${pose.pos[0]}, ${pose.pos[2]}, ${pose.yaw} + ${away ? Math.PI : 0}, ${pose.pitch}, 0); __sdfGame.step(3); return 1; })()`);
const measure = async (label) => {
  const r = await evaluate(`(async () => {
    const r = await __sdfGame.bench({ kind: 'closeup', mode: 'passes', closeupFrames: ${FRAMES}, warmup: 15, holdPlayer: true, label: '${label}' });
    const lab = r.passes?.overall?.labels ?? {};
    const pick = {};
    for (const k of Object.keys(lab)) if (!k.startsWith('cpu') && lab[k].p50 > 0.05) pick[k] = +lab[k].p50.toFixed(2);
    return JSON.stringify({ valid: r.valid, frame: r.overall.p50, passes: pick });
  })()`, 600_000);
  return JSON.parse(r);
};
const LEGS = [
  { name: 'face@0.5', away: false, scale: 0.5 }, { name: 'away@0.5', away: true, scale: 0.5 },
  { name: 'face@0.25', away: false, scale: 0.25 }, { name: 'away@0.25', away: true, scale: 0.25 },
];
const rows = [];
const runCount = async (n, extra = '') => {
  for (let rep = 0; rep < REPS; rep++) {
    for (let k = 0; k < LEGS.length; k++) {
      const leg = LEGS[(k + rep) % LEGS.length];
      await evaluate(`__sdfGame.setSdfScale(${leg.scale}); 1`);
      await setView(leg.away);
      const r = await measure(`${n}:${leg.name}`);
      rows.push({ wounds: n, leg: leg.name + extra, ...r });
      console.log(String(n).padStart(2), (leg.name + extra).padEnd(16), 'march', String(r.passes['sdf:march'] ?? 0).padStart(6), 'frame', r.frame.toFixed(2), r.valid ? '' : 'INVALID');
    }
  }
};

const FAST = process.env.PROBE_FAST === '1';
const crowd = () => evaluate(`(() => { const c = __sdfGame.crowdInfo(); return JSON.stringify({ on: c.on, dispatch: c.dispatch, tilesOn: c.tilesOn, fallback: c.fallbackReason, types: c.types.map(t => ({ name: t.name, attached: t.attached, live: t.live, tilesOn: t.tilesOn })) }); })()`);
console.log('crowd(clean)', await crowd());
await runCount(0);
let stamped = 0;
for (const [dyaw, dpitch, kind] of WOUND_OFFSETS) {
  await setView(false);
  const ok = await evaluate(`(() => {
    __sdfGame.setPose(${pose.pos[0]}, ${pose.pos[2]}, ${pose.yaw + dyaw}, ${pose.pitch + dpitch}, 0);
    __sdfGame.step(3);
    const p = __sdfGame.predictSlugHit();
    if (p.actorId < 0 || !p.hit) return false;
    const ok = __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2], p.dir[0], p.dir[1], p.dir[2], '${kind}', p.actorId);
    __sdfGame.step(5);
    return !!ok;
  })()`);
  if (!ok) { console.log('stamp missed', dyaw, dpitch); continue; }
  stamped++;
  if (!FAST) await runCount(stamped);
}

if (FAST) await runCount(stamped);
console.log('crowd(wounded)', await crowd());
// Toggle sweep at the final wound count, facing, ship scale: which seam owns the cost?
const TOGGLES = (process.env.PROBE_TOGGLES ?? '').split(';').filter(Boolean);
for (const t of TOGGLES) {
  const [on, off] = t.split('|');
  await evaluate(`__sdfGame.setSdfScale(0.25); 1`);
  await setView(false);
  for (let rep = 0; rep < REPS; rep++) {
    await evaluate(`(() => { ${on}; __sdfGame.step(3); return 1; })()`);
    const a = await measure('toggle-on');
    await evaluate(`(() => { ${off}; __sdfGame.step(3); return 1; })()`);
    const b = await measure('toggle-off');
    rows.push({ wounds: stamped, leg: `T[${on}]`, ...a }, { wounds: stamped, leg: `T[${off}]`, ...b });
    console.log('toggle', on.padEnd(44), 'march', a.passes['sdf:march'], '| restored', b.passes['sdf:march']);
  }
}
const state = await evaluate(`JSON.stringify({ chunks: __sdfGame.chunkCount, bleed: __sdfGame.bleed, passesNow: null })`);
console.log('state', state);
writeFileSync(`${OUT}/wound-cost.json`, JSON.stringify({ staged, rows }, null, 1));
process.exit(0);
