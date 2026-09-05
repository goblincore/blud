// scripts/sdf-depth-prepass-census.mjs — close-up task 3 correctness gate.
//
// THE LESSON THIS SCRIPT EXISTS TO ENFORCE: the hull exit bound once "won"
// 0.28 ms by DELETING 4 of 9 bodies and every timing table looked fine. A
// quarter-res ray start that is too aggressive does not look slightly wrong
// — it deletes geometry, silently and range-dependently. So the census
// (bodies/pixels present with the prepass on vs off, at three ranges) is the
// gate, and the timing is commentary.
//
// DESIGN NOTE on what "identical" means here, different from the exit-bound
// census: the exit bound is EXACT (it only cuts empty space), so its hit set
// had to be bit-identical. The depth-prepass start is a LOWER BOUND with a
// finite backoff, so hit POSITIONS may move by up to ~one block footprint —
// hits/meanStepsHit MAY change (meanStepsHit DROPPING is the win). What may
// NOT change: which geometry exists. The instruments:
//   1. hits within a fringe tolerance of off (a deleted body is -100% of
//      itself; a fringe is <1%);
//   2. decoded off/on pixel diffs vs an off/off2 noise floor, with the diff
//      maps SAVED for eyeball;
//   3. state-clean (off2 == off1);
//   4. per-view step counters, quoted.
// Occupancy mode-4 counts only the depth-winning fragment — where proxy
// boxes overlap it cannot attribute hits per body (march.wgsl.ts note) —
// which is why the pixel-level instruments above, not just counters, are
// the gate. Range sweep: 0.5 / 3 / 9 m — the fog decay that killed the exit
// bound was exact near and wrong far; a near-only gate passes a broken
// feature.
//
// Usage: node scripts/sdf-depth-prepass-census.mjs 5397 9397
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep, stampFacingWounds } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5397);
const CDP = Number(process.argv[3] ?? 9397);
const OUT = process.env.CENSUS_OUT ?? '/tmp/sdf-depth-prepass-census';
const W = 1280, H = 800;

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (25 min)'); process.exit(3); }, 25 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;

const conn = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });
const { send, evaluate } = conn;
console.log(`depth-prepass census ${url}`);

// --- minimal PNG decode + diff (verbatim from sdf-exit-bound-census.mjs) ----
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
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported png: depth ${bitDepth} color ${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= ch && prev ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}

function diffPngs(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('size mismatch');
  let changed = 0, sum = 0, maxD = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const ia = i * a.ch, ib = i * b.ch;
    const d = Math.abs(a.data[ia] - b.data[ib]) + Math.abs(a.data[ia + 1] - b.data[ib + 1]) + Math.abs(a.data[ia + 2] - b.data[ib + 2]);
    if (d > 30) changed++;
    sum += d; if (d > maxD) maxD = d;
  }
  return { changed, changedPct: +((changed / (a.w * a.h)) * 100).toFixed(4), meanD: +(sum / (a.w * a.h)).toFixed(2), maxD };
}

const shot = async (name, tag) => {
  await sleep(400);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (!s.result?.data) fail(`${name}: screenshot ${tag} returned no data`);
  const file = `${OUT}/${name}-${tag}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  return file;
};

const occRead = async () => evaluate(`(async () => {
  __sdfGame.step(2);
  const o = await __sdfGame.occupancy();
  return { hits: o.hits, rasterised: o.rasterised, cov: +(o.hits / (o.targetW * o.targetH)).toFixed(5),
           missStepShare: +o.missStepShare.toFixed(4), meanStepsHit: +o.meanStepsHit.toFixed(2),
           meanStepsMiss: +o.meanStepsMiss.toFixed(2), bodies: o.bodiesOnScreen };
})()`);

async function censusView(name, stageJs, opts = {}) {
  const { wantWounds = false, minStamped = 3 } = opts;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await bootCloseupPage({ send, evaluate, url: `${url}&r=${name}-${attempt}`, fail });
      await applyShipDefaults(evaluate);
      await evaluate('__sdfGame.setHullExitBound(true)');
      const staged = await evaluate(`(async () => { ${stageJs} return { ok: true }; })()`);
      if (staged.error) fail(`${name}: ${staged.error}`);
      // The posed fields the wound tracer reads update on the frame loop —
      // predictions issued in the SAME tick as setPose all miss (measured
      // 2026-09-05: 0/5 without this, 5/5 with it).
      await evaluate('__sdfGame.step(3)');
      await sleep(400);
      if (wantWounds) await stampFacingWounds(evaluate, { minStamped });
      await sleep(2500);

      const warm = await occRead();
      if (!warm || warm.hits < 100) { console.log(`  ${name}: boot dead (hits ${warm ? warm.hits : 'null'}) — retry`); continue; }

      const off1 = await occRead();
      const offPng = await shot(name, 'off');
      await evaluate('__sdfGame.setDepthPrepass(true)');
      await sleep(1200);
      const on = await occRead();
      const onPng = await shot(name, 'on');
      await evaluate('__sdfGame.setDepthPrepass(false)');
      await sleep(1200);
      const off2 = await occRead();
      const off2Png = await shot(name, 'off2');

      // THE CENSUS. A deleted body shows as a hits collapse; a fringe is ~0.
      const hitsKept = off1.hits > 0 ? on.hits / off1.hits : 1;
      const hitsKeptPct = +(hitsKept * 100).toFixed(2);
      const fringeOk = hitsKept >= 0.985;
      const stateClean = off1.hits === off2.hits && off1.rasterised === off2.rasterised;
      const noise = diffPngs(decodePng(readFileSync(offPng)), decodePng(readFileSync(off2Png)));
      const delta = diffPngs(decodePng(readFileSync(offPng)), decodePng(readFileSync(onPng)));
      const pxOk = delta.changedPct <= Math.max(0.15, noise.changedPct * 2);
      const clean = fringeOk && stateClean && pxOk;
      const stepWin = off1.meanStepsHit > 0 ? +(((off1.meanStepsHit - on.meanStepsHit) / off1.meanStepsHit) * 100).toFixed(1) : 0;
      const row = {
        view: name, bodies: off1.bodies, cov: off1.cov,
        off: off1, on, off2,
        hitsKeptPct, fringeOk, stateClean, pxOk,
        noisePct: noise.changedPct, diffPct: delta.changedPct,
        stepWinPct: stepWin,
        clean,
      };
      console.log(`  ${name.padEnd(16)} bodies ${row.bodies}  hits ${off1.hits} → ${on.hits} (kept ${hitsKeptPct}%)  msh ${off1.meanStepsHit} → ${on.meanStepsHit} (-${stepWin}%)  mss ${off1.meanStepsMiss} → ${on.meanStepsMiss}  | state-clean ${stateClean ? 'yes' : 'NO'}  px-diff ${delta.changedPct}% (noise ${noise.changedPct}%)  → ${clean ? 'CLEAN' : 'FAILED'}`);
      return row;
    } catch (e) {
      console.log(`  ${name}: attempt ${attempt} failed: ${e.message.slice(0, 90)}`);
      if (attempt === 3) fail(`${name}: 3 attempts exhausted`);
    }
  }
}

/** Fixed-distance framing of ONE room-1 body, camera-facing. */
const rangeStage = (d) => `
  __sdfGame.teleport(1);
  const z = __sdfGame.zombies().find(q => q.room === 1);
  if (!z) return { error: 'no body in room 1' };
  __sdfGame.freeze(true);
  const ex = z.pos[0], ez = z.pos[2] + ${d};
  const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
  __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)), 0);
  return { ok: true };
`;

/** Rooms 3/4: the bench standoff framing (the bare teleport lands INSIDE the
 *  frozen spawn cluster where the occupancy readback is blind — 1b note). */
const roomStage = (room) => `
  __sdfGame.teleport(${room});
  const rc = __sdfGame.pose().pos;
  const mine = __sdfGame.zombies().filter(q => q.room === ${room});
  if (!mine.length) return { error: 'no bodies in room ${room}' };
  const cx = mine.reduce((n, z) => n + z.pos[0], 0) / mine.length;
  const cz = mine.reduce((n, z) => n + z.pos[2], 0) / mine.length;
  __sdfGame.freeze(true);
  const dx = cx - rc[0], dz = cz - rc[2];
  const len = Math.hypot(dx, dz) || 1;
  const px = cx + (dx / len) * 4.0, pz = cz + (dz / len) * 4.0;
  __sdfGame.setPose(px, pz, Math.atan2(cx - px, -(cz - pz)), Math.atan2(1.0 - 1.62, Math.hypot(cx - px, cz - pz)), 0);
  return { ok: true };
`;

/** Thin geometry: the HEAD at close range — jaw/ears/skull are where an
 *  over-aggressive start shows first. Plus a NEAR body OVERLAPPING a far one
 *  (the second staged body is behind the first from this pose). */
const headStage = `
  __sdfGame.teleport(1);
  const z = __sdfGame.zombies().find(q => q.room === 1);
  if (!z) return { error: 'no body in room 1' };
  __sdfGame.freeze(true);
  const ex = z.pos[0], ez = z.pos[2] + 0.9;
  const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
  __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.55 - 1.62, Math.hypot(dx, dz)), 0);
  return { ok: true };
`;

const rows = [];
rows.push(await censusView('wounded-0.5m', rangeStage(0.5), { wantWounds: true }));
// At 3/9 m the fill-screen wound offsets mostly miss a small body — and
// near-field crater stress is the 0.5 m view's job anyway. Far views want
// ONE hit (proof the body is there), not the full crater set.
rows.push(await censusView('wounded-3m', rangeStage(3), { wantWounds: true, minStamped: 1 }));
// 9 m: no wounds — every offset misses a body this small, and the far-range
// question is whether the START survives distance (the fog-decay failure
// mode), which the geometry census answers without craters.
rows.push(await censusView('wounded-9m', rangeStage(9)));
rows.push(await censusView('head-0.9m-thin', headStage));
rows.push(await censusView('room3-standoff', roomStage(3)));
rows.push(await censusView('room4-standoff', roomStage(4)));

const allClean = rows.every((r) => r.clean);
console.log(`\ncensus verdict: ${allClean
  ? 'CLEAN — hit coverage retained at every view, state-clean, pixel diffs at/below noise'
  : 'FAILED — a view lost geometry (or moved pixels beyond the fringe)'}`);

writeFileSync(`${OUT}/depth-prepass-census.json`, JSON.stringify({ url, W, H, when: new Date().toISOString(), allClean, rows }, null, 2));
console.log(`\nwrote ${OUT}/depth-prepass-census.json  (triplets saved as ${OUT}/<view>-{off,on,off2}.png)`);
process.exit(allClean ? 0 : 2);
