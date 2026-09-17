// scripts/crowd-t1-probe.mjs — WHERE THE CROWD QUAD'S FIREFIGHT COST GOES.
//
// Crowd-march attribution task 1 (2026-09-14). The t1 window of the owner's
// room-1 recording (frames 1123-2245) is the one window where the crowd quad
// LOSES to per-body (58 vs 42 ms p50 sdf:march, dev note `## Flip decision
// bench`). This script answers WHY, per leg and per frame, from counters rather
// than from wall-clock deltas:
//
//   crowd-off   per-body proxy boxes (the control)      boot ?crowd=0
//   crowd-quad  one screen quad per character type       boot ?crowd=1
//   crowd-boxes one instanced proxy box per body         boot ?crowd=1
//
// EACH LEG BOOTS ITS OWN CROWD FLAG — it must not call setCrowd() after boot.
// A mid-session toggle rebuilds the cast and respawns every body with a new
// `nextId`-derived seed, so the legs would replay different fights (see LEG_APIS
// and the legUrl comment in sdf-game-bench.mjs). Each (leg, frame) boots a FRESH
// page (?simidle=1 + the recording's seed), pins the bench's ship defaults,
// applies the leg, then replays the recording's frames [0,N) with the SAME
// driver the frame-hash gate uses (`__sdfGame.demoReplay`, `hold: true`). That
// puts the sim in the state frame N really has — the camera pose included —
// which a slice-the-frames bench cannot do (see the BENCH_DEMO_FRAMES comment
// in sdf-game-bench.mjs). Two frames are then stepped before any capture: the
// canvas is stale straight after a replay (cost a false alarm on 2026-09-14).
//
// WHAT IT READS, and the seam that owns each number:
//   occupancy()   march debug mode 4 (march.wgsl.ts, "returned BEFORE the
//                 discard"): rasterised = pixels that reached the end of the
//                 march loop and wrote; r = steps, g = hit. Screen pixels the
//                 fragment never reached read as b = 0 and are NOT counted.
//                 The seam's own caveat applies: depth-testing means only the
//                 front-most body writes a pixel, so rasterised is a LOWER
//                 bound on fragment invocations when proxy boxes or type quads
//                 overlap.
//   crowdInfo()   per type: visible / rect (NDC) / rectFrac / meanDistance /
//                 clampedTiles / dispatch. rectFrac x screenPx is the quad's
//                 fragment-invocation footprint (the per-pixel input setup's
//                 addressable area), summed across types because each type
//                 draws its own quad.
//   actorDump()   who the cull kept, per body: visible / dist / position.
//   normalGradientPieces()  per body, ownerLimbs.length = prims + bonePrims —
//                 the "sum of prims across visible bodies" column.
//   readTileSlotMask()  (installDebugProbe) tiles where the SAME-KIND proxy
//                 boxes of >= 2 bodies overlap — the tiles where a union fold
//                 has more than one candidate slot. Tile-granular, not
//                 per-pixel: read it as a fraction of tiles, not mean gPixN.
//   sceneCensus()   (the demoReplay RETURN, not __sdfGame.sceneCensus) bodies /
//                 wounds / chunks / droplets — the scene descriptor at frame N,
//                 so a row cannot silently describe the wrong third.
//
// Usage (inside the chain's server lifecycle):
//   LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 \
//   PROBE_OUT=docs/dev-notes/2026-09-14-crowd-firefight-cost/probe.json \
//   node scripts/crowd-t1-probe.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connectGame, bootCloseupPage, sleep, StageFail } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.argv[3] ?? process.env.LAB_CDP_PORT ?? 9323);
const DEMO_PATH = process.env.PROBE_DEMO
  ?? 'docs/dev-notes/demos/2026-09-14T21-02-05-669Z-room1.dem.json';
const DEMO = JSON.parse(readFileSync(DEMO_PATH, 'utf8'));
// The probe frames live inside t1 (the recording's thirds are t0 0-1122,
// t1 1123-2245, t2 2246-3367), so each one is a sample of the window the bench
// times. Order matters only for logging; every measurement is a fresh page.
const FRAMES = (process.env.PROBE_FRAMES ?? '1300,1600,1900').split(',').map(Number);
const LEGS = (process.env.PROBE_LEGS ?? 'crowd-off,crowd-quad,crowd-boxes').split(',');
const OUT = process.env.PROBE_OUT
  ?? 'docs/dev-notes/2026-09-14-crowd-firefight-cost/probe.json';
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (60 min)'); process.exit(3); }, 60 * 60_000).unref();
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });

/** The bench's ship-default pin (sdf-game-bench.mjs applyLeg), so a probe row
 *  describes the same configuration the t1 bench times. Kept as one string so
 *  the page's own boot state can never leak in. */
const SHIP_PINS = `(() => {
  __sdfGame.setProbeGatherRate(2);
  __sdfGame.setProbeRays(null);
  __sdfGame.setProbeLights(null);
  __sdfGame.setProbeBlend(null);
  __sdfGame.setProbeFall(null);
  __sdfGame.setTemporalAccum(false);
  __sdfGame.setOccluder(false);
  __sdfGame.setCone(false);
  __sdfGame.setFxaa(true);
  if (__sdfGame.refineInfo && __sdfGame.refineInfo().allocated) __sdfGame.setRefine(false);
  __sdfGame.setUpscale(null);
  __sdfGame.setSdfScale(1.0);
  __sdfGame.setAdaptive(false);
  __sdfGame.setMarchSteps(96);
  __sdfGame.setShell(true);
  __sdfGame.setRelax(1.0);
  __sdfGame.setBleed(true);
  __sdfGame.setHullExitBound(true);
  __sdfGame.setTiles(false);
  __sdfGame.setTileRayCull(false);
  __sdfGame.setWoundStep(1.0);
  __sdfGame.setWoundEarlyOut(true);
  __sdfGame.setWoundCull(true);
  __sdfGame.setOwnerRefold(true);
  __sdfGame.setWoundList(false);
  __sdfGame.setBoneMesh(false);
  __sdfGame.setBoneCullMode('segment');
  return 1;
})()`;

/**
 * PER LEG, the crowd flag belongs in the BOOT URL, not in a post-boot call.
 *
 * `setCrowd()` mid-session calls rebuildCast(), which RESPAWNS every body with
 * a new `nextId`-derived seed (game-main.ts spawnAll: `1337 + nextId * 101`) and
 * therefore replays a DIFFERENT fight — measured 2026-09-14: a per-body boot
 * (ids 1-15) read wounds 7 at frame 1300 while a leg that toggled the crowd on
 * after boot (ids 16-30) read wounds 10 with 5 bodies on screen instead of 3.
 * Booting the leg's own flag spawns that leg's cast directly from the
 * recording's spawn state (verified identical ids/positions for ?crowd=0 vs
 * ?crowd=1), so the crowd leg and the per-body control replay the SAME fight.
 * setCrowdDispatch is safe — it swaps the draw, not the cast.
 */
const LEG_APIS = {
  'crowd-off': { query: 'crowd=0', crowdOn: false, dispatch: null, apis: [] },
  'crowd-quad': { query: 'crowd=1', crowdOn: true, dispatch: 'quad', apis: ["__sdfGame.setCrowdDispatch('quad')"] },
  'crowd-boxes': { query: 'crowd=1', crowdOn: true, dispatch: 'boxes', apis: ["__sdfGame.setCrowdDispatch('boxes')"] },
};

/** The recording sliced to [0,n): the replay's input log up to frame n. */
function sliceTo(n) {
  return JSON.stringify({ ...DEMO, frames: DEMO.frames.slice(0, n) });
}

/** Sum prims (flesh + bone) across the bodies the cull kept, from the same
 *  identity seam the normal-gradient diagnostic publishes. */
function primsOfVisible(pieces, visibleKeys) {
  let prims = 0;
  const perBody = [];
  for (const p of pieces) {
    if (p.kind !== 'body') continue;
    const id = Number(String(p.key).slice(5));
    if (!visibleKeys.has(id)) continue;
    const n = p.ownerLimbs.length;
    prims += n;
    perBody.push({ id, prims: n });
  }
  return { prims, perBody };
}

async function measure(conn, leg, frame) {
  const { send, evaluate } = conn;
  await send('Page.bringToFront');
  const spec = LEG_APIS[leg];
  // FRESH PAGE per (leg, frame): damage persists on a warm page, so a second
  // replay would start from the first one's craters (the 583%-spread lesson).
  await bootCloseupPage({
    send, evaluate, fail,
    url: `http://localhost:${VITE}/sdf-game.html?simidle=1&seed=${DEMO.seed}&${spec.query}`,
  });
  await evaluate(SHIP_PINS);
  for (const api of spec.apis) await evaluate(api);
  // The boot flag must have taken: a mismatch here means a rebuild happened and
  // the row is a different fight from the other legs (see LEG_APIS above).
  const crowdState = await evaluate('__sdfGame.crowdInfo()');
  if (crowdState.on !== spec.crowdOn) {
    fail(`${leg}@${frame}: crowd is ${crowdState.on}, expected ${spec.crowdOn} from boot '${spec.query}' — a rebuild would change the fight`);
  }
  // The static probe grid bakes in a worker and lands on whichever frame it
  // finishes. Refuse to measure a scene whose lighting is still settling (the
  // hash gate does the same, for the same reason).
  let baked = false;
  for (let i = 0; i < 240; i++) {
    baked = await evaluate('(() => __sdfGame.roomProbesReady())()') === true;
    if (baked) break;
    await sleep(500);
  }
  if (!baked) fail(`${leg}@${frame}: the static probe grid never baked`);
  // The replay owns the sim (start pose, seed, sim clock, RNG streams).
  const t0 = Date.now();
  const replay = await evaluate(
    `__sdfGame.demoReplay(${sliceTo(frame)}, { hold: true, label: 't1probe-${leg}-${frame}' })`,
    30 * 60_000,
  );
  const replayMs = Date.now() - t0;
  // Two frames before any capture: the presented canvas is stale right after a
  // replay (2026-09-14 capture note). occupancy() then steps one more frame of
  // its own, so the counters describe frame N+3, not N — a stable +3 shift for
  // every leg and frame, which is what an A/B needs.
  await evaluate('(() => { __sdfGame.step(2); return 1; })()');

  const occ = await evaluate('__sdfGame.occupancy()');
  const crowd = await evaluate('__sdfGame.crowdInfo()');
  const dump = await evaluate('__sdfGame.actorDump()');
  const pieces = await evaluate('__sdfGame.normalGradientPieces()');
  const demoInfo = await evaluate('__sdfGame.demoInfo()');
  const mask = await evaluate('__sdfGameDebug.readTileSlotMask()')
    .catch((e) => { console.warn(`  (tile mask unavailable: ${e.message})`); return null; });

  const visibleKeys = new Set(dump.filter((a) => a.visible).map((a) => a.id));
  const { prims, perBody } = primsOfVisible(pieces, visibleKeys);

  const screenPx = occ.screenPx;
  const types = crowd.on === true ? (crowd.types ?? []) : [];
  // Quad fragment-invocation footprint: one quad per live type, each covering
  // its own NDC rect. Summed because the GPU runs every one of them (the depth
  // test only decides whose value sticks).
  const quadFragPx = Math.round(types.reduce((n, t) => n + (t.rectFrac ?? 0), 0) * screenPx);
  const quadRectFrac = types.reduce((n, t) => n + (t.rectFrac ?? 0), 0);
  const tiles = mask ? mask.tilesX * mask.tilesY : 0;
  const multiTiles = mask ? mask.mask.reduce((n, v) => n + (v ? 1 : 0), 0) : 0;
  const stepped = occ.rasterised;
  const hitSteps = occ.hits * occ.meanStepsHit;
  const missSteps = occ.misses * occ.meanStepsMiss;
  return {
    leg, frame,
    targetW: occ.targetW, targetH: occ.targetH, screenPx,
    dispatch: crowd.dispatch ?? null,
    crowdOn: crowd.on === true,
    replayMs,
    // --- fragment accounting (see the header's caveats) ------------------
    /** Fragments that ran the per-pixel setup, summed over the type quads.
     *  Zero for per-body / boxes legs — the census does not report a box
     *  footprint, so for those legs read `stepped` as the marched pixel count. */
    quadFragPx, quadRectFrac,
    /** Pixels that reached the end of the march loop and wrote (mode 4 b>0).
     *  Front-most only: overlapping quads/boxes hide extra invocations. */
    steppedPx: stepped,
    /** Upper bound on fragments that ran the setup and did NOT step: the quad
     *  footprint minus the pixels that stepped. Includes any fragment that
     *  stepped but lost the depth test, so it OVER-counts setup discards. */
    setupNoStepUpperBound: quadFragPx ? Math.max(0, quadFragPx - stepped) : null,
    setupNoStepUpperBoundFrac: quadFragPx ? Math.max(0, quadFragPx - stepped) / quadFragPx : null,
    coverage: occ.coverage,
    hits: occ.hits, misses: occ.misses, occupancy: occ.occupancy,
    meanStepsHit: occ.meanStepsHit, meanStepsMiss: occ.meanStepsMiss,
    /** Mean steps over every pixel that stepped: (hit+miss step sums)/stepped. */
    meanStepsPerSteppedPx: stepped ? (hitSteps + missSteps) / stepped : 0,
    missStepShare: occ.missStepShare,
    bodiesOnScreen: occ.bodiesOnScreen,
    stepsTotal: Math.round(hitSteps + missSteps),
    // --- union-fold candidates -------------------------------------------
    /** Fraction of tiles where >=2 same-kind proxy boxes overlap (the tiles a
     *  crowd union fold has >1 candidate slot in). Tile-granular bound on
     *  "mean slots folded per step" — NOT gPixN. */
    tileMultiFrac: tiles ? multiTiles / tiles : null,
    tilesX: mask?.tilesX ?? null, tilesY: mask?.tilesY ?? null,
    // --- scene descriptor -------------------------------------------------
    types: types.map((t) => ({
      name: t.name, attached: t.attached, visible: t.visible,
      rect: t.rect, rectFrac: t.rectFrac, meanDistance: t.meanDistance,
      clampedTiles: t.clampedTiles, tilesOn: t.tilesOn, idleSkips: t.idleSkips,
    })),
    primsVisible: prims,
    primsPerBody: perBody,
    bodiesVisible: visibleKeys.size,
    actors: dump.map((a) => ({ id: a.id, visible: a.visible, dist: a.dist, baked: a.baked })),
    /** The replayed state's own census, from demoReplay's return: bodies /
     *  wounds / chunks / droplets / splats / gooQuads at frame N, BEFORE the
     *  +2 step and occupancy's own +1 render. The scene descriptor that ties a
     *  row to the fire-heavy third. */
    censusAtFrame: replay?.census ?? null,
    demoInfo: { frame: demoInfo.frame, replaying: demoInfo.replaying },
  };
}

const conn = await connectGame({ vite: VITE, cdp: CDP, onFail: fail });
const rows = [];
try {
  for (const leg of LEGS) {
    for (const frame of FRAMES) {
      if (!LEG_APIS[leg]) fail(`unknown PROBE_LEGS entry "${leg}"`);      process.stdout.write(`probe ${leg} @ frame ${frame} ... `);
      const r = await measure(conn, leg, frame);
      rows.push(r);
      const q = r.quadFragPx ? `${(r.quadFragPx / 1000).toFixed(0)}k` : '-';
      console.log(
        `stepped ${(r.steppedPx / 1000).toFixed(0)}k (${(100 * r.coverage).toFixed(0)}% of target)  `
        + `quadFrag ${q} (${(100 * (r.quadRectFrac ?? 0)).toFixed(0)}%)  `
        + `setupNoStep<=${r.setupNoStepUpperBound == null ? '-' : (r.setupNoStepUpperBound / 1000).toFixed(0) + 'k'}  `
        + `steps/px ${r.meanStepsPerSteppedPx.toFixed(1)} (miss ${(100 * r.missStepShare).toFixed(0)}%)  `
        + `tileMulti ${r.tileMultiFrac == null ? '-' : (100 * r.tileMultiFrac).toFixed(0) + '%'}  `
        + `prims ${r.primsVisible}  bodies ${r.censusAtFrame?.bodies}  wounds ${r.censusAtFrame?.wounds}`,
      );
    }
  }
} catch (e) {
  if (e instanceof StageFail) fail(e.message);
  throw e;
}

writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(),
  demo: DEMO_PATH,
  seed: DEMO.seed,
  frames: FRAMES,
  legs: LEGS,
  loadAvg: (await import('node:os')).loadavg(),
  rows,
}, null, 2));
console.log(`\nwrote ${OUT}`);
