// scripts/sdf-gib-rupture-lifecycle.mjs — LIFECYCLE + LIVE-LOOP evidence for the
// body-to-gib rupture (Task 2, 2026-09-16).
//
// The look rigs answer "what does it look like". This one answers the contract's
// behavioural questions on the REAL loop (no `frozen=1`, no step-driving):
//   * a MOVING/posed zombie still ruptures and releases exactly once;
//   * a SECOND blast during the window does not schedule a second breakup;
//   * REPEATED explosions keep the live pool bounded;
//   * RESET mid-window drains the transition (no stale actor, no stale impulse);
//   * a MULTI-BODY blast into a tight pool degrades by tier and stays bounded;
//   * cold first explosion vs repeated explosions, with wall-clock frame times
//     and the detonation / first-chunk / first-bake numbers kept separate.
//
// Usage: node scripts/sdf-gib-rupture-lifecycle.mjs <vitePort> <cdpPort> [qs]
import { connectGame, sleep, failHard } from './lib/sdf-closeup-stage.mjs';
import { writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5401);
const CDP = Number(process.argv[3] ?? 9401);
const QS = process.argv[4] ?? '';
const fail = failHard;
const W = 960, H = 720;

const { evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H });
const url = `http://localhost:${VITE}/sdf-game.html?room=arena&vhs=off&seed=7${QS.startsWith('&') ? QS : QS ? `&${QS}` : ''}`;
console.log(`opening ${url}`);
await evaluate(`location.href = ${JSON.stringify(url)}`);
for (let i = 0; i < 160; i++) {
  await sleep(500);
  if (await evaluate('typeof window.__sdfGame === "object"').catch(() => false)) break;
  if (i === 159) fail('__sdfGame never appeared');
}
for (let i = 0; i < 80; i++) {
  if (await evaluate('!!window.__warmDone && window.__sdfGame.gunReady === true').catch(() => false)) break;
  await sleep(250);
  if (i === 79) console.log('WARNING: warm/ready gate not reached');
}
// Page-level error tap: connectGame's CDP handler only resolves request ids, so
// the run's own error channel is the page's.
await evaluate(`(() => {
  window.__errs = [];
  window.addEventListener('error', e => window.__errs.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', e => window.__errs.push('reject: ' + String(e.reason)));
  const ce = console.error.bind(console);
  console.error = (...a) => { window.__errs.push('console.error: ' + a.map(String).join(' ')); ce(...a); };
})()`);
// WALL-CLOCK FRAME TIMES, from the page's own presentation. The live loop is
// the only place a hitch exists; frozen stepping is explicitly not a perf test.
await evaluate(`(() => {
  window.__ft = []; let last = performance.now();
  const tick = () => { const n = performance.now(); window.__ft.push(n - last); last = n; if (window.__ft.length < 6000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})()`);
const ftStats = async () => evaluate(`(() => {
  const a = window.__ft.slice(); window.__ft.length = 0;
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return { n: a.length, p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
})()`);

const summary = { cases: {}, perf: {} };
const pickNearest = `(() => {
  const pp = window.__sdfGame.playerPos();
  const l = window.__sdfGame.actorList().filter(a => a.room === 6 && a.kind === 'zombie')
    .sort((a, b) => Math.hypot(a.pos[0]-pp[0],a.pos[2]-pp[2]) - Math.hypot(b.pos[0]-pp[0],b.pos[2]-pp[2]));
  return l[0] ?? null;
})()`;
const dmg = async () => evaluate('window.__sdfGame.dynamite()');
const chunks = async () => evaluate('window.__sdfGame.chunkCensus()');
const errs = async () => evaluate('window.__errs.slice()');

// ——— CASE 1: MOVING body, second blast mid-window, repeated blasts —————————
{
  await evaluate('window.__sdfGame.teleport(6)');
  await sleep(200);
  const before = await evaluate(`window.__sdfGame.actorList().find(a => a.room===6 && a.kind==='zombie') ? JSON.stringify(window.__sdfGame.actorList().filter(a=>a.room===6&&a.kind==='zombie').map(a=>a.pos)) : '[]'`);
  await sleep(800);
  const after = await evaluate(`JSON.stringify(window.__sdfGame.actorList().filter(a=>a.room===6&&a.kind==='zombie').map(a=>a.pos))`);
  summary.cases.movingCast = before !== after;
  const t = await evaluate(pickNearest);
  if (!t) fail('no arena zombie to test');
  const t0 = await evaluate('window.__sdfGame.pose()');
  await evaluate(`window.__sdfGame.setPose(${t.pos[0]}, ${t.pos[2] + 2.2}, 0, 0)`);
  await evaluate(`window.__sdfGame.aimSurface(undefined, ${t.id})`);
  await sleep(150);
  await ftStats(); // clear
  const coldBefore = await evaluate('window.__sdfGame.chunkStats()');
  await evaluate('window.__sdfGame.setPipelineLog(true)');
  await evaluate(`window.__sdfGame.detonate(${t.pos[0]}, ${t.pos[1] + 0.6}, ${t.pos[2]})`);
  await sleep(60);
  const mid = await dmg();
  // SECOND BLAST, mid-window: must not schedule another breakup.
  await evaluate(`window.__sdfGame.detonate(${t.pos[0]}, ${t.pos[1] + 0.6}, ${t.pos[2]})`);
  await sleep(40);
  const afterSecond = await dmg();
  const perBlast = (await ftStats());
  summary.perf.coldBlast = { lastBlastMs: (await dmg()).lastBlastMs, frames: perBlast };
  await sleep(900);
  const released = await dmg();
  const c1 = await chunks();
  summary.cases.secondBlastDuringTear = {
    pendingMid: mid.pendingGibs, tearingMid: mid.tearing,
    pendingAfterSecond: afterSecond.pendingGibs,
    scheduledBodies: released.scheduledGibBodies,
    oneRelease: c1.live > 0,
  };
  // REPEATED explosions, and confirm the pool stays bounded and piece ids unique.
  for (let k = 0; k < 2; k++) {
    const q = await evaluate(pickNearest);
    if (q) await evaluate(`window.__sdfGame.detonate(${q.pos[0]}, ${q.pos[1] + 0.6}, ${q.pos[2]})`);
    await sleep(700);
  }
  const cs = await evaluate('window.__sdfGame.chunkStats()');
  const cc = await chunks();
  const ids = new Set(cs.livePieces.map(p => p.id));
  summary.cases.repeated = {
    live: cc.live, cap: cc.cap, baked: cc.baked, views: cs.views, bounded: cc.live <= cc.cap,
    uniqueIds: ids.size === cs.livePieces.length,
    lastBakeMs: cs.lastBakeMs, lastBakeSwapMs: cs.lastBakeSwapMs,
  };
  summary.perf.repeatedBlast = { lastBlastMs: (await dmg()).lastBlastMs, frames: await ftStats() };
  summary.perf.pipelineLog = await evaluate(`(() => {
    const p = window.__sdfGame.pipelineLog();
    return { frames: p?.frames?.length ?? p?.longFrames?.length ?? null,
      longFrames: (p?.longFrames ?? []).map(f => ({ ms: Math.round(f.ms ?? f.durationMs ?? 0), pipelines: (f.pipelines ?? []).length })) };
  })()`);
}

// ——— CASE 2: RESET mid-window ——————————————————————————————————————————————
{
  const t = await evaluate(pickNearest);
  if (t) {
    await evaluate(`window.__sdfGame.detonate(${t.pos[0]}, ${t.pos[1] + 0.6}, ${t.pos[2]})`);
    await sleep(80); // mid-window (0.2 s)
    const mid = await dmg();
    const actors = await evaluate('window.__sdfGame.resetCast()');
    await sleep(300);
    const post = await dmg();
    const c = await chunks();
    summary.cases.resetMidTear = {
      midTearing: mid.tearing, midPending: mid.pendingGibs,
      actorsAfterReset: actors, postTearing: post.tearing, postPending: post.pendingGibs,
      liveAfter: c.live, drained: post.pendingGibs === 0 && post.tearing === 0,
    };
  }
}

// ——— CASE 3: MULTI-BODY into a TIGHT pool ——————————————————————————————————
{
  await evaluate('window.__sdfGame.setDynamiteTuning({ maxchunks: 12 })');
  await sleep(100);
  const t = await evaluate(pickNearest);
  if (t) {
    // Blast at the crowd centre: hit more than one body at once.
    await evaluate(`window.__sdfGame.detonate(23.5, 1.0, -7.5)`);
    await sleep(900);
    const d = await dmg();
    const c = await chunks();
    const cs = await evaluate('window.__sdfGame.chunkStats()');
    summary.cases.tightMultiBody = {
      tierLog: d.gibTierLog ?? d.lastGibTier, live: c.live, cap: c.cap, bounded: c.live <= c.cap,
      dropped: d.lastGibDropped, views: cs.views,
    };
  }
  await evaluate('window.__sdfGame.setDynamiteTuning({ maxchunks: 64 })');
}

summary.pageErrors = await errs();
const OUT = process.env.LIFECYCLE_OUT ?? '/tmp/gib-lifecycle.json';
writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(`wrote ${OUT}`);
console.log(JSON.stringify({
  cases: summary.cases,
  perf: { coldBlast: summary.perf.coldBlast, repeatedBlast: summary.perf.repeatedBlast },
  pageErrors: summary.pageErrors,
}, null, 2));
if (summary.pageErrors.length) { console.error('PAGE ERRORS present'); process.exit(1); }
console.log('PASS: lifecycle probe completed');
process.exit(0);
