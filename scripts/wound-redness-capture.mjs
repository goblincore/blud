// scripts/wound-redness-capture.mjs — wound-REDNESS gate driver (2026-08-27).
//
// The owner's bar: "does the inside read RED, like the lab?" This drives the
// game page (and the lab as reference) through the four gate wounds — slug in
// a torso, slug in a forearm (the perforation case), buckshot-pocked torso,
// dynamite-class blast — capturing close-ups AND an objective redness metric
// per shot: the screenshot is decoded IN THE PAGE (2D canvas) and the central
// crop is measured for red-dominant pixels + mean channel spread. Placement
// truth comes from __sdfGame.debugWounds() (surface anchor vs GPU carve
// centre per wound), which quantifies exactly what the renderer subtracts.
//
//   node scripts/wound-redness-capture.mjs <vitePort> <cdpPort> <outDir> <phase>
//
// phase: slug | forearm | buckshot | blast | all-game | lab | lab-pellets
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5344);
const CDP = Number(process.argv[3] ?? 9344);
const OUT = process.argv[4] ?? '/tmp/wound-redness';
const PHASE = process.argv[5] ?? 'all-game';
const W = 1100, H = 800;
const EYE = 1.62;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

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
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 45000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
async function shot(name, stats = true) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  let metric = null;
  if (stats) {
    // Decode IN THE PAGE: central crop (30%..70% box), red-dominant fraction
    // + mean RGB. A pale wound scores low; the lab's deep cavity scores high.
    metric = await evaluate(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${s.result.data}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const x0 = Math.floor(img.width * 0.30), x1 = Math.ceil(img.width * 0.70);
      const y0 = Math.floor(img.height * 0.30), y1 = Math.ceil(img.height * 0.70);
      const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let red = 0, n = 0, R = 0, G = 0, B = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        R += r; G += gg; B += b; n++;
        if (r > 60 && r > 1.35 * gg && r > 1.35 * b) red++;
      }
      return { redFrac: +(red / n).toFixed(4), meanR: +(R / n).toFixed(1), meanG: +(G / n).toFixed(1), meanB: +(B / n).toFixed(1), px: n };
    })()`);
  }
  console.log(`  shot ${name}.png (${buf.length} bytes)${metric ? ` redFrac=${metric.redFrac} meanRGB=${metric.meanR}/${metric.meanG}/${metric.meanB}` : ''}`);
  if (metric) writeFileSync(`${OUT}/${name}.json`, JSON.stringify(metric, null, 2));
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

/** Camera pose standing `dist` from (tx,tz) at angle `a`, looking at height ty. */
function around(tx, tz, a, dist, ty) {
  const sx = tx + Math.sin(a) * dist;
  const sz = tz + Math.cos(a) * dist;
  const yaw = Math.atan2(tx - sx, -(tz - sz));
  const pitch = Math.atan2(ty - EYE, dist);
  return { x: sx, z: sz, yaw, pitch };
}

async function setPose(p) {
  await evaluate(`__sdfGame.setPose(${p.x}, ${p.z}, ${p.yaw}, ${p.pitch})`);
  await sleep(300);
}

async function bootGame(slug) {
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html${slug ? '?slug' : ''}` });
  let api = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
    if (api) break;
  }
  if (api !== 'webgpu') fail(`page never booted on webgpu (got ${api})`);
  for (let i = 0; i < 40; i++) {
    if (await evaluate('window.__sdfGame.gunReady')) break;
    await sleep(250);
  }
  if (!(await evaluate('window.__sdfGame.gunReady'))) fail('gun never ready');
  // Freeze for stable AIMING; fireAndSettle unfreezes for the shot itself
  // (a frozen rig pins the flinch lunge forever).
  await evaluate('window.__sdfGame.freeze(true)');
  await sleep(400);
  console.log('game booted: webgpu, gun ready, frozen for aim');
}

/** Fire, let the flinch play OUT (frozen rigs pin the lunge forever —
 *  wanderFrozen gates a.step entirely), then freeze to pin a settled pose. */
async function fireAndSettle(fireExpr) {
  await evaluate('__sdfGame.freeze(false)');
  await sleep(150);
  await evaluate(fireExpr);
  await sleep(3500);
  await evaluate('__sdfGame.freeze(true)');
  await sleep(600);
}

/** The zombie's CURRENT chest anchor (posed torso centre) + ground pos. */
const chestExpr = `(id => {
  const z = __sdfGame.zombie(id);
  const p = z.posed();
  const t = p.clusters.find(c => c.limb === 'torso');
  return { centre: t ? t.center : null, pos: z.pose() };
})`;

async function dumpWounds(id, tag) {
  const w = await evaluate(`__sdfGame.debugWounds(${id})`);
  writeFileSync(`${OUT}/wounds-${tag}.json`, JSON.stringify(w, null, 2));
  if (Array.isArray(w)) {
    for (const [i, ww] of w.entries()) {
      const off = Math.hypot(ww.carve[0] - ww.surface[0], ww.carve[1] - ww.surface[1], ww.carve[2] - ww.surface[2]);
      console.log(`    wound[${i}] ${ww.type} r=${ww.radius.toFixed(3)} prim=${ww.primIdx} |carve-surface|=${off.toFixed(4)} m`);
    }
  }
  return w;
}

// ---------------------------------------------------------------- game ----
if (PHASE === 'slug' || PHASE === 'all-game') {
  await bootGame(true);
  const zs = await evaluate('__sdfGame.zombies()');
  const z0 = zs[0];
  console.log(`slug-torso: target zombie ${z0.id} at (${z0.pos[0].toFixed(2)}, ${z0.pos[2].toFixed(2)})`);
  const ch = await evaluate(`${chestExpr}(${z0.id})`);
  const ty = ch.centre ? ch.centre[1] : 1.1;
  await setPose(around(z0.pos[0], z0.pos[2], 0, 2.4, ty));
  await shot('slug-torso-0-aim', false);

  await fireAndSettle('__sdfGame.fireSlug()');
  // The shove moved the body — re-read and re-frame.
  const zs2 = await evaluate('__sdfGame.zombies()');
  const z2 = zs2.find(z => z.id === z0.id);
  const ch2 = await evaluate(`${chestExpr}(${z0.id})`);
  const ty2 = ch2.centre ? ch2.centre[1] : 1.1;
  console.log(`  body moved to (${z2.pos[0].toFixed(2)}, ${z2.pos[2].toFixed(2)})`);
  await setPose(around(z2.pos[0], z2.pos[2], 0, 1.3, ty2));
  await sleep(600);
  await shot('slug-torso-1-close');
  await setPose(around(z2.pos[0], z2.pos[2], 0, 0.9, ty2));
  await sleep(600);
  await shot('slug-torso-2-point-blank');
  await dumpWounds(z0.id, 'slug-torso');
}

if (PHASE === 'forearm' || PHASE === 'all-game') {
  await bootGame(true);
  const zs = await evaluate('__sdfGame.zombies()');
  const z0 = zs[0];
  // FOREARM = the arm-cluster endpoint FARTHEST from the torso centre.
  const arm = await evaluate(`(id => {
    const z = __sdfGame.zombie(id);
    const p = z.posed();
    const torso = p.clusters.find(c => c.limb === 'torso');
    const pick = (limb) => {
      const cl = p.clusters.find(c => c.limb === limb && c.alive);
      if (!cl) return null;
      let best = null, bd = -1;
      for (let i = cl.start; i < cl.start + cl.count; i++) {
        const pr = p.prims[i];
        if (!pr || pr.op === 'sub' || pr.dead) continue;
        for (const e of [pr.a, pr.b]) {
          const d = Math.hypot(e[0] - torso.center[0], e[1] - torso.center[1], e[2] - torso.center[2]);
          if (d > bd) { bd = d; best = e; }
        }
      }
      return best ? { x: best[0], y: best[1], z: best[2], limb } : null;
    };
    return pick('armR') || pick('armL');
  })(${z0.id})`);
  if (!arm) fail('no alive arm to shoot');
  console.log(`forearm: aiming at (${arm.x.toFixed(2)}, ${arm.y.toFixed(2)}, ${arm.z.toFixed(2)})`);
  // Stand 1.8 m from the ARM POINT, camera facing it.
  const aim = async (dist, angleOffset = 0) => {
    const dx = arm.x - z0.pos[0], dz = arm.z - z0.pos[2];
    const base = Math.atan2(dx, dz);
    const sx = arm.x - Math.sin(base + angleOffset) * dist;
    const sz = arm.z - Math.cos(base + angleOffset) * dist;
    const yaw = Math.atan2(arm.x - sx, -(arm.z - sz));
    const pitch = Math.atan2(arm.y - EYE, dist);
    await evaluate(`__sdfGame.setPose(${sx}, ${sz}, ${yaw}, ${pitch})`);
    await sleep(300);
  };
  await aim(1.8);
  await shot('forearm-0-aim', false);
  await fireAndSettle('__sdfGame.fireSlug()');
  await aim(0.9);
  await sleep(300);
  await shot('forearm-1-front-close');
  // Perforation check: view the SAME limb from the OPPOSITE side.
  await aim(0.9, Math.PI);
  await sleep(300);
  await shot('forearm-2-back-close');
  await aim(1.4, Math.PI * 0.5);
  await sleep(300);
  await shot('forearm-3-side');
  await dumpWounds(z0.id, 'forearm');
}

if (PHASE === 'buckshot' || PHASE === 'all-game') {
  await bootGame(false);
  const zs = await evaluate('__sdfGame.zombies()');
  const z0 = zs[0];
  const ch = await evaluate(`${chestExpr}(${z0.id})`);
  const ty = ch.centre ? ch.centre[1] : 1.1;
  await setPose(around(z0.pos[0], z0.pos[2], 0, 2.6, ty));
  await fireAndSettle('__sdfGame.fire(1)');
  await fireAndSettle('__sdfGame.fire(1)');
  await fireAndSettle('__sdfGame.fire(1)');
  const zs2 = await evaluate('__sdfGame.zombies()');
  const z2 = zs2.find(z => z.id === z0.id);
  const ch2 = await evaluate(`${chestExpr}(${z0.id})`);
  const ty2 = ch2.centre ? ch2.centre[1] : 1.1;
  await setPose(around(z2.pos[0], z2.pos[2], 0, 1.3, ty2));
  await sleep(300);
  await shot('buckshot-1-close');
  await setPose(around(z2.pos[0], z2.pos[2], 0, 0.9, ty2));
  await sleep(300);
  await shot('buckshot-2-point-blank');
  await dumpWounds(z0.id, 'buckshot');
}

if (PHASE === 'blast' || PHASE === 'all-game') {
  await bootGame(false);
  const zs = await evaluate('__sdfGame.zombies()');
  const z0 = zs[0];
  const ch = await evaluate(`${chestExpr}(${z0.id})`);
  if (!ch.centre) fail('no torso centre');
  const [cx, cy, cz] = ch.centre;
  // Detonate ~35 cm in front of the chest (z+ toward the default camera side):
  // falloff-scaled calibre, same as a dynamite stick landing at the feet-chest.
  // Front = toward the player's spawn side; use +z (the around() angle-0 side).
  await evaluate(`__sdfGame.explode(${cx}, ${cy}, ${cz + 0.35})`);
  // explode() is instant and does NO shove (wounds only) — no settle needed.
  await sleep(400);
  const zs2 = await evaluate('__sdfGame.zombies()');
  const z2 = zs2.find(z => z.id === z0.id);
  const ch2 = await evaluate(`${chestExpr}(${z0.id})`);
  const ty2 = ch2.centre ? ch2.centre[1] : 1.1;
  await setPose(around(z2.pos[0], z2.pos[2], 0, 1.3, ty2));
  await sleep(300);
  await shot('blast-1-close');
  await setPose(around(z2.pos[0], z2.pos[2], 0, 0.9, ty2));
  await sleep(300);
  await shot('blast-2-point-blank');
  await dumpWounds(z0.id, 'blast');
}

// ----------------------------------------------------------------- lab ----
// Reference: the LAB rendering comparable wounds on its hero. The lab's own
// capture recipe (freezeCosmetics doc block): pin pose + wander, stamp, pin
// cosmetics. The lab's blast profile (0.13) is the closest comparable wound
// class to the game's slug (0.16, same tamed-lip profile family).
if (PHASE.startsWith('lab')) {
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });
  let ready = false;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    ready = await evaluate('typeof window.__sdfLab === "object"');
    if (ready) break;
  }
  if (!ready) fail('lab never booted');
  await evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' })); // hide panel
    window.__sdfLab.setMotionEnabled(false);
    window.__sdfLab.setWander(false);
    window.__sdfLab.freezeCosmetics(true);
    return true;
  })()`);
  await sleep(800);
  // Where is the hero's chest? Hero torso prims' mean endpoint.
  const chest = await evaluate(`(() => {
    const b = window.__sdfLab.current;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const p of b.prims) {
      if (p.limb !== 'torso' || p.op === 'sub' || p.dead) continue;
      sx += p.a[0] + p.b[0]; sy += p.a[1] + p.b[1]; sz += p.a[2] + p.b[2]; n += 2;
    }
    return n ? [sx / n, sy / n, sz / n] : null;
  })()`);
  if (!chest) fail('lab: no torso centre');
  console.log(`lab: hero chest at (${chest.map(v => v.toFixed(2)).join(', ')})`);
  writeFileSync(`${OUT}/lab-chest.json`, JSON.stringify({ chest }, null, 2));

  // PELLETS FIRST, wide apart on intact skin (they merge inside a blast bowl
  // otherwise), then the blast in the centre — each shot taken before the
  // next stamp. The lab's blast profile (0.13) is the closest comparable
  // wound class to the game's slug (0.16, same tamed-lip family).
  const clicks = [[-0.12, 0.1], [0.1, 0.08], [-0.09, -0.07], [0.13, -0.06], [0.0, 0.15]];
  for (const [ox, oy] of clicks) {
    const ndcRaw = await evaluate(`(() => {
      const c = window.__sdfLab.camera;
      c.updateMatrixWorld(); c.updateProjectionMatrix();
      const v = new (Object.getPrototypeOf(c.position).constructor)(${chest[0]} + ${ox}, ${chest[1]} + ${oy}, ${chest[2]});
      v.project(c);
      const el = window.__sdfLab.renderer.domElement;
      const r = el.getBoundingClientRect();
      return { px: String(r.left + (v.x * 0.5 + 0.5) * r.width), py: String(r.top + (-v.y * 0.5 + 0.5) * r.height) };
    })()`);
    if (!ndcRaw || ndcRaw.px === 'NaN') fail('lab: projection NaN');
    // REAL input via CDP: synthetic PointerEvents make canvas.setPointerCapture
    // throw (no active pointer), which aborts the lab's pointerup handler
    // before its shoot logic runs. CDP mouse events are trusted input.
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Number(ndcRaw.px), y: Number(ndcRaw.py), button: 'left', clickCount: 1, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Number(ndcRaw.px), y: Number(ndcRaw.py), button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(500);
    console.log(`  lab pellet at screen (${Number(ndcRaw.px).toFixed(0)}, ${Number(ndcRaw.py).toFixed(0)})`);
  }
  await sleep(1000);
  await evaluate(`window.__sdfLab.setCam(0, 0.02, 0.8, ${chest[1]})`);
  await sleep(1200);
  await shot('lab-pellets-chest-close');

  // Big-crater reference: one blast from 3 m in front (+z), centred chest.
  await evaluate(`window.__sdfLab.stampWoundAt([${chest[0]}, ${chest[1]}, ${chest[2] + 3}], [0, 0, -1])`);
  await sleep(1000);
  await shot('lab-blast-chest-close');
  const wc = await evaluate('window.__sdfLab.wounds.length');
  console.log(`lab: ${wc} wounds stamped`);
}

console.log(`done — shots in ${OUT}`);
process.exit(0);
