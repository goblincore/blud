// scripts/cloth-cost.mjs — what SDF cloth costs the march (docs/dev-notes/2026-10-26-sdf-cloth-cost/NOTES.md).
//
// For every scene x cloth variant, sdf-bench.html is loaded on its HELD yaw-0 frame (?debug=shaded) and:
//   1. THE CENSUS (__sdfBench.census): the march's raw counters summed over the float march target, debug modes
//      13 (the walk) and 14 (the whole pixel). Deterministic: machine load cannot move them.
//   2. a screenshot of the shaded still (OUT/<scene>-<variant>.png), the visual check that the garment is there.
//   3. TIMING=1: a timed orbit per leg (SECONDS), legs rotated over ROUNDS rounds so a drift in load lands on all
//      of them; the 1-minute load average is logged beside every run. Not trustworthy above a load of ~6.
//
// Usage (bash; servers from scripts/lab-servers.sh):
//   bash -c 'export LAB_TMP=.lab-tmp LAB_VITE_PORT=5281 LAB_CDP_PORT=9281; . scripts/lab-servers.sh;
//     trap lab_servers_down EXIT; lab_servers_up; node scripts/cloth-cost.mjs 5281 9281'
// Env: SCENES (CZ,Z1)  VARIANTS (none,paint,offset,trousers,robe,robe-flat)  QS (extra page flags)
//      DUMP=1 (raw mode-13 texels per leg)  TIMING=1  ROUNDS (3)  SECONDS (8)  SCALE (0.7)  OUT (.lab-tmp/cloth-cost)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";

const VITE = Number(process.argv[2] ?? 5281);
const CDP = Number(process.argv[3] ?? 9281);
const SCENES = (process.env.SCENES ?? "CZ,Z1").split(",");
const VARIANTS = (process.env.VARIANTS ?? "none,paint,offset,trousers,robe,robe-flat").split(",");
const QS = process.env.QS ? `&${process.env.QS}` : "";
const TIMING = process.env.TIMING === "1";
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const SECONDS = Number(process.env.SECONDS ?? 8);
const SCALE = Number(process.env.SCALE ?? 0.7);
const OUT = process.env.OUT ?? ".lab-tmp/cloth-cost";
const W = 1536, H = 1704;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
mkdirSync(OUT, { recursive: true });

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: "PUT" })).json();
process.on("exit", () => { try { execFileSync("curl", ["-s", "-m", "2", `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: "ignore" }); } catch { /* gone */ } });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400));
};
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
await send("Page.enable");
await send("Runtime.enable");
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send("Page.bringToFront");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

async function open(scene, variant, extra) {
  errors.length = 0;
  const cloth = variant === "none" ? "" : `&cloth=${variant}`;
  const url = `http://localhost:${VITE}/sdf-bench.html?scene=${scene}&scale=${SCALE}${cloth}${extra}${QS}`;
  await send("Page.navigate", { url });
  for (let i = 0; i < 480; i++) {
    await sleep(500);
    const st = await evaluate("(() => { const b = window.__bench; if (b && b.error) return 'error:' + b.error; return typeof window.__sdfBench === 'object' ? 'up' : null; })()").catch(() => null);
    if (st?.startsWith?.("error:")) die(`${scene}/${variant}: ${st}`);
    if (st === "up") return url;
  }
  die(`${scene}/${variant}: page never booted (${errors.slice(-3).join(" | ")})`);
}

const result = { when: new Date().toISOString(), scale: SCALE, qs: QS, census: {}, timing: {} };
for (const scene of SCENES) {
  for (const variant of VARIANTS) {
    const url = await open(scene, variant, "&debug=shaded");
    for (let i = 0; i < 120 && !(await evaluate("window.__sdfBench.ready")); i++) await sleep(500);
    await sleep(1500);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}/${scene}-${variant}.png`, Buffer.from(shot.result.data, "base64"));
    const c = await evaluate("window.__sdfBench.census()");
    if (process.env.DUMP === "1") {
      // The walk's raw texels (mode 13: prims, -, steps + 1000 hit), for a per-texel diff between legs.
      const d = await evaluate("window.__sdfBench.counters(13)");
      writeFileSync(`${OUT}/${scene}-${variant}.w${d.w}h${d.h}.f32`, Buffer.from(d.rgba32f, "base64"));
    }
    if (errors.length) die(`${scene}/${variant}: console errors: ${errors.join(" | ")}`);
    const w = c.walk, a = c.all;
    const row = {
      marched: w.marched, hits: w.hits,
      stepsPerPx: +(w.steps / w.marched).toFixed(2), primsPerPx: +(w.prims / w.marched).toFixed(1),
      primsPerStep: +(w.prims / w.steps).toFixed(2), walkPrims: w.prims,
      shadePrims: a.prims - w.hitPrims, totalPrims: w.prims + a.prims - w.hitPrims,
    };
    result.census[`${scene}/${variant}`] = { url, ...row, raw: c };
    console.log(`${scene.padEnd(3)} ${variant.padEnd(10)} marched ${String(row.marched).padStart(7)} hit ${String(row.hits).padStart(7)}`
      + ` steps/px ${String(row.stepsPerPx).padStart(6)} prims/px ${String(row.primsPerPx).padStart(6)} prims/step ${String(row.primsPerStep).padStart(5)}`
      + ` walk ${(row.walkPrims / 1e6).toFixed(2)}M shade ${(row.shadePrims / 1e6).toFixed(2)}M total ${(row.totalPrims / 1e6).toFixed(2)}M`);
  }
}

if (TIMING) {
  for (let round = 0; round < ROUNDS; round++) {
    const legs = SCENES.flatMap((s) => VARIANTS.map((v) => [s, v]));
    const rot = legs.slice(round % legs.length).concat(legs.slice(0, round % legs.length));
    for (const [scene, variant] of rot) {
      await open(scene, variant, `&seconds=${SECONDS}`);
      const load0 = loadavg()[0];
      let r = null;
      for (let i = 0; i < (SECONDS + 120) * 2; i++) { await sleep(500); r = await evaluate("window.__bench ?? null"); if (r?.done) break; }
      if (!r?.done || r.error) die(`${scene}/${variant} timing: ${r?.error ?? "never finished"}`);
      const key = `${scene}/${variant}`;
      (result.timing[key] ??= []).push({ p50: r.summary.p50, p95: r.summary.p95, mean: r.summary.mean, hidden: r.hiddenFrames, load0, load1: loadavg()[0] });
      console.log(`round ${round} ${key.padEnd(14)} p50 ${r.summary.p50?.toFixed?.(2)} ms  load ${load0.toFixed(1)} -> ${loadavg()[0].toFixed(1)}`);
    }
  }
}
writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
console.log(`wrote ${OUT}/result.json`);
ws.close();
process.exit(0);
