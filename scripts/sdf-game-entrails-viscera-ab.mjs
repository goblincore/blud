// scripts/sdf-game-entrails-viscera-ab.mjs — the viscera A/B, judged BY LOOK.
//
// Task 8 step 4 supplement: stage ONE slug into a standing torso (no rope —
// spillChance 0 keeps the crater unobstructed), capture close, then flip
// visceraAmp 1 -> 0 (a live uniform write, same wound) and capture again.
// What must differ BY LOOK: the cavity interior — dark wet purple-red with
// low-frequency lumps ON, plain muscle/clot red OFF. NO pixel diffs (52-82k
// px same-build flicker).
//
// Usage: node scripts/sdf-game-entrails-viscera-ab.mjs <vitePort> <cdpPort> <outDir> <tag>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5388);
const CDP = Number(process.argv[3] ?? 9388);
const OUT = process.argv[4] ?? '/tmp/entrails-capture';
const TAG = process.argv[5] ?? 'visc';
const W = 1280, H = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), 60000)),
  ]);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
let shotN = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const p = `${OUT}/${String(++shotN).padStart(2, '0')}-${TAG}-${name}.png`;
  writeFileSync(p, Buffer.from(s.result.data, 'base64'));
  console.log(`  shot ${p}`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
let backend = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (backend) break;
}
if (backend !== 'webgpu') fail('no webgpu boot');
await sleep(2000);

// No rope — this A/B is the CAVITY, unobstructed.
await evaluate('__sdfGame.setWoundTuning({ spillChance: 0 })');
await evaluate('__sdfGame.freeze(true)');
await evaluate('__sdfGame.step(2)');

// Closer pick: 1.6-2.0 m, aim at the belly (~0.95 m).
// Closer pick: 1.6-2.2 m, aiming at torso heights, and the stamp is only
// ACCEPTED if the wound actually reads cavity:true — the predictor aims at
// the torso CLUSTER, but at close range the resolved surface can be a leg/hip
// prim (cavity false — the r2 wall ramp, correct, but not this A/B). Retry
// down the aim heights until a torso prim takes the hit.
let picked = null;
for (const H_AIM of [1.2, 1.3, 1.1, 1.25]) {
  const got = await evaluate(`(() => {
    const zs = __sdfGame.zombies();
    const eyeH = 1.62;
    const H_AIM = ${H_AIM};
    for (const z of zs) {
      for (const dist of [1.8, 2.2, 1.6]) {
        for (const ang of [0, 0.5, -0.5]) {
          const ex = z.pos[0] + Math.sin(ang) * dist;
          const ez = z.pos[2] + Math.cos(ang) * dist;
          const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
          const yaw = Math.atan2(dx, -dz);
          const dy = (z.pos[1] ?? 0) + H_AIM - eyeH;
          const pitch = Math.atan2(dy, Math.hypot(dx, dz));
          __sdfGame.setPose(ex, ez, yaw, pitch, 0);
          const p = __sdfGame.predictSlugHit();
          if (p.actorId === z.id && p.hit) return { id: z.id, d: dist };
        }
      }
    }
    return null;
  })()`);
  if (!got) continue;
  await evaluate(`(() => {
    const p = __sdfGame.predictSlugHit();
    if (p.actorId < 0 || !p.hit) return null;
    return __sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2],
      p.dir[0], p.dir[1], p.dir[2], 'slug', p.actorId);
  })()`);
  const cav = await evaluate(`__sdfGame.zombie(${got.id}).woundList().some(w => w.cavity === true)`);
  console.log(`  aim h=${H_AIM} d=${got.d} body ${got.id}: stamped, cavity=${cav}`);
  if (cav) { picked = got; break; }
}
if (!picked) fail('no torso-prim (cavity) stamp achieved at close range');
console.log(`picked body ${picked.id} at ~${picked.d} m, aim h accepted`);
await evaluate('__sdfGame.step(20)');

const wounds = await evaluate(`__sdfGame.zombie(${picked.id}).woundList().map(w => ({cavity: w.cavity === true, cal: w.spillCalibre}))`);
console.log('wounds:', JSON.stringify(wounds));

// ON: shipped viscera (amp 1).
await evaluate('__sdfGame.setWoundTuning({ visceraAmp: 1 })');
await evaluate('__sdfGame.step(5)');
await shot('viscera-ON');

// OFF: same wound, amp 0 — the live uniform write.
await evaluate('__sdfGame.setWoundTuning({ visceraAmp: 0 })');
await evaluate('__sdfGame.step(5)');
await shot('viscera-OFF');
const cfg = await evaluate('__sdfGame.woundTuning');
console.log('final tuning:', JSON.stringify(cfg));

console.log('OK');
