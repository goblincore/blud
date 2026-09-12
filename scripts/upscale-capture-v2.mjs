// scripts/upscale-capture-v2.mjs — neural upscale P3 capture v2
// (spec docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md §1;
//  dataset format docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §1).
//
// Per pair, ONE frozen state rendered up to three ways:
//   input  = scale 0.5, fields off, temporal ray start as shipped   -> 400x300 single-ray
//   target = scale 1.0, 16 jittered samples, temporal ray start off -> 800x600 supersampled
//   native = scale 1.0 single-ray (validation sequences only)       -> 800x600
// Stored as flesh crops (+8 input px). pairs.jsonl / sequences.jsonl are appended as they land, so
// rerunning the same command resumes.
//
// Usage:
//   LAB_VITE_PORT=5320 LAB_CDP_PORT=9320 UPSCALE_NAME=v2-smoke UPSCALE_PAIRS=24 UPSCALE_FRAMES=4 \
//     bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-v2.mjs'
// Env: UPSCALE_DATA_ROOT (~/blud-upscale-data), UPSCALE_NAME, UPSCALE_SEED (1), UPSCALE_PAIRS (1000),
//      UPSCALE_FRAMES (10 per sequence), UPSCALE_ADVANCE (6), UPSCALE_CAP_GB (5), UPSCALE_ROOMS (1,2,3,4,5),
//      UPSCALE_FACE_SHOT=1 (save a presented-frame PNG of the first head close-up, for the face-direction check)
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeNpy } from './lib/npy.mjs';
import { bootCapturePage, maxAbsDiff, readMarch, readMarchNormals, renderAt, runG2Checks, viewSpaceNormals } from './lib/upscale-capture.mjs';
import { cropFrame, fleshFraction, maskIoU, pairCrop, toLocalRegions } from './lib/upscale-crop.mjs';
import { cameraPose, mulberry32, pickShowcase, planSequence, splitFor } from './lib/upscale-framing.mjs';
import { registerHalfRes } from './lib/upscale-registration.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5320);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9320);
const ROOT = process.env.UPSCALE_DATA_ROOT ?? join(homedir(), 'blud-upscale-data');
const NAME = process.env.UPSCALE_NAME ?? `v2-${new Date().toISOString().slice(0, 10)}`;
const OUT = join(ROOT, NAME);
const SEED = Number(process.env.UPSCALE_SEED ?? 1);
const PAIRS = Number(process.env.UPSCALE_PAIRS ?? 1000);
const FRAMES = Number(process.env.UPSCALE_FRAMES ?? 10);
const ADVANCE = Number(process.env.UPSCALE_ADVANCE ?? 6);
const CAP_BYTES = Number(process.env.UPSCALE_CAP_GB ?? 5) * 1024 ** 3;
const ROOMS = (process.env.UPSCALE_ROOMS ?? '1,2,3,4,5').split(',').map(Number);
const GRID = 4, IN_W = 400, IN_H = 300, OUT_W = 800, OUT_H = 600;
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => fail('watchdog 12 h'), 12 * 3600_000).unref();
mkdirSync(join(OUT, 'pairs'), { recursive: true });
const SEQ_FILE = join(OUT, 'sequences.jsonl');
const PAIR_FILE = join(OUT, 'pairs.jsonl');
const decodeF32 = (b64) => { const c = Buffer.from(Buffer.from(b64, 'base64')); return new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4); };
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const stats = { skippedStatic: 0, skippedEmpty: 0, skippedNoHead: 0, skippedSpawn: 0, secondsPerPair: 0 };
const startedAt = Date.now();

const { evaluate } = await bootCapturePage({ vite: VITE, cdp: CDP, fail });
const { near, far } = await evaluate('__sdfGame.upscaleInfo()');
const characters = await evaluate('__sdfGame.characterNames()');
if (!Array.isArray(characters) || characters.length === 0) fail('no characters');

// ROSTER (owner, 2026-09-12): only the characters that are actually in the game. `characterNames()`
// also lists work-in-progress bodies — a 44-pair probe drew 12 of them, 38 % of sequences could not
// even spawn ('no motion joints'), and only 27 % of captured pairs were shipping content. Training
// on bodies that will not ship spends capture time and dataset weight on nothing.
// `UPSCALE_CHARACTERS=all` restores the old behaviour; a comma list picks any other roster.
const ROSTER = process.env.UPSCALE_CHARACTERS ?? 'zombie,goblin,soldier';
const cast = ROSTER === 'all' ? characters : ROSTER.split(',').map((s) => s.trim()).filter(Boolean);
if (cast.length === 0) fail('UPSCALE_CHARACTERS is empty');
const absent = cast.filter((c) => !characters.includes(c));
if (absent.length) fail(`UPSCALE_CHARACTERS names ${absent.join(', ')}; the page offers ${characters.join(', ')}`);
console.log(`roster: ${cast.join(', ')}${ROSTER === 'all' ? ' (every spawnable character)' : ''}`);

async function readSupersampled() {
  await evaluate(`(() => { __sdfGame.setUpscale(null); __sdfGame.setFieldStyle('off'); __sdfGame.setSdfScale(1.0); __sdfGame.step(4); return 1; })()`);
  const r = await evaluate(`__sdfGameDebug.readSupersampledTarget(${GRID})`, 600_000);
  return { w: r.w, h: r.h, offsets: r.offsets, data: decodeF32(r.target), coverage: decodeF32(r.coverage) };
}

// ---- session checks: G2 on the P2 staging, then the supersampler ----------------
const g2 = await runG2Checks(evaluate, fail, { seq: { room: 1, dist: 2.5, orbit: 0 }, pitchUp: 0.2 });
if (g2.failures.length) fail(`G2: ${g2.failures.join('; ')}`);
const ssChecks = {};
{
  const plain = await renderAt(evaluate, 1.0);
  await evaluate('(() => { if (!__sdfGame.setMarchJitter(0, 0)) throw new Error("jitter refused"); __sdfGame.step(4); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  const zero = await readMarch(evaluate);
  await evaluate('(() => { __sdfGame.setMarchJitter(null); __sdfGame.step(4); return 1; })()');
  ssChecks.zeroJitterMaxAbsDiff = maxAbsDiff(plain, zero);
  const tgt = await readSupersampled();
  ssChecks.offsetMean = tgt.offsets.reduce((s, o) => [s[0] + o[0] / tgt.offsets.length, s[1] + o[1] / tgt.offsets.length], [0, 0]);
  const lr = await renderAt(evaluate, 0.5);
  const reg = registerHalfRes(lr, tgt, { mode: 'depth', near, far });
  ssChecks.registration = { texels: reg.texels, argmin: reg.argmin, subpixelOutputPx: reg.subpixel };
  const failures = [];
  if (ssChecks.zeroJitterMaxAbsDiff !== 0) failures.push(`(0,0) jitter differs from no jitter by ${ssChecks.zeroJitterMaxAbsDiff}`);
  if (tgt.offsets.length !== GRID * GRID || ssChecks.offsetMean.some((v) => Math.abs(v) > 1e-12)) failures.push(`jitter offsets not centred: ${JSON.stringify(ssChecks.offsetMean)}`);
  // Depth comes from the first hit in sample order, a (-0.125, -0.125) sample, so |sub-pixel| up to
  // ~0.125 px is expected; the gate stays at 0.25.
  if (reg.texels < 500 || reg.argmin.ox !== 0 || reg.argmin.oy !== 0 || !(Math.abs(reg.subpixel.x) <= 0.25 && Math.abs(reg.subpixel.y) <= 0.25)) {
    failures.push(`supersampled target registration ${JSON.stringify(ssChecks.registration)}`);
  }
  console.log('supersample checks:', JSON.stringify(ssChecks));
  if (failures.length) fail(`supersample: ${failures.join('; ')}`);
}

// ---- eye height: camera height above the player's feet -----------------------------
await evaluate('(() => { __sdfGame.setRenderLock(false); const p = __sdfGame.pose(); __sdfGame.setPose(p.pos[0], p.pos[2], p.yaw, 0, 0); __sdfGame.step(1); return 1; })()');
const eyeBase = (await evaluate('__sdfGame.cameraWorld()'))[1] - (await evaluate('__sdfGame.pose()')).pos[1];

async function setCamera(pose) {
  await evaluate(`(() => { __sdfGame.setPose(${pose.x}, ${pose.z}, ${pose.yaw}, ${pose.pitch}, ${pose.eyeY - eyeBase}); return 1; })()`);
}

async function bodyOf(id) {
  return (await evaluate('__sdfGame.zombies()')).find((z) => z.id === id) ?? null;
}

async function woundActor(id, plan) {
  const body = await bodyOf(id);
  if (!body) return 0;
  for (let s = 0; s < plan.wounds.shots; s++) {
    const torso = await evaluate(`__sdfGame.actorLimbCenter(${id}, 'torso')`);
    if (!torso) break;
    await setCamera(cameraPose(torso, body.yaw, 3.0, (s - plan.wounds.shots / 2) * 15, torso[1] + 0.1));
    const fire = plan.wounds.slug && s === 0 ? 'fireSlug()' : 'fire(1)';
    await evaluate(`(() => { const g = __sdfGame; g.setRenderLock(false); g.refillShells(); g.step(2); g.${fire}; g.step(20); return 1; })()`);
  }
  if (plan.wounds.blast) {
    const torso = await evaluate(`__sdfGame.actorLimbCenter(${id}, 'torso')`);
    if (torso) {
      const a = plan.wounds.blastAngle;
      await evaluate(`(() => { __sdfGame.explode(${torso[0] + Math.cos(a) * 1.6}, ${torso[1]}, ${torso[2] + Math.sin(a) * 1.6}); __sdfGame.step(10); return 1; })()`);
    }
  }
  return (await evaluate(`__sdfGame.actorWounds(${id})`)).length;
}

async function stageSequence(plan) {
  const r = await evaluate(`(() => {
    const g = __sdfGame;
    g.setRenderLock(false);
    g.freeze(false);
    g.resetCast();
    g.teleport(${plan.room});
    let sp;
    try { sp = g.spawnDebugCharacter(${JSON.stringify(plan.character)}); }
    catch (e) { return { error: String((e && e.message) || e) }; }
    if (sp.errors.length) return { error: sp.errors.join(' | ') };
    g.freeze(true);
    g.step(10);
    performance.now = () => ${plan.lightPhase};
    g.setLightClockFrozen(false);
    g.setLightClockFrozen(true);
    return { actorId: sp.id };
  })()`);
  if (r?.error) {
    console.warn(`seq ${plan.index}: spawning ${plan.character} failed (${r.error}) — skipped`);
    stats.skippedSpawn++;
    return null;
  }
  if (plan.wounds) await woundActor(r.actorId, plan);
  return r;
}

async function aimFor(plan, id) {
  const body = await bodyOf(id);
  if (!body) return null;
  let target = null;
  if (plan.lookAt === 'head') target = await evaluate(`__sdfGame.actorLimbCenter(${id}, 'head')`);
  if (plan.lookAt === 'wound') {
    const ws = await evaluate(`__sdfGame.actorWounds(${id})`);
    if (ws.length) target = ws[plan.index % ws.length].pos;
  }
  if (!target) target = await evaluate(`__sdfGame.actorLimbCenter(${id}, 'torso')`);
  if (!target) return null;
  const eyeY = plan.eyeOffset !== null ? target[1] + plan.eyeOffset : plan.eyeHeight;
  return cameraPose(target, body.yaw, plan.distance, plan.orbitDeg, eyeY);
}

let faceShotDone = false;
async function captureFrame(plan, split, id, f, prevInput) {
  if (f > 0) await evaluate(`(() => { const g = __sdfGame; g.setRenderLock(false); g.freeze(false); g.step(${ADVANCE}); g.freeze(true); return 1; })()`);
  let input = null;
  for (let attempt = 0; ; attempt++) {
    const aim = await aimFor(plan, id);
    if (!aim) return { stop: true };
    await setCamera(aim);
    await evaluate('(() => { __sdfGame.setRenderLock(true); return 1; })()');
    input = await renderAt(evaluate, 0.5);
    if (!prevInput || maskIoU(prevInput.data, input.data, IN_W, IN_H) < 0.98) break;
    if (attempt === 3) { stats.skippedStatic++; return { stop: true }; }
    await evaluate(`(() => { const g = __sdfGame; g.setRenderLock(false); g.freeze(false); g.step(${ADVANCE}); g.freeze(true); return 1; })()`);
  }
  if (fleshFraction(input.data, IN_W, IN_H) < 0.005) { stats.skippedEmpty++; return { input }; }
  // NORMALS (2026-09-12, rgbn input sets): the same 0.5-scale frozen frame in normals mode.
  // The trace is identical, so the hit mask must be — a differing alpha means the mode
  // changed the march and the pair would train on misregistered normals.
  const normals = await readMarchNormals(evaluate);
  if (normals.w !== input.w || normals.h !== input.h) fail(`normals ${normals.w}x${normals.h} vs input ${input.w}x${input.h}`);
  // The re-render is a second frame, so a grazing silhouette texel can flip under the temporal
  // ray start (1 texel in ~120k seen at pair 932 of the first v3 run). Tolerate a trace, fail on
  // a pattern; the loader masks normals by the INPUT hit, so a flipped texel gets a zero normal.
  let maskDiff = 0;
  for (let i = 3; i < input.data.length; i += 4) if ((input.data[i] < 1) !== (normals.data[i] < 1)) maskDiff++;
  if (maskDiff > input.data.length / 4 * 0.001) fail(`normals hit mask differs from input at ${maskDiff} texels`);
  if (maskDiff) stats.normalMaskDiffs = (stats.normalMaskDiffs ?? 0) + maskDiff;
  const normalView = viewSpaceNormals(normals);
  const annotations = await evaluate(`__sdfGame.captureAnnotations(${OUT_W}, ${OUT_H})`);
  if (plan.lookAt === 'head') {
    const h = annotations.find((a) => a.actorId === id)?.head;
    if (!(h && h.x - h.r >= 0 && h.x + h.r <= OUT_W && h.y - h.r >= 0 && h.y + h.r <= OUT_H)) { stats.skippedNoHead++; return { input }; }
  }
  const native = split === 'val' ? await renderAt(evaluate, 1.0) : null;
  const target = await readSupersampled();
  const crop = pairCrop(input.data, IN_W, IN_H, target.coverage, OUT_W, OUT_H, 8);
  if (!crop) { stats.skippedEmpty++; return { input }; }

  const pid = `s${String(plan.index).padStart(4, '0')}-f${String(f).padStart(3, '0')}`;
  mkdirSync(join(OUT, 'pairs', pid), { recursive: true });
  const files = {
    in: `pairs/${pid}/in.npy`,
    target: `pairs/${pid}/target.npy`,
    targetCoverage: `pairs/${pid}/target-coverage.npy`,
    native: native ? `pairs/${pid}/native.npy` : null,
    normal: `pairs/${pid}/normal.npy`,
  };
  const write = (rel, data, shape) => { const buf = encodeNpy(data, shape); writeFileSync(join(OUT, rel), buf); return buf.length; };
  const X = crop.x * 2, Y = crop.y * 2, W2 = crop.w * 2, H2 = crop.h * 2;
  let bytes = 0;
  bytes += write(files.in, cropFrame(input.data, IN_W, IN_H, 4, crop.x, crop.y, crop.w, crop.h), [crop.h, crop.w, 4]);
  bytes += write(files.target, cropFrame(target.data, OUT_W, OUT_H, 4, X, Y, W2, H2), [H2, W2, 4]);
  bytes += write(files.targetCoverage, cropFrame(target.coverage, OUT_W, OUT_H, 1, X, Y, W2, H2), [H2, W2, 1]);
  if (native) bytes += write(files.native, cropFrame(native.data, OUT_W, OUT_H, 4, X, Y, W2, H2), [H2, W2, 4]);
  bytes += write(files.normal, cropFrame(normalView, IN_W, IN_H, 3, crop.x, crop.y, crop.w, crop.h), [crop.h, crop.w, 3]);
  if (process.env.UPSCALE_FACE_SHOT && !faceShotDone && plan.lookAt === 'head' && plan.class === 'close') {
    writeFileSync(join(OUT, `face-check-${pid}.png`), Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));
    faceShotDone = true;
  }
  const pair = {
    id: pid, seq: plan.index, frame: f, split, showcase: false,
    class: plan.class, lookAt: plan.lookAt, character: plan.character, room: plan.room,
    distance: plan.distance, orbitDeg: plan.orbitDeg,
    wounds: (await evaluate(`__sdfGame.actorWounds(${id})`)).length,
    crop, files, regions: toLocalRegions(annotations, crop),
    inputCoverage: fleshFraction(input.data, IN_W, IN_H),
    iouPrev: prevInput ? maskIoU(prevInput.data, input.data, IN_W, IN_H) : null,
    bytes,
  };
  return { input, pair };
}

// ---- resume: keep only pairs from sequences that finished, replay the rng stream ---------
const seqDone = readJsonl(SEQ_FILE);
const pairs = readJsonl(PAIR_FILE).filter((p) => p.seq < seqDone.length);
writeFileSync(PAIR_FILE, pairs.map((p) => JSON.stringify(p) + '\n').join(''));
let bytes = pairs.reduce((s, p) => s + p.bytes, 0);
const rng = mulberry32(SEED);
for (let i = 0; i < seqDone.length; i++) planSequence(rng, i, cast, ROOMS);
let seqIndex = seqDone.length;
if (seqIndex) console.log(`resuming after ${seqIndex} sequences, ${pairs.length} pairs`);
const pairsAtStart = pairs.length;

while (pairs.length < PAIRS && bytes < CAP_BYTES) {
  const plan = planSequence(rng, seqIndex, cast, ROOMS);
  const split = splitFor(SEED, seqIndex);
  const staged = await stageSequence(plan);
  let captured = 0;
  if (staged) {
    let prevInput = null;
    for (let f = 0; f < FRAMES && pairs.length < PAIRS; f++) {
      const r = await captureFrame(plan, split, staged.actorId, f, prevInput);
      if (r.stop) break;
      if (r.input) prevInput = r.input;
      if (!r.pair) continue;
      pairs.push(r.pair);
      bytes += r.pair.bytes;
      appendFileSync(PAIR_FILE, JSON.stringify(r.pair) + '\n');
      captured++;
      if (pairs.length % 100 === 0) {
        const a = await renderAt(evaluate, 0.5);
        const b = await renderAt(evaluate, 0.5);
        const d = maxAbsDiff(a, b);
        if (d > 1e-6) fail(`determinism spot-check at ${pairs.length} pairs: max |Δ| ${d}`);
      }
    }
  }
  appendFileSync(SEQ_FILE, JSON.stringify({ id: seqIndex, split, captured, ...plan, actorId: staged?.actorId ?? null }) + '\n');
  process.stdout.write(`seq ${seqIndex} ${plan.class}/${plan.lookAt} ${plan.character} room ${plan.room}: ${captured} pairs (total ${pairs.length}, ${(bytes / 1e9).toFixed(2)} GB)\n`);
  seqIndex++;
}

const newPairs = pairs.length - pairsAtStart;
stats.secondsPerPair = newPairs ? (Date.now() - startedAt) / 1000 / newPairs : 0;
const showcase = new Set(pickShowcase(pairs));
for (const p of pairs) p.showcase = showcase.has(p.id);
await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.setSdfScale(1.0); __sdfGame.setFieldStyle("bodies"); return 1; })()');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  format: 'blud-upscale-dataset/2',
  created: new Date().toISOString(),
  checkout: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
  spec: 'docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md',
  seed: SEED,
  near, far,
  content: { characters: cast, rooms: ROOMS },
  input: { fullW: IN_W, fullH: IN_H, sdfScale: 0.5, fieldStyle: 'off', temporalStart: g2.checks.temporalStart },
  target: { fullW: OUT_W, fullH: OUT_H, samples: GRID * GRID, grid: GRID, coverageRule: 'k >= 8', temporalStart: 'off' },
  rowOrder: 'row 0 = top',
  checks: { g2: g2.checks, supersample: ssChecks },
  stats,
  sequences: readJsonl(SEQ_FILE),
  pairs,
}, null, 1));
const byClass = pairs.reduce((m, p) => ({ ...m, [p.class]: (m[p.class] ?? 0) + 1 }), {});
console.log(`\nCAPTURE V2: ${pairs.length} pairs, ${(bytes / 1e9).toFixed(2)} GB, ${JSON.stringify(byClass)}, ${stats.secondsPerPair.toFixed(1)} s/pair, stats ${JSON.stringify(stats)} -> ${OUT}`);
process.exit(0);
