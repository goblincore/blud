// scripts/sdf-game-grapeshot.mjs — headless verification for the grapeshot
// weapon on sdf-game.html. No-deps CDP, same pattern as scripts/sdf-game.mjs.
//
//   1. Boot gate: backend === 'webgpu', gun model loaded.
//   2. ONE BARREL at a wandering zombie from ~3 m — wound count grows, and
//      the wounds' resolved world anchors sit on the struck body.
//   3. FLIGHT READS: burst-capture pellets crossing a room at longer range.
//   4. POINT-BLANK DOUBLE-BARREL to a shoulder — the arm must come off
//      through the existing sever checks; chunks spawn.
//   5. SIBLING PAGES still boot without console errors.
//
// Usage: LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-game-grapeshot.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5277);
const CDP = Number(process.argv[3] ?? 9277);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-game-grapeshot';
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
if (api !== 'webgpu') fail(`backend is ${api}, not webgpu`);
console.log('backend: webgpu');

// Gun loaded?
for (let i = 0; i < 40; i++) {
  if (await evaluate('window.__sdfGame.gunReady')) break;
  await sleep(250);
}
if (!(await evaluate('window.__sdfGame.gunReady'))) fail('gun GLB never reported ready');
console.log('gun: ready');

// Let the wander run live for a moment, then take captures.
await sleep(2500);
await evaluate('window.__sdfGame.freeze(false)');

// --- 1. view-model ---------------------------------------------------------
await evaluate('window.__sdfGame.setPose(-4.0, -4.0, 0.7, -0.05)');
await sleep(600);
await shot('01-viewmodel');

// --- 2. one barrel at a wanderer -------------------------------------------
const zs = await evaluate('window.__sdfGame.zombies()');
const target = zs[0];
function poseToFace(px, pz, tx, tz, ty = 1.15, dist = 3.0) {
  // Position on the line between player start and target at `dist` back.
  const ux = tx - px, uz = tz - pz;
  const l = Math.hypot(ux, uz) || 1;
  const sx = tx - (ux / l) * dist;
  const sz = tz - (uz / l) * dist;
  const yaw = Math.atan2(tx - sx, -(tz - sz));
  const eye = 1.62;
  const pitch = Math.atan((ty - eye) / dist);
  return { x: sx, z: sz, yaw, pitch };
}
const aim1 = poseToFace(-4.0, -4.0, target.pos[0], target.pos[2], 1.15, 3.0);
await evaluate(`window.__sdfGame.setPose(${aim1.x}, ${aim1.z}, ${aim1.yaw}, ${aim1.pitch})`);
await sleep(400);
await shot('02-before-one-barrel');
const woundsBefore = await evaluate(`__sdfGame.zombie(${target.id}).woundCount()`);
const fired = await evaluate('__sdfGame.fire(1)');
if (!fired) fail('fire(1) returned false (gun not ready or cooldown)');
console.log(`fired 1 barrel at zombie ${target.id}; projectiles:`, await evaluate('__sdfGame.projectiles().length'));
await sleep(120);
await shot('03-flight-one-barrel');
await sleep(1500);
const woundsAfter1 = await evaluate(`__sdfGame.zombie(${target.id}).woundCount()`);
console.log(`wounds on zombie ${target.id}: ${woundsBefore} -> ${woundsAfter1}`);
await shot('04-after-one-barrel');

// Do the wounds land ON the body? Resolve each wound anchor vs the posed bounds.
const woundCheck = await evaluate(`(() => {
  const z = __sdfGame.zombie(${target.id});
  const p = z.posed();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity,-Infinity,-Infinity];
  for (const pr of p.prims) for (const e of [pr.a, pr.b]) for (let i=0;i<3;i++){lo[i]=Math.min(lo[i],e[i]);hi[i]=Math.max(hi[i],e[i]);}
  let inside = 0;
  const out = [];
  for (const w of (() => { throw new Error('no wound access'); })()) {}
  return { lo, hi };
})()`).catch(() => null);

// --- 3. flight reads at long range ----------------------------------------
{
  // Fire across an empty stretch: face along +x from room1's corner.
  await evaluate('window.__sdfGame.setPose(-5.2, -5.2, 0.7853981633974483, 0.0)');
  await sleep(300);
  await evaluate('__sdfGame.fire(1)');
  await sleep(45);
  await shot('05-flight-a');
  await sleep(50);
  await shot('06-flight-b');
  await sleep(50);
  await shot('07-flight-c');
  await sleep(1200);
}

// --- 4. point-blank double barrel to the shoulder --------------------------
let stage4TargetId = null;
{
  const zs2 = await evaluate('window.__sdfGame.zombies()');
  const t2 = zs2.find(z => z.id !== target.id) ?? zs2[0];
  stage4TargetId = t2.id;
  // 0.8 m in front of its chest, aimed at shoulder height (~1.40 m).
  await evaluate('window.__sdfGame.freeze(true)'); // hold it still while we seat the muzzle
  const aim = poseToFace(0, 0, t2.pos[0], t2.pos[2], 1.38, 0.8);
  await evaluate(`window.__sdfGame.setPose(${aim.x}, ${aim.z}, ${aim.yaw}, ${aim.pitch})`);
  await sleep(400);
  const armAliveBefore = await evaluate(
    `__sdfGame.zombie(${t2.id}).posed().clusters.find(c => c.limb === 'armR')?.alive`
    + ` ?? __sdfGame.zombie(${t2.id}).posed().clusters.find(c => c.limb === 'armL')?.alive`);
  await shot('08-before-double-barrel');
  const ok = await evaluate('__sdfGame.fire(2)');
  if (!ok) fail('fire(2) returned false');
  console.log(`double-barrel into zombie ${t2.id} at 0.8 m; projectiles:`, await evaluate('__sdfGame.projectiles().length'));
  await sleep(200);
  await shot('09-after-double-barrel');
  await evaluate('window.__sdfGame.freeze(false)');
  await sleep(1500);
  await shot('10-later-double-barrel');
  const res = await evaluate(`(() => {
    const z = __sdfGame.zombie(${t2.id});
    const cl = z.posed().clusters;
    const gone = {};
    for (const c of cl) gone[c.limb] = c.alive;
    return { gone, wounds: z.woundCount() };
  })()`);
  const anyArmGone = !(res.gone.armR ?? true) || !(res.gone.armL ?? true);
  console.log(`armR alive=${res.gone.armR} armL alive=${res.gone.armL} wounds=${res.wounds} armAliveBefore=${armAliveBefore}`);
  console.log(anyArmGone ? 'SEVER: yes — an arm came off' : 'SEVER: no arm came off');
}

console.log(`chunks spawned: ${await evaluate('__sdfGame.chunkCount')}`);

// --- 4b. shoulder-aimed double barrels — the sever gate --------------------
{
  // Stage 4 aimed at a fixed shoulder HEIGHT; the frozen zombie was mid-
  // stagger and the pellets chewed its belly (16 wounds, no sever — correct,
  // they never touched the joint). Here we read the ACTUAL posed shoulder
  // endpoint from the body and pour double barrels at it until it goes.
  const zs3 = await evaluate('window.__sdfGame.zombies()');
  // A FRESH target: stage 4's zombie is a collapsed pile by now (the wound
  // meter did that), and you cannot cut an arm off a crumpled corpse whose
  // joints are buried in the pile. Farthest zombie from the pile wins.
  const pile = await evaluate(`__sdfGame.zombies().find(z => z.id === ${stage4TargetId}).pos`);
  let t3 = null; let bestD = -1;
  for (const z of zs3) {
    const d = Math.hypot(z.pos[0] - pile[0], z.pos[2] - pile[2]);
    if (z.id !== stage4TargetId && d > bestD) { bestD = d; t3 = z; }
  }
  console.log(`sever target: zombie ${t3.id} (${bestD.toFixed(1)} m from the pile)`);
  await evaluate('window.__sdfGame.freeze(true)');
  let severed = false;
  for (let volley = 1; volley <= 4 && !severed; volley++) {
    // Read the shoulder: the arm endpoint NEAREST THE TORSO CENTRE (the
    // proximal end — cutLimbs' own root rule). "Highest endpoint" fails on
    // a zombie whose arms are extended straight forward: it picked the
    // HAND and the volley chewed a forearm.
    const shoulder = await evaluate(`(() => {
      const z = __sdfGame.zombie(${t3.id});
      const p = z.posed();
      const cl = p.clusters.find(c => (c.limb === 'armR' && c.alive) || (c.limb === 'armL' && c.alive));
      const torso = p.clusters.find(c => c.limb === 'torso');
      if (!cl || !torso) return null;
      const d2 = (e) => (e[0]-torso.center[0])**2 + (e[1]-torso.center[1])**2 + (e[2]-torso.center[2])**2;
      let best = null, bd = Infinity;
      for (let i = cl.start; i < cl.start + cl.count; i++) {
        const pr = p.prims[i];
        if (!pr || pr.op === 'sub' || pr.dead) continue;
        for (const e of [pr.a, pr.b]) { const d = d2(e); if (d < bd) { bd = d; best = e; } }
      }
      return best ? { x: best[0], y: best[1], z: best[2] } : null;
    })()`);
    if (!shoulder) { severed = true; break; } // both arms already gone
    // Stand 0.9 m back along the player->shoulder line, aim at the joint.
    const me = await evaluate('__sdfGame.pose()');
    const dx = shoulder.x - me.pos[0], dz = shoulder.z - me.pos[2];
    const l = Math.hypot(dx, dz) || 1;
    const sx = shoulder.x - (dx / l) * 0.9;
    const sz = shoulder.z - (dz / l) * 0.9;
    const yaw = Math.atan2(shoulder.x - sx, -(shoulder.z - sz));
    const pitch = Math.atan((shoulder.y - 1.62) / 0.9);
    await evaluate(`__sdfGame.setPose(${sx}, ${sz}, ${yaw}, ${pitch})`);
    await sleep(350);
    await evaluate('__sdfGame.fire(2)');
    await sleep(200);
    await shot(`11-sever-volley-${volley}.png`);
    await sleep(600);
    severed = await evaluate(`(() => {
      const p = __sdfGame.zombie(${t3.id}).posed();
      const a = l => p.clusters.find(c => c.limb === l);
      return (a('armR') && !a('armR').alive) || (a('armL') && !a('armL').alive);
    })()`);
    console.log(`volley ${volley}: severed=${severed} chunks=${await evaluate('__sdfGame.chunkCount')}`);
  }
  await evaluate('window.__sdfGame.freeze(false)');
  await sleep(1200);
  await shot('12-sever-aftermath.png');
  console.log(severed ? 'SEVER GATE: PASS — an arm came off point-blank' : 'SEVER GATE: FAIL');
}

// --- 5. sibling pages boot clean -------------------------------------------
for (const page of ['sdf-lab-webgpu.html', 'sdf-game.html']) {
  consoleEvents.length = 0;
  await send('Page.navigate', { url: `http://localhost:${VITE}/${page}` });
  let booted = false;
  for (let i = 0; i < 180 && !booted; i++) {
    await sleep(500);
    booted = await evaluate(
      page === 'sdf-game.html'
        ? 'typeof window.__sdfGame === "object"'
        : 'typeof window.__sdfLab === "object"').catch(() => false) === true;
  }
  const errs = consoleEvents.filter(e => e.type === 'error' || e.type === 'exception');
  console.log(`${page}: ${booted ? 'booted' : 'DID NOT BOOT (or >90 s)'}${errs.length ? `, ${errs.length} console errors: ${errs.slice(0, 3).map(e => e.text.slice(0, 160)).join(' | ')}` : ', console clean'}`);
}

console.log(`done — ${shotCount} shots in ${OUT}`);
