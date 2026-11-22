// One-off: why does the soldier's skin differ between analytic and original normals?
// Hypothesis: the 'skin detail' light layer (soldier k 1) only acts where the analytic normal is valid.
// One boot, one frozen frame, the march target read in five states. Usage:
//   LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 scripts/native-spike/servers.sh \
//     node docs/dev-notes/2026-11-10-soldier-skin-detail/probe.mjs <character> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { connectGame, bootCloseupPage, stageCloseUp, sleep } from '../../../scripts/lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5391);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9391);
const WHO = process.argv[2] ?? 'soldier';
const OUT = process.argv[3] ?? `.scratch/soldier-skin/out-${WHO}`;
const EXTRA = process.env.PROBE_QUERY ? `&${process.env.PROBE_QUERY}` : '';
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => fail('watchdog 20 min'), 20 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?level=arena&spawn=${WHO}${EXTRA}`, fail });

await evaluate('__sdfGame.setLoopRunning(false)');
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); return 1; })()');
const bodies = await evaluate('JSON.stringify(__sdfGame.zombies().map((z) => ({ id: z.id, room: z.room })))').then(JSON.parse);
if (bodies.length === 0) fail('no body in the arena');
const staged = await stageCloseUp(evaluate, { room: bodies[0].room, ladder: [1.4, 1.1, 0.9, 0.75], settleTries: 2400 }, fail);

const capture = async () => {
  await evaluate('(() => { __sdfGame.step(2); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  for (let attempt = 0; ; attempt++) {
    await evaluate('__sdfGameDebug.readMarchTarget()');
    const r = await evaluate('__sdfGameDebug.readMarchTarget()');
    const bytes = Buffer.from(r.rgba32f, 'base64');
    const f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
    if (f.some((v) => v !== 0)) return { w: r.w ?? r.width, h: r.h ?? r.height, f };
    if (attempt >= 40) fail('march target stayed all-zero');
    await sleep(250);
  }
};

const status = await evaluate('JSON.stringify(__sdfGame.normalGradientStatus())').then(JSON.parse);
const layers0 = await evaluate('JSON.stringify(__sdfGame.setLayer("skinDetail", true))');

await evaluate('__sdfGame.setNormalGradientDebug(0); __sdfGame.setNormalGradient(1); 1');
const a1 = await capture();
const a1b = await capture();
await evaluate('__sdfGame.setNormalGradient(0); 1');
const a0 = await capture();
await evaluate('__sdfGame.setLayer("skinDetail", false); __sdfGame.setNormalGradient(1); 1');
const s1 = await capture();
await evaluate('__sdfGame.setNormalGradient(0); 1');
const s0 = await capture();
// The reason census: r = reason + 1 on a body pixel (1 = analytic), 0 on background.
await evaluate('__sdfGame.setLayer("skinDetail", true); __sdfGame.setNormalGradient(1); __sdfGame.setNormalGradientDebug(2); 1');
const dbg = await capture();
await evaluate('__sdfGame.setNormalGradientDebug(0); 1');

// WOUNDED (PROBE_WOUNDS=1): five facing stamps, then the same two normals with the layer on, and the census.
let wounded = null;
if (process.env.PROBE_WOUNDS === '1') {
  const stamp = await evaluate(`(async () => {
    __sdfGame.setWoundTuning({ spillChance: 0 });
    const offsets = [[0, 0, 'slug'], [0.14, 0.06, 'slug'], [0.07, -0.08, 'pellet'], [-0.07, 0.1, 'pellet'], [-0.16, -0.04, 'pellet']];
    const base = __sdfGame.pose();
    let n = 0;
    for (const [dyaw, dpitch, kind] of offsets) {
      __sdfGame.setPose(base.pos[0], base.pos[2], base.yaw + dyaw, base.pitch + dpitch, 0);
      const p = __sdfGame.predictSlugHit();
      if (p.actorId < 0 || !p.hit) continue;
      if (__sdfGame.stampWoundAt(p.origin[0], p.origin[1], p.origin[2], p.dir[0], p.dir[1], p.dir[2], kind, p.actorId)) n++;
    }
    __sdfGame.setPose(base.pos[0], base.pos[2], base.yaw, base.pitch, 0);
    __sdfGame.step(6);
    return { stamped: n, chunks: __sdfGame.chunkCount };
  })()`);
  await evaluate('__sdfGame.setNormalGradient(1); 1');
  const w1 = await capture();
  await evaluate('__sdfGame.setNormalGradient(0); 1');
  const w0 = await capture();
  await evaluate('__sdfGame.setNormalGradient(1); __sdfGame.setNormalGradientDebug(2); 1');
  const wd = await capture();
  await evaluate('__sdfGame.setNormalGradientDebug(0); 1');
  wounded = { stamp, w1, w0, wd };
}

const { w, h } = a1;
const n = w * h;
const reasons = {};
const body = new Uint8Array(n);
for (let i = 0; i < n; i++) {
  const r = Math.round(dbg.f[i * 4]);
  if (r > 0) { body[i] = 1; reasons[r - 1] = (reasons[r - 1] ?? 0) + 1; }
}
const bodyN = body.reduce((s, v) => s + v, 0);
const compare = (x, y) => {
  let over02 = 0, over10 = 0, sum = 0, max = 0, lumX = 0, lumY = 0;
  for (let i = 0; i < n; i++) {
    if (!body[i]) continue;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(x.f[i * 4 + c] - y.f[i * 4 + c]));
    if (d > 0.02) over02++;
    if (d > 0.1) over10++;
    sum += d; if (d > max) max = d;
    lumX += (x.f[i * 4] + x.f[i * 4 + 1] + x.f[i * 4 + 2]) / 3;
    lumY += (y.f[i * 4] + y.f[i * 4 + 1] + y.f[i * 4 + 2]) / 3;
  }
  return { over02, over10, meanAbs: +(sum / bodyN).toFixed(5), max: +max.toFixed(4), meanLum: [+(lumX / bodyN).toFixed(4), +(lumY / bodyN).toFixed(4)] };
};

// ---- PNG sheets ----
const crc = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
const png = (W, H, rgb) => {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const tone = (v) => Math.max(0, Math.min(255, Math.round(255 * Math.pow(Math.max(v, 0), 1 / 2.2))));
const panel = (x) => { const b = Buffer.alloc(n * 3); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) b[i * 3 + c] = tone(x.f[i * 4 + c]); return b; };
const diffPanel = (x, y, gain) => { const b = Buffer.alloc(n * 3); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) b[i * 3 + c] = Math.min(255, Math.round(255 * gain * Math.abs(x.f[i * 4 + c] - y.f[i * 4 + c]))); return b; };
const sheet = (panels) => { const W = w * panels.length; const b = Buffer.alloc(W * h * 3); panels.forEach((p, k) => { for (let y = 0; y < h; y++) p.copy(b, (y * W + k * w) * 3, y * w * 3, (y + 1) * w * 3); }); return png(W, h, b); };
writeFileSync(join(OUT, 'layer-on.png'), sheet([panel(a0), panel(a1), diffPanel(a1, a0, 4)]));
writeFileSync(join(OUT, 'layer-off.png'), sheet([panel(s0), panel(s1), diffPanel(s1, s0, 4)]));
writeFileSync(join(OUT, 'original-layer-on-off.png'), sheet([panel(s0), panel(a0), diffPanel(a0, s0, 8)]));
let woundedOut = null;
if (wounded) {
  const wr = {}; let wn = 0;
  const keep = body.slice();
  for (let i = 0; i < n; i++) { const r = Math.round(wounded.wd.f[i * 4]); body[i] = r > 0 ? 1 : 0; if (r > 0) { wn++; wr[r - 1] = (wr[r - 1] ?? 0) + 1; } }
  const saveN = bodyN;
  woundedOut = { stamp: wounded.stamp, bodyPixels: wn, reasons: wr };
  writeFileSync(join(OUT, 'wounded.png'), sheet([panel(a1), panel(wounded.w1), panel(wounded.w0), diffPanel(wounded.w1, wounded.w0, 4)]));
  body.set(keep);
}

const result = {
  who: WHO, w, h, staged, status, layers0, bodyPixels: bodyN, reasons,
  'analytic vs analytic again (determinism)': compare(a1, a1b),
  'layer ON: analytic vs original': compare(a1, a0),
  'layer OFF: analytic vs original': compare(s1, s0),
  'original normals: layer ON vs OFF': compare(a0, s0),
  'analytic normals: layer ON vs OFF': compare(a1, s1),
  wounded: woundedOut,
};
writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(0);
