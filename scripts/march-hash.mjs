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
//
// SETTLING, DELIBERATELY (2026-09-20). This gate was bistable ACROSS BOOTS on
// unchanged code (8f2b74e7... / ce7045ac... / 9871c2c2... / b6422b41...),
// always within-boot deterministic, canonical on an idle machine and bogus
// under CPU load. The MARCH_HASH_DUMP instrument named the input: NOT a
// uniform, NOT temporal state — the COVERAGE-SEARCH STAGED A DIFFERENT LADDER
// RUNG. Every occupancy() read (sdf-closeup-stage.mjs) dispatches a frame and
// reads the march target back; under load three's asynchronous render
// submission can defer that frame past the readback, which then returns the
// last LANDED content — at boot, an all-zero target. cov reads 0, the first
// rung (d=1.6) wins by default, and the gate hashes a different pose. Fix, in
// the spirit of the fields-off pin: WAIT FOR THE REAL CONDITION instead of
// racing it. The ladder census (sdf-closeup-stage.mjs) now reads until two
// consecutive occupancy reads agree and are live; this script additionally
// settles the march target (hash stable across a 250 ms gap, nonZero > 0)
// before the first capture and, requiring the hash to DIFFER from room1,
// before the wounded capture, and capture() retries an all-zero readback
// (2 internal steps per attempt, so the read-parity contract below is
// preserved). This is the regime the march work is consumed in: a gate must
// hash the frame it actually staged, never whichever frame happened to land
// first. No pin was moved and no comparison loosened — the canonical below is
// the same value the idle machine always produced.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
// CANONICAL VALUES (default = crowd, BOXES dispatch, RE-PINNED 2026-09-18):
//   shipped default (crowd, boxes, tiles on)        = 8f2b74e71ff18dd04a99c05fe19392b96dd80c9d
//   crowd quad (?crowddispatch=quad, tiles on)      = c77f9008d44cb016dcb887361391690f6f6b3484
//   per-body (?crowd=0, tiles off)                  = 2c5dac0da44c7a3aa96a4ee0f33385c6f463b6dc
//
// WHY THESE MOVED, and how it was established. The previous pins (2026-09-15,
// 0b84c119… / a350361d… / a8ab4efa…) were set by 2b396068 and then went STALE:
// every run of this gate exited FAIL for a reason that had nothing to do with
// the change being tested, which is how a real regression gets waved through.
//
// The mover was found by bisecting all 163 commits from 2b396068 to HEAD with
// this script, two probes at a time:
//
//   2b396068 (the pin itself)                 0b84c119…   <- pin reproduced
//   index  82  f4588548 shutter blur task 2   0b84c119…
//   index  93  4ce1e826 docs: close out …     0b84c119…
//   index  98  75545d2b fix(rendering): …     0b84c119…
//   index  99  efdb5eb2 Merge reviewed …      0b84c119…
//   index 100  3662c1ca half-strength round blends for character builds
//                                             8f2b74e7…   <- MOVED HERE
//   index 103  1cd6b041                       8f2b74e7…
//   HEAD                                      8f2b74e7…
//
// ONE commit, 3662c1ca, moved all three canonicals and nothing since has moved
// them again. It changes character flesh blend geometry, so a staged character
// close-up MUST change — and it is owner-accepted work (see TASKS.md,
// "Character blends and zombie heading — owner accepted 2026-09-17"). The drift
// is therefore explained and intentional, not a regression.
//
// Each new value was reproduced on two independent runs (separate vite + Chrome
// on separate ports) before being pinned. A value that is not deterministic must
// NEVER be pinned: a flaky canonical is worse than a stale one.
//
// RE-PINNING DISCIPLINE. Do not update these to make a red run pass. Bisect to
// the commit that moved the value, confirm that commit intended to change what
// is rendered, reproduce the new value twice, and record the evidence here — as
// above. If you cannot name the commit, you have a regression, not a stale pin.
// Each stays reachable in one command:
//   node scripts/march-hash.mjs                       (default, pinned)
//   MARCH_HASH_CROWD=1 node scripts/march-hash.mjs    (quad, pinned)
//   MARCH_HASH_PERBODY=1 node scripts/march-hash.mjs  (per-body, pinned)
// The per-body value stays reachable in one command:
//   MARCH_HASH_PERBODY=1 node scripts/march-hash.mjs
// (equivalently MARCH_HASH_QUERY='crowd=0' MARCH_HASH_TILES=0 node scripts/march-hash.mjs).
const PERBODY_HASH = '2c5dac0da44c7a3aa96a4ee0f33385c6f463b6dc';
// MARCH_HASH_PERBODY — the per-body opt-out gate (task 8). Boots `?crowd=0`
// with the tile list off and asserts the canonical per-body sha1, so the old
// gate is still one self-checking command after the default flip.
const PERBODY = process.env.MARCH_HASH_PERBODY === '1';
// MARCH_HASH_CROWD — the QUAD-dispatch gate: boots `?crowd=1&crowddispatch=quad`,
// tiles on, and pins the quad canonical. The shipped default (boxes) is pinned
// by DEFAULT_HASH whenever neither override is set and no extra query is given.
const CROWD = process.env.MARCH_HASH_CROWD === '1';
const CROWD_HASH = 'c77f9008d44cb016dcb887361391690f6f6b3484';
const DEFAULT_HASH = '8f2b74e71ff18dd04a99c05fe19392b96dd80c9d';
// MARCH_HASH_QUERY — extra query string appended to the boot URL, so a page
// flag (e.g. `crowd=1`, `tiles-playtest`) can be hashed through this same gate.
// MARCH_HASH_PERBODY forces `crowd=0` and wins over it.
const EXTRA_QUERY = PERBODY ? '&crowd=0' : CROWD ? '&crowd=1&crowddispatch=quad' : (process.env.MARCH_HASH_QUERY ? `&${process.env.MARCH_HASH_QUERY}` : '');
// MARCH_HASH_ROOM — which room's fill-screen close-up to stage. Room 1 is the
// canonical gate; room 2 is the crowd-parity diagnostic (more bodies per type).
const ROOM = Number(process.env.MARCH_HASH_ROOM ?? 1);
// MARCH_HASH_MASK=1 — also hash only the march-target texels that fall in
// tiles the CPU TileBinner marks SINGLE-SLOT (see __sdfGameDebug
// .readTileSlotMask). The masked hash is the crowd-parity instrument: where a
// tile holds one instance of a type, the per-slot loop is a single field eval.
const USE_MASK = process.env.MARCH_HASH_MASK === '1';
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 14 min'); process.exit(3); }, 14 * 60_000).unref();

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({
  send, evaluate, fail,
  url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&upscale=0${EXTRA_QUERY}`,
});
// WAIT FOR THE BACKGROUND COMPILES (2026-09-21). The gib and crowd programs
// compile AFTER the loader (defer-compile, 2026-09-19); until the crowd job is
// `ready` the game draws every member through the per-body FALLBACK. That
// fallback drew nothing until the cold-cache flesh fix (49751086), so the
// occupancy wait below used to cover this by accident; now it draws at once,
// and a gate that hashes early hashes the PER-BODY path — it returns exactly
// PERBODY_HASH (2c5dac0d…) and reads as "the canonical moved". Seen twice on
// 2026-09-21, both times with a second Chrome loading the machine. Neither
// ?crowd=0 (no crowd job is ever started) nor a `failed` crowd job may wait forever.
if (!PERBODY) {
  const BG_WAIT_S = Number(process.env.MARCH_HASH_BG_WAIT_S ?? 600);
  let bg = null;
  for (let i = 0; i < BG_WAIT_S * 2; i++) {
    bg = await evaluate('JSON.stringify(__sdfGame.warmBackground())').then(JSON.parse);
    // Only the CROWD job decides which path is hashed. The gib job runs first
    // and may time out cold (`failed`) — the crowd job still starts after it.
    if (bg.crowd === 'ready' || bg.crowd === 'failed') break;
    await sleep(500);
  }
  if (bg?.crowd !== 'ready') {
    fail(`background compiles not ready after ${BG_WAIT_S} s (${JSON.stringify(bg)}) — hashing now would hash the per-body fallback, not the crowd path. Cold shader cache or a loaded machine: rerun, or raise MARCH_HASH_BG_WAIT_S.`);
  }
}
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

// SETTLE before the first capture (see header): the hash must be live
// (nonZero > 0) and STABLE across a 250 ms gap — a deferred render landing
// between the two reads breaks stability, so agreement means the backlog has
// drained and the target holds the staged frame. hashMarchTarget() consumes
// no frames, so this cannot disturb the read-parity contract below.
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
if (!(await settleMarchTarget())) fail('march target never settled after staging (live + stable reads) — renderer backlog?');

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
let rawWritten = false;
const capture = async (maskInfo = null) => {
  // Each attempt consumes exactly 2 internal readMarchTarget() steps (the
  // parity contract in the comment below); a retry re-runs the whole pair, so
  // parity is preserved whatever the retry count. An all-zero readback is the
  // deferred-render signature (nothing had landed yet) — wait and re-read.
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
    const full = createHash('sha1').update(bytes).digest('hex');
    // MARCH_HASH_RAW=<path>: also write the FIRST capture's raw float bytes
    // (with a {w,h} JSON sidecar) so two commits can be diffed by magnitude
    // with scripts/march-raw-diff.mjs when the exact hash moves.
    if (process.env.MARCH_HASH_RAW && !rawWritten) {
      rawWritten = true;
      writeFileSync(process.env.MARCH_HASH_RAW, bytes);
      writeFileSync(`${process.env.MARCH_HASH_RAW}.json`, JSON.stringify({ w: r.w, h: r.h }));
    }
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
  }
};

// MARCH_HASH_DUMP=<path> — write a JSON snapshot of the scene state at hash
// time (march material uniforms per piece, camera/projection, staged actor
// poses, probe-gather census, warm phase, march-target rSum) BEFORE the first
// capture. This is the instrument that named the bistability input (task 0 of
// the march phase-2 plan): run two boots that disagree, diff the files.
// Big Float32Arrays (dataTexture/records/probeDyn) are folded in-page to
// `fnv#len` strings; everything else crosses as compact numbers.
if (process.env.MARCH_HASH_DUMP) {
  const dump = await evaluate(`(async () => {
    const fnv = (arr) => { const f = Float32Array.from(arr); let h = 0x811c9dc5; for (let i = 0; i < f.length; i++) h = Math.imul(h ^ (f[i] | 0), 0x01000193); return (h >>> 0).toString(16) + '#' + f.length; };
    const r6 = (a) => Array.from(a, (v) => +Number(v).toFixed(6));
    const st = __sdfGameDebug.normalCaptureState();
    const dyn = Array.from(await __sdfGame.probeDynReadback());
    return {
      frames: __sdfGame.frames,
      camera: r6(st.camera), projection: r6(st.projection),
      zombies: __sdfGame.zombies().map((z) => ({ id: z.id, room: z.room, pos: r6(z.pos) })),
      pieces: st.pieces.map((p) => ({
        key: p.key, data: fnv(p.data), records: fnv(p.records),
        uniforms: Object.fromEntries(Object.entries(p.uniforms).map(([k, v]) => [k, Array.isArray(v) ? r6(v) : v])),
      })),
      probeDynamic: __sdfGame.probeDynamic,
      probeDynHash: fnv(dyn), probeDynNonZero: dyn.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0),
      levelProbes: __sdfGame.levelProbes,
      sdfScale: __sdfGame.sdfScale,
      warmDone: __sdfGame.warmDone(),
      chunkCount: __sdfGame.chunkCount, bodiesOnScreen: __sdfGame.bodiesOnScreen,
      marchTarget: await __sdfGameDebug.hashMarchTarget(),
    };
  })()`);
  writeFileSync(process.env.MARCH_HASH_DUMP, JSON.stringify(dump, null, 1));
}

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
if (CROWD && room1 !== CROWD_HASH) {
  fail(`crowd canonical moved: room1=${room1} expected ${CROWD_HASH}`);
}
if (!PERBODY && !CROWD && !process.env.MARCH_HASH_QUERY && process.env.MARCH_HASH_TILES !== '0' && room1 !== DEFAULT_HASH) {
  fail(`shipped-default canonical moved: room1=${room1} expected ${DEFAULT_HASH}`);
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
  // Same settle as the first capture, plus the wound must already be visible:
  // a stale pre-wound frame would read as room1 and make the visibility check
  // below fail spuriously, so settle on stable AND distinct-from-room1.
  if (!(await settleMarchTarget({ distinctFrom: room1 }))) fail('march target never settled post-wound (stable + distinct from room1)');
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
