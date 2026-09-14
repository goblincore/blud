// crowd-normal-probe.mjs — per-hit-slot analytic-vs-finite-difference normal agreement (crowd march).
//
// Boots the game frozen (vhs off, upscale off), enables the crowd path, teleports to ROOM (default 4),
// spawns N zombies (default 3, 0.9 m grid) 2.5 m in front of the camera, sets march debug mode MODE
// (12 = per pixel: x = hit slot, y = analytic reason code, z = dot(analytic n, finite-difference n))
// and histograms the raw march target per slot. PRELUDE is extra JS evaluated after setCrowd(true).
//
// Gate for the analytic-gradient recalibration: every slot's dotMean >= 0.99 and dotLow == 0.
// Env: LAB_VITE_PORT/LAB_CDP_PORT (5325/9325), MODE, ROOM, N, PRELUDE. Run inside scripts/lab-servers.sh (bash).
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp } from './lib/sdf-closeup-stage.mjs';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5325), CDP = Number(process.env.LAB_CDP_PORT ?? 9325);
const fail = (m) => { console.error('FAIL', m); process.exit(1); };
const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&upscale=0` });
await evaluate('__sdfGame.setLoopRunning(false)');
await applyShipDefaults(evaluate);
await evaluate('__sdfGame.setCrowd(true)'); if (process.env.PRELUDE) await evaluate(process.env.PRELUDE);
await evaluate(`__sdfGame.setMarchDebugMode(${Number(process.env.MODE ?? 11)})`);
await stageCloseUp(evaluate, { room: 1 }, fail);
await evaluate(`__sdfGame.teleport(${Number(process.env.ROOM ?? 4)})`);
console.log('spawn', await evaluate(`(() => { const sp = __sdfGame.spawnCrowd('zombie', ${Number(process.env.N ?? 3)}, { spacing: 0.9 }); const q = sp.placed[0]; if (__sdfGame.freeze) __sdfGame.freeze(true); __sdfGame.placePlayer({ x: q[0], z: q[2] + 2.5, yaw: 0, pitch: 0 }); __sdfGame.step(12); return JSON.stringify(sp); })()`));
await evaluate('__sdfGame.resolveGpu()');
await evaluate('__sdfGameDebug.readMarchTarget()');
const r = await evaluate('__sdfGameDebug.readMarchTarget()');
const f = new Float32Array(Buffer.from(r.rgba32f, 'base64').buffer.slice(0));
const W = r.w, H = r.h; console.log('target', W, H);
// histogram of (slot, band, distortion) over hit pixels, and per-slot mean distortion
const per = new Map(); const rs = new Map();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (f[i + 3] >= 1) continue;
  const slot = f[i], dist = f[i + 1], prim = f[i + 2], band = f[i + 3];
  const k = `slot${slot}`; const e = per.get(k) ?? { n: 0, distSum: 0, distMin: 1e9, distMax: -1e9, primMin: 1e9, primMax: -1e9, nan: 0, xs: 1e9, xe: -1 };
  e.n++; { const rk = `slot${slot}`; const q = rs.get(rk) ?? { n: 0, reasons: {}, dotSum: 0, dotNeg: 0, dotLow: 0 }; q.n++; q.reasons[dist] = (q.reasons[dist] ?? 0) + 1; q.dotSum += prim; if (prim < 0) q.dotNeg++; if (prim < 0.9) q.dotLow++; rs.set(rk, q); } if (!Number.isFinite(dist)) e.nan++; else { e.distSum += dist; e.distMin = Math.min(e.distMin, dist); e.distMax = Math.max(e.distMax, dist); }
  e.primMin = Math.min(e.primMin, prim); e.primMax = Math.max(e.primMax, prim); e.xs = Math.min(e.xs, x); e.xe = Math.max(e.xe, x); per.set(k, e); }
for (const [k, e] of per) console.log(k, JSON.stringify({ n: e.n, distMean: +(e.distSum / Math.max(1, e.n - e.nan)).toFixed(3), distMin: e.distMin, distMax: e.distMax, primMin: e.primMin, primMax: e.primMax, nan: e.nan, xRange: [e.xs, e.xe] }));
for (const [k, q] of rs) console.log('STATS', k, JSON.stringify({ n: q.n, reasons: q.reasons, dotMean: +(q.dotSum / q.n).toFixed(3), dotNeg: q.dotNeg, dotLow: q.dotLow }));
let bad = 0; for (const [k, q] of rs) if (q.dotSum / q.n < 0.99 || q.dotLow > 0) bad++;
console.log(bad === 0 ? 'PASS' : `FAIL: ${bad} slot(s) below dot 0.99`);
console.log('dump', await evaluate('JSON.stringify(__sdfGame.crowdSlotDump()["zombie@4"].map(r => [r.actor, r.slot, r.isSource]))'));
for (const slot of [0, 3]) for (const row of [0, 1, 2, 7, 8, 9, 10, 12, 20]) console.log(`band${slot} row${row}`, JSON.stringify((await evaluate(`__sdfGame.crowdBandRow("zombie@4", ${slot}, ${row}, 4)`)).map(v => +v.toFixed(3))));
process.exit(0);
