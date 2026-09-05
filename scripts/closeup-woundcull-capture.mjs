// scripts/closeup-woundcull-capture.mjs — close-up wound-cull task
// (2026-09-05): PIXEL-PARITY gate for the wound union-reach cull
// (applyWounds' one-sphere early-out, uniform woundBound).
//
// The cull is a value no-op BY CONSTRUCTION (a sample outside the bound is
// outside every per-wound reach, so every loop iteration would `continue`),
// and the gate holds it to that: on the WOUNDED fill-screen staging, cull ON
// vs cull OFF, same boot, same staged frame — 0 changed pixels, not "below
// the noise floor". The unwounded staging gets the same pair (bound radius 0
// / no setWounds — either way the loop never runs). A pixel that moves means
// the bound under-covers and the cull is eating a carve.
//
// Protocol inherited from closeup-probes-capture.mjs: frozen boot, explicit
// ship-default pin, bringToFront, 2500 ms weapon-spring settle, HUD strip
// (top 44 px) excluded, FPV weapon region masked. The seam flip is a uniform
// write — no pipeline recompile, no re-staging, so the pair shares one boot
// and one staged scene. ON is captured again after OFF to catch state
// leakage through the flip.
//
// Usage:
//   node scripts/closeup-woundcull-capture.mjs <vite> <cdp>
//   WOUNDCULL_SHOTS=/tmp/sdf-woundcull (output dir)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp, stampFacingWounds, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5399);
const CDP = Number(process.argv[3] ?? 9399);
const OUT = process.env.WOUNDCULL_SHOTS ?? '/tmp/sdf-woundcull-shots';
const W = 1280, H = 800;
const SETTLE_STEPS = Number(process.env.WOUNDCULL_SETTLE ?? 600);

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (25 min)'); process.exit(3); }, 25 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

// --- PNG decode + diff (verbatim from closeup-probes-capture.mjs, which took
// it from goo-capture.mjs) ---------------------------------------------------
function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = { 2: 3, 6: 4 }[colorType];
  const stride = w * channels;
  const out = Buffer.alloc(w * h * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { w, h, ch: channels, data: out };
}

const WEAPON_MASK = [[310, 532, 801, 799]];

// Hard gate: ZERO changed pixels at ANY delta (the cull is a value no-op —
// "prove it, do not hope"). changed counts pixels with any channel diff > 0.
function diffPngs(a, b, skipTopPx = 0, masks = WEAPON_MASK) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('size mismatch');
  let changed = 0, sum = 0, maxD = 0, n = 0;
  const y0 = skipTopPx; // the HUD strip: its frame EMA ticks even frozen
  for (let y = y0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++, n++) {
      if (masks.some(([mx0, my0, mx1, my1]) => x >= mx0 && x <= mx1 && y >= my0 && y <= my1)) continue;
      const i = (y * a.w + x) * a.ch;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 0) changed++;
      sum += d; if (d > maxD) maxD = d;
    }
  }
  return { changed, changedPct: +((changed / n) * 100).toFixed(4), meanD: +(sum / n).toFixed(4), maxD };
}

const shot = async (send, name, tag, settle = 2500) => {
  await sleep(settle);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (!s.result?.data) fail(`${name}: screenshot ${tag} returned no data`);
  const file = `${OUT}/${name}-${tag}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  return file;
};

/** One cull-state capture on the CURRENT staged frame: flip the seam, read
 *  it back (prove the seam bit), render fresh, shoot. */
async function captureCull(conn, on, tag) {
  const { send, evaluate } = conn;
  await evaluate(`__sdfGame.setWoundCull(${on})`);
  const rb = await evaluate('__sdfGame.woundCull');
  if (rb !== on) fail(`woundCull readback ${rb} != requested ${on} — seam did not bind`);
  await evaluate('__sdfGame.step(2)');
  return shot(send, on ? 'on' : 'off', tag);
}

/** Pin the wall clock. The frozen scene still ticks the fire flicker off
 *  performance.now() (game-main.ts: it is NOT gated on frozen), which wobbles
 *  the level's point-light intensities ±14% and jitters the whole frame at
 *  sub-LSB level — same-state captures 2.5 s apart differ on ~19% of pixels
 *  at d>0 (measured 2026-09-05, ON1/ON2 of this very script). The cull gate
 *  is a literal 0-changed-pixels proof, so the clock is pinned for the
 *  duration of the capture: every render then sees identical uniforms. */
async function pinClock(evaluate) {
  await evaluate('performance.now = () => 100000');
}

async function pair(conn, tag) {
  const fOn1 = await captureCull(conn, true, `${tag}-on1`);
  const fOff = await captureCull(conn, false, `${tag}-off`);
  const fOn2 = await captureCull(conn, true, `${tag}-on2`);
  const onOff = diffPngs(decodePng(readFileSync(fOn1)), decodePng(readFileSync(fOff)), 44);
  const onOn = diffPngs(decodePng(readFileSync(fOn1)), decodePng(readFileSync(fOn2)), 44);
  console.log(`  ${tag}: ON vs OFF ${JSON.stringify(onOff)}   ON1 vs ON2 ${JSON.stringify(onOn)}`);
  return { onOff, onOn };
}

const conn = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });
conn.vite = VITE;
console.log(`closeup-woundcull-capture → ${OUT}`);

// --- Wounded staging: the fill-screen body with camera-facing craters. -----
const { send, evaluate } = conn;
await send('Page.bringToFront');
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1`, fail });
await applyShipDefaults(evaluate);
await pinClock(evaluate);
const staging = await stageCloseUp(evaluate, {}, fail);
const woundInfo = await stampFacingWounds(evaluate, { minStamped: 3 }, fail);
await evaluate(`__sdfGame.step(${SETTLE_STEPS})`);
const wounded = await pair(conn, 'wounded');
// Liveness: with wounds stamped and the cull ON, the bound must be the
// COMPUTED sphere (radius in metres), not the 1e9 no-cull identity —
// otherwise the parity result above is vacuous.
const bound = await evaluate('JSON.stringify(__sdfGame.woundBound())');
const bs = JSON.parse(bound);
const live = bs.filter((b) => b[3] > 0 && b[3] < 1e8);
if (live.length === 0) fail(`no actor carries a computed wound bound after stamping: ${bound}`);
console.log(`  wound bounds (cull ON, wounded): ${live.map((b) => `[${b.map((v) => +v.toFixed(3)).join(', ')}]`).join(' ')}`);

// --- Unwounded staging: fresh boot, same staging, no stamps. ---------------
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1`, fail });
await applyShipDefaults(evaluate);
await pinClock(evaluate);
const staging2 = await stageCloseUp(evaluate, {}, fail);
await evaluate('__sdfGame.step(60)');
const unwounded = await pair(conn, 'unwounded');

writeFileSync(`${OUT}/parity.json`, JSON.stringify({ staging, woundInfo, staging2, wounded, unwounded }, null, 2));

for (const [name, d] of [['wounded on/off', wounded.onOff], ['wounded on/on', wounded.onOn], ['unwounded on/off', unwounded.onOff], ['unwounded on/on', unwounded.onOn]]) {
  if (d.changed !== 0) fail(`${name}: ${d.changed} changed pixels (maxD ${d.maxD}) — the cull is NOT a value no-op`);
}
console.log('PARITY: 0 changed pixels on all four diffs — the cull is a value no-op.');
console.log(`manifest ${OUT}/parity.json`);
process.exit(0);
