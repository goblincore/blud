// scripts/sdf-swing-strip.mjs — photograph both swing variants at five beats
// each, from ONE fixed camera placed at the swinging body, so the two arcs
// can be compared directly by eye. Companion to
// docs/dev-notes/2026-09-05-swing-variants/notes.md (the owner read the
// shipped swing as "a swimmer's motion"; these frames are the evidence the
// replacement arcs read as a hook and a chop).
//
// The CDP plumbing below is copied VERBATIM from
// scripts/sdf-game-crowd-gate.mjs lines 15-101 — that file owns this
// plumbing and it must not fork.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5281);
const CDP = Number(process.argv[3] ?? 9281);
const OUT = process.env.GAME_OUT ?? 'docs/dev-notes/2026-09-05-swing-variants';
const W = Number(process.env.GAME_W ?? 800);
const H = Number(process.env.GAME_H ?? 600);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

/** A crashed/tab-busy target never answers a CDP request — every await needs
 *  a bound, or the driver hangs forever with zero diagnostics. */
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}

mkdirSync(OUT, { recursive: true });
let shotCount = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  shotCount++;
  console.log(`  shot ${name}.png (${buf.length} bytes)`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html`;
console.log(`game ${url}`);
await send('Page.navigate', { url });

let api = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (api) break;
}
if (!api) {
  console.error('console tail:', consoleEvents.slice(-8));
  fail('game page never booted (__sdfGame absent)');
}

// Ten frames: each variant at five phases, from ONE fixed camera placed at
// the swinging body, so the two arcs can be compared directly by eye.
await evaluate('typeof __sdfGame.woundPanel === "function" ? (__sdfGame.woundPanel(false), 1) : 0');
await evaluate('typeof __sdfGame.gooPanel === "function" ? (__sdfGame.gooPanel(false), 1) : 0');
await evaluate('__sdfGame.setLoopRunning(false)');

// Walk into room 4 and wake the room, so a body comes to melee range.
await evaluate('__sdfGame.setPose(-4.8, 2.0, 0, 0, 0)');
await evaluate('__sdfGame.fire(1)');

// Find a body that reaches melee, and park the camera 1.6 m from it looking
// at it. Everything below is captured from that ONE pose, so the only thing
// changing between frames is the swing.
let subject = null;
for (let i = 0; i < 60 && !subject; i++) {
  await evaluate('__sdfGame.step(10, 1 / 60)');
  const bs = await evaluate('__sdfGame.brains()');
  subject = bs.find((b) => b.state === 'attack' || b.state === 'recover') ?? null;
}
if (!subject) fail('no body reached melee range — nothing to photograph');
const zs = await evaluate('__sdfGame.zombies()');
const me = zs.find((z) => z.id === subject.id);
if (!me) fail(`zombie ${subject.id} vanished between reads`);
const cx = me.pos[0] - 1.6;
const cz = me.pos[2] - 1.6;
const yaw = Math.atan2(me.pos[0] - cx, -(me.pos[2] - cz));
const CAM = `__sdfGame.setPose(${cx}, ${cz}, ${yaw}, -0.10, 0)`;
await evaluate(CAM);

// The phases, named for the beat each one sits on.
const TUNING = await evaluate('__sdfGame.attackTuning()');
const PHASES = [
  ['rest', 0.02],
  ['windup', TUNING.windupEnd],
  ['midstrike', (TUNING.windupEnd + TUNING.strikeEnd) / 2],
  ['contact', (TUNING.strikeEnd + TUNING.holdEnd) / 2],
  ['recovery', (TUNING.holdEnd + 1) / 2],
];

for (const variant of ['hook', 'overhead']) {
  for (const [name, phase] of PHASES) {
    // SETTLE, THEN SHOOT. The rig is a spring system: the forced config sets
    // the TARGET, and one step moves the arm only part of the way there
    // (measured: phase-hopping one frame at a time showed pure lag — target
    // 1.35 rad read 0.44 and still climbing). Re-arm the pin on EVERY settle
    // frame so the brain cannot hijack the target mid-settle; ~5 frames
    // converges, 10 gives margin. A final re-armed frame is the one shot.
    for (let i = 0; i < 10; i++) {
      await evaluate(`__sdfGame.poseSwing(${subject.id}, ${phase}, 'R', '${variant}')`);
      await evaluate('__sdfGame.step(1, 1 / 60)');
    }
    await evaluate(CAM);
    await evaluate(`__sdfGame.poseSwing(${subject.id}, ${phase}, 'R', '${variant}')`);
    await evaluate('__sdfGame.step(1, 1 / 60)');
    await shot(`${variant}-${name}`);
  }
}
await evaluate('__sdfGame.setLoopRunning(true)');
console.log(`[swing-strip] OK — ${shotCount} frames in ${OUT}`);
process.exit(0);
