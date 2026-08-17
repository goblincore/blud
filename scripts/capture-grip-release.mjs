// CDP capture run for X1.27 task F (F4 step 3): the eight fixed views (jiggle
// off, pinned eye/aim/light/material/SDF scale/no wounds) and two normal-speed
// webm loops (jiggle off / on) of the full close→hold→toss→detonate→re-close
// cycle, driven by the loop playback mode. Numerical handoff assertion is
// re-recorded alongside. Evidence lands in docs/dev-notes/2026-08-17-sdf-dynamite-grip/.
//
// Usage: node scripts/capture-grip-release.mjs <vitePort> <cdpPort> <outDir>
import { writeFileSync, mkdirSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5291);
const CDP = Number(process.argv[3] ?? 9224);
const OUT = process.argv[4] ?? 'docs/dev-notes/2026-08-17-sdf-dynamite-grip';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const res = await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' });
const tab = await res.json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
ws.onclose = (ev) => console.log(`[ws closed ${ev.code}]`);
process.on('exit', () => { try { ws.close(); } catch { /* gone */ } });

let seq = 0;
const pending = new Map();
const consoleEvents = [];
const videoFrames = [];
let recording = false;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push(`exception: ${JSON.stringify(m.params.exceptionDetails).slice(0, 400)}`);
  }
  if (m.method === 'Page.screencastFrame') {
    const { data, metadata, sessionId } = m.params;
    if (recording) {
      videoFrames.push({ jpeg: Buffer.from(data, 'base64'), ts: metadata.timestamp * 1000 });
    }
    // Ack every frame so the stream keeps flowing.
    void send('Page.screencastFrameAck', { sessionId }).catch(() => {});
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

for (let i = 0; i < 160; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfLab === "object" && !!window.__sdfLab.fpv')) break;
}
for (let i = 0; i < 120; i++) {
  const st = await evaluate('window.__sdfLab.fpv');
  if (st.staticLoad === 'ready' && st.clipLoad === 'ready') break;
  await sleep(500);
}

// ——— Pin everything the gate pins ————————————————————————————————————————
// eye/aim, material + light (boot defaults, untouched), SDF scale 1, no
// wounds, jiggle OFF (hand warp off). Recorded into the notes verbatim.
await evaluate(`(() => {
  window.__sdfLab.enterFpv();
  window.__sdfLab.setFpvAim({ yaw: 0, pitch: -0.03, pos: [0, 0, 4] });
  window.__sdfLab.setHandField('clip');
  window.__sdfLab.setHandWarp(false);
  window.__sdfLab.setSdfScale(1);
  window.__sdfLab.setGripPlayback('play');
  return true;
})()`);
for (let i = 0; i < 40; i++) {
  const st = await evaluate('window.__sdfLab.fpv');
  if (st.handField === 'clip') break;
  await sleep(500);
}
const raf = (n) => evaluate(`new Promise(r => { let k = 0;
  const tick = () => (++k >= ${n} ? r(true) : requestAnimationFrame(tick));
  requestAnimationFrame(tick); })`, true);

/** rAF-accurate pause: run a condition loop inside ONE evaluate; the frame
 *  the condition fires in pauses the controller synchronously. */
const pauseWhen = (condJs, timeoutMs = 6000) => evaluate(`(async () => {
  const t0 = performance.now();
  while (performance.now() - t0 < ${timeoutMs}) {
    const s = window.__sdfLab.fpv;
    if (${condJs}) { window.__sdfLab.setGripPlayback('pause'); return s; }
    await new Promise(r => requestAnimationFrame(r));
  }
  return null;
})()`, true);

const shot = async (name) => {
  await raf(3); // let the paused pose settle through the pipeline
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(s.result?.data ?? s.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, png);
  const st = await evaluate('window.__sdfLab.fpv');
  console.log(`${name}.png ${png.length}B · phase ${st.gripPhase} grip01 ${st.grip01?.toFixed(3)} owner ${st.propOwner}`);
};

// ——— The five closure states: exact authored frames via the scrub ————————
// (scrub is pause-only + visual: the authored pose is held exactly)
const stills = process.argv[5] !== 'loops';
if (stills) {
await evaluate('window.__sdfLab.setGripProgress(0.0), true');
await shot('open');
await evaluate('window.__sdfLab.setGripProgress(0.4), true');
await shot('first-contact');
await evaluate('window.__sdfLab.setGripProgress(0.6), true');
await shot('wrap');
await evaluate('window.__sdfLab.setGripProgress(0.8), true');
await shot('thumb-lock');
await evaluate('window.__sdfLab.setGripProgress(1.0), true');
await shot('firm-grip');
}

if (stills) {
// ——— release-marker: a REAL throw, paused the frame the marker fired ————
await evaluate('window.__sdfLab.setGripPlayback("play"), true');
await raf(40); // re-present → held
await evaluate('window.__sdfLab.playGripThrow(0.5), true');
const marker = await pauseWhen('s.releaseCount >= 1 && s.propOwner === "flight"');
console.log('marker state:', marker && JSON.stringify({
  releaseCount: marker.releaseCount, handoffErrorM: marker.handoffErrorM,
  glbRoot: marker.glbRoot, flightPos: marker.flightPos,
}));
if (!marker || !(marker.handoffErrorM < 1e-4)) throw new Error('marker pause failed');
await shot('release-marker');

// ——— bundle-clear: fingers mostly open, bundle away ————————————————
await evaluate('window.__sdfLab.setGripPlayback("play"), true');
const clear = await pauseWhen('s.gripPhase === "throwing" && s.gripElapsedSec >= 0.19');
console.log('bundle-clear state:', clear && `${clear.gripPhase}@${clear.gripElapsedSec}`);
await shot('bundle-clear');

// ——— follow-through: the open hand holds where the swing left it ————————
await evaluate('window.__sdfLab.setGripPlayback("play"), true');
const ft = await pauseWhen('s.gripPhase === "follow-through" && s.grip01Controller === 0');
console.log('follow-through state:', ft && `${ft.gripPhase}`);
await shot('follow-through');
}

// ——— The two normal-speed loops (webm): close→hold→toss→detonate→next close
/** Records one webm via CDP screencast while the loop mode plays. */
async function recordLoop(name, warpOn, seconds) {
  await evaluate(`window.__sdfLab.setHandWarp(${warpOn}), true`);
  await evaluate('window.__sdfLab.setGripPlayback("loop"), true');
  await raf(5);
  videoFrames.length = 0;
  await send('Page.startScreencast', {
    format: 'jpeg', quality: 80, everyNthFrame: 1, maxWidth: 1380,
  });
  recording = true;
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) await sleep(200);
  recording = false;
  await send('Page.stopScreencast');
  await sleep(300); // drain in-flight frames
  await evaluate('window.__sdfLab.setGripPlayback("play"), true');
  const frames = [...videoFrames];
  if (frames.length < 30) throw new Error(`${name}: only ${frames.length} frames captured`);
  // Assemble the JPEG ring into a webm with ffmpeg (timestamps preserved).
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const tmp = `/tmp/grip-frames-${name}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  let lastTs = frames[0].ts;
  const concat = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    // Variable-frame-rate → CFR via per-frame concat durations.
    const dtMs = Math.max(1, Math.min(200, f.ts - lastTs));
    lastTs = f.ts;
    fs.writeFileSync(`${tmp}/f${String(i).padStart(5, '0')}.jpg`, f.jpeg);
    concat.push(`file 'f${String(i).padStart(5, '0')}.jpg'`);
    concat.push(`duration ${(dtMs / 1000).toFixed(4)}`);
  }
  // ffmpeg needs the last file repeated for the final duration to stick.
  const lastFile = `f${String(frames.length - 1).padStart(5, '0')}.jpg`;
  concat.push(`file '${lastFile}'`);
  fs.writeFileSync(`${tmp}/list.txt`, concat.join('\n') + '\n');
  execFileSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', `${tmp}/list.txt`,
    '-vsync', 'vfr', '-c:v', 'libvpx-vp9', '-b:v', '2M', '-pix_fmt', 'yuv420p',
    `${OUT}/${name}.webm`,
  ], { stdio: 'ignore' });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${name}.webm: ${frames.length} frames, ${seconds}s, warp=${warpOn}`);
}

// Detonations during the loops are the real gameplay ones (loop auto-tosses
// at charge 0.5); the scene heals nothing — the corpse is part of the loop.
// Optional argv[5] filter: 'loops' skips the stills.
if (process.argv[5] !== 'loops') {
  await recordLoop('grip-release-loop', false, 16);
}
// The jiggle-on loop: re-enable the distal warp (the visible jiggle path).
await send('Page.bringToFront');
await recordLoop('grip-release-loop-jiggle', true, 16);
await evaluate('window.__sdfLab.setHandWarp(false), true');

const badConsole = consoleEvents.filter(e =>
  /GPUValidationError|GPUInternalError|GPUOutOfMemoryError|compil|shader|pipeline|GLB|dynamite|unhandled|error/i.test(e));
console.log('console events (filtered):', badConsole.length);
for (const e of badConsole.slice(0, 10)) console.log('  |', e.slice(0, 300));
console.log('CAPTURE RUN DONE');
process.exit(0);
