// scripts/sdf-piece-cost.mjs — WHAT DO DETACHED PIECES COST THE FRAME?
//
// This is the number the per-archetype MESH PRE-BAKE rests on, and the design's
// §4 was written on the assumption that it is large. It has been measured twice
// before, wrongly both times:
//
//   * first by comparing `sdf:march` between two STATES, on an instrument whose
//     same-state spread (2.6 -> 18.8 ms in one boot) was larger than the
//     difference being claimed;
//   * then paired, which fixed the drift but left a noise floor of ~1.75 ms at
//     24 pieces — the size of the effect it was trying to see.
//
// So this rig measures the thing the player actually experiences instead: the
// browser's own FRAME CADENCE. It alternates pieces shown/hidden in bursts on
// the LIVE loop (no `step()`, no stopped loop — see sdf-dynamite-soak.mjs for
// why that distinction has teeth) and reports the per-arm median and p95 of the
// real inter-frame delta, plus the paired difference between bursts so a drift
// in the frame rate cancels. The GPU's `sdf:march` row is printed beside it as a
// cross-reference, not as the verdict.
//
// A caveat that decides how to read the answer: on a vsync-limited page the
// cadence is pinned at the display rate, so a piece cost that fits inside the
// budget is invisible here BY CONSTRUCTION. "No cadence difference" therefore
// means "the pieces are absorbed by the frame budget in this configuration",
// which is exactly the question the pre-bake has to answer.
//
// Usage: node scripts/sdf-piece-cost.mjs <vitePort> <cdpPort> [qs] [bursts]
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const QS = process.argv[4] ?? '';
const BURSTS = Number(process.argv[5] ?? 8);
const OUT = '/tmp/piece-cost';
mkdirSync(OUT, { recursive: true });
const SEND_TIMEOUT_MS = Number(process.env.COST_SEND_TIMEOUT_MS ?? 60000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (mm, p = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${mm} timed out after ${SEND_TIMEOUT_MS} ms`)); }, SEND_TIMEOUT_MS);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  ws.send(JSON.stringify({ id, method: mm, params: p }));
});
ws.addEventListener('close', () => { for (const [, r] of pending) r({ error: 'socket closed' }); pending.clear(); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r?.error) throw new Error(`evaluate failed: ${JSON.stringify(r.error).slice(0, 200)}`);
  return r.result?.result?.value;
};
process.on('unhandledRejection', (e) => { console.error(`FAIL: ${e?.message ?? e}`); process.exit(1); });

await send('Runtime.enable');
const url = `http://localhost:${VITE}/sdf-game.html?room=arena${QS}`;
console.log(`opening ${url} (LIVE loop — this rig never calls step())`);
await send('Page.navigate', { url });
for (let i = 0; i < 240; i++) { await sleep(500); if (await ev('typeof window.__sdfGame === "object"')) break; if (i === 239) fail('__sdfGame never appeared'); }
for (let i = 0; i < 60; i++) { if (await ev('window.__sdfGame.gunReady === true')) break; await sleep(500); if (i === 59) fail('the view-model never became ready'); }
await sleep(2000);

// FILL THE POOL: blow up bodies until the census stops growing.
// WHICH CENSUS DEPENDS ON THE RENDER MODE. The marched view pool is empty by
// construction under `?gibrender=sprite` (a sprite piece has no view), so reading
// only `chunkCensus()` there reports "0 of 64" for a page holding over a hundred
// billboards — and the fill loop would never learn it is full.
const spriteMode = QS.includes('gibrender=sprite');
const pieceCount = async () => {
  const c = await ev('window.__sdfGame.chunkCensus()');
  const s = await ev('window.__sdfGame.spriteCensus()');
  return {
    live: c.live + s.live, cap: spriteMode ? s.liveCap : c.cap,
    marched: c.live, sprites: s.live, rest: s.rest, inFrustum: c.inFrustum, baked: c.baked,
  };
};
for (let i = 0; i < 8; i++) {
  const c = await pieceCount();
  if (c.live >= c.cap) break;
  const roster = await ev('window.__sdfGame.actorList()');
  const t = roster.find(a => a.room === 6) ?? roster.find(a => a.room === 1) ?? roster[0];
  if (!t) break;
  await ev(`window.__sdfGame.detonate(${t.pos[0]}, ${t.pos[1] + 0.6}, ${t.pos[2]})`);
  await sleep(700);
}
await sleep(2500);
const census = await pieceCount();
console.log(`pieces: ${census.live} live of ${census.cap} cap `
  + `(${census.marched} marched views + ${census.sprites} sprites, ${census.rest} parked), `
  + `${census.inFrustum} marched IN FRAME, ${census.baked} baked`);

// ——— AIM AT THE PILE, AND PROVE IT ————————————————————————————————————————
// A piece cost measured with the pieces off-screen is a measurement of nothing.
// This rig used to leave the camera wherever `teleport` put it and then read
// "5 marched IN FRAME" out of its own census — the pieces were behind the player
// and the GPU row could not possibly move. So: put the camera a fixed distance
// from the pieces' own centroid, facing it, and then ASSERT with `screenPosOf`
// that they are on screen before measuring anything. `aimed` is that check, and
// it is reported whether or not it passes.
const aim = await ev(`(async () => {
  const g = window.__sdfGame;
  const all = g.chunkStates().filter(p => p.render === 'march' || p.render === 'sprite');
  if (!all.length) return { ok: false, why: 'no pieces' };
  let cx = 0, cy = 0, cz = 0;
  for (const p of all) { cx += p.pos[0]; cy += p.pos[1]; cz += p.pos[2]; }
  cx /= all.length; cy /= all.length; cz /= all.length;
  // Stand back 3.5 m on the +Z side and look at the centroid. The level is a set
  // of 3-6 m rooms, so a fixed 3.5 m is a sane framing distance in all of them;
  // if a wall is in the way the screenPosOf check below is what catches it.
  const px = cx, pz = cz + 3.5;
  const dx = cx - px, dz = cz - pz;
  const yaw = Math.atan2(dx, -dz);
  const pitch = Math.atan2(cy - 1.6, Math.hypot(dx, dz));
  g.setPose(px, pz, yaw, pitch, 0);
  // THE LIVE LOOP MUST BE RUNNING AGAIN BEFORE ANYTHING IS MEASURED. This rig's
  // whole instrument is real rAF cadence on the game's own loop, and the game's
  // own step() STOPS that loop (documented: "stops the rAF loop first"). An
  // earlier version of this block aimed with step() and left it stopped, so the
  // page drew nothing at all afterwards — every later cadence delta read exactly
  // 0.00 ms and every GPU row vanished, which looks precisely like "the pieces
  // are free". It is not; it is a rig measuring a stopped renderer.
  g.setLoopRunning(true);
  await new Promise(r => setTimeout(r, 400));
  let onScreen = 0;
  for (const p of all) {
    const s = g.screenPosOf(p.pos[0], p.pos[1], p.pos[2]);
    if (Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1 && s.z <= 1) onScreen++;
  }
  return { ok: true, total: all.length, onScreen, loopRunning: true,
           seated: g.pose(), centroid: [cx, cy, cz] };
})()`);
console.log(`aimed at the pile: ${aim.onScreen ?? 0} of ${aim.total ?? 0} pieces ON SCREEN`
  + `${aim.why ? ` (${aim.why})` : ''} — the cost below is only meaningful if this is non-zero`);
if (!(aim.onScreen > 0)) {
  console.log('WARNING: no piece is on screen; the pass rows below cannot price them. '
    + 'Treat the verdict as untested rather than as "free".');
}

// ——— THE MEASUREMENT. `requestAnimationFrame` deltas, alternating arms every
// burst. The game's own loop schedules in the same cadence, so a frame that
// costs more shows up as a longer delta.
const pacing = await ev(`(async () => {
  const g = window.__sdfGame;
  const BURST = 30, BURSTS = ${BURSTS};
  const byArm = { shown: [], hidden: [] };
  const pairs = [];
  let arm = 'hidden';
  g.setChunksVisible(false);
  await new Promise(res => {
    let last = 0, n = 0, burstSum = 0, burstN = 0, otherSum = 0, otherN = 0;
    const frame = (t) => {
      if (last) {
        const d = t - last;
        byArm[arm].push(d);
        burstSum += d; burstN++;
      }
      last = t;
      n++;
      if (n % BURST === 0) {
        if (arm === 'shown') pairs.push([otherSum / Math.max(1, otherN), burstSum / Math.max(1, burstN)]);
        arm = arm === 'shown' ? 'hidden' : 'shown';
        g.setChunksVisible(arm === 'shown');
        otherSum = burstSum; otherN = burstN; burstSum = 0; burstN = 0;
      }
      if (n >= BURST * BURSTS * 2) { res(); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  g.setChunksVisible(true);
  const stat = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { n: s.length, median: s[Math.floor(s.length / 2)] ?? 0, p95: s[Math.floor(s.length * 0.95)] ?? 0 };
  };
  return { shown: stat(byArm.shown), hidden: stat(byArm.hidden), samples: byArm.shown.length, pairs };
})()`);

const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };

// ——— WHICH GPU ROW DO THE PIECES LAND IN? ————————————————————————————————
// `sdf:march` is the BODIES' march and is the wrong row for either arm — it was
// the cross-reference here only because it was the row the old measurement
// happened to have. The MARCHED PIECES have their own row, `sdf:march-chunks`
// (it exists precisely because `sdf:march` cannot price detached pieces — see
// its comment in sdf-layer.ts). A SPRITE PIECE does not march AT ALL: it is a
// material in the deferred router's mesh layer, and there is NO pass label
// dedicated to that layer (`mesh-front` is a CAMERA POSE name in
// deferred-main.ts, not a timer label — checked, after guessing it first).
//
// So this does not guess: it samples EVERY label in both arms and reports the
// ones that actually move. A rig that hard-codes the row it hopes will move is a
// rig that reports 0.00 ms forever and calls it "free".
//
// `collect()` DRAINS its history (measured: three calls in a row returned 1658,
// 263 then 279 samples — the first swallowed everything since install). So the
// history must be flushed before EACH arm or the first arm's reading contains
// the whole session and the two arms are not paired at all. Rounds alternate
// shown/hidden so a drift in the frame rate lands in both arms.
const drainPasses = async () => { await ev('window.__sdfGame.passTimings()'); };
const passRows = async (samples = 6) => {
  await drainPasses();
  const acc = {};
  for (let i = 0; i < samples; i++) {
    await sleep(200);
    const s = await ev('window.__sdfGame.passTimings()');
    // `samples` is the frame history since the last drain, so the latest
    // occurrence of each label is this iteration's reading.
    const latest = {};
    for (const x of (s?.samples ?? [])) latest[x.label ?? x.name] = x.ms;
    for (const [lab, ms] of Object.entries(latest)) (acc[lab] ??= []).push(ms);
  }
  const out = {};
  for (const [k, v] of Object.entries(acc)) out[k] = med(v);
  return out;
};
const rowsShown = [], rowsHidden = [];
const ROUNDS = Number(process.env.COST_ROUNDS ?? 4);
for (let r = 0; r < ROUNDS; r++) {
  await ev('window.__sdfGame.setChunksVisible(true)');
  rowsShown.push(await passRows());
  await ev('window.__sdfGame.setChunksVisible(false)');
  rowsHidden.push(await passRows());
}
await ev('window.__sdfGame.setChunksVisible(true)');
const shownRows = {}, hiddenRows = {};
for (const lab of Object.keys({ ...rowsShown[0], ...rowsHidden[0] })) {
  const s = rowsShown.map(r => r[lab]).filter(Number.isFinite);
  const h = rowsHidden.map(r => r[lab]).filter(Number.isFinite);
  if (s.length) shownRows[lab] = med(s);
  if (h.length) hiddenRows[lab] = med(h);
}
console.log(`  GPU pass rows, ${ROUNDS} paired rounds of (shown, hidden);`
  + ' a row that MOVES is the one the pieces are billed to:');
const rowDeltas = {};
for (const lab of Object.keys({ ...shownRows, ...hiddenRows }).sort()) {
  const s = shownRows[lab], h = hiddenRows[lab];
  if (!Number.isFinite(s) || !Number.isFinite(h)) continue;
  const d = s - h;
  rowDeltas[lab] = { shown: s, hidden: h, delta: d };
  // Print the rows big enough to be the pieces, plus the reference rows that
  // "should" carry them, so an absent row is visible as absent rather than silent.
  const interesting = Math.abs(d) >= 0.05
    || lab === 'sdf:march-chunks' || lab === 'sdf:march' || lab === 'frame:other'
    || lab === 'effects' || lab === 'sdf:composite';
  if (interesting) {
    console.log(`    ${lab.padEnd(20)} ${s.toFixed(2).padStart(7)} ms shown  `
      + `${h.toFixed(2).padStart(7)} ms hidden  ->  ${d >= 0 ? '+' : ''}${d.toFixed(2)} ms`);
  }
}
const biggest = Object.entries(rowDeltas).sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta))[0];
if (biggest) {
  console.log(`  -> the largest moving row is ${biggest[0]} at `
    + `${biggest[1].delta >= 0 ? '+' : ''}${biggest[1].delta.toFixed(2)} ms `
    + `for ${census.live} pieces (${aim.onScreen ?? 0} on screen)`);
}
const diffs = pacing.pairs.map(([hidden, shown]) => shown - hidden);
writeFileSync(`${OUT}/piece-cost.json`, JSON.stringify({
  qs: QS, spriteMode, census, aim, pacing, diffs, shownRows, hiddenRows, rowDeltas,
}, null, 2));
console.log(`\nreal frame cadence, ${pacing.samples} frames per arm (bursts of 30, alternating):`);
console.log(`  pieces SHOWN : median ${pacing.shown.median.toFixed(2)} ms, p95 ${pacing.shown.p95.toFixed(2)} ms`);
console.log(`  pieces HIDDEN: median ${pacing.hidden.median.toFixed(2)} ms, p95 ${pacing.hidden.p95.toFixed(2)} ms`);
console.log(`  paired difference (shown - hidden) per burst: median ${med(diffs).toFixed(2)} ms `
  + `[${pacing.pairs.map(([h, s]) => (s - h).toFixed(1)).join(', ')}]`);
console.log(`  cross-reference: sdf:march (the BODIES, not the pieces) `
  + `${shownRows['sdf:march']?.toFixed(2) ?? '—'} ms shown vs ${hiddenRows['sdf:march']?.toFixed(2) ?? '—'} ms hidden`);
const visible = pacing.shown.median - pacing.hidden.median;
if (Math.abs(visible) < 0.5) {
  console.log(`\nVERDICT: ${census.live} pieces are absorbed by the frame budget here (${visible.toFixed(2)} ms of cadence). `
    + 'The mesh pre-bake has no measured case in this configuration.');
} else {
  console.log(`\nVERDICT: pieces cost ${visible.toFixed(2)} ms of frame cadence at ${census.live} live / ${census.inFrustum} in frame.`);
}
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
