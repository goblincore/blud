// scripts/lean-walk-parity.mjs — the MULTI-BODY bit-identity gate for the
// march's clean-body fast path (`?leanwalk`,
// docs/superpowers/specs/2026-11-09-march-lean-walk-design.md).
//
// march-hash.mjs proves the flag on ONE clean (and one wounded) body. The fast
// path is chosen per pixel from every slot of the pixel's tile table, so the
// cases that matter are tiles holding SEVERAL bodies: two clean bodies (the
// fast path must fold both, in table order) and a clean body sharing a tile
// with a wounded one (the whole pixel must stay on mapBody). This script stages
// such a frame and compares the EXACT float march target, float for float:
//
//   boot 1, ?leanwalk=0   stage, read OFF (the march without the lean walk)
//   boot 2, the default   stage the same way, read ON (lean enabled), HELD after
//                      __sdfGame.setLeanWalk(false), ON2 after setLeanWalk(true),
//                      then the census (debug mode 23: r = 1 where the walk took
//                      mapLean, g = the pixel's slot count, b = steps + 1000*hit)
//
// PASS: OFF == ON, ON == HELD, ON == ON2, every bit of every float; AND the
// census shows the frame exercises the claim: lean pixels with >= 2 slots (two
// clean bodies in one tile) and non-lean HIT pixels with >= 2 slots (a clean
// body sharing a tile with the wounded one). Either missing FAILs as "frame does
// not exercise the claim", never as a pass. The clean pre-wound frame of each
// boot is compared too (OFF-clean vs ON-clean), as extra evidence.
//
// THE FRAME. The page is pinned exactly as march-hash.mjs pins it (same URL
// flags, same background-compile wait, loop off, ship defaults, fields off,
// light clock frozen at 0, demo hold, probe blend/fall 1, sdfScale 0.5, the
// same settle loops and the same two-reads-per-capture parity contract: see
// march-hash.mjs's header for why each exists). Copied, not shared, so
// march-hash.mjs's behaviour cannot move. One addition: the clean and wounded
// frames are each taken only once two captures 12 frames apart agree to the bit
// (captureSettled below: a freshly wounded crowd body keeps changing for frames). The scene is capture.mjs's
// SPIKE_SCENE=crowd (the player in room 1's near corner, LEAN_PARITY_CROWD
// zombies, default 12, on a 0.9 m grid in the far half) instead of the close-up.
// ONE zombie is then wounded: the spawned body whose projected proxy box shares
// the most 16 px tiles with another spawned body's box (ties: lowest id). Its
// three shots are computed in the page from its position and the camera eye and
// rounded to 3 decimals (march-hash.mjs's WOUND_SHOTS rationale: no traced hit
// point feeds the ray), aimed from 2 m in front of the body along the view ray,
// stamped through __sdfGame.stampWoundAt(..., bodyId) on that body alone.
//
// OVERLAP ON THE OFF BOOT. `?leanwalk=0` has no census, so the
// script reports overlap from the per-body proxy boxes (actorDump centre +
// bodyHalf from normalCaptureState, projected with the page's own camera and
// projection, the method of __sdfGameDebug.readTileSlotMask): tiles covered by
// >= 2 clean spawned boxes, and tiles where the wounded box overlaps another.
// A box overlap is a necessary condition for a shared tile table, not proof of
// one; the census on the flag-on boot is the proof.
//
// LEAN_PARITY_AA=1 — the determinism check: both boots `?leanwalk=0`, and
// the comparison is OFF(boot 1) against OFF(boot 2) (clean and wounded). Run it
// before trusting an off-vs-on comparison: two boots that do not agree with the
// flag off make any flag-on difference meaningless. Do not loosen anything if
// they disagree; find the staging input that moves (march-hash.mjs's header
// lists the past causes and MARCH_HASH_DUMP is the instrument).
//
// Env:
//   LAB_VITE_PORT / LAB_CDP_PORT  (default 5323 / 9323; run inside lab-servers)
//   LEAN_PARITY_AA=1              two flag-off boots, the determinism check
//   LEAN_PARITY_CROWD=<n>         zombies spawned (default 12)
//   LEAN_PARITY_QUERY=<query>     extra page query on both boots (e.g. crowddispatch=boxes)
//   LEAN_PARITY_EXITBOUND=1       the shipped hull exit bound ON on both boots (default off, the
//                                 march-hash.mjs regime); echoed as hullExitBound in the JSON line
//   LEAN_PARITY_FLAG=<query>     the on boot's flag (default none: the shipped page, walk only; leanwalk = walk and probe)
//   LEAN_PARITY_OUT=<dir>         also write each buffer as <dir>/<name>.f32 + .f32.json ({w,h}),
//                                 the layout scripts/march-raw-diff.mjs reads
//   MARCH_HASH_BG_WAIT_S          the background-compile ceiling (default 600), as march-hash.mjs
//
// Output: ONE JSON line to stdout; exit 0 on pass, 1 on any difference, an
// unexercised frame, or an on boot without the lean walk (or an off boot with it).
//
// Run (under the machine's GPU lock, LAB_TMP=.lab-tmp):
//   LAB_TMP=.lab-tmp LAB_VITE_PORT=5377 LAB_CDP_PORT=9377 scripts/native-spike/servers.sh \
//     env LEAN_PARITY_AA=1 node scripts/lean-walk-parity.mjs
//   LAB_TMP=.lab-tmp LAB_VITE_PORT=5377 LAB_CDP_PORT=9377 scripts/native-spike/servers.sh \
//     node scripts/lean-walk-parity.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
const AA = process.env.LEAN_PARITY_AA === '1';
const CROWD = Number(process.env.LEAN_PARITY_CROWD ?? 12);
const EXTRA = process.env.LEAN_PARITY_QUERY ? `&${process.env.LEAN_PARITY_QUERY}` : '';
const OUT = process.env.LEAN_PARITY_OUT ?? '';
// THE LEAN WALK IS ON BY DEFAULT since 2026-11-09 (walk only; lean-walk-flag.ts). So the "off" boot of this gate is
// `?leanwalk=0` and the "on" boot is the DEFAULT page. LEAN_PARITY_FLAG names another form for the on boot
// (`leanwalk`: the temporal probe on mapLean too).
const LEAN_FLAG = process.env.LEAN_PARITY_FLAG ?? '';
// LEAN_PARITY_EXITBOUND=1 — the SHIPPED hull exit bound. applyShipDefaults turns it
// off (the march-hash.mjs regime, where its pins were taken); the game ships it on.
// Set after the ship defaults on both boots, before staging; the JSON line says which.
const EXITBOUND = process.env.LEAN_PARITY_EXITBOUND === '1';
const TILE = 16;
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 30 min'); process.exit(3); }, 30 * 60_000).unref();
if (OUT) mkdirSync(OUT, { recursive: true });

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });

// ---- the march-hash.mjs pins (copied; see that file's header for each) ----
const settleMarchTarget = async (opts = {}) => {
  const { distinctFrom = null, tries = 40 } = opts;
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const cur = await evaluate('__sdfGameDebug.hashMarchTarget()');
    const live = cur.nonZero > 0;
    const stable = prev !== null && prev.hash === cur.hash;
    const distinct = distinctFrom === null || cur.hash !== distinctFrom;
    if (live && stable && distinct) return cur;
    prev = cur;
    await sleep(250);
  }
  return null;
};

// After a uniform switch: hashMarchTarget() renders nothing, so draw two frames
// (an even count keeps the read-parity phase) before settling on the new state.
const redraw = async () => { await evaluate('(() => { __sdfGame.step(2); return 1; })()'); await evaluate('__sdfGame.resolveGpu()'); };

// Two readMarchTarget() calls per logical capture (each steps one frame; the
// pair keeps the frame-parity jitter on one phase), all-zero retried. Returns
// the raw bytes and the exact sha1 of every bit.
const capture = async () => {
  for (let attempt = 0; ; attempt++) {
    await evaluate('__sdfGameDebug.readMarchTarget()');
    const r = await evaluate('__sdfGameDebug.readMarchTarget()');
    const bytes = Buffer.from(r.rgba32f, 'base64');
    let allZero = true;
    for (const b of bytes) { if (b !== 0) { allZero = false; break; } }
    if (allZero) {
      if (attempt >= 20) fail('readMarchTarget returned an all-zero frame 20x — renderer never caught up');
      await sleep(250);
      continue;
    }
    return { w: r.w, h: r.h, bytes, sha1: createHash('sha1').update(bytes).digest('hex') };
  }
};

// SETTLED CAPTURE (2026-11-09, found by this script's first full run): a freshly
// wounded crowd body keeps changing for frames after the stamp's step(5), sim
// frozen or not (ON vs a read 4 frames later differed in 323 texels at the
// wounded body's edge, the same in both programs). So a capture is only taken as
// THE frame once two captures 10 frames apart agree to the bit. The schedule is
// frame-counted, not timed, so both boots step the same number of frames; the
// count is reported. Ten frames a try keeps the read-parity phase (even).
const captureSettled = async (what, maxTries = 60) => {
  let prev = await capture();
  for (let k = 1; k <= maxTries; k++) {
    await evaluate('(() => { __sdfGame.step(10); return 1; })()');
    await evaluate('__sdfGame.resolveGpu()');
    const cur = await capture();
    if (cur.sha1 === prev.sha1) return { ...cur, settleFrames: k * 12 };
    prev = cur;
  }
  fail(`${what}: the march target still changes after ${maxTries} tries of 12 frames — nothing to compare`);
};

const save = (name, cap) => {
  if (!OUT) return;
  writeFileSync(join(OUT, `${name}.f32`), cap.bytes);
  writeFileSync(join(OUT, `${name}.f32.json`), JSON.stringify({ w: cap.w, h: cap.h }));
};

// ---- float-for-float comparison: bit identity is the pass ----
const compare = (a, b) => {
  if (a.w !== b.w || a.h !== b.h) return { identical: false, sizeMismatch: [`${a.w}x${a.h}`, `${b.w}x${b.h}`] };
  const ua = new Uint32Array(a.bytes.buffer, a.bytes.byteOffset, a.bytes.length / 4);
  const ub = new Uint32Array(b.bytes.buffer, b.bytes.byteOffset, b.bytes.length / 4);
  const fa = new Float32Array(a.bytes.buffer, a.bytes.byteOffset, a.bytes.length / 4);
  const fb = new Float32Array(b.bytes.buffer, b.bytes.byteOffset, b.bytes.length / 4);
  let texels = 0, maxAbs = 0, nanMismatch = 0;
  const first = [];
  for (let t = 0; t < a.w * a.h; t++) {
    let diff = false;
    for (let c = 0; c < 4; c++) {
      const i = t * 4 + c;
      if (ua[i] === ub[i]) continue;
      diff = true;
      const d = Math.abs(fa[i] - fb[i]);
      if (Number.isNaN(d)) nanMismatch++; else if (d > maxAbs) maxAbs = d;
    }
    if (!diff) continue;
    texels++;
    if (first.length < 5) {
      const x = t % a.w, y = Math.floor(t / a.w);
      first.push({ x, y, a: Array.from(fa.subarray(t * 4, t * 4 + 4)), b: Array.from(fb.subarray(t * 4, t * 4 + 4)) });
    }
  }
  return { identical: texels === 0, differingTexels: texels, maxAbsDiff: maxAbs, nanMismatch, first };
};

// ---- the census (debug mode 23, flag-on pages only) ----
const census = (cap) => {
  const f = new Float32Array(cap.bytes.buffer, cap.bytes.byteOffset, cap.bytes.length / 4);
  const rows = {};
  let lean2 = 0, nonLeanHit2 = 0, leanTotal = 0, marched = 0;
  for (let t = 0; t < cap.w * cap.h; t++) {
    const lean = f[t * 4] > 0.5;
    const slots = Math.round(f[t * 4 + 1]);
    const hit = f[t * 4 + 2] >= 999.5;
    if (slots <= 0) continue; // no fragment marched here (or the pixel is off the tile-list path)
    marched++;
    const key = `${slots >= 3 ? '3+' : slots}/${lean ? 'lean' : 'body'}/${hit ? 'hit' : 'miss'}`;
    rows[key] = (rows[key] ?? 0) + 1;
    if (lean) leanTotal++;
    if (lean && slots >= 2) lean2++;
    if (!lean && hit && slots >= 2) nonLeanHit2++;
  }
  return { marched, leanTotal, leanShare: marched ? +(leanTotal / marched).toFixed(4) : 0, leanMultiSlot: lean2, bodyHitMultiSlot: nonLeanHit2, rows };
};

// ---- per-body proxy boxes, projected (the readTileSlotMask method) ----
const boxesJs = (ids, W, H) => `(() => {
  const st = __sdfGameDebug.normalCaptureState();
  const m = st.camera, P = st.projection;
  // camera.matrixWorld is rigid: its inverse is R^T, -R^T t (column-major).
  const tx = m[12], ty = m[13], tz = m[14];
  const toView = (x, y, z) => {
    const dx = x - tx, dy = y - ty, dz = z - tz;
    return [m[0] * dx + m[1] * dy + m[2] * dz, m[4] * dx + m[5] * dy + m[6] * dz, m[8] * dx + m[9] * dy + m[10] * dz];
  };
  const halfOf = new Map(st.pieces.filter((p) => p.key.startsWith('body:')).map((p) => [Number(p.key.slice(5)), p.uniforms.bodyHalf]));
  const want = new Set(${JSON.stringify(ids)});
  const out = [];
  for (const a of __sdfGame.actorDump()) {
    if (!want.has(a.id)) continue;
    const h = halfOf.get(a.id);
    if (!h) { out.push({ id: a.id, error: 'no bodyHalf' }); continue; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, any = false;
    for (let c = 0; c < 8; c++) {
      const v = toView(a.pos[0] + ((c & 1) ? h[0] : -h[0]), a.pos[1] + ((c & 2) ? h[1] : -h[1]), a.pos[2] + ((c & 4) ? h[2] : -h[2]));
      if (v[2] >= 0) continue;
      const cx = P[0] * v[0] + P[4] * v[1] + P[8] * v[2] + P[12];
      const cy = P[1] * v[0] + P[5] * v[1] + P[9] * v[2] + P[13];
      const cw = P[3] * v[0] + P[7] * v[1] + P[11] * v[2] + P[15];
      if (cw <= 0) continue;
      any = true;
      const px = (cx / cw * 0.5 + 0.5) * ${W}, py = (0.5 - cy / cw * 0.5) * ${H};
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    if (!any) continue;
    const r1 = (q) => Math.round(q * 10) / 10;
    out.push({ id: a.id, pos: a.pos, dist: a.dist, box: [r1(Math.max(0, minX)), r1(Math.max(0, minY)), r1(Math.min(${W}, maxX)), r1(Math.min(${H}, maxY))] });
  }
  return { eye: [tx, ty, tz], boxes: out };
})()`;

const tilesOf = (box, W, H) => {
  const s = new Set();
  const [x0, y0, x1, y1] = box;
  if (x1 <= x0 || y1 <= y0) return s;
  const tx1 = Math.min(Math.ceil(W / TILE) - 1, Math.floor((x1 - 1e-6) / TILE));
  const ty1 = Math.min(Math.ceil(H / TILE) - 1, Math.floor((y1 - 1e-6) / TILE));
  for (let ty = Math.floor(y0 / TILE); ty <= ty1; ty++) for (let tx = Math.floor(x0 / TILE); tx <= tx1; tx++) s.add(ty * 1000 + tx);
  return s;
};

// ---- one boot: pin, stage the crowd, wound one body, read ----
const boot = async (lean) => {
  const url = `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&upscale=0&layers=${process.env.LIGHT_LAYERS ?? 'all'}${EXTRA}${lean ? (LEAN_FLAG ? `&${LEAN_FLAG}` : '') : '&leanwalk=0'}`;
  await bootCloseupPage({ send, evaluate, fail, url });
  const state = await evaluate('typeof __sdfGame.leanWalkState === "function" ? JSON.stringify(__sdfGame.leanWalkState()) : "null"').then(JSON.parse);
  if (lean && (!state || state.compiled !== true)) {
    fail(`the lean walk is not compiled into the on boot's page (leanWalkState ${state ? JSON.stringify(state) : 'missing'})`);
  }
  if (!lean && (!state || state.compiled !== false)) fail(`the off boot's page (?leanwalk=0) still has the lean walk compiled in (leanWalkState ${state ? JSON.stringify(state) : 'missing'})`);
  // WAIT FOR THE BACKGROUND COMPILES (march-hash.mjs): until the crowd job is
  // ready every member is drawn through the per-body fallback.
  const BG_WAIT_S = Number(process.env.MARCH_HASH_BG_WAIT_S ?? 600);
  const waitBg = async (what) => {
    let bg = null;
    for (let i = 0; i < BG_WAIT_S * 2; i++) {
      bg = await evaluate('JSON.stringify(__sdfGame.warmBackground())').then(JSON.parse);
      if (bg.crowd === 'ready' || bg.crowd === 'failed') break;
      await sleep(500);
    }
    if (bg?.crowd !== 'ready') fail(`${what}: background compiles not ready after ${BG_WAIT_S} s (${JSON.stringify(bg)})`);
  };
  await waitBg('boot');
  await evaluate('__sdfGame.setLoopRunning(false)');
  await applyShipDefaults(evaluate);
  await evaluate('__sdfGame.setFieldStyle("off")');
  if (EXITBOUND) await evaluate('__sdfGame.setHullExitBound(true)');
  await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');

  // capture.mjs's SPIKE_SCENE=crowd, verbatim but for the returned record.
  const before = await evaluate('__sdfGame.zombies().map((z) => z.id)');
  const spawned = await evaluate(`(() => {
    const r = __sdfGame.rooms.find(x => x.id === 1);
    const b = r.bounds;
    const px = b.minX + 0.6, pz = b.minZ + 0.6;
    const yaw = Math.atan2(b.maxX - px, -(b.maxZ - pz));
    __sdfGame.teleport(1);
    __sdfGame.placePlayer({ x: px, z: pz, yaw, pitch: 0 });
    __sdfGame.freeze(true);
    const region = { minX: (b.minX + b.maxX) / 2, maxX: b.maxX - 0.5, minZ: b.minZ + 0.5, maxZ: b.maxZ - 0.5 };
    return __sdfGame.spawnCrowd('zombie', ${CROWD}, { spacing: 0.9, region });
  })()`);
  if (spawned.ok < 4) fail(`only ${spawned.ok} zombies spawned (need >= 4)`);
  const ids = (await evaluate('__sdfGame.zombies().map((z) => z.id)')).filter((id) => !before.includes(id));
  await evaluate('(() => { __sdfGame.setSdfScale(0.5); __sdfGame.step(6); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  // The spawned type must be on the crowd tile path before anything is read: a
  // new type's members draw per body until it is attached and binned.
  // The crowd type's name is not the spawn name, so the condition is on the bodies:
  // every spawned actor holds a crowd slot, and a type with the tile list on draws >= 4.
  let zt = null;
  const liveJs = `(() => {
    const want = new Set(${JSON.stringify(ids)});
    const slots = __sdfGame.actorDump().filter((a) => want.has(a.id)).map((a) => a.crowdSlot);
    const ci = __sdfGame.crowdInfo();
    return { slotted: slots.filter((s) => s !== null && s !== undefined).length, of: slots.length, tilesOn: ci.tilesOn,
      types: ci.types.map((t) => ({ name: t.name, attached: t.attached, visible: t.visible, tilesOn: t.tilesOn })) };
  })()`;
  const isLive = (z) => z.slotted === z.of && z.tilesOn && z.types.some((t) => t.tilesOn && t.visible >= 4);
  for (let i = 0; i < 360; i++) { // ~3-4 min; the background compiles have their own wait above
    zt = await evaluate(liveJs);
    if (isLive(zt)) break;
    if (i % 20 === 0) console.error(`  waiting for the spawned bodies on the crowd tile path: ${JSON.stringify(zt)}`);
    // Two frames, never one: readMarchTarget's frame-parity jitter (march-hash.mjs)
    // must land on the same phase whatever the number of polls a boot needs.
    await evaluate('__sdfGame.step(2)');
    await sleep(500);
  }
  if (!isLive(zt)) fail(`the spawned bodies never went live on the crowd tile path: ${JSON.stringify(zt)}`);
  await waitBg('after spawn');
  if (!(await settleMarchTarget())) fail('march target never settled after staging (live + stable reads)');
  const clean = await captureSettled('clean frame');

  // Pick the wounded body from the projected proxy boxes.
  const geo = await evaluate(boxesJs(ids, clean.w, clean.h));
  const tiles = new Map(geo.boxes.filter((b) => b.box).map((b) => [b.id, tilesOf(b.box, clean.w, clean.h)]));
  let pick = null;
  for (const [id, ts] of [...tiles].sort((p, q) => p[0] - q[0])) {
    let shared = 0;
    for (const [jd, us] of tiles) if (jd !== id) for (const t of ts) if (us.has(t)) shared++;
    if (!pick || shared > pick.shared) pick = { id, shared };
  }
  if (!pick || pick.shared === 0) fail(`no spawned body's box overlaps another's on screen: ${JSON.stringify(geo.boxes)}`);
  const body = geo.boxes.find((b) => b.id === pick.id);

  // Three shots at the chosen body, march-hash.mjs-style literals rounded to 3 decimals.
  const stamp = await evaluate(`(async () => {
    __sdfGame.setWoundTuning({ spillChance: 0 });
    const id = ${pick.id};
    const z = __sdfGame.zombies().find((q) => q.id === id);
    const eye = ${JSON.stringify(geo.eye)};
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const shots = [[0, 1.3, 'slug'], [0.08, 1.12, 'pellet'], [-0.08, 1.42, 'pellet']];
    const hits = [], rays = [];
    for (const [side, yUp, kind] of shots) {
      const tgt = [z.pos[0], z.pos[1] + yUp, z.pos[2]];
      let d = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
      const L = Math.hypot(d[0], d[1], d[2]); d = d.map((v) => v / L);
      // a sideways nudge perpendicular to the view ray, in the ground plane
      const sx = -d[2], sz = d[0], sl = Math.hypot(sx, sz) || 1;
      const t2 = [tgt[0] + side * sx / sl, tgt[1], tgt[2] + side * sz / sl];
      const o = [r3(t2[0] - d[0] * 2), r3(t2[1] - d[1] * 2), r3(t2[2] - d[2] * 2)];
      const dir = [r3(d[0]), r3(d[1]), r3(d[2])];
      rays.push({ o, dir, kind });
      const hit = __sdfGame.stampWoundAt(o[0], o[1], o[2], dir[0], dir[1], dir[2], kind, id);
      if (hit) hits.push(kind);
    }
    __sdfGame.step(5);
    return { stamped: hits.length, wounds: __sdfGame.zombie(id).woundList().length, rays, bleed: __sdfGame.bleed, chunks: __sdfGame.chunkCount };
  })()`);
  if (!stamp.stamped) fail(`no wound stamped on body ${pick.id}: ${JSON.stringify(stamp)}`);
  if (stamp.bleed.droplets !== 0 || stamp.bleed.splats !== 0) fail(`blood sim not empty after the stamp: ${JSON.stringify(stamp.bleed)}`);
  if (stamp.chunks !== 0) fail(`${stamp.chunks} chunks in flight — a stamp severed something`);
  await evaluate('__sdfGame.resolveGpu()');
  // Stable only: hashMarchTarget() truncates each float, so a wound need not move
  // it (march-hash.mjs's header); the exact sha1 check below is the visibility test.
  if (!(await settleMarchTarget())) fail('march target never settled post-wound');
  const wounded = await captureSettled('wounded frame');
  if (wounded.sha1 === clean.sha1) fail(`the wound is not visible: the wounded frame equals the clean one (${clean.sha1})`);

  // Box overlap, reported whatever the boot (the only overlap evidence a flag-off page has).
  const woundedTiles = tiles.get(pick.id);
  const cleanCover = new Map();
  for (const [id, ts] of tiles) if (id !== pick.id) for (const t of ts) cleanCover.set(t, (cleanCover.get(t) ?? 0) + 1);
  const overlap = {
    bodies: tiles.size,
    tilesTwoCleanBoxes: [...cleanCover.values()].filter((n) => n >= 2).length,
    tilesWoundedWithClean: [...woundedTiles].filter((t) => cleanCover.has(t)).length,
    gameTileSlotMaskMulti: await evaluate('__sdfGameDebug.readTileSlotMask().mask.reduce((n, v) => n + v, 0)'),
  };

  const rec = { lean, state, url, spawned: spawned.ok, ids, crowdTypes: zt.types, wounded: { id: pick.id, sharedTiles: pick.shared, box: body.box, dist: body.dist, stamped: stamp.stamped, wounds: stamp.wounds, rays: stamp.rays }, overlap, boxes: geo.boxes.map((b) => ({ id: b.id, box: b.box })), clean, woundedCap: wounded };
  if (!lean) return rec;

  // Flag-on legs: HELD (forced onto mapBody), ON2 (back), the census.
  const leanState = async () => JSON.parse(await evaluate('JSON.stringify(__sdfGame.leanWalkState())'));
  if (!(await leanState()).enabled) fail(`the on boot has the fast path disabled before the first read: ${JSON.stringify(await leanState())}`);
  await evaluate('__sdfGame.setLeanWalk(false)');
  await redraw();
  rec.heldState = await leanState();
  if (rec.heldState.enabled) fail(`setLeanWalk(false) did not disable the fast path: ${JSON.stringify(rec.heldState)}`);
  if (!(await settleMarchTarget())) fail('march target never settled with the switch held');
  rec.held = await capture();
  await evaluate('__sdfGame.setLeanWalk(true)');
  await redraw();
  rec.on2State = await leanState();
  if (!(await settleMarchTarget())) fail('march target never settled with the switch released');
  rec.on2 = await capture();
  const pictureFnv = (await evaluate('__sdfGameDebug.hashMarchTarget()')).hash;
  await evaluate('__sdfGame.setMarchDebugMode(23)');
  await redraw();
  if (!(await settleMarchTarget({ distinctFrom: pictureFnv }))) fail('census never settled (stable and distinct from the picture)');
  rec.censusCap = await capture();
  rec.census = census(rec.censusCap);
  // The switch reaches the shader? Only checkable when the switch and the debug
  // mode are separate lanes: then mode 23 with the switch held must show no lean pixel.
  // Mode -23: the census with the switch held (the switch and the debug mode share debugCfg.x; any negative
  // value holds the fast path, and the census answers to |x| == 23).
  await evaluate('__sdfGame.setMarchDebugMode(-23)');
  const heldModeState = await leanState();
  await redraw();
  if (!(await settleMarchTarget())) fail('held census never settled');
  const heldCensus = census(await capture());
  if (heldModeState.enabled) fail(`mode -23 left the fast path enabled: ${JSON.stringify(heldModeState)}`);
  rec.heldCensus = { verifiable: true, leanTotal: heldCensus.leanTotal, marched: heldCensus.marched };
  if (heldCensus.leanTotal !== 0) fail(`with the switch held the census still shows ${heldCensus.leanTotal} lean pixels`);
  if (heldCensus.marched !== rec.census.marched) fail(`the held census marched ${heldCensus.marched} pixels, the census ${rec.census.marched}: not the same frame`);
  await evaluate('__sdfGame.setMarchDebugMode(0)');
  await evaluate('__sdfGame.setLeanWalk(true)');
  return rec;
};

const A = await boot(false);
const B = await boot(!AA);

for (const [k, v] of [['ids', 'spawned bodies'], ['wounded', 'wounded body']]) {
  const a = k === 'ids' ? A.ids : A.wounded.id, b = k === 'ids' ? B.ids : B.wounded.id;
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(`the two boots staged different ${v}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

const summary = (cmp) => ({ identical: cmp.identical, differingTexels: cmp.differingTexels, maxAbsDiff: cmp.maxAbsDiff, nanMismatch: cmp.nanMismatch, first: cmp.first, sizeMismatch: cmp.sizeMismatch });
const out = {
  mode: AA ? 'aa' : 'off-vs-on',
  hullExitBound: EXITBOUND,
  size: `${A.woundedCap.w}x${A.woundedCap.h}`,
  bootA: { lean: A.lean, state: A.state, clean: A.clean.sha1, wounded: A.woundedCap.sha1, settleFrames: { clean: A.clean.settleFrames, wounded: A.woundedCap.settleFrames } },
  bootB: { lean: B.lean, state: B.state, clean: B.clean.sha1, wounded: B.woundedCap.sha1, settleFrames: { clean: B.clean.settleFrames, wounded: B.woundedCap.settleFrames }, held: B.held?.sha1, on2: B.on2?.sha1, heldState: B.heldState, on2State: B.on2State },
  staging: { spawned: A.spawned, ids: A.ids, crowdTypes: A.crowdTypes, wounded: A.wounded, overlap: A.overlap, overlapB: B.overlap, boxes: A.boxes },
};
save(AA ? 'aa-a-clean' : 'off-clean', A.clean); save(AA ? 'aa-a-wounded' : 'off', A.woundedCap);
save(AA ? 'aa-b-clean' : 'on-clean', B.clean); save(AA ? 'aa-b-wounded' : 'on', B.woundedCap);
let ok = true;
const problems = [];
if (AA) {
  out.compare = { clean: summary(compare(A.clean, B.clean)), wounded: summary(compare(A.woundedCap, B.woundedCap)) };
  if (!out.compare.clean.identical) problems.push('two flag-off boots differ on the clean frame');
  if (!out.compare.wounded.identical) problems.push('two flag-off boots differ on the wounded frame');
  // Flag-off overlap evidence (boxes; the census needs the flag).
  if (A.overlap.tilesTwoCleanBoxes === 0) problems.push('frame does not exercise the claim: no tile is covered by two clean bodies\' boxes');
  if (A.overlap.tilesWoundedWithClean === 0) problems.push('frame does not exercise the claim: the wounded body\'s box shares no tile with a clean body\'s');
  out.census = 'unavailable on flag-off boots; overlap from boxes only (staging.overlap)';
} else {
  save('held', B.held); save('on2', B.on2); save('census', B.censusCap);
  out.compare = {
    offOn: summary(compare(A.woundedCap, B.woundedCap)),
    onHeld: summary(compare(B.woundedCap, B.held)),
    onOn2: summary(compare(B.woundedCap, B.on2)),
    offOnClean: summary(compare(A.clean, B.clean)),
  };
  out.census = B.census;
  out.heldCensus = B.heldCensus;
  for (const [k, v] of Object.entries(out.compare)) if (!v.identical) problems.push(`${k}: ${v.differingTexels} texels differ (max ${v.maxAbsDiff})`);
  if (B.census.leanMultiSlot === 0) problems.push('frame does not exercise the claim: no lean pixel has >= 2 slots');
  if (B.census.bodyHitMultiSlot === 0) problems.push('frame does not exercise the claim: no non-lean hit pixel has >= 2 slots');
}
if (problems.length) { ok = false; out.problems = problems; }
out.pass = ok;
console.log(JSON.stringify(out));
process.exit(ok ? 0 : 1);
