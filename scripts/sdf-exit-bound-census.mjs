// scripts/sdf-exit-bound-census.mjs — STEP 3 of close-up task 1b
// (2026-09-04): re-take the GAME_HULL_EXIT_BOUND census now that the fog
// decay is fixed (main 8da0bdd).
//
// HISTORY. The exit bound ("cut the march at the hull's back face") was
// measured as a 0.28 ms win with missStepShare 0.54 → 0.41 — and never
// shipped, because its census DELETED 4 of 9 bodies. Task 1 root-caused
// that deletion: the shell-out target was written through the scene's fog,
// so a far body's exit distance read ~2.8 m at a true 9 m and the bound cut
// the march short of the body. With material.fog = false the written
// distance is exact, and the bound's own exactness argument applies again:
// the hull contains the flesh, so no ray can hit anything beyond the hull's
// back face — the cut can only delete empty walking.
//
// CENSUS FIRST, TIMING SECOND. The bound's claim is EXACTNESS on the hit
// set, so the census instrument is the occupancy triple (off → on → off)
// on a frozen frame: hits, rasterised and meanStepsHit must be BIT-IDENTICAL
// off/on (the hit set cannot change; only miss walking shrinks), and the two
// off reads must agree (state-clean). missStepShare is ALLOWED — expected —
// to drop: that is the step win. Screenshots off/on accompany every view
// (decoded and pixel-diffed here, plus saved for eyeball) because the
// counters cannot see what the COMPOSITE does — the exact failure mode that
// hid the deletion last time. Screenshots come BEFORE any later occupancy
// call (each occupancy re-steps one frame in debug mode 4; the next state's
// settle absorbs it — perf-r2-parity's protocol, inherited).
//
// INSTRUMENT NOTE (task 1b). installDebugProbe's hashMarchTarget is NOT a
// valid live-frame parity hash in this build: in normal (non-debug) mode the
// march target is not refreshed by the running loop, so the hash reads a
// stale frame (constant c1b031c5 across different staged views, measured
// 2026-09-04) — and calling it was observed to leave the NEXT occupancy()
// read all-miss (hits 0). It is only valid immediately after a debug-mode
// render, as texRoundTrip uses it. The census therefore uses the occupancy
// triple + screenshots and never calls it.
//
// Views: room 1 at 0.5 / 3 / 9 m (the close-up ladder's extremes plus the
// far case), and rooms 3 / 4 in the game's own teleport framing (the
// multi-body views where the deletion historically happened).
//
// Usage: LAB_VITE_PORT=5387 LAB_CDP_PORT=9387 node scripts/sdf-exit-bound-census.mjs 5387 9387
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5387);
const CDP = Number(process.argv[3] ?? 9387);
const OUT = process.env.CENSUS_OUT ?? '/tmp/sdf-exit-census';
const W = 1280, H = 800;

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (20 min)'); process.exit(3); }, 20 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;
const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });
console.log(`exit-bound census ${url}`);

const settle = () => sleep(2500);

// --- minimal PNG decode (truecolor/grayscale, 8-bit, non-interlaced) --------
// Copied verbatim from scripts/perf-r2-parity.mjs (its precedent: verbatim
// from scripts/dungeon-shadowab.mjs).
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
  // The sleep is the headless capture race guard: without it
  // captureScreenshot can pair the LAST PRESENTED frame with the
  // just-submitted GPU work (perf-r2-parity's guard, inherited).
  await sleep(400);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (!s.result?.data) fail(`${name}: screenshot ${tag} returned no data`);
  const file = `${OUT}/${name}-${tag}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  return file;
};

/** One occupancy read, on the CURRENT bound state, after an explicit step. */
const occRead = async () => evaluate(`(async () => {
  __sdfGame.step(2);
  const o = await __sdfGame.occupancy();
  return { hits: o.hits, rasterised: o.rasterised, cov: +(o.hits / (o.targetW * o.targetH)).toFixed(5),
           missStepShare: +o.missStepShare.toFixed(4), meanStepsHit: +o.meanStepsHit.toFixed(2),
           meanStepsMiss: +o.meanStepsMiss.toFixed(2), bodies: o.bodiesOnScreen };
})()`);

/** One staged view: stage camera, freeze, settle, then off/on/off + shots. */
async function censusView(name, stageJs) {
  await bootCloseupPage({ send, evaluate, url, fail });
  await applyShipDefaults(evaluate);
  const staged0 = await evaluate(`(async () => {
    ${stageJs}
    return { ok: true };
  })()`);
  if (staged0.error) fail(`${name}: ${staged0.error}`);
  await settle();

  const off1 = await occRead();
  const offPng = await shot(name, 'off');
  await evaluate('__sdfGame.setHullExitBound(true)');
  await settle();
  const on = await occRead();
  const onPng = await shot(name, 'on');
  await evaluate('__sdfGame.setHullExitBound(false)');
  await settle();
  const off2 = await occRead();
  const off2Png = await shot(name, 'off2');

  // The exactness census: the hit set and its walk must not move; only the
  // MISS share may (that is the win). State-clean: flipping back restores.
  const hitSetSame = off1.hits === on.hits && off1.rasterised === on.rasterised && off1.meanStepsHit === on.meanStepsHit;
  const stateClean = off1.hits === off2.hits && off1.rasterised === off2.rasterised
    && off1.missStepShare === off2.missStepShare;
  const noise = diffPngs(decodePng(readFileSync(offPng)), decodePng(readFileSync(off2Png)));
  const delta = diffPngs(decodePng(readFileSync(offPng)), decodePng(readFileSync(onPng)));
  const clean = hitSetSame && stateClean && delta.changedPct <= Math.max(0.05, noise.changedPct * 2);
  const row = {
    view: name, bodies: off1.bodies, cov: off1.cov,
    off: off1, on, off2,
    hitSetSame, stateClean,
    noisePct: noise.changedPct, diffPct: delta.changedPct, maxD: delta.maxD,
    clean,
  };
  console.log(`  ${name.padEnd(12)} bodies ${row.bodies}  cov ${(row.cov * 100).toFixed(1)}%  hits ${off1.hits}${hitSetSame ? ' == ' + on.hits : ` != ${on.hits} (on)`}  rasterised ${off1.rasterised}→${on.rasterised}  meanStepsHit ${off1.meanStepsHit}→${on.meanStepsHit}  missStepShare ${off1.missStepShare}→${on.missStepShare}  | state-clean ${stateClean ? 'yes' : 'NO'}  px-diff on/off ${delta.changedPct}% (noise ${noise.changedPct}%)  → ${clean ? 'CLEAN' : 'FAILED'}`);
  return row;
}

/** The room-1 range staging: same pose maths as stageCloseUp, fixed rung. */
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

/** Rooms 3/4: the BENCH's standoff framing, not the bare teleport. The
 *  teleport seam drops the player at the room centre — INSIDE the frozen
 *  spawn cluster — and there the occupancy readback is blind: every hit
 *  pixel is also covered by a NEARER body's box whose rays miss, and mode 4
 *  gives the readback to the nearest write (the depth-winner bias documented
 *  in march.wgsl.ts's occupancy block). Measured 2026-09-04: bare teleport
 *  reads hits 0 / rasterised 39725 with bodies plainly on screen, while the
 *  same scene from a 4 m standoff reads hits 89050. Stand off and face the
 *  group, like buildFirefight's teleport action does. */
const roomStage = (room) => `
  __sdfGame.teleport(${room});
  const rc = __sdfGame.pose().pos; // the room centre, read from the seam
  const mine = __sdfGame.zombies().filter(q => q.room === ${room});
  if (!mine.length) return { error: 'no bodies in room ${room}' };
  const cx = mine.reduce((n, z) => n + z.pos[0], 0) / mine.length;
  const cz = mine.reduce((n, z) => n + z.pos[2], 0) / mine.length;
  __sdfGame.freeze(true);
  // Back off 4 m beyond the group (away from the room centre), then face it —
  // the bench teleport action's geometry (game-main.ts, 'teleport' case).
  const dx = cx - rc[0], dz = cz - rc[1 === 1 ? 2 : 2];
  const len = Math.hypot(dx, dz) || 1;
  const px = cx + (dx / len) * 4.0, pz = cz + (dz / len) * 4.0;
  __sdfGame.setPose(px, pz, Math.atan2(cx - px, -(cz - pz)), Math.atan2(1.0 - 1.62, Math.hypot(cx - px, cz - pz)), 0);
  return { ok: true, player: [px, pz], centroid: [cx, cz] };
`;

const views = [
  ['room1-0.5m', rangeStage(0.5)],
  ['room1-3m', rangeStage(3)],
  ['room1-9m', rangeStage(9)],
  ['room3', roomStage(3)],
  ['room4', roomStage(4)],
];

const rows = [];
for (const [name, stage] of views) rows.push(await censusView(name, stage));

const allClean = rows.every((r) => r.clean);
console.log(`\ncensus verdict: ${allClean
  ? 'CLEAN — hit set bit-identical on/off at every view; only miss walking shrank'
  : 'FAILED — the bound changes the hit set (or the composite): bodies (or pixels) move'}`);

writeFileSync(`${OUT}/exit-bound-census.json`, JSON.stringify({ url, W, H, when: new Date().toISOString(), allClean, rows }, null, 2));
console.log(`\nwrote ${OUT}/exit-bound-census.json  (pairs saved as ${OUT}/<view>-{off,on,off2}.png)`);
process.exit(0);
