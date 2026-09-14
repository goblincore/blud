// scripts/startup-hitch-probe.mjs — the LIVE-LOOP attribution run for the
// startup/room-entry hitches (2026-09-14).
//
// NOT the staged close-up: the staged verification of the 2026-09-13 warm-up
// work paused the loop, which is exactly why it never saw the owner's
// hitches. This probe boots the REAL game (`sdf-game.html`, crowd default,
// no pins beyond the log flag itself), lets the animation loop run its own
// first 600 frames, teleports the player through rooms 1 -> 2 -> 3 -> 1
// every 150 frames (a teleport is what "entering a room" does to the draw
// list), then reads __sdfGame.pipelineLog(): every frame whose rAF handler
// took >= 100 ms, with the device pipelines created during it, plus the
// renderer.compute() per-frame census and the console warnings that say the
// timestamp pools or zero-index draws are misbehaving.
//
// Expected shape (before any fix): a handful of 300-2500 ms frames, the first
// naming ~24 compute pipelines (the crowd tile-bin kernels, which the warm
// never dispatches); a repeat with ?crowd=0 shows which of those are the
// crowd's alone. Long frames that name NO pipelines are submit/GPU stalls —
// read their frames against the compute census and the warnings below.
//
// Env: LAB_VITE_PORT / LAB_CDP_PORT (default 5323 / 9323),
//      HITCH_FRAMES (default 600), HITCH_ROOM (default '2,3,1').
// Run inside scripts/lab-servers.sh (see that file's header).
import { connectGame, sleep, failHard } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
const FRAMES = Number(process.env.HITCH_FRAMES ?? 600);
const ROOMS = (process.env.HITCH_ROOM ?? '2,3,1').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
const fail = failHard;
setTimeout(() => { console.error('FAIL: watchdog 8 min'); process.exit(3); }, 8 * 60_000).unref();

/** Console taps: capture EVERY console/log line with its CDP timestamp (the
 *  page's [warm]/[room-probes]/gun lines name the events that coincide with
 *  long frames), plus counts for the warnings the task cares about. CDP
 *  broadcasts events per SESSION, so this opens its OWN websocket to the tab
 *  (connectGame keeps the first session and only resolves request ids). */
async function attachConsoleTap(tab) {
  const counts = { queriesExceeded: 0, indexCount0: 0 };
  const lines = [];
  const scan = (ts, text) => {
    if (!text) return;
    if (text.includes('Maximum number of queries exceeded')) counts.queriesExceeded++;
    if (/index count of 0/.test(text)) counts.indexCount0++;
    if (lines.length < 200) lines.push({ ts, text: String(text).slice(0, 200) });
  };
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      scan(m.params?.timestamp, (m.params?.args ?? []).map((a) => (typeof a.value === 'string' ? a.value : a.description)).join(' '));
    } else if (m.method === 'Log.entryAdded') {
      scan(m.params?.entry?.source === 'network' ? undefined : m.params?.timestamp, m.params?.entry?.text);
    }
  };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable', params: {} }));
  ws.send(JSON.stringify({ id: 2, method: 'Log.enable', params: {} }));
  return { counts, lines, close: () => ws.close() };
}

async function runLeg(label, urlSuffix) {
  const { tab, send, evaluate } = await connectGame({ vite: VITE, cdp: CDP });
  const tap = await attachConsoleTap(tab);
  try {
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(200);
    await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?pipelinelog=1${urlSuffix}` });
    // Boot: backend handshake.
    let backend = null;
    for (let i = 0; i < 240; i++) {
      await sleep(500);
      backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
      if (backend) break;
    }
    if (!backend) fail(`${label}: game page never booted`);
    if (backend !== 'webgpu') fail(`${label}: backend is ${backend}, not webgpu`);
    // Warm: wait for __warmDone (bounded at 15 s in-page).
    let warm = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      warm = await evaluate('window.__warmDone ?? null');
      if (warm) break;
    }
    if (!warm) fail(`${label}: __warmDone never appeared`);
    console.log(`[${label}] warm: ${JSON.stringify(warm)}`);

    // Drive FRAMES frames through the rooms, teleporting every 150. One
    // evaluate per poll (teleport included) — under machine load each CDP
    // round trip can take seconds.
    const start = await evaluate('__sdfGame.frames');
    const marks = ROOMS.map((_, i) => start + (i + 1) * 150).filter((m) => m < start + FRAMES);
    const end = start + FRAMES;
    let teleported = 0;
    let lastFrames = start;
    let idlePolls = 0;
    while (true) {
      await sleep(300);
      const r = await evaluate(`(() => {
        const f = __sdfGame.frames;
        const marks = ${JSON.stringify(marks)}; let done = ${JSON.stringify(teleported)};
        while (done < marks.length && f >= marks[done]) { __sdfGame.teleport(${JSON.stringify(ROOMS)}[done]); done++; }
        return { f, done };
      })()`);
      if (r.done > teleported) console.log(`[${label}] frame ${r.f}: teleported through rooms ${ROOMS.slice(teleported, r.done).join(',')} -> ${r.done}/${marks.length}`);
      teleported = r.done;
      if (r.f === lastFrames) { idlePolls++; if (idlePolls > 130) fail(`${label}: loop stalled at frame ${r.f}`); }
      else { idlePolls = 0; lastFrames = r.f; }
      if (r.f >= end) break;
    }
    const visible = await evaluate('document.visibilityState');
    if (visible !== 'visible') fail(`${label}: page ${visible} — a hidden page presents no frames; run invalid`);

    const log = await evaluate(`(() => {
      const l = __sdfGame.pipelineLog();
      return {
        installed: l.installed, enabled: l.enabled,
        totalPipelines: l.totalPipelines, totalCompileMs: l.totalCompileMs,
        timeOrigin: performance.timeOrigin,
        longFrames: l.frames.map(f => ({
          frame: f.frame, ms: f.ms, t0: f.t0, t1: f.t1,
          pipelines: f.pipelines.map(p => ({ k: p.kind[0], n: p.name, ms: Math.round(p.ms * 10) / 10, a: p.async, v: p.via })),
        })),
        slowest: l.slowest.map(p => ({ n: p.name, ms: Math.round(p.ms * 10) / 10, frame: p.frame, a: p.async, k: p.kind[0], v: p.via })),
        compute: { total: l.compute.total, maxPerFrame: l.compute.maxPerFrame,
          byFrame: l.compute.byFrame.filter(e => e.frame > ${JSON.stringify(start)}) },
        warmFrameBound: ${JSON.stringify(start)},
      };
    })()`);
    // Report.
    const pageOrigin = log.timeOrigin;
    const consoleIn = (t0, t1) => tap.lines
      .filter((l) => l.ts !== undefined && l.ts - pageOrigin >= t0 - 2 && l.ts - pageOrigin <= t1 + 2)
      .map((l) => l.text);
    console.log(`\n===== ${label} =====`);
    console.log(`warm: ${warm.ms} ms; pipelines: total ${log.totalPipelines}, totalCompileMs ${log.totalCompileMs}`);
    console.log(`compute dispatches: total ${log.compute.total}, max/frame ${log.compute.maxPerFrame}`);
    const noisy = log.compute.byFrame.filter((e) => e.calls !== (log.compute.byFrame[0]?.calls ?? 0));
    if (noisy.length > 0) console.log(`compute calls deviating from first post-warm frame (${log.compute.byFrame[0]?.calls ?? 0}): ${JSON.stringify(noisy.slice(0, 12))}`);
    console.log(`long frames (>= 100 ms, frame > ${start}): ${log.longFrames.length}`);
    for (const f of log.longFrames) {
      console.log(`  frame ${f.frame}  ${f.ms} ms  creations=${f.pipelines.length}`);
      // Aggregate by (name, via): count, max ms, async count — sorted by max ms.
      const byName = new Map();
      for (const p of f.pipelines) {
        const key = p.via ? `${p.n} [${p.via}]` : p.n;
        const e = byName.get(key) ?? { count: 0, maxMs: 0, async: 0 };
        e.count++; e.maxMs = Math.max(e.maxMs, p.ms); if (p.a) e.async++;
        byName.set(key, e);
      }
      const rows = [...byName].sort((a, b) => b[1].maxMs - a[1].maxMs);
      for (const [n, e] of rows.slice(0, 12)) {
        console.log(`      ${e.count}x ${e.async}a max=${e.maxMs}ms  ${n}`);
      }
      if (rows.length > 12) console.log(`      … +${rows.length - 12} distinct names`);
      for (const c of consoleIn(f.t0, f.t1).slice(0, 10)) console.log(`      | console: ${c}`);
    }
    // Global slowest creations with their frame — names the one-off stalls.
    if (log.slowest.length > 0) {
      console.log(`slowest creations (session-wide):`);
      for (const p of log.slowest.slice(0, 10)) console.log(`      ${p.ms}ms frame ${p.frame}${p.a ? ` async via ${p.v}` : ''} ${p.n}`);
    }
    console.log(`warnings: queriesExceeded=${tap.counts.queriesExceeded} indexCount0=${tap.counts.indexCount0}`);
    return log;
  } finally {
    tap.close();
    try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
  }
}

async function main() {
  // A leg that dies (browser hung, watchdog) must not take the run: report
  // and continue so the A/B table keeps both columns when possible.
  let crowd = null;
  let solo = null;
  try { crowd = await runLeg('crowd(default)', ''); }
  catch (e) { console.error(`[crowd(default)] leg failed: ${e.message}`); }
  try { solo = await runLeg('crowd=0', '&crowd=0'); }
  catch (e) { console.error(`[crowd=0] leg failed: ${e.message}`); }
  console.log('\n===== SUMMARY =====');
  const line = (tag, l) => {
    if (!l) { console.log(`${tag}: leg failed`); return; }
    const post = l.longFrames;
    const pipelinesInLong = post.reduce((n, f) => n + f.pipelines.length, 0);
    console.log(`${tag}: longFrames=${post.length} pipelinesInThem=${pipelinesInLong} computeMax/frame=${l.compute.maxPerFrame}`);
  };
  line('crowd(default)', crowd);
  line('crowd=0       ', solo);
  if (!crowd || !solo) process.exit(2);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
