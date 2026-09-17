// scripts/sdf-pile-crowding.mjs — WHY THE OWNER SAW TUBES AND ORBS INSTEAD OF A
// SKELETON: the piece pool is GLOBAL and a pile from EARLIER blasts is charged
// against a LATER blast's budget.
//
// The owner's report was "i didnt see any skeleton chunks and the gib parts
// still looked like tubes and orbs". The piece set was fine and the bone census
// said `buriedBonePieces 0` — in a CLEAN arena with one blast. But a playtest is
// not one blast: `maxChunks` bounds the LIVE VIEW count for the whole level, a
// gib drops 24 views' worth of debris that stays for its lifetime, and the tier
// ladder hands out whatever the pool has LEFT. So the deeper into a pile you
// throw, the cheaper every body's shape gets, and past a point the only rung
// that fits is `clusters` — one chunk per limb, bones packed INSIDE the meat,
// i.e. tubes and orbs with no skeleton, which is exactly the complaint.
//
// This rig detonates on live bodies round after round in the arena and prints,
// per round, the tier every body actually got and what the pile then contains.
// It runs the SAME sequence at two caps so the fix's size is a measurement
// rather than an argument about one screenshot.
//
// Usage: node scripts/sdf-pile-crowding.mjs <vitePort> <cdpPort> [caps...]
//        node scripts/sdf-pile-crowding.mjs 5391 9391 24 64
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const CAPS = process.argv.slice(4).map(Number).filter(Number.isFinite);
const caps = CAPS.length ? CAPS : [24, 64];
const OUT = process.env.PILE_OUT ?? '/tmp/pile-crowding';
mkdirSync(OUT, { recursive: true });

const W = 1100, H = 800;
const ROUNDS = Number(process.env.PILE_ROUNDS ?? 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withTab(fn) {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  try { return await fn(tab); } finally {
    try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
  }
}

async function session(tab) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let seq = 0; const pending = new Map(); const pageErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(m.params?.exceptionDetails?.exception?.description ?? 'exception');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      pageErrors.push((m.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT: ${expression.slice(0, 80)}`)), 30000)),
    ]);
    if (r.result?.exceptionDetails) {
      throw new Error(`page threw: ${r.result.exceptionDetails.exception?.description
        ?? r.result.exceptionDetails.text}`);
    }
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  // A rig whose subject is "what did the last edit change" must not measure a
  // cached module graph (see the same note in sdf-game-dynamite-gate.mjs).
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  return { evaluate, pageErrors, close: () => ws.close() };
}

const results = [];
for (const cap of caps) {
  const url = `http://localhost:${VITE}/sdf-game.html?maxchunks=${cap}`;
  const rows = await withTab(async (tab) => {
    const s = await session(tab);
    await s.evaluate(`(async () => { location.href = ${JSON.stringify(url)}; return true; })()`);
    let booted = false;
    for (let i = 0; i < 240; i++) {
      await sleep(500);
      if (await s.evaluate('typeof window.__sdfGame === "object" && window.__sdfGame !== null').catch(() => false)) {
        booted = true; break;
      }
    }
    if (!booted) throw new Error(`__sdfGame never appeared (${s.pageErrors.slice(0, 2).join(' | ')})`);
    for (let i = 0; i < 60; i++) {
      if (await s.evaluate('window.__sdfGame.gunReady === true').catch(() => false)) break;
      await sleep(500);
    }
    // The ARENA — the room the owner tests in — and a frozen clock so the pile
    // is exactly the pile this rig built.
    await s.evaluate('__sdfGame.teleport(6); __sdfGame.setLoopRunning(false); __sdfGame.step(4);');
    const out = [];
    for (let round = 1; round <= ROUNDS; round++) {
      const row = await s.evaluate(`(() => {
        const actors = __sdfGame.actorList();
        if (actors.length === 0) return { round: ${round}, skipped: 'no live actors left' };
        const before = __sdfGame.chunkCensus();
        const t = actors[0];
        const r = __sdfGame.detonate(t.pos[0], t.pos[1] + 0.6, t.pos[2]);
        // 0.1 s tear window = 6 frames, then three drain-paced impulse waves;
        // 16 frames is past both, and short of the pieces starting to retire.
        __sdfGame.step(16);
        const d = __sdfGame.dynamite();
        const after = __sdfGame.chunkCensus();
        return {
          round: ${round},
          gibbed: r.gibbed,
          tierLog: d.gibTierLog,
          piecesSpawned: d.lastGibSpawned, dropped: d.lastGibDropped,
          live: after.live, cap: after.cap,
          bonePieces: after.bonePieces, boneRows: after.boneRows,
          buriedBonePieces: after.buriedBonePieces,
          bonesShadingAsMeat: after.bonesShadingAsMeat,
          piecesBefore: before.live,
          what: (d.lastGibParts ?? []).filter(n => n.startsWith('bone.')).length,
          lastParts: d.lastGibParts ?? [],
        };
      })()`);
      out.push(row);
      if (row.skipped) break;
    }
    s.close();
    return out;
  });
  results.push({ cap, rows });
  console.log(`\n=== ?maxchunks=${cap} — the arena, ${ROUNDS} blasts in a row ===`);
  for (const r of rows) {
    if (r.skipped) { console.log(`  round ${r.round}: ${r.skipped}`); continue; }
    console.log(`  round ${r.round}: gibbed ${r.gibbed} | tiers [${r.tierLog.join(', ')}]`
      + ` | spawned ${r.piecesSpawned} dropped ${r.dropped} | pile ${r.piecesBefore} -> ${r.live}/${r.cap}`
      + ` | bone ${r.bonePieces} pieces / ${r.boneRows} rows | BURIED ${r.buriedBonePieces}`
      + ` | bone names in the last body: ${r.what}`);
  }
}

writeFileSync(`${OUT}/pile-crowding.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote ${OUT}/pile-crowding.json`);
