// docs/dev-notes/2026-11-02-head-split-roll-out/split-shot.mjs — the head split on one arena enemy, shot by seam.
// Run through shoot.sh beside it. Frozen arena (?level=arena&spawn=<character>&frozen=1), camera on the head:
//   0-closed, 1-chop1 (axeChop H head), 2-chop2 (widened), 3-side, 4-corpse (the kill chop, thawed, settled).
// Prints the split state after each chop, the corpse's phase / pose split / corpse-bake stats and the head wounds.
import { mkdirSync, writeFileSync } from "node:fs";
const [VITE, CDP, OUT, TAG, CHAR = "soldier"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const step = async (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) await ev(`__sdfGame.step(1, ${dt})`); };
await send("Page.enable"); await send("Runtime.enable");
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send("Page.bringToFront");
await send("Emulation.setDeviceMetricsOverride", { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?level=arena&spawn=${CHAR}&seed=1&frozen=1&vhs=off&loader=0` });
let backend = null;
for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await ev("typeof window.__sdfGame === 'object' ? window.__sdfGame.backend : null"); } catch { backend = null; } }
if (backend !== "webgpu") { console.error("backend", backend, logs.slice(-10)); process.exit(1); }
for (let i = 0; i < 480; i++) { if (await ev("window.__warmGate ? window.__warmGate.phase : 'ready'") === "ready") break; await sleep(500); }
await ev("__sdfGame.setLoopRunning(false)");
await ev(`(() => { for (const e of document.body.children) { if (!e.querySelector("canvas") && e.tagName !== "CANVAS") e.style.display = "none"; } return 1; })()`);
await step(30);
const a = (await ev("__sdfGame.actorList()"))[0];
const head = await ev(`__sdfGame.actorLimbCenter(${a.id}, "head")`);
// The eye 0.85 m in front of the head (the actor's front is -sin/cos of its yaw, as yawOf), a little above.
const fwd = [Math.sin(a.yaw), 0, -Math.cos(a.yaw)];
async function camFrom(dir, dist, up) {
  const e = [head[0] + dir[0] * dist, 1.62, head[2] + dir[2] * dist];
  const d = [head[0] - e[0], head[1] - e[1], head[2] - e[2]];
  await ev(`__sdfGame.setPose(${e[0]}, ${e[2]}, ${Math.atan2(d[0], -d[2])}, ${Math.atan2(d[1], Math.hypot(d[0], d[2]))}, 0)`);
}
async function shot(name) {
  await ev("__sdfGame.setRenderLock(true)");
  await step(2, 0);
  await ev("__sdfGame.resolveGpu()");
  await ev("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  const s = await send("Page.captureScreenshot", { format: "png" });
  await ev("__sdfGame.setRenderLock(false)");
  writeFileSync(`${OUT}/${TAG}-${CHAR}-${name}.png`, Buffer.from(s.result.data, "base64"));
}
// Which way the face is: try both and keep the one the head frame says is front.
const fr = await ev(`__sdfGame.head?.frame?.(${a.id}) ?? null`);
let front = fwd;
if (fr) { const [x, y, z, w] = fr.quat; const v = [0, 0, 1]; const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  const f = [v[0] + w * tx + (y * tz - z * ty), 0, v[2] + w * tz + (x * ty - y * tx)]; const l = Math.hypot(f[0], f[2]) || 1; front = [f[0] / l, 0, f[2] / l]; }
const camFront = () => camFrom(front, 0.9, 0.12);
await camFront(); await step(2); await shot("0-closed");
const out = { id: a.id, head, front };
await camFront();
out.chop1 = await ev(`__sdfGame.axeChop(${a.id}, "H", "head")`);
await step(40);
out.state1 = await ev(`__sdfGame.headSplit(${a.id})`);
await camFront(); await shot("1-chop1");
out.chop2 = await ev(`__sdfGame.axeChop(${a.id}, "H", "head")`);
await step(60);
out.state2 = await ev(`__sdfGame.headSplit(${a.id})`);
out.dbg = await ev(`(() => { const d = __sdfGame.actorList().find(x => x.id === ${a.id}); return d; })()`);
await camFront(); await shot("2-chop2");
// Three-quarter view, above.
await camFrom([front[0] * 0.6 + front[2] * 0.8, 0, front[2] * 0.6 - front[0] * 0.8], 0.8, 0.35); await step(1); await camFrom([front[0] * 0.6 + front[2] * 0.8, 0, front[2] * 0.6 - front[0] * 0.8], 0.8, 0.35); await shot("3-side");
// The kill chop, then thaw and let the corpse settle (and the soldier's corpse bake run).
out.chop3 = await ev(`__sdfGame.axeChop(${a.id}, "H", "head")`);
await ev("__sdfGame.freeze(false)");
await step(360);
await ev("new Promise((r) => setTimeout(r, 1500))");
await step(30);
out.corpse = await ev(`(() => { const d = __sdfGame.actorList().find(x => x.id === ${a.id}); const z = __sdfGame.zombie?.(${a.id}); return { phase: d?.phase, split: !!z?.posed().split, bake: __sdfGame.soldierCorpseBake?.() ?? null }; })()`);
out.state3 = await ev(`__sdfGame.headSplit(${a.id})`);
const h2 = await ev(`__sdfGame.actorLimbCenter(${a.id}, "head")`);
out.corpseHead = h2;
if (h2) {
  // Stand back so the head sits mid-frame, well above the weapon.
  const pos = (await ev("__sdfGame.actorList()")).find((x) => x.id === a.id).pos;
  const t = await ev(`__sdfGame.actorLimbCenter(${a.id}, "torso")`) ?? pos;
  let ax = h2[0] - t[0], az = h2[2] - t[2]; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
  const e = [h2[0] + ax * 0.9, 1.62, h2[2] + az * 0.9];
  const d = [h2[0] - e[0], h2[1] - e[1], h2[2] - e[2]];
  await ev(`__sdfGame.setPose(${e[0]}, ${e[2]}, ${Math.atan2(d[0], -d[2])}, ${Math.atan2(d[1], Math.hypot(d[0], d[2]))}, 0)`);
  await step(2, 0);
  await shot("4-corpse");
}
out.wounds =(await ev(`__sdfGame.actorWounds(${a.id})`))?.map?.((w) => ({ limb: w.limb, shape: w.shape, headRegion: w.headRegion, headSlot: w.headSlot })) ?? null;
out.logs = logs.filter((l) => /head|split|error|warn/i.test(l)).slice(-15);
console.log(JSON.stringify(out, null, 1));
ws.close();
await fetch(`http://localhost:${CDP}/json/close/${tab.id}`).catch(() => {});
process.exit(0);
