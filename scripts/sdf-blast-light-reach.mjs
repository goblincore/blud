// scripts/sdf-blast-light-reach.mjs — DOES THE BLAST LIGHT THE ROOM, and how far?
//
// The owner, playing: "the explosion seems to have a rather small radius of
// light effect". That is a REACH question, not a brightness one. A packed probe
// light accumulates as `intensity / d²`, so the blast lit a bright disc of floor
// at the crater and almost nothing across the room: at 2 m a wall gets 1/4 of
// the peak, at 8 m it gets 1/64. `fxspread` adds the soft room-fill component a
// real detonation has (the flash scattering in air, dust and smoke) —
// `LIGHT_FILL_REF_M` — at `intensity · fill / (1 + d²/4²)`.
//
// TWO INSTRUMENTS, because neither alone is honest:
//   1. `__sdfGame.probeDynReadback()` — the probe gather's OWN output, in light
//      units. The direct answer to "did the light reach the room", with no
//      camera or pixel question in the way.
//   2. The PRESENTED frame in a 4x4 tile grid. A whole-frame mean cannot tell
//      "the crater blew out" from "the room filled" — a bright blob raises the
//      mean exactly as much as a uniform lift — so the tiles holding the burst
//      and the tiles far from it are reported separately. Each spread carries an
//      fxlight=0 control at the SAME frame age, so the difference is the light's
//      own contribution rather than the particles.
//
// THREE TRAPS THIS RIG EXISTS PAST, all of which produced a confident null
// result first ("the fill does nothing"):
//   * A BACKGROUND TAB THROTTLES requestAnimationFrame. Waiting in wall-clock
//     time measured a FROZEN page: the explosion light sat at age 0 and never
//     aged, and every capture was the same stale presented frame. Frames are
//     driven with `step()`, and each arm prints the light's age, so a stalled
//     page shows up in the output instead of being inferred.
//   * THE READBACK STOPS UPDATING after a few gathers in one boot (measured:
//     arms 4-6 all returned arm 3's value), so ONE BOOT PER SPREAD.
//   * A stale cached module graph. Cache is disabled.
//
// Usage: node scripts/sdf-blast-light-reach.mjs <vitePort> <cdpPort> [spreads...]
import { decodePng } from '/Users/donny/Projects/blud/.claude/worktrees/dynamite-weapon-slot/scripts/lib/demo-presented.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const SPREADS = process.argv.slice(4).map(Number).filter(Number.isFinite);
const spreads = SPREADS.length ? SPREADS : [0, 1.2, 3];
const OUT = process.env.REACH_OUT ?? '/tmp/blast-light-reach';
mkdirSync(OUT, { recursive: true });
const TILES = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The frame as a 4x4 tile grid of luminance means, plus the whole-frame mean. */
function tileStats(buf) {
  const { w, h, ch, data } = decodePng(buf);   // decodePng returns w/h, not width/height
  const sum = new Array(TILES * TILES).fill(0);
  const n = new Array(TILES * TILES).fill(0);
  let all = 0, allN = 0;
  for (let y = 0; y < h; y++) {
    const ty = Math.min(TILES - 1, Math.floor((y / h) * TILES));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const t = ty * TILES + Math.min(TILES - 1, Math.floor((x / w) * TILES));
      sum[t] += l; n[t]++; all += l; allN++;
    }
  }
  return { mean: +(all / allN).toFixed(3), tiles: sum.map((s, i) => +(s / n[i]).toFixed(2)) };
}

const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

const results = [];
for (const spread of spreads) {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
  let seq = 0; const pending = new Map(); const errs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params?.exceptionDetails?.exception?.description ?? 'exc');
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errs.push((m.params.args ?? []).map(a => a.value ?? '').join(' '));
  };
  const send = (mm, p = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: mm, params: p })); });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page threw');
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off` });
  for (let i = 0; i < 240; i++) { await sleep(400); if (await ev('typeof window.__sdfGame === "object"')) break; }
  for (let i = 0; i < 60; i++) { if (await ev('__sdfGame.gunReady === true')) break; await sleep(400); }
  await ev('__sdfGame.setDemoHold(true)'); await ev('__sdfGame.setVhs(null)');
  // STEP-DRIVEN from here: the loop is stopped so nothing depends on rAF.
  await ev('__sdfGame.setLoopRunning(false)');
  await ev('__sdfGame.teleport(6)');
  await ev(`__sdfGame.setDynamiteTuning({ fxspread: ${spread} })`);
  await ev('__sdfGame.step(20)');

  const at = [28.0, 0.8, -1.4];   // the same place in the arena for every arm
  const arms = {};
  for (const light of [0, 1]) {
    await ev(`__sdfGame.setDynamiteTuning({ fxlight: ${light} })`);
    await ev(`__sdfGame.spawnExplosionFx(${at[0]}, ${at[1]}, ${at[2]}, 2.0, 'ground')`);
    await ev('__sdfGame.step(6)');
    // presentedShot returns the last PRESENTED frame, so draw one after the change.
    await ev('__sdfGame.setRenderLock(true)');
    await ev('__sdfGame.step(1)');
    const t = tileStats(Buffer.from(await ev('__sdfGame.presentedShot()'), 'base64'));
    const rb = await ev(`__sdfGame.probeDynReadback().then(b => { let s = 0, mx = 0;
      for (let i = 0; i < b.length; i++) { s += Math.abs(b[i]); if (b[i] > mx) mx = b[i]; }
      return { sum: +s.toFixed(1), max: +mx.toFixed(3) }; })`);
    const d = await ev('__sdfGame.dynamite()');
    arms[light] = { ...t, probe: rb, lightAges: d.lightAges, mesh: d.meshIntensity[0] };
    await ev('__sdfGame.setRenderLock(false)');
    await ev('__sdfGame.step(90)');   // let the burst and its light die
  }
  const r = arms[1], u = arms[0];
  const d2 = r.tiles.map((v, i) => v - u.tiles[i]);
  results.push({ spread, lit: r, unlit: u, deltaTiles: d2 });
  console.log(`\n=== fxspread ${spread} === (light age at the lit read ${JSON.stringify(r.lightAges)}, mesh ${r.mesh})`);
  if (!r.lightAges.length || r.lightAges[0] === 0) {
    console.log('  !! THE LIGHT NEVER AGED — the page is stalled and this arm measured nothing');
  }
  console.log(`  probe gather radiance: unlit ${u.probe.sum} -> lit ${r.probe.sum}`
    + `   (peak ${u.probe.max} -> ${r.probe.max})`);
  console.log('  frame tiles, LIT - UNLIT (the light\'s own contribution):');
  for (let ty = 0; ty < TILES; ty++) {
    console.log('   ' + d2.slice(ty * TILES, ty * TILES + TILES).map(v => v.toFixed(1).padStart(7)).join(''));
  }
  const ranked = r.tiles.map((v, i) => ({ i, d: d2[i], v })).sort((p, q) => q.v - p.v);
  const farD = ranked.slice(4).map(x => x.d);
  console.log(`  rise in the 12 NON-brightest tiles: min ${Math.min(...farD).toFixed(2)}, `
    + `median ${median(farD).toFixed(2)}, max ${Math.max(...farD).toFixed(2)}`);
  if (errs.length) console.log('  page errors:', errs.slice(0, 2));
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
}
writeFileSync(`${OUT}/reach.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote ${OUT}/reach.json`);
