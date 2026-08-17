// CDP in-page numeric probe (motion-polish task 5): the screenshots from
// verify-motion-polish-5.mjs can't be eyeballed by the agent, so this
// measures the RENDERED pose directly — heroPosed() is the exact posed
// body the shader draws (view.update(posed)).
//
// Per 300 ms sample over two+ wander legs: nose-prim lead and arm-cluster
// lead along the applied bodyYaw, bucketed by quadrant. PASS = nose leads
// > 0.08 m and arms > 0.2 m in EVERY quadrant (pre-fix the -z nose lead
// was ~0.02 m — the 180°-head defect).
//
// Usage: node scripts/verify-motion-polish-5b.mjs <vitePort>
const VITE = Number(process.argv[2] ?? 5317);
const CDP = 9223;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });
await sleep(2500);

const gpu = await evaluate(`(async () => (await navigator.gpu?.requestAdapter()) ? 'webgpu-ok' : 'NO-ADAPTER')()`, true);
console.log('backend:', gpu);
if (gpu !== 'webgpu-ok') process.exit(1);

// One-time setup inside the page: identify the nose prim + cluster indices
// from a fresh deterministic build (same recipe as facing-chain.test.ts).
await evaluate(`(async () => {
  const bb = await import('/src/lab/sdf-zombie/build-body.ts');
  const bd = await import('/src/lab/sdf-zombie/body.ts');
  const body = bb.buildBody(bd.ZOMBIE, bb.DEFAULT_BUILD_OPTS);
  let noseIdx = -1, noseZ = -Infinity;
  body.prims.forEach((p, i) => {
    if (p.limb !== 'head') return;
    const z = (p.a[2] + p.b[2]) / 2;
    if (z > noseZ) { noseZ = z; noseIdx = i; }
  });
  window.__t5 = { noseIdx };
  const L = window.__sdfLab;
  L.setMotionEnabled(true); L.setWander(true); L.setArmStyle('reach');
  L.setGazeFollow(1); L.setCam(0.7, 0.28, 3.6);
  return window.__t5;
})()`, true);

const sample = () => evaluate(`(() => {
  const L = window.__sdfLab;
  const m = L.motion;
  const posed = L.heroPosed();
  const fwd = [Math.sin(m.bodyYaw), 0, Math.cos(m.bodyYaw)];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const p = posed.prims[window.__t5.noseIdx];
  const nose = [(p.a[0]+p.b[0])/2, (p.a[1]+p.b[1])/2, (p.a[2]+p.b[2])/2];
  const cl = (limb) => posed.clusters.find(c => c.limb === limb)?.center;
  const torso = cl('torso');
  if (!torso) return null;
  return {
    bodyYaw: +m.bodyYaw.toFixed(3), speed: +m.speed.toFixed(2),
    noseLead: +dot(sub(nose, torso), fwd).toFixed(3),
    armL: +dot(sub(cl('armL'), torso), fwd).toFixed(3),
    armR: +dot(sub(cl('armR'), torso), fwd).toFixed(3),
  };
})()`);

const QNAME = ['+z', '+x', '-z', '-x'];
const quadrant = (h) => {
  const a = ((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.round(a / (Math.PI / 2)) % 4;
};
const buckets = [[], [], [], []];
const t0 = Date.now();
let arrivals = 0, wasWalking = false;
while (Date.now() - t0 < 100_000 && (arrivals < 2 || buckets.some(b => b.length < 6))) {
  await sleep(300);
  const s = await sample();
  if (!s) continue;
  const walking = s.speed > 0.45;
  if (wasWalking && !walking) arrivals++;
  wasWalking = walking;
  if (!walking) continue;
  buckets[quadrant(s.bodyYaw)].push(s);
}

let fail = false;
for (let q = 0; q < 4; q++) {
  const b = buckets[q];
  if (b.length === 0) { console.log(`${QNAME[q]}: NO SAMPLES`); fail = true; continue; }
  const minNose = Math.min(...b.map(s => s.noseLead));
  const minArm = Math.min(...b.map(s => Math.min(s.armL, s.armR)));
  const avgNose = b.reduce((a, s) => a + s.noseLead, 0) / b.length;
  console.log(`${QNAME[q]}: n=${b.length} nose lead min ${minNose.toFixed(3)} avg ${avgNose.toFixed(3)} · arm lead min ${minArm.toFixed(3)}`);
  if (minNose < 0.08) { console.log(`  FAIL: nose does not lead travel in ${QNAME[q]}`); fail = true; }
  if (minArm < 0.2) { console.log(`  FAIL: arms not on the travel side in ${QNAME[q]}`); fail = true; }
}
console.log(fail ? 'RESULT: FAIL' : `RESULT: PASS (${arrivals} arrivals watched)`);
process.exit(fail ? 1 : 0);
