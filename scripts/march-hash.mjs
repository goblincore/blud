// scripts/march-hash.mjs — the before/after pixel gate for march shader
// refactors. Boots the game frozen, stages the standard close-up (room 1,
// ship defaults), and prints a deterministic hash of the 400x300 march
// target — plus a repeat-state determinism proof and a wounded variant.
//
// USAGE: run this script at commit A, save its JSON line; run it again at
// commit B (e.g. with a single shader file swapped in via `git show
// <sha>:<path> > <path>`, then restored); diff the two JSON lines. Any hash
// mismatch means the refactor changed march-target output — investigate,
// do not loosen this gate to make it pass.
//
// EXACT, not truncated: __sdfGameDebug.hashMarchTarget() (game-main.ts)
// folds each float into its FNV hash via `r | 0`, which truncates to the
// integer part — a sub-1.0 change in a pixel's float value is invisible to
// it. Measured directly: stamping wounds changed the march target's rSum
// (1784.941 -> 1784.711) but hashMarchTarget()'s hash did not move. So this
// script instead pulls the exact float readback via
// __sdfGameDebug.readMarchTarget() ({ w, h, rgba32f: base64 of the raw
// Float32Array bytes, row-depadded}) and hashes the raw bytes with sha1 in
// Node — every bit of every float participates, nothing is truncated.
//
// Output: ONE JSON line to stdout —
//   { "room1": "<hash>", "room1-repeat": "<hash>", "room1-wounded": "<hash>" }
// With MARCH_HASH_ROOM=2 the keys become room2-* and the wounded key is
// omitted (the hardcoded wound rays are the room-1 staged pose). With
// MARCH_HASH_MASK=1 the line also carries roomN-masked, roomN-masked-repeat,
// roomN-masked-fraction and roomN-tiles.
// room1-repeat must equal room1 (same staged state, hashed again after a
// couple of extra steps) — that is the determinism proof this script
// exists to provide before trusting a cross-commit comparison at all.
// room1-wounded must NOT equal room1 — the stamped wound must be visible to
// the gate, or the gate isn't testing anything. Either check failing FAILs
// loudly rather than reporting a possibly-spurious diff.
//
// FIELDS OFF, DELIBERATELY (2026-09-13). This gate used to be bimodal
// across boots — room1 came out as either 83b72b03... or ee147144...
// (both superseded, see below). The split was traced to
// fieldParity(frameIndex, fieldCount) (field-render.ts:51, called from
// sdf-layer.ts ~1720): sdf-layer.ts keeps its OWN private frame counter
// (`let frameIndex = 0`, sdf-layer.ts ~1045, incremented only inside
// sdfLayer.render(), sdf-layer.ts ~2188) with no getter, setter, or reset
// hook — it is entirely disjoint from game-main.ts's `frameCount`
// (exposed as __sdfGame.frames). Measured directly: stopping the RAF loop
// atomically the instant __sdfGame.backend becomes readable (so
// __sdfGame.frames reads 0, confirmed every run) did NOT collapse the
// bimodality — proving it is not the wall-clock/RAF drift it first looked
// like, but this private, boot-time-fixed counter that no external script
// can read or normalize. Forcing __sdfGame.setFieldStyle('off') — which
// makes sdf-layer.ts's `parity` unconditionally 0 regardless of
// frameIndex — collapsed the hash to a single value across every boot
// tested. That is the pin below.
// This is not a loosened gate: the march-shader work this script exists
// for (run 5 refine, normal stencil, trace split) is consumed in the
// fields-OFF regime — the upscale stage and the refine pass both force
// fields off in production — so hashing fields-off is hashing the regime
// that regime actually runs in. The interlaced/fields-on path keeps its
// own source-text pins in sdf-layer.test.ts; it is not this gate's job.
// The previously documented hashes (83b72b03.../ee147144...) were taken
// with fields on and are SUPERSEDED — do not compare them against output
// from this version.
//
// Env: LAB_VITE_PORT / LAB_CDP_PORT (default 5323 / 9323). Run inside
// lab-servers (see scripts/lab-servers.sh).
import { createHash } from 'node:crypto';
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
// CANONICAL VALUES after the task-8 default flip (2026-09-14):
//   crowd (shipped default, quad dispatch, tiles on) = a350361d6a223946a4cb8aac9bc2a3a70ee15bfd
//   per-body (?crowd=0, tiles off)                  = a8ab4efac15fc0376c3e4e05420f13e34d1511bd
// The per-body value stays reachable in one command:
//   MARCH_HASH_PERBODY=1 node scripts/march-hash.mjs
// (equivalently MARCH_HASH_QUERY='crowd=0' MARCH_HASH_TILES=0 node scripts/march-hash.mjs).
const PERBODY_HASH = 'a8ab4efac15fc0376c3e4e05420f13e34d1511bd';
// MARCH_HASH_PERBODY — the per-body opt-out gate (task 8). Boots `?crowd=0`
// with the tile list off and asserts the canonical per-body sha1, so the old
// gate is still one self-checking command after the default flip.
const PERBODY = process.env.MARCH_HASH_PERBODY === '1';
// MARCH_HASH_QUERY — extra query string appended to the boot URL, so a page
// flag (e.g. `crowd=1`, `tiles-playtest`) can be hashed through this same gate.
// MARCH_HASH_PERBODY forces `crowd=0` and wins over it.
const EXTRA_QUERY = PERBODY ? '&crowd=0' : (process.env.MARCH_HASH_QUERY ? `&${process.env.MARCH_HASH_QUERY}` : '');
// MARCH_HASH_ROOM — which room's fill-screen close-up to stage. Room 1 is the
// canonical gate; room 2 is the crowd-parity diagnostic (more bodies per type).
const ROOM = Number(process.env.MARCH_HASH_ROOM ?? 1);
// MARCH_HASH_MASK=1 — also hash only the march-target texels that fall in
// tiles the CPU TileBinner marks SINGLE-SLOT (see __sdfGameDebug
// .readTileSlotMask). The masked hash is the crowd-parity instrument: where a
// tile holds one instance of a type, the per-slot loop is a single field eval.
const USE_MASK = process.env.MARCH_HASH_MASK === '1';
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 6 min'); process.exit(3); }, 6 * 60_000).unref();

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({
  send, evaluate, fail,
  url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&upscale=0${EXTRA_QUERY}`,
});
// Belt-and-braces: the loop should already be stopped by the time any
// step()-driven capture happens (step() calls setLoopRunning(false)
// itself), but stopping it explicitly here costs nothing and removes one
// more source of uncontrolled frames between boot and staging.
await evaluate('__sdfGame.setLoopRunning(false)');
await applyShipDefaults(evaluate);
// MARCH_HASH_TILES — the per-BODY tile playtest (the controller is not
// `allowed` without the page flag), NOT the crowd's tile list: the crowd march
// always bins its own binding (task 8). MARCH_HASH_PERBODY pins this off so the
// per-body canonical stays the tiles-off cluster walk.
if (!PERBODY && process.env.MARCH_HASH_TILES === '1') await evaluate('__sdfGame.setTiles(true)');
// THE ACTUAL PIN (see header): force the field-interlace parity to a
// constant 0 by turning field mode off, rather than trying to read or
// normalize sdf-layer.ts's private frameIndex counter, which has no
// accessor.
await evaluate('__sdfGame.setFieldStyle("off")');
// Pin the wall-clock-driven render state: the dungeon flicker lights read
// performance.now() directly in the draw path (game-main.ts ~line 1114),
// with no gate from ?frozen=1 or freeze(true) — those only stop actors.
// The truncating hashMarchTarget() never noticed this drift (sub-1.0
// lighting deltas don't cross an integer boundary); the exact byte readback
// does (measured: two direct back-to-back readMarchTarget() calls on an
// unpinned clock produced different sha1s). Same pins scripts/upscale-parity.mjs
// uses for the same reason.
// Also pin the room-probe afterglow (game-main.ts ~line 1389, default
// blend 0.6 / fall 0.12): a slow temporal accumulation filter whose state
// depends on how many frames have been dispatched, same reasoning as
// scripts/upscale-parity.mjs — blend/fall = 1 makes it a pure per-frame
// estimate so the march target is a function of the frozen scene alone.
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
await stageCloseUp(evaluate, { room: ROOM }, fail);
await evaluate('(() => { __sdfGame.setSdfScale(0.5); __sdfGame.step(6); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');

// readMarchTarget() (game-main.ts) calls handle.step(0) itself before
// reading — an extra internal frame per call, on top of whatever this
// script's own step()s already advanced. That internal step flips a
// frame-parity-driven jitter: measured directly, back-to-back
// readMarchTarget() calls with zero other steps in between produce a
// strict period-2 cycle (X, Y, X, Y, ...), not noise — hashMarchTarget()
// never showed this because it reads the current target with no step of
// its own. Calling readMarchTarget() TWICE per logical capture (consuming
// an even number of internal frames each time) locks the parity so
// successive logical captures land on the same phase; verified stable
// across an intervening external step(2) too.
const capture = async (maskInfo = null) => {
  await evaluate('__sdfGameDebug.readMarchTarget()');
  const r = await evaluate('__sdfGameDebug.readMarchTarget()');
  const bytes = Buffer.from(r.rgba32f, 'base64');
  const full = createHash('sha1').update(bytes).digest('hex');
  if (!maskInfo) return { hash: full, maskedHash: null, maskedFraction: null };
  // Hash only the texels whose TILE is single-slot (mask 0). The mask grid is
  // at the SDF-pass size (sdfLayer.targetSize); the readback IS that target.
  const { tilesX, tilesY, tilePx, mask } = maskInfo;
  const h = createHash('sha1');
  let kept = 0, total = 0;
  for (let y = 0; y < r.h; y++) {
    const ty = Math.min(tilesY - 1, Math.floor(y / tilePx));
    for (let x = 0; x < r.w; x++) {
      total++;
      const tx = Math.min(tilesX - 1, Math.floor(x / tilePx));
      if (mask[ty * tilesX + tx]) continue;
      kept++;
      const o = (y * r.w + x) * 16;
      h.update(bytes.subarray(o, o + 16));
    }
  }
  return { hash: full, maskedHash: h.digest('hex'), maskedFraction: kept / total };
};

let maskInfo = null;
if (USE_MASK) {
  maskInfo = await evaluate('__sdfGameDebug.readTileSlotMask()');
  if (!maskInfo || !Array.isArray(maskInfo.mask)) fail('readTileSlotMask returned nothing');
}

const cap0 = await capture(maskInfo);
const room1 = cap0.hash;
if (PERBODY && room1 !== PERBODY_HASH) {
  fail(`per-body canonical moved: room1=${room1} expected ${PERBODY_HASH}`);
}

await evaluate('(() => { __sdfGame.step(2); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const cap1 = await capture(maskInfo);
const room1Repeat = cap1.hash;

if (room1Repeat !== room1) {
  fail(`not deterministic within boot: room1=${room1} room1-repeat=${room1Repeat}`);
}
if (maskInfo && cap1.maskedHash !== cap0.maskedHash) {
  fail(`masked hash not deterministic: masked=${cap0.maskedHash} repeat=${cap1.maskedHash}`);
}

// Wounded variant — reuse the stamp dance from scripts/sdf-game-parity.mjs,
// EXCEPT the ray origin/direction are hardcoded literals, not this run's
// __sdfGame.predictSlugHit() output.
//
// WHY: predictSlugHit()'s traced hit point carries ~1e-10 run-to-run float
// noise even with a bit-identical staged pose (measured directly: same
// pose, same predictSlugHit() call site, hit.x differing in the 10th
// decimal digit across boots) — small enough to be visually meaningless
// but large enough to flip the exact sha1 byte hash every run. The origin/
// dir predictSlugHit() itself computes from the pose (pure trig on
// already-identical floats) are NOT the noisy part; passing THOSE through
// literally, instead of re-deriving them from a fresh predictSlugHit()
// call each run, removes the noise — confirmed stable across 4 back-to-
// back boots after this change (room1-wounded was previously bimodal-to-
// multimodal even after the fields-off pin above).
// The three shots below are literally __sdfGame.predictSlugHit()'s
// origin/dir for the staged room-1 pose, captured once and rounded to 3
// decimals — regenerate them (see git history around this comment) only if
// CLOSEUP_LADDER, room 1's staged pose, or the dyaw/dpitch offsets below
// change.
const WOUND_SHOTS = [
  { origin: [-4.764, 1.096, -4.461], dir: [-0.005, -0.647, -0.762], kind: 'slug' },
  { origin: [-4.764, 1.096, -4.461], dir: [0.096, -0.605, -0.790], kind: 'pellet' },
  { origin: [-4.764, 1.096, -4.461], dir: [-0.005, -0.647, -0.762], kind: 'pellet' },
];
const stampWounds = () => evaluate(`(async () => {
  __sdfGame.setWoundTuning({ spillChance: 0 });
  const shots = ${JSON.stringify(WOUND_SHOTS)};
  const hits = [];
  for (const { origin, dir, kind } of shots) {
    const hit = __sdfGame.stampWoundAt(origin[0], origin[1], origin[2],
      dir[0], dir[1], dir[2], kind, 1);
    if (hit) hits.push({ kind, at: hit });
  }
  __sdfGame.step(5);
  return { stamped: hits.length };
})()`);

let capW = null;
if (ROOM === 1) {
  const stamp = await stampWounds();
  if (!stamp.stamped) fail(`no wounds stamped: ${JSON.stringify(stamp)}`);
  await evaluate('__sdfGame.resolveGpu()');
  capW = await capture(maskInfo);

  if (capW.hash === room1) {
    fail(`wound not visible to the gate: room1-wounded=${capW.hash} equals room1=${room1}`);
  }
} else {
  console.error(`note: room ${ROOM} — wounded variant skipped (the hardcoded shots are staged for room 1)`);
}

const K = `room${ROOM}`;
const out = { [K]: room1, [`${K}-repeat`]: room1Repeat };
if (maskInfo) {
  out[`${K}-masked`] = cap0.maskedHash;
  out[`${K}-masked-repeat`] = cap1.maskedHash;
  out[`${K}-masked-fraction`] = +cap0.maskedFraction.toFixed(4);
  out[`${K}-tiles`] = `${maskInfo.tilesX}x${maskInfo.tilesY}`;
  const multi = maskInfo.mask.reduce((n, v) => n + v, 0);
  out[`${K}-multi-tile-fraction`] = +(multi / maskInfo.mask.length).toFixed(4);
}
if (capW) out[`${K}-wounded`] = capW.hash;
console.log(JSON.stringify(out));
process.exit(0);
