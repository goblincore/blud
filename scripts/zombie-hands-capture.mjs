// scripts/zombie-hands-capture.mjs — the zombie's hands in the GAME, framed, plus the points a lighting probe reads
// (zombie hands redo, 2026-11-22).
//
// Boots the arena (`?level=arena&spawn=zombie`, frozen, VHS off), stands the player DIST m from the zombie at hand
// height and shoots its left hand from the front, 3/4 and side; then unfreezes and shoots the zombie walking up and
// reaching. Beside every frame it writes the screen points of a line down the forearm's axis and on past the wrist
// into the hand (t 0.4 -> 1.5 of the forearm, posed, from __sdfGame.actorPrims), so scripts/zombie-hands-light.py can
// read the light along it: a mesh hand that does not take the flesh light shows as a step at the wrist.
//
//   node scripts/zombie-hands-capture.mjs <vitePort> <cdpPort> <outDir>
// Env: DIST (0.9), LIVE (4 frames of the approach; 0 to skip)
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5292);
const CDP = Number(process.argv[3] ?? 9292);
const OUT = process.argv[4] ?? '.lab-tmp/hands-capture';
const DIST = Number(process.env.DIST ?? 0.9);
const LIVE = Number(process.env.LIVE ?? 4);
const W = 1280, H = 800, EYE_H = 1.62;
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
mkdirSync(OUT, { recursive: true });

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });
await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?level=arena&spawn=zombie&frozen=1&seed=1&vhs=off` });
for (let i = 0; i < 600; i++) {
  if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') === 'ready') break;
  await sleep(500);
}
// Pose the kit once (a frozen boot parks it at the bind pose: bride-game-frames.mjs), then hold.
await evaluate('__sdfGame.freeze(false); __sdfGame.step(2); __sdfGame.freeze(true);');
await sleep(5000); // the READY card fades
const actors = JSON.parse(await evaluate('JSON.stringify(__sdfGame.actorTrace())'));
const target = actors.find((a) => a.kind !== 'soldier') ?? fail('no zombie');

/** The left forearm's axis, posed: its capsule (the longest foreArm.l prim) a -> b. */
async function forearm() {
  const prims = JSON.parse(await evaluate(`JSON.stringify(__sdfGame.actorPrims(${target.id}))`));
  const fa = prims.filter((p) => p.bone === 'foreArm.l' && !p.dead)
    .sort((p, q) => Math.hypot(...q.a.map((v, i) => v - q.b[i])) - Math.hypot(...p.a.map((v, i) => v - p.b[i])))[0];
  return fa;
}

async function shot(name, place) {
  if (place) await evaluate(`__sdfGame.placePlayer(${JSON.stringify(place)}); __sdfGame.step(2);`);
  await sleep(1200);
  const fa = await forearm();
  // The capsule spans 0.05 -> 0.90 of the bone: extrapolate to bone t (0.4 .. 1.5).
  const d = fa.b.map((v, i) => v - fa.a[i]);
  const pts = [];
  for (let t = 0.40; t <= 1.501; t += 0.025) {
    const u = (t - 0.05) / 0.85;
    const p = fa.a.map((v, i) => v + d[i] * u);
    const s = JSON.parse(await evaluate(`JSON.stringify(__sdfGame.worldToScreen(${p[0]}, ${p[1]}, ${p[2]}, ${W}, ${H}))`));
    if (s) pts.push({ t: +t.toFixed(3), x: s.x, y: s.y });
  }
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(png.result.data, 'base64'));
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ forearm: fa, points: pts }));
  console.log(`wrote ${OUT}/${name}.png`);
}

// The hand hangs at ~0.75 m; the eye is 1.62 m: look down at it from DIST.
const hand = (await forearm()).b;
const at = (angle, dist = DIST) => {
  const x = hand[0] + Math.sin(angle) * dist, z = hand[2] + Math.cos(angle) * dist;
  const pitch = -Math.atan2(EYE_H - hand[1] + 0.05, dist);
  return { x, z, yaw: -angle, pitch };
};
// Compass angles round the hand (0 = from +z, the zombie's front at spawn yaw 0).
await shot('front', at(0));
await shot('three-quarter', at(Math.PI / 4));
await shot('side', at(Math.PI / 2));
await shot('full', { ...at(Math.PI / 8, 2.2), pitch: -0.25 });
if (LIVE > 0) {
  await evaluate(`__sdfGame.placePlayer(${JSON.stringify({ ...at(0, 2.0), pitch: -0.15 })}); __sdfGame.freeze(false);`);
  for (let i = 0; i < LIVE; i++) {
    await evaluate('__sdfGame.step(20)');
    await shot(`live-${i}`, null);
  }
}
process.exit(0);
