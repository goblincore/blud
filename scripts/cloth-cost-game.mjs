// scripts/cloth-cost-game.mjs — what SDF cloth costs the GAME's march (docs/dev-notes/2026-10-26-sdf-cloth-cost/NOTES.md).
//
// The bench page (scripts/cloth-cost.mjs) has no outer hull, so its background rays walk the whole proxy box; the
// game discards them. This driver measures the same garments (bench-cloth.ts, `?cloth=<variant>` on the zombie
// registry entry) on the game page as it ships (crowd march, hulls, kit occluder), frozen and seeded:
//   arena   the bare page's arena (room 6: six zombies, two soldiers), the view teleport() leaves.
//   close   room 4's nearest zombie, the eye CLOSE_D m in front of its chest.
// Per boot and stage: THE CENSUS (debug modes 13 and 14 read off the float march target: steps and prim evaluations,
// deterministic) and __sdfGame.timeDraws(N) (fenced still frames, CPU + GPU; ROUNDS boots per variant, the variants
// rotated, the 1-minute load average logged beside each). Timing is not trustworthy above a load of ~6.
//
// Usage (bash; servers from scripts/lab-servers.sh):
//   bash -c 'export LAB_TMP=.lab-tmp LAB_VITE_PORT=5282 LAB_CDP_PORT=9282; . scripts/lab-servers.sh;
//     trap lab_servers_down EXIT; lab_servers_up; node scripts/cloth-cost-game.mjs 5282 9282'
// Env: VARIANTS (none,paint,trousers,robe,robe-flat)  STAGES (arena,close)  ROUNDS (2)  N (60)  CLOSE_D (1.3)
//      DUMP=1 (raw mode-13 texels per stage and variant)  QS (extra page flags)  OUT (.lab-tmp/cloth-cost-game)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";

const VITE = Number(process.argv[2] ?? 5282);
const CDP = Number(process.argv[3] ?? 9282);
const VARIANTS = (process.env.VARIANTS ?? "none,paint,trousers,robe,robe-flat").split(",");
const STAGES = (process.env.STAGES ?? "arena,close").split(",");
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const N = Number(process.env.N ?? 60);
const CLOSE_D = Number(process.env.CLOSE_D ?? 1.3);
const QS = process.env.QS ? `&${process.env.QS}` : "";
const OUT = process.env.OUT ?? ".lab-tmp/cloth-cost-game";
const W = 1280, H = 800, EYE_H = 1.62;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
mkdirSync(OUT, { recursive: true });

let S = null;
async function openSession() {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  const s = { tab, ws, seq: 0, pending: new Map(), console: [] };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && s.pending.has(m.id)) { s.pending.get(m.id)(m); s.pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") s.console.push(`exception: ${JSON.stringify(m.params.exceptionDetails).slice(0, 300)}`);
  };
  s.send = (method, params = {}) => new Promise((res) => { const id = ++s.seq; s.pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  S = s;
  await s.send("Page.enable"); await s.send("Runtime.enable");
  await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
  await s.send("Page.bringToFront");
  await s.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
}
function closeSession() {
  if (!S) return;
  try { S.ws.close(); } catch { /* gone */ }
  try { execFileSync("curl", ["-s", "-m", "2", `http://localhost:${CDP}/json/close/${S.tab.id}`], { stdio: "ignore" }); } catch { /* gone */ }
  S = null;
}
process.on("exit", closeSession);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { closeSession(); process.exit(130); });
const evaluate = async (expression, ms = 600000) => {
  const r = await Promise.race([
    S.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${expression.slice(0, 100)}`)), ms)),
  ]);
  if (r.result?.exceptionDetails) throw new Error(`page threw in ${expression.slice(0, 100)}: ${JSON.stringify(r.result.exceptionDetails).slice(0, 500)}`);
  return r.result?.result?.value;
};

/** The frame-cost.mjs boot: the game page, frozen and seeded, the background warm (crowd march, gibs) done. */
async function boot(variant) {
  await openSession();
  const cloth = variant === "none" ? "" : `&cloth=${variant}`;
  await S.send("Page.navigate", { url: `http://localhost:${VITE}/sdf-game.html?seed=1&loader=0&frozen=1${cloth}${QS}` });
  let backend = null;
  for (let i = 0; i < 240 && !backend; i++) { await sleep(500); try { backend = await evaluate("typeof window.__sdfGame === \"object\" ? window.__sdfGame.backend : null"); } catch { backend = null; } }
  if (backend !== "webgpu") die(`backend ${backend}, expected webgpu (${S.console.slice(-2).join(" | ")})`);
  for (let i = 0; i < 480; i++) { if (await evaluate("window.__warmGate ? window.__warmGate.phase : \"ready\"") === "ready") break; await sleep(500); }
  await evaluate("__sdfGame.setLoopRunning(false)");
  let wb = null;
  for (let i = 0; i < 800; i++) { wb = await evaluate("__sdfGame.warmBackground()"); if (wb.gib === "ready" && wb.crowd === "ready") break; if (wb.gib === "failed" || wb.crowd === "failed") break; await sleep(500); if (i % 10 === 0) await evaluate("__sdfGame.step(1, 0)"); }
  if (wb?.gib !== "ready" || wb?.crowd !== "ready") die(`the background warm is ${JSON.stringify(wb)}`);
  await evaluate("__sdfGame.installDebugProbe()");
}

async function stage(name) {
  if (name === "arena") {
    await evaluate("(() => { __sdfGame.freeze(true); __sdfGame.teleport(6); for (let i = 0; i < 30; i++) __sdfGame.step(1, 0); return 1; })()");
    return;
  }
  await evaluate("(() => { __sdfGame.freeze(true); __sdfGame.teleport(4); __sdfGame.step(1, 0); return 1; })()");
  const pose = await evaluate("__sdfGame.pose()");
  const zs = (await evaluate("__sdfGame.actorList()")).filter((a) => a.kind === "zombie" && a.room === 4);
  const z = zs.sort((a, b) => Math.hypot(a.pos[0] - pose.pos[0], a.pos[2] - pose.pos[2]) - Math.hypot(b.pos[0] - pose.pos[0], b.pos[2] - pose.pos[2]))[0];
  if (!z) die("no zombie in room 4");
  const torso = await evaluate(`__sdfGame.actorLimbCenter(${z.id}, "torso")`);
  const t = [torso[0], torso[1] - 0.15, torso[2]];
  const fx = Math.sin(z.yaw), fz = -Math.cos(z.yaw);
  const hz = Math.sqrt(Math.max(0.01, CLOSE_D * CLOSE_D - (t[1] - EYE_H) ** 2));
  await evaluate(`__sdfGame.placePlayer({ x: ${t[0] + fx * hz}, z: ${t[2] + fz * hz}, yaw: ${Math.atan2(-fx, fz)}, pitch: ${Math.atan2(t[1] - EYE_H, hz)} })`);
  await evaluate("(() => { for (let i = 0; i < 30; i++) __sdfGame.step(1, 0); return 1; })()");
}

/** Modes 13 (the walk, misses included) and 14 (the whole pixel, hits only), summed in the page. */
const census = () => evaluate(`(async () => {
  const sum = async (mode) => {
    __sdfGame.setMarchDebugMode(mode);
    await __sdfGameDebug.readMarchTarget();
    const r = await __sdfGameDebug.readMarchTarget();
    const f = new Float32Array(Uint8Array.from(atob(r.rgba32f), (c) => c.charCodeAt(0)).buffer);
    let marched = 0, hits = 0, steps = 0, prims = 0, hitPrims = 0;
    for (let i = 0; i < f.length; i += 4) {
      const b = f[i + 2];
      if (!(b >= 0.5)) continue;
      marched++; prims += f[i]; steps += b % 1000;
      if (b >= 1000) { hits++; hitPrims += f[i]; }
    }
    return { marched, hits, steps, prims, hitPrims };
  };
  const walk = await sum(13), all = await sum(14);
  __sdfGame.setMarchDebugMode(0);
  await __sdfGameDebug.readMarchTarget();
  return { walk, all };
})()`);

const result = { when: new Date().toISOString(), n: N, closeD: CLOSE_D, qs: QS, census: {}, timing: {} };
for (let round = 0; round < ROUNDS; round++) {
  const order = VARIANTS.slice(round % VARIANTS.length).concat(VARIANTS.slice(0, round % VARIANTS.length));
  for (const variant of order) {
    await boot(variant);
    for (const st of STAGES) {
      await stage(st);
      const key = `${st}/${variant}`;
      if (!result.census[key]) {
        const c = await census();
        const w = c.walk, a = c.all;
        result.census[key] = { ...c, totalPrims: w.prims + a.prims - w.hitPrims };
        if (process.env.DUMP === "1") {
          // The walk's raw texels (mode 13), de-padded, for a per-texel diff between variants.
          const d = await evaluate(`(async () => { __sdfGame.setMarchDebugMode(13); await __sdfGameDebug.readMarchTarget(); const r = await __sdfGameDebug.readMarchTarget(); __sdfGame.setMarchDebugMode(0); await __sdfGameDebug.readMarchTarget(); return r; })()`);
          writeFileSync(`${OUT}/${st}-${variant}.w${d.w}h${d.h}.f32`, Buffer.from(d.rgba32f, "base64"));
        }
        const shot = await S.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${OUT}/${st}-${variant}.png`, Buffer.from(shot.result.data, "base64"));
        console.log(`${st.padEnd(5)} ${variant.padEnd(10)} marched ${String(w.marched).padStart(7)} hit ${String(w.hits).padStart(6)}`
          + ` steps ${(w.steps / 1e6).toFixed(2)}M (${(w.steps / w.marched).toFixed(1)}/px) walk ${(w.prims / 1e6).toFixed(2)}M`
          + ` shade ${((a.prims - w.hitPrims) / 1e6).toFixed(2)}M total ${(result.census[key].totalPrims / 1e6).toFixed(2)}M`);
      }
      const load0 = loadavg()[0];
      const ms = await evaluate(`__sdfGame.timeDraws(${N})`);
      (result.timing[key] ??= []).push({ ms, load0, load1: loadavg()[0] });
      console.log(`  round ${round} ${key.padEnd(16)} ${ms.toFixed(2)} ms  load ${load0.toFixed(1)} -> ${loadavg()[0].toFixed(1)}`);
    }
    if (S.console.length) die(`${variant}: ${S.console.join(" | ")}`);
    closeSession();
  }
}
writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
console.log(`wrote ${OUT}/result.json`);
process.exit(0);
