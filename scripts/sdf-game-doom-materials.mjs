// scripts/sdf-game-doom-materials.mjs — sector material shots for E1M1 (before/after the per-family materials).
// Boots ?level=doom-e1m1&nospawn&god=1 once per variant, stands at each pose and writes
// .lab-tmp/doom/mat/<variant>/<pose>.png. Variants: "after" (default materials), "before" (?sectormat=0, the old
// single stone set); a pose suffixed "-off" is taken with the flashlight off (__sdfGame.setFlashlight(false)).
// Also prints the draw calls and the sector mesh count per variant. Compose the sheet with
// scripts/sdf-game-doom-materials-sheet.py.
// Usage: LAB_TMP=.lab-tmp bash scripts/sdf-game-doom-materials.sh   (VARIANTS=before,after; POSES=start,tech,...)
// Emitters (hand-off item 2g): POSE_SET=emitters VARIANTS=emit-before,emit-after writes .lab-tmp/doom/emit/<variant>/
// (emit-before is ?emitters=0, the old look); compose with SHEET=emitters python3 scripts/sdf-game-doom-materials-sheet.py.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5483);
const CDP = Number(process.argv[3] ?? 9483);
const POSE_SET = process.env.POSE_SET ?? 'materials';
const OUT = POSE_SET === 'emitters' ? '.lab-tmp/doom/emit' : '.lab-tmp/doom/mat';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

/** [name, x, z, yaw, pitch, flashlight]: yaw 0 faces -z, π/2 faces +x. Picked from the generated plan. */
export const POSES = [
  ['start', 0, -1, Math.PI * 0.6, 0.05, true],            // the start room, facing its east wall
  ['tech', 30, -40, 0.25, 0.12, true],                    // the window room (zone 2): tech walls, light-panel bays
  ['door', 8.5, -35, Math.PI / 2, 0.05, true],           // the zone 7 corridor facing its door east (x 15)
  ['nukage', 57.75, -23.25, Math.PI * 0.9, -0.25, true], // the zigzag walkway, looking down at the nukage pool
  ['corridor', 50, -30, Math.PI / 2, 0, true],           // the corridor east of the window room (zone 9)
  ['lightceil', 61, 36, Math.PI, 0.45, true],            // the room past the exit door: a light-panel ceiling
  ['exitdoor', 61, 26, Math.PI, 0.1, true],              // facing the exit door (door family walls)
  ['start-off', 0, -1, Math.PI * 0.6, 0.05, false],
  ['tech-off', 30, -40, 0.25, 0.12, false],
];
/** The emitter shots: the computer room (zone 2: screen banks, the viewscreen boxes), fluorescents, the exit signs. */
export const EMITTER_POSES = [
  ['computer', 21, -28, 0.45, 0.2, true],                // the computer room from its north-west: both viewscreen boxes, the banks
  ['viewscreen', 26, -36.5, 0, 0.5, true],               // looking up at the south viewscreen box (y 3..7)
  ['screens', 32, -45.5, 0, 0.12, true],                 // the south alcove: its screen-bank back wall, the bank above
  ['screens-far', 32, -38, 0, 0.25, true],               // the south wall of screen banks from mid-room
  ['fluoro-ceil', 11, -35, Math.PI / 2, 0.35, true],     // the zone 7 corridor's fluorescent ceiling
  ['fluoro-niche', 0, -1.5, Math.PI, 0.1, true],         // the start room's lit niche (fluorescent strips, a flicker sector)
  ['exitsign', 61, 28, Math.PI, 0.4, true],              // the exit passage's sign box (y 1.75..2.25)
  ['exitceil', 61, 35, Math.PI, 0.45, true],             // the exit room: fluorescent ceiling and the second sign
  ['computer-off', 21, -28, 0.45, 0.2, false],
  ['viewscreen-off', 26, -36.5, 0, 0.5, false],
];

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); let consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  if (m.method === 'Runtime.exceptionThrown') consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });

const VARIANTS = (process.env.VARIANTS ?? 'before,after').split(',');
const only = process.env.POSES ? new Set(process.env.POSES.split(',')) : null;
const QUERY = { before: '&sectormat=0', after: '', head: '', 'emit-before': '&emitters=0', 'emit-after': '' };
const POSE_LIST = POSE_SET === 'emitters' ? EMITTER_POSES : POSES;
const EXTRA = process.env.QUERY_EXTRA ?? '';
for (const variant of VARIANTS) {
  consoleEvents = [];
  const t0 = Date.now();
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=doom-e1m1&nospawn&god=1${QUERY[variant] ?? ''}${EXTRA}` });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) {
    await sleep(500);
    ready = (await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready';
    if (consoleEvents.some((e) => e.type === 'error' || e.type === 'exception')) break;
  }
  if (!ready) { console.error(consoleEvents.slice(-8)); fail(`${variant}: did not boot to ready`); }
  console.log(`${variant}: ready in ${((Date.now() - t0) / 1000).toFixed(1)} s${consoleEvents.filter((e) => e.text.includes('[sector-mat]')).map((e) => `; ${e.text}`).join('')}`);
  // Walk a little first: right after ready the click-to-start overlay still covers the frame.
  await evaluate('__sdfGame.setPose(0, 0, 0, 0, 0)');
  await evaluate('__sdfGame.walkTo(0, -4)'); await sleep(2500); await evaluate('__sdfGame.walkCancel()');
  const meshes = await evaluate(`(() => { const out = {}; __sdfGame.sectorMeshes?.()?.forEach((n) => { out[n] = (out[n] ?? 0) + 1; }); return out; })()`).catch(() => null);
  if (meshes) console.log(`${variant}: sector meshes ${JSON.stringify(meshes)}`);
  mkdirSync(`${OUT}/${variant}`, { recursive: true });
  for (const [name, x, z, yaw, pitch, torch] of POSE_LIST) {
    if (only && !only.has(name)) continue;
    const hasSeam = await evaluate('typeof __sdfGame.setFlashlight === "function"');
    if (hasSeam) await evaluate(`__sdfGame.setFlashlight(${torch})`);
    else if (!torch) { console.log(`${variant}: ${name} skipped (no setFlashlight seam)`); continue; }
    const f = (await evaluate(`__sdfGame.ground(${x}, ${z})`)).floor;
    await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yaw}, ${pitch}, ${f})`);
    await sleep(1500);
    if (name === 'start' || name === 'computer') {
      await evaluate('__sdfGame.timeDraws(15)');
      const calls = [];
      for (let k = 0; k < 5; k++) {
        await evaluate('__sdfGame.drawStats(true)');
        await evaluate('__sdfGame.timeDraws(1)');
        calls.push((await evaluate('__sdfGame.drawStats(true)')).drawCalls);
      }
      console.log(`${variant}: draw calls at the start pose ${calls.join(', ')} (median ${[...calls].sort((x, y) => x - y)[2]})`);
    }
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${variant}/${name}.png`, Buffer.from(s.result.data, 'base64'));
    // ANIM_MS=<ms>: a second shot that much later (<pose>-later.png), to see the animated emitters move.
    if (process.env.ANIM_MS) {
      await sleep(Number(process.env.ANIM_MS));
      const s2 = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${variant}/${name}-later.png`, Buffer.from(s2.result.data, 'base64'));
    }
  }
  const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
  if (errs.length) fail(`${variant}: console errors ${JSON.stringify(errs.slice(0, 4))}`);
  console.log(`${variant}: shots in ${OUT}/${variant}/`);
}
process.exit(0);
