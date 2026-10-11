// scripts/flat-frame-cost.mjs: a frame-cost probe for the Flat (docs/dev-notes/2026-10-11-flat-room/NOTES.md, "Frame cost").
// Per scene, one boot at 1280 x 800: ablations by alternation (baseline, variant, baseline blocks of K drawn-and-fenced frames, ROUNDS rounds; the delta is
// the variant minus the mean of the baselines either side, so a drift in load cancels). A/A is the instrument's floor. "Off" draws a wrong frame on purpose:
// each delta is the CEILING of what optimising that group could return. Material groups are hidden by their art-batch name.
// Env: ROUNDS (6), K (15), SCENES (flat-hall,flat-room,train-third). Needs its own vite + Chrome, and a quiet machine (it waits for the 1-minute load below 5):
//   bash -c 'export LAB_TMP=.lab-tmp LAB_VITE_PORT=5570 LAB_CDP_PORT=9570; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/flat-frame-cost.mjs 5570 9570'
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
const VITE = Number(process.argv[2]), CDP = Number(process.argv[3]);
const ROUNDS = Number(process.env.ROUNDS ?? 6), K = Number(process.env.K ?? 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const waitLoad = async () => { for (let i = 0; i < 40 && loadavg()[0] > 5; i++) await sleep(3000); return loadavg()[0]; };

async function boot(query) {
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${query}` });
  for (let i = 0; i < 480; i++) { await sleep(500); if ((await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready') return; if (errors.length) throw new Error(errors.join(' | ')); }
  throw new Error('no ready');
}
const HIDE = `(() => { let root = __sdfGame.viewModelAnchor; while (root.parent) root = root.parent; const sets = {};
  window.fc = { root, hide(key, test) { const v = sets[key] = []; root.traverse((o) => { if (o.visible && test(o)) { o.visible = false; v.push(o); } }); return v.length; },
    show(key) { for (const o of sets[key] || []) o.visible = true; sets[key] = []; } }; return 1; })()`;
const GROUPS = [
  ['conduits, rings, spines, claws (bone, gunmetal, gasket)', 'fc.hide("g", (o) => o.isMesh && /art-batch:\\d+:(bone|gunmetal|gasket)$/.test(o.name))'],
  ['the quilt', 'fc.hide("g", (o) => o.isMesh && /art-batch:\\d+:quilt$/.test(o.name))'],
  ['stone walls and ribs (stone_*)', 'fc.hide("g", (o) => o.isMesh && /art-batch:\\d+:stone_/.test(o.name))'],
  ['vault and flagstones', 'fc.hide("g", (o) => o.isMesh && /art-batch:\\d+:(vault|flagstone)$/.test(o.name))'],
  ['bathroom (tile, floor, enamel, chrome, bronze, mirror)', 'fc.hide("g", (o) => o.isMesh && /art-batch:\\d+:(bath_tile|bath_floor|enamel|chrome|bronze|mirror_glass)$/.test(o.name))'],
  ['the iMac shell', 'fc.hide("g", (o) => o.isMesh && /art-batch:\\d+:giger_shell$/.test(o.name))'],
  ['books', 'fc.hide("g", (o) => o.isMesh && /art-batch:\\d+:books$/.test(o.name))'],
];
const ABL = [
  ['A/A control', '0', '0'],
  ['all level art hidden', '__sdfGame.setArtVisible(false)', '__sdfGame.setArtVisible(true)'],
  ['post: VHS off', '__sdfGame.setVhs(null)', '__sdfGame.setVhs(window.__keepVhs)'],
  ['post: FXAA off', '__sdfGame.setFxaa(false)', '__sdfGame.setFxaa(true)'],
  ...GROUPS.map(([n, hide]) => [n, hide, 'fc.show("g")']),
];
async function measure(sceneName, query, pose) {
  await waitLoad();
  await boot(query);
  await evaluate('__sdfGame.freeze(true)');
  if (pose) await evaluate(pose);
  await evaluate(HIDE);
  await evaluate('window.__keepVhs = __sdfGame.vhs');
  await evaluate('__sdfGame.step(4)').catch(() => {});
  await sleep(1500);
  await evaluate('__sdfGame.timeDraws(20)');                                           // warm: pipelines for what this pose sees
  const t = async () => evaluate(`__sdfGame.timeDraws(${K})`);
  const base = [];
  const rows = [];
  for (const [name, on, off] of ABL) {
    const deltas = [];
    for (let r = 0; r < ROUNDS; r++) {
      const b1 = await t();
      await evaluate(on); await evaluate('__sdfGame.timeDraws(3)'); const v = await t(); await evaluate(off);
      const b2 = await t();
      base.push(b1, b2); deltas.push(v - (b1 + b2) / 2);
    }
    rows.push([name, med(deltas), Math.min(...deltas), Math.max(...deltas)]);
  }
  const stats = await evaluate('(() => { const i = __sdfGame.drawStats ? __sdfGame.drawStats(true) : null; return i; })()').catch(() => null);
  console.log(`\n== ${sceneName}  (load ${loadavg()[0].toFixed(1)}) baseline median ${med(base).toFixed(1)} ms  [min ${Math.min(...base).toFixed(1)}, max ${Math.max(...base).toFixed(1)}]  draws ${stats?.drawCalls ?? '?'}`);
  for (const [n, m, lo, hi] of rows) console.log(`   ${n.padEnd(58)} ${m >= 0 ? '+' : ''}${m.toFixed(2)} ms   (${lo.toFixed(1)} .. ${hi.toFixed(1)})`);
}
const WHICH = (process.env.SCENES ?? 'flat-hall,flat-room,train-third').split(',');
if (WHICH.includes('flat-hall')) await measure('Flat: the hall at the front door, looking north', 'level=flat&frozen', '__sdfGame.setPose(0.12, 1.55, 0, 0)');
if (WHICH.includes('flat-room')) await measure('Flat: the main room, wide', 'level=flat&frozen', '__sdfGame.setPose(0.12, -0.6, 0, 0)');
if (WHICH.includes('train-third')) await measure('Night Train: third class (reference)', 'level=night-train&frozen&nospawn', '__sdfGame.teleport(2)');
process.exit(0);
