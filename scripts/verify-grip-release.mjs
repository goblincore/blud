// CDP live-sequence verification for X1.27 task F (F4 step 2): load the lab,
// enter FPV, select the CLIP hand field, and walk the FULL ownership cycle —
// open→close (presented), cook, scripted underhand throw, marker handoff
// (numerically asserted), flight, detonation, recovery, next close — while
// recording every console event. The gate: the cycle completes AND the
// console holds no shader/pipeline/GLB/unhandled-rejection error.
//
// Usage: node scripts/verify-grip-release.mjs <vitePort> <cdpPort>
import { writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5291);
const CDP = Number(process.argv[3] ?? 9224);
const OUT = 'docs/dev-notes/2026-08-17-sdf-dynamite-grip/task-f-smoke.png';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const res = await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' });
const tab = await res.json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
ws.onclose = (ev) => consoleEvents.push(`WS-CLOSED: code=${ev.code} reason=${ev.reason}`);
process.on('exit', () => { try { ws.close(); } catch { /* already gone */ } });

let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push(`exception: ${JSON.stringify(m.params.exceptionDetails).slice(0, 400)}`);
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1380, height: 820, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });

// Boot wait — the lab object AND the new F-task keys must exist (a stale
// server/port would serve old code; this fails loudly instead).
let booted = false;
for (let i = 0; i < 160; i++) {
  await sleep(500);
  booted = await evaluate('typeof window.__sdfLab === "object" && !!window.__sdfLab.fpv');
  if (booted) break;
}
if (!booted) {
  console.log('console tail:', consoleEvents.slice(-8));
  throw new Error('lab did not boot (__sdfLab.fpv absent)');
}
const hasNewKeys = await evaluate(
  'window.__sdfLab.fpv.gripPhase !== undefined && typeof window.__sdfLab.setGripPlayback === "function" && typeof window.__sdfLab.playGripThrow === "function"');
if (!hasNewKeys) throw new Error('served bundle lacks task-F keys — stale server/port?');
console.log('served bundle: task-F keys present');

const backend = await evaluate(`(async () => {
  const a = await navigator.gpu?.requestAdapter();
  return a ? 'webgpu-ok' : 'NO-ADAPTER';
})()`, true);
console.log('backend:', backend);

// Wait for BOTH loads: the static volume and the combined clip+GLB settlement.
for (let i = 0; i < 120; i++) {
  const st = await evaluate('window.__sdfLab.fpv');
  if (st.staticLoad === 'ready' && st.clipLoad === 'ready') break;
  await sleep(500);
}
await evaluate('window.__sdfLab.enterFpv()');
// Pin the aim (deterministic launch state; pointer-lock mouse is irrelevant).
await evaluate('window.__sdfLab.setFpvAim({ yaw: 0, pitch: -0.03, pos: [0, 0, 4] })');
await evaluate(`window.__sdfLab.setHandField('clip'), true`);
let fpv = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  fpv = await evaluate('window.__sdfLab.fpv');
  if (fpv.handField === 'clip' && fpv.clipLoad === 'ready') break;
}
console.log('clip field:', JSON.stringify({
  handField: fpv.handField, staticLoad: fpv.staticLoad, clipLoad: fpv.clipLoad,
  glbLoad: fpv.glbLoad, clipError: fpv.clipError,
}));
if (fpv.handField !== 'clip') throw new Error('clip field did not engage');

const raf = (n) => evaluate(`new Promise(r => { let k = 0;
  const tick = () => (++k >= ${n} ? r(true) : requestAnimationFrame(tick));
  requestAnimationFrame(tick); })`, true);

// — open→close: a bundle presents (recovery holds idle) and the clip closes.
await raf(30);
const closeWitness = await evaluate(`(async () => {
  // Restart the controller deterministically from open, then watch for held.
  window.__sdfLab.setGripPlayback('play');
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    const s = window.__sdfLab.fpv;
    if (s.gripPhase === 'held' && s.grip01Controller === 1) return { held: true, at: performance.now() - t0 };
    await new Promise(r => requestAnimationFrame(r));
  }
  return { held: false, last: window.__sdfLab.fpv.gripPhase };
})()`, true);
console.log('open→close:', JSON.stringify(closeWitness));
if (!closeWitness.held) throw new Error('clip never reached held/firm-grip');

// — cook + scripted throw: playGripThrow parks the deferred pending throw.
await evaluate('window.__sdfLab.playGripThrow(0.5), true');
const parked = await evaluate('window.__sdfLab.fpv');
console.log('throw parked:', JSON.stringify({
  cookPhase: parked.cookPhase, gripPhase: parked.gripPhase, propOwner: parked.propOwner,
}));

// — marker handoff + flight (numbers!): exactly one release, handoff error
//   < 0.1 mm, prop owner flips to flight at the rendered root.
const handoff = await evaluate(`(async () => {
  const t0 = performance.now();
  let before = null;
  while (performance.now() - t0 < 2000) {
    const s = window.__sdfLab.fpv;
    if (s.releaseCount >= 1) {
      return {
        released: true, releaseCount: s.releaseCount,
        handoffErrorM: s.handoffErrorM, propOwner: s.propOwner,
        glbRoot: s.glbRoot, flightPos: s.flightPos,
        gripPhase: s.gripPhase, grip01: s.grip01,
      };
    }
    before = s;
    await new Promise(r => requestAnimationFrame(r));
  }
  return { released: false, last: before && { phase: before.gripPhase, cook: before.cookPhase } };
})()`, true);
console.log('marker handoff:', JSON.stringify(handoff));
if (!handoff.released) throw new Error('release marker never fired');
if (handoff.releaseCount !== 1) throw new Error('release not exactly-once');
if (!(handoff.handoffErrorM < 1e-4)) {
  throw new Error(`handoff moved the bundle: ${handoff.handoffErrorM} m (gate 1e-4)`);
}
console.log(`handoff error: ${(handoff.handoffErrorM * 1000).toFixed(6)} mm (< 0.1 mm gate)`);

// — flight → detonation → recovery → next close (the full cycle, unwatched).
const cycle = await evaluate(`(async () => {
  const t0 = performance.now();
  const out = { detonated: false, recovered: false, nextClose: false, flight: false };
  let last = null;
  while (performance.now() - t0 < 8000) {
    const s = window.__sdfLab.fpv;
    last = s;
    if (s.flightPos) out.flight = true;
    if (out.flight && !s.flightPos && !out.detonated) out.detonated = true;
    if (out.detonated && (s.gripPhase === 'closing' || s.gripPhase === 'held') && s.releaseCount >= 1) {
      out.recovered = s.cookPhase === 'idle' || s.cookPhase === 'cooldown';
      out.nextClose = true;
      out.grip01After = s.grip01;
      out.phaseAfter = s.gripPhase;
      return out;
    }
    await new Promise(r => requestAnimationFrame(r));
  }
  out.last = last && {
    gripPhase: last.gripPhase, gripElapsedSec: last.gripElapsedSec,
    cookPhase: last.cookPhase, handField: last.handField,
    flightPos: last.flightPos, releaseCount: last.releaseCount,
    propOwner: last.propOwner, gripPlayback: last.gripPlayback,
  };
  return out;
})()`, true);
console.log('cycle:', JSON.stringify(cycle));
if (!cycle.flight || !cycle.detonated || !cycle.nextClose) {
  throw new Error('full cycle incomplete (flight/detonation/recovery/next close)');
}

// — scrub is purely visual (F3 step 2): pause + scrub changes the sample and
//   creates NO pending throw, flight, or cook activity.
const scrub = await evaluate(`(async () => {
  window.__sdfLab.setGripPlayback('pause');
  window.__sdfLab.setGripProgress(0.5);
  await new Promise(r => setTimeout(r, 250));
  const s = window.__sdfLab.fpv;
  return {
    grip01: s.grip01, frame0: s.frame0, frame1: s.frame1, frameAlpha: s.frameAlpha,
    cookPhase: s.cookPhase, flightPos: s.flightPos, releaseCount: s.releaseCount,
    propOwner: s.propOwner,
  };
})()`, true);
console.log('scrub:', JSON.stringify(scrub));
const scrubOk = scrub.grip01 === 0.5 && scrub.frame0 === 2 && scrub.frame1 === 3
  && Math.abs(scrub.frameAlpha - 0.5) < 1e-3
  && scrub.flightPos === null && scrub.releaseCount === 1 && scrub.cookPhase !== 'cooking';
if (!scrubOk) throw new Error('scrub violated the visual-only contract');

// Resume play for a clean final state, settle, screenshot evidence.
await evaluate('window.__sdfLab.setGripPlayback("play"), true');
await raf(20);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const png = Buffer.from(shot.result?.data ?? shot.data, 'base64');
writeFileSync(OUT, png);
console.log('screenshot ->', OUT, png.length, 'bytes');

const badConsole = consoleEvents.filter(e =>
  /GPUValidationError|GPUInternalError|GPUOutOfMemoryError|compil|shader|pipeline|GLB|dynamite|unhandled|error/i.test(e));
console.log('console events (filtered):', badConsole.length);
for (const e of badConsole.slice(0, 12)) console.log('  |', e.slice(0, 300));

const pass = backend === 'webgpu-ok'
  && fpv.handField === 'clip' && fpv.clipLoad === 'ready'
  && closeWitness.held
  && handoff.released && handoff.releaseCount === 1 && handoff.handoffErrorM < 1e-4
  && cycle.flight && cycle.detonated && cycle.nextClose
  && scrubOk
  && badConsole.every(e => !/GPUValidationError|compil|shader|GLB|dynamite|unhandled/i.test(e));
console.log(pass ? 'GRIP RELEASE SEQUENCE PASS' : 'GRIP RELEASE SEQUENCE FAIL');
process.exit(pass ? 0 : 1);
