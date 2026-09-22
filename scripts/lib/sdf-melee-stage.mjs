// scripts/lib/sdf-melee-stage.mjs — the MELEE staging harness (2026-09-21).
//
// WHY A SECOND STAGE FILE. Every existing close-up harness stages ONE
// standing body at ~0.7 m, which fills ~27% of the march target and lands
// all its wounds on one hip. The owner's one GPU-bound telemetry episode was
// different in kind: EIGHT bodies, nearest 1.6 m, screen coverage 1.0, fire
// burning, `sdf:march` 28-38 ms (docs/dev-notes/2026-09-20-telemetry-v3/
// NOTES.md). This module stages THAT scene — several bodies close to the
// camera, wounds owned by different limbs, FX running — from the same
// building blocks as sdf-closeup-stage.mjs (which this file deliberately
// does not modify; the close-up gates stay byte-identical).
//
// WHAT IS HERE:
//   pure (unit-tested in scripts/sdf-melee-stage.test.mjs):
//     woundPlan(bodyCount, perBody)             — per body, aim targets on
//       DIFFERENT owner limbs (chest / head / one arm / one thigh), kinds
//       alternating slug/pellet with one safety: a slug stamps ONLY a chest,
//       because SLUG.severRadius 0.13 severs a limb or head in ONE hit
//       (game-weapon.ts) and a sever adds gib cost no leg asked for.
//     summariseBlocks(rows) / renderMarkdown(summary, staging)
//     censusFromTarget(float32, w, h)           — the mode-4 census.
//     assertMeleeWounds(record, {minLandedFrac})— the three loud checks.
//   browser-driving (take an `evaluate` from connectGame):
//     stageMelee(evaluate, opts)                — let the room's cast WALK to the
//       player, freeze, then search yaw x pitch for the highest settled coverage.
//     stampMeleeWounds(evaluate, plan)          — aim, predict, stamp ONLY
//       when the predicted body is the intended one, restore the pose.
//
// THE THREE RULES OF GPU TIMING live in the bench caller, not here, but the
// helpers are shaped by them: wounds are irreversible so the PHASES are
// sequential (clean -> wounded -> wounded+fire) while the LEGS alternate
// inside one page; every leg restores the ship state before applying its own
// seam; and every row records os.loadavg()[0].
//
// READBACK TRAPS inherited from the close-up work (still true):
//   * occupancy()/readMarchTarget() dispatch a frame and read it back; under
//     load the read can return the PREVIOUS frame (all-zero at boot). Every
//     coverage number here comes from the settled read — two consecutive
//     agreeing live reads, 250 ms apart — not from a single dispatch.
//   * mode-4 target channels are r = steps, g = hit (0/1), b = rasterised
//     (1), a = CLIP DEPTH, not metres (near 0.1 / far 200). readMarchTarget
//     already de-pads the 256-byte row alignment: rgba32f is a dense
//     Float32Array, base64.
import { connectGame, failHard, sleep } from './sdf-closeup-stage.mjs';

export { connectGame, failHard, sleep };
export { bootCloseupPage, applyShipDefaults } from './sdf-closeup-stage.mjs';
import { bootCloseupPage, applyShipDefaults } from './sdf-closeup-stage.mjs';

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s[s.length >> 1];
};

// ---------------------------------------------------------------------------
// woundPlan — pure
// ---------------------------------------------------------------------------

/** The four aim regions, in body-local terms. Heights are metres above the
 *  ground; lateral is metres off the body's spine, POSITIVE meaning the
 *  body's left as seen from the player (sign set per body below). The arm is
 *  offset sideways hard (0.28 m ~ the shoulder socket of an average body);
 *  the thigh only slightly (0.12 m). */
export const MELEE_REGIONS = [
  { region: 'chest', height: 1.25, lateral: 0 },
  { region: 'head', height: 1.6, lateral: 0 },
  { region: 'arm', height: 1.3, lateral: 0.28 },
  { region: 'thigh', height: 0.8, lateral: 0.12 },
];

/**
 * Per body: `perBody` aim targets spread over DIFFERENT owner limbs.
 *
 * Body b takes regions (b + j) % 4 for j in 0..perBody-1, so different
 * bodies LEAD with different regions and no two bodies carry the same
 * region list in the same order — the point is wounds owned by different
 * limbs across the crowd, not five craters on one hip (the old close-up's
 * failure, which priced one hip's cost as "the wounded body").
 *
 * Lateral side alternates per body (even b -> +, odd b -> -) so the arm and
 * thigh wounds land on both flanks of the crowd.
 *
 * Kinds alternate slug/pellet by global stamp index. ONE safety overrides
 * the alternation: a 'slug' stamps only a CHEST. SLUG.severRadius is 0.13 —
 * the measured one-hit sever calibre for limbs and head — and a severed
 * limb spawns gib chunks, a cost no timing leg asked for. The pellet's
 * 0.10 severRadius needs ~8 pellets through the SAME joint; one pellet per
 * region never severs (damage.ts sever-union note).
 *
 * Returns [{ body, targets: [{ region, height, lateral, kind }] }].
 */
export function woundPlan(bodyCount, perBody = 4) {
  const out = [];
  let g = 0;
  for (let b = 0; b < bodyCount; b++) {
    const side = b % 2 === 0 ? 1 : -1;
    const targets = [];
    for (let j = 0; j < perBody; j++) {
      const def = MELEE_REGIONS[(b + j) % MELEE_REGIONS.length];
      const alternate = g % 2 === 0 ? 'slug' : 'pellet';
      const kind = alternate === 'slug' && def.region !== 'chest' ? 'pellet' : alternate;
      // Past the fourth target the regions repeat; shift the repeat a few centimetres so
      // it opens its own crater beside the first instead of re-stamping the same point.
      const lap = Math.floor(j / MELEE_REGIONS.length);
      const dh = lap === 0 ? 0 : (lap % 2 === 1 ? -0.09 : 0.09);
      const dl = lap === 0 ? 0 : 0.07 * lap;
      targets.push({ region: def.region, height: def.height + dh, lateral: (def.lateral + dl) * side, kind });
      g++;
    }
    out.push({ body: b, targets });
  }
  return out;
}

/** Pellets-only copy of a plan — the severed-retry shape. */
export function pelletsOnly(plan) {
  return plan.map((p) => ({
    ...p,
    targets: p.targets.map((t) => ({ ...t, kind: 'pellet' })),
  }));
}

// ---------------------------------------------------------------------------
// summariseBlocks / renderMarkdown — pure
// ---------------------------------------------------------------------------

/** Median per (phase, leg) over the bench rows.
 *
 *  rows: [{ phase, leg, p50, labels: { name: { p50 } }, load1 }]
 *  (exactly what the bench driver accumulates per timed block).
 *
 *  Returns { groups: [{ phase, leg, n, frameP50, labels: { name: medianP50 },
 *  topLabels: [name...], maxLoad, loadSuspect }], loadSuspect } — topLabels
 *  the 8 most expensive labels by median (the table's width), loadSuspect
 *  true when ANY row's 1-minute load average exceeded LOAD_SUSPECT_LIMIT
 *  (4.0). The flag is a FLAG, not a gate: this instrument reports the load
 *  it ran under, it does not pretend the machine was quiet. */
export const LOAD_SUSPECT_LIMIT = 4.0;

export function summariseBlocks(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.phase}/${r.leg}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const groups = [];
  let loadSuspect = false;
  for (const [k, rs] of byKey) {
    const [phase, leg] = k.split('/');
    const labelNames = [...new Set(rs.flatMap((r) => Object.keys(r.labels ?? {})))];
    const labels = {};
    for (const name of labelNames) {
      const vals = rs.map((r) => r.labels?.[name]?.p50).filter((v) => typeof v === 'number');
      if (vals.length > 0) labels[name] = median(vals);
    }
    const topLabels = Object.entries(labels)
      .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
    const maxLoad = Math.max(...rs.map((r) => r.load1 ?? 0));
    const suspect = rs.some((r) => (r.load1 ?? 0) > LOAD_SUSPECT_LIMIT);
    loadSuspect ||= suspect;
    groups.push({
      phase, leg, n: rs.length,
      frameP50: median(rs.map((r) => r.p50)),
      labels, topLabels, maxLoad, loadSuspect: suspect,
    });
  }
  return { groups, loadSuspect };
}

/** The markdown tables: staging, then one block table per phase with the
 *  union of the phase's top labels as columns. Deterministic; the bench
 *  embeds it verbatim in melee.md. */
export function renderMarkdown(summary, staging) {
  const L = [];
  const fmt = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
  L.push('## Staged scene');
  L.push('');
  L.push('| bodies gathered | sim frames | nearest | distances (m) | coverage | rasterised | bodies on screen | room |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  L.push(`| ${staging.gathered ?? '—'}/${staging.n} | ${staging.frames ?? '—'} | ${fmt(staging.nearest)} m | ${(staging.distances ?? []).join(' ')} | ${(staging.coverage * 100).toFixed(1)}% | ${((staging.rasterised ?? 0) * 100).toFixed(1)}% | ${staging.bodiesOnScreen} | ${staging.room} |`);
  L.push('');
  if (staging.search?.length) {
    const top = [...staging.search].sort((p, q) => q.coverage - p.coverage).slice(0, 3);
    L.push(`Camera search (yaw offset / pitch -> coverage), best three of ${staging.search.length}: ${top.map((r) => `${r.dyaw}/${r.pitch} -> ${(r.coverage * 100).toFixed(1)}%`).join(', ')}`);
    L.push('');
  }
  const phases = [...new Set(summary.groups.map((g) => g.phase))];
  for (const phase of phases) {
    const gs = summary.groups.filter((g) => g.phase === phase);
    const cols = [...new Set(gs.flatMap((g) => g.topLabels))];
    L.push(`## ${phase}`);
    L.push('');
    L.push(`| leg | n | frame p50 ms | ${cols.map((c) => `\`${c}\``).join(' | ')} | max load |`);
    L.push(`| --- | --- | --- | ${cols.map(() => '---').join(' | ')} | --- |`);
    for (const g of gs) {
      const cells = cols.map((c) => (g.labels[c] !== undefined ? g.labels[c].toFixed(2) : '—'));
      L.push(`| ${g.leg} | ${g.n} | ${fmt(g.frameP50)} | ${cells.join(' | ')} | ${g.maxLoad.toFixed(1)}${g.loadSuspect ? ' ⚠' : ''} |`);
    }
    L.push('');
  }
  if (summary.loadSuspect) {
    L.push(`> ⚠ **loadSuspect**: at least one block ran with the 1-minute load average above ${LOAD_SUSPECT_LIMIT}. Under that load the fenced frame ms read LONG (CPU contention), so cross-leg deltas are indicative only. Re-run on a quiet machine before judging a seam.`);
    L.push('');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// censusFromTarget — pure
// ---------------------------------------------------------------------------

/** The mode-4 march-target census over a DENSE rgba32f buffer (what
 *  __sdfGameDebug.readMarchTarget() returns de-padded, base64-decoded).
 *  Channels: r = steps, g = hit (0/1), b = rasterised (1), a = CLIP DEPTH —
 *  NOT metres; see clipDepthToMetres.
 *
 *  coverage is hits / ALL target pixels (what "the bodies fill X% of the
 *  march target" means); rasterisedFrac is the proxy-box footprint; the
 *  per-ray step means and missStepShare decompose where the marched steps
 *  actually go. */
export function censusFromTarget(f32, w, h) {
  const n = w * h;
  let rasterised = 0, hits = 0, stepsHit = 0, stepsMiss = 0, clipSum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const raster = f32[o + 2];
    if (!(raster >= 0.5)) continue;
    rasterised++;
    if (f32[o + 1] > 0.5) { hits++; stepsHit += f32[o]; clipSum += f32[o + 3]; }
    else stepsMiss += f32[o];
  }
  const misses = rasterised - hits;
  const totalSteps = stepsHit + stepsMiss;
  return {
    w, h, pixels: n,
    rasterised, hits, misses,
    coverage: n ? hits / n : 0,
    rasterisedFrac: n ? rasterised / n : 0,
    occupancy: rasterised ? hits / rasterised : 0,
    meanStepsHit: hits ? stepsHit / hits : 0,
    meanStepsMiss: misses ? stepsMiss / misses : 0,
    missStepShare: totalSteps > 0 ? stepsMiss / totalSteps : 0,
    meanClipDepthOnHit: hits ? clipSum / hits : 0,
  };
}

/** Mode-4 alpha is clip depth in [0,1] (0 = near plane, 1 = far plane);
 *  game camera is near 0.1 / far 200 (upscaleInfo() reports both). This is
 *  the standard perspective linearisation — verified only as self-consistent
 *  (converted values landed between the staged body distances), so treat
 *  the metres as indicative until a known-distance scene confirms it. */
export function clipDepthToMetres(a, near = 0.1, far = 200) {
  return (near * far) / (far - a * (far - near));
}

// ---------------------------------------------------------------------------
// assertMeleeWounds — pure
// ---------------------------------------------------------------------------

/** The loud wound-staging checks, as data so the caller decides what a
 *  failure means (the bench retries pellets-only on a sever; unit tests
 *  assert the checks themselves).
 *
 *  record: what stampMeleeWounds returns — { planned, landed, chunks,
 *  bleed: { droplets, splats }, perBody: [{ limbs }] }. Returns a list of
 *  problems; an empty array is a trustworthy staging. */
export function assertMeleeWounds(record, opts = {}) {
  const problems = [];
  const minFrac = opts.minLandedFrac ?? 0.6;
  if (record.planned > 0 && record.landed / record.planned < minFrac) {
    problems.push(`only ${record.landed}/${record.planned} planned stamps landed (< ${Math.round(minFrac * 100)}%) — bodies occlude their neighbours' aim points; raise spacing or lower MELEE_BODIES`);
  }
  if ((record.chunks ?? 0) !== 0) {
    problems.push(`${record.chunks} chunks in flight — a stamp SEVERED a limb; reload and retry with pellets only on limbs (pelletsOnly(plan))`);
  }
  if (opts.spillChanceZero !== false && record.bleed
      && ((record.bleed.droplets ?? 0) !== 0 || (record.bleed.splats ?? 0) !== 0)) {
    problems.push(`blood sim not empty at spillChance 0: ${JSON.stringify(record.bleed)}`);
  }
  const limbSet = new Set((record.perBody ?? []).flatMap((b) => b.limbs ?? []));
  if (limbSet.size < 3) {
    problems.push(`wounds landed on only ${limbSet.size} distinct owner limbs (${[...limbSet].join(', ') || 'none'}) — the plan wants >= 3 (chest/head/arm/thigh)`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// stageMelee — browser-driving
// ---------------------------------------------------------------------------

/** Camera search after the gather: yaw offsets (radians, around the direction of the
 *  bodies' centroid) x pitches. The best settled flesh coverage wins. */
export const MELEE_YAWS = [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6];
export const MELEE_PITCHES = [-0.12, -0.22, -0.04];

/**
 * Stage the melee scene by LETTING THE GAME BUILD IT: stand the player with their back
 * near a wall of the room, thaw the cast, and step the sim until `n` bodies have walked
 * to within `gatherRadius` of the player (or `maxFrames` pass). Then freeze, and search
 * a small yaw x pitch fan for the framing with the highest settled flesh coverage.
 *
 * WHY NOT PLACE THE BODIES (both tried 2026-09-21, both dead ends):
 *   * spawnDebugCharacter / spawnCrowd after boot: the new crowd type attaches
 *     (`zombie@1:4` in crowdInfo) but its bodies never march flesh — occupancy hits
 *     stayed bit-identical for 170 s. The shipped game spawns every actor at boot.
 *   * zombieNudge on boot bodies: moves the SIM position, but a frozen cast pins the
 *     view upload (flesh kept drawing 6.6 m away), and after a thaw the bodies drew as
 *     floating torsos at the wrong range — hull/shell bounds and view state do not
 *     follow a teleport. nudge is also canTravel-gated, so long hops silently refuse.
 * Bodies that WALK in go through every normal tick, so everything the renderer keeps
 * per body is valid — and the frame is the real thing: attack poses, reaching arms,
 * bodies overlapping. With `?seed=1` and a fixed step count the gather is repeatable.
 *
 * opts: room (6 = the arena: 16x16 m, boots 8 zombies), n (6), gatherRadius (3.0),
 * maxFrames (2400 = 40 s of sim; the far wall is a 12 m walk for the arena cast), wallInset (0.9 m — how far from the wall the player
 * stands), settleTries.
 *
 * Returns { n, room, gathered, frames, nearest, distances, coverage, rasterised,
 *           bodiesOnScreen, pose, ids (nearest first), search }.
 */
export async function stageMelee(evaluate, opts = {}, fail = failHard) {
  const room = opts.room ?? 6;
  const n = opts.n ?? 6;
  const gatherRadius = opts.gatherRadius ?? 3.0;
  const maxFrames = opts.maxFrames ?? 2400;
  const wallInset = opts.wallInset ?? 0.9;
  const settleTries = Number(opts.settleTries ?? process.env.MELEE_SETTLE_TRIES ?? 30);
  const staged = await evaluate(`(async () => {
    const n = ${n};
    if (!__sdfGame.teleport(${room})) return { error: 'teleport(${room}) refused — no such room' };
    const r = __sdfGame.rooms.find((x) => x.id === ${room});
    if (!r) return { error: 'room ${room} not in __sdfGame.rooms' };
    const boot = __sdfGame.zombies().filter((q) => q.room === ${room});
    if (boot.length < n) return { error: 'room ${room} boots only ' + boot.length + ' bodies, want ' + n + ' (spawned bodies do not march; lower MELEE_BODIES)' };
    // Back to the wall FARTHEST from the cast's centroid, so everybody arrives from the front.
    const b = r.bounds;
    const cx0 = boot.reduce((a, q) => a + q.pos[0], 0) / boot.length;
    const cz0 = boot.reduce((a, q) => a + q.pos[2], 0) / boot.length;
    const midX = (b.minX + b.maxX) / 2, midZ = (b.minZ + b.maxZ) / 2;
    const walls = [
      { x: midX, z: b.maxZ - ${wallInset} }, { x: midX, z: b.minZ + ${wallInset} },
      { x: b.maxX - ${wallInset}, z: midZ }, { x: b.minX + ${wallInset}, z: midZ },
    ];
    walls.sort((p, q) => Math.hypot(q.x - cx0, q.z - cz0) - Math.hypot(p.x - cx0, p.z - cz0));
    const px = walls[0].x, pz = walls[0].z;
    // The page's forward is (sin yaw, -cos yaw).
    const yawTo = (tx, tz) => Math.atan2(tx - px, -(tz - pz));
    __sdfGame.placePlayer({ x: px, z: pz, yaw: yawTo(cx0, cz0), pitch: 0 });
    const dists = () => __sdfGame.zombies().filter((q) => q.room === ${room})
      .map((q) => ({ id: q.id, d: Math.hypot(q.pos[0] - px, q.pos[2] - pz), pos: q.pos }))
      .sort((p, q) => p.d - q.d);
    __sdfGame.freeze(false);
    let frames = 0;
    while (frames < ${maxFrames}) {
      __sdfGame.step(30);
      frames += 30;
      // Hold the player on the spot: a shove from a body must not move the measured scene.
      __sdfGame.placePlayer({ x: px, z: pz, yaw: yawTo(cx0, cz0), pitch: 0 });
      const d = dists();
      if (d.length >= n && d[n - 1].d <= ${gatherRadius}) break;
    }
    __sdfGame.freeze(true);
    __sdfGame.step(2);
    const near = dists().slice(0, n);
    const gathered = near.filter((q) => q.d <= ${gatherRadius}).length;
    const gx = near.reduce((a, q) => a + q.pos[0], 0) / near.length;
    const gz = near.reduce((a, q) => a + q.pos[2], 0) / near.length;
    const baseYaw = yawTo(gx, gz);
    const SETTLE_TRIES = ${settleTries};
    const settledOcc = async () => {
      let occ = await __sdfGame.occupancy();
      let prevSig = null;
      for (let t = 0; t < SETTLE_TRIES && !(occ.rasterised > 0 && occ.hits + ':' + occ.rasterised === prevSig); t++) {
        prevSig = occ.hits + ':' + occ.rasterised;
        await new Promise((res) => setTimeout(res, 250));
        occ = await __sdfGame.occupancy();
      }
      return occ;
    };
    let best = null;
    const search = [];
    for (const dyaw of ${JSON.stringify(MELEE_YAWS)}) {
      for (const pitch of ${JSON.stringify(MELEE_PITCHES)}) {
        __sdfGame.setPose(px, pz, baseYaw + dyaw, pitch, 0);
        __sdfGame.step(3);
        const occ = await settledOcc();
        if (!(occ.rasterised > 0)) return { error: 'occupancy never went live in the camera search (cold compile? MELEE_SETTLE_TRIES=2400)' };
        const cov = occ.hits / (occ.targetW * occ.targetH);
        search.push({ dyaw, pitch, coverage: +cov.toFixed(4), bodiesOnScreen: occ.bodiesOnScreen });
        if (!best || cov > best.cov) best = { dyaw, pitch, cov, occ };
      }
    }
    __sdfGame.setPose(px, pz, baseYaw + best.dyaw, best.pitch, 0);
    __sdfGame.step(3);
    return {
      n, room: ${room}, gathered, frames,
      nearest: +near[0].d.toFixed(2),
      distances: near.map((q) => +q.d.toFixed(2)),
      coverage: best.cov,
      rasterised: best.occ.rasterised / (best.occ.targetW * best.occ.targetH),
      bodiesOnScreen: best.occ.bodiesOnScreen,
      pose: __sdfGame.pose(),
      ids: near.map((q) => q.id),
      search,
    };
  })()`, 600_000);
  if (staged.error) fail(staged.error);
  return staged;
}

// ---------------------------------------------------------------------------
// stampMeleeWounds — browser-driving
// ---------------------------------------------------------------------------

/**
 * Stamp the plan's wounds: for each body and target, aim the camera from the
 * STAGED player position at that world point (setPose with computed
 * yaw/pitch, then step(3) so the muzzle rig catches up), read
 * predictSlugHit() — the EXACT ray fire() would take, with gravity — and
 * stamp ONLY when the predicted body is the intended one. A near body that
 * occludes a far body's aim point is a SKIP, not a misattributed crater.
 *
 * The staged pose is restored afterwards; the arc is the scene the legs
 * measure, and no leg may inherit a wound-stamping camera.
 *
 * plan: woundPlan()'s output (with .body indices). opts: ids (the actor id
 * per body index, from stageMelee's .ids), playerPose (stageMelee's .pose),
 * eyeH (default 1.62 — the same constant the close-up staging aims with).
 *
 * Per body the readback reports the STAMP count, the wound ROW count
 * (visualWoundList().length — larger than the stamp count, and what the
 * shader actually pays for per-ray) and the OWNING LIMBS (wound.primIdx ->
 * posed().prims[primIdx].limb), so the crowd's wounds are provably spread
 * over limbs rather than piled on one hip.
 *
 * NO SEVER CHECK HERE: chunks > 0 means a limb was severed and the caller
 * must reload and retry with pelletsOnly(plan) — pure assertMeleeWounds()
 * reports it, the bench owns the retry (a reload re-boots the page, which
 * is the bench's connection, not this helper's).
 *
 * Returns { planned, landed, skips, chunks, bleed, perBody:
 *   [{ body, id, planned, landed, woundRows, visualRows, limbs }] }.
 */
export async function stampMeleeWounds(evaluate, plan, opts = {}, fail = failHard) {
  const ids = opts.ids;
  if (!ids || ids.length !== plan.length) {
    fail(`stampMeleeWounds: ids (${ids?.length ?? 'undefined'}) does not match plan bodies (${plan.length})`);
  }
  const eyeH = opts.eyeH ?? 1.62;
  const r = await evaluate(`(async () => {
    const plan = ${JSON.stringify(plan)};
    const ids = ${JSON.stringify(ids)};
    const eyeH = ${eyeH};
    const P = __sdfGame.pose();
    const px = P.pos[0], pz = P.pos[2];
    const perBody = [];
    const skips = [];
    let landed = 0, planned = 0, severed = false;
    outer:
    for (const p of plan) {
      const id = ids[p.body];
      const z = __sdfGame.zombie(id);
      if (!z) { skips.push({ body: p.body, reason: 'no actor ' + id }); continue; }
      const rec = { body: p.body, id, planned: p.targets.length, landed: 0 };
      planned += rec.planned;
      for (const t of p.targets) {
        const zb = __sdfGame.zombies().find((q) => q.id === id);
        if (!zb) { skips.push({ body: p.body, region: t.region, reason: 'actor gone' }); continue; }
        const bx = zb.pos[0], bz = zb.pos[2];
        const fx = bx - px, fz = bz - pz;
        const len = Math.hypot(fx, fz) || 1;
        const ux = fz / len, uz = -fx / len;   // perpendicular, plan's sign picks the flank
        const ax = bx + ux * t.lateral, az = bz + uz * t.lateral, ay = t.height;
        const yaw = Math.atan2(ax - px, -(az - pz));
        const pitch = Math.atan2(ay - eyeH, Math.hypot(ax - px, az - pz));
        __sdfGame.setPose(px, pz, yaw, pitch, 0);
        __sdfGame.step(3);
        const hit = __sdfGame.predictSlugHit();
        if (!hit.hit || hit.actorId !== id) {
          skips.push({ body: p.body, region: t.region, kind: t.kind,
            reason: !hit.hit ? 'no hit' : 'predicted body ' + hit.actorId + ' (occlusion)' });
          continue;
        }
        const ok = __sdfGame.stampWoundAt(hit.origin[0], hit.origin[1], hit.origin[2],
          hit.dir[0], hit.dir[1], hit.dir[2], t.kind, id);
        if (ok) { rec.landed++; landed++; }
        else skips.push({ body: p.body, region: t.region, reason: 'stampWoundAt returned null' });
        if (__sdfGame.chunkCount > 0) { severed = true; break outer; }
      }
      perBody.push(rec);
    }
    __sdfGame.setPose(px, pz, P.yaw, P.pitch, 0);
    __sdfGame.step(2);
    for (const rec of perBody) {
      const z = __sdfGame.zombie(rec.id);
      const wounds = z ? z.woundList() : [];
      const prims = z ? z.posed().prims : [];
      rec.limbs = [...new Set(wounds.map((w) => prims[w.primIdx]?.limb ?? 'unknown'))];
      rec.woundRows = wounds.length;
      rec.visualRows = z ? z.visualWoundList().length : 0;
    }
    return {
      planned, landed, skips, severed,
      chunks: __sdfGame.chunkCount,
      bleed: __sdfGame.bleed,
      perBody,
    };
  })()`);
  return r;
}

// ---------------------------------------------------------------------------
// missAnatomy — pure (miss-ray culling study, 2026-09-22)
// ---------------------------------------------------------------------------

/** WHERE the miss-ray steps are, over the same dense mode-4 buffer as
 *  censusFromTarget. Two views of the same question — "could a cull skip them":
 *
 *  - byDistance: miss steps bucketed by chessboard distance (march-target
 *    pixels) to the nearest HIT pixel. Distance 1-2 is the silhouette band
 *    (grazing rays, inherent); large distances are empty hull/proxy area.
 *  - emptyBlocks: for block sizes 4 and 8, the share of miss steps that sit in
 *    a block with NO hit pixel — the ceiling a perfect coarse-miss cull at that
 *    block size could remove (it would still pay the coarse pass).
 *
 *  Returns shares of TOTAL steps (hit + miss) so they read against the frame. */
export function missAnatomy(f32, w, h) {
  const n = w * h;
  const INF = 1 << 20;
  const dist = new Int32Array(n).fill(INF);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0, totalSteps = 0, missSteps = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (!(f32[o + 2] >= 0.5)) continue;
    totalSteps += f32[o];
    if (f32[o + 1] > 0.5) { dist[i] = 0; queue[qt++] = i; } else missSteps += f32[o];
  }
  while (qh < qt) {
    const i = queue[qh++], x = i % w, y = (i / w) | 0, d = dist[i] + 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] > d) { dist[j] = d; queue[qt++] = j; }
    }
  }
  const edges = [1, 2, 4, 8, 16, INF];
  const labels = ['1', '2', '3-4', '5-8', '9-16', '>16'];
  const buckets = new Float64Array(edges.length);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (!(f32[o + 2] >= 0.5) || f32[o + 1] > 0.5) continue;
    const d = dist[i];
    let b = 0; while (d > edges[b]) b++;
    buckets[b] += f32[o];
  }
  const emptyBlocks = {};
  for (const B of [4, 8]) {
    let s = 0;
    for (let by = 0; by < h; by += B) for (let bx = 0; bx < w; bx += B) {
      let anyHit = false, st = 0;
      for (let y = by; y < Math.min(by + B, h); y++) for (let x = bx; x < Math.min(bx + B, w); x++) {
        const o = (y * w + x) * 4;
        if (!(f32[o + 2] >= 0.5)) continue;
        if (f32[o + 1] > 0.5) anyHit = true; else st += f32[o];
      }
      if (!anyHit) s += st;
    }
    emptyBlocks[B] = totalSteps ? s / totalSteps : 0;
  }
  return {
    missStepShare: totalSteps ? missSteps / totalSteps : 0,
    byDistance: Object.fromEntries(labels.map((l, b) => [l, totalSteps ? buckets[b] / totalSteps : 0])),
    emptyBlocks,
  };
}

// ---------------------------------------------------------------------------
// costCensus — pure (cost-weighted census, 2026-09-22)
// ---------------------------------------------------------------------------

/** WHERE THE WORK IS, not where the steps are. The step census over-ranked miss
 *  rays: a step far from any body culls every cluster before evaluating a prim,
 *  so it is nearly free (the miss cull removed 36-41 % of steps for ~0.5 ms).
 *  This counts the inner-loop work instead, from two dense readbacks of the same
 *  frame:
 *    walk  = march debug mode 13 (before the discard; misses report)
 *    total = mode 14 (after the whole post-hit chain; hits only)
 *  Both: r = prim evaluations, g = wound rows walked, b = steps + 1000*hit +
 *  2000*(hit near a wound). post = total - walk, on hits.
 *
 *  Pixel classes: miss; wound (hit near a wound); silhouette (other hit with a
 *  non-hit 8-neighbour); interior (the rest). Per class: pixels, and the SHARE of
 *  all prim work / all wound-row work that class accounts for, split walk/post,
 *  plus per-pixel means. "Work" is reported both ways because a prim and a wound
 *  row are not the same price; neither is timed here. */
export function costCensus(walk, total, w, h) {
  const n = w * h;
  const cls = new Int8Array(n).fill(-1);            // -1 not rasterised, 0 miss, 1 interior, 2 silhouette, 3 wound
  const hit = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const b = walk[i * 4 + 2];
    // A real fragment took >= 1 step, so b >= 1; a never-rasterised texel holds the
    // scene CLEAR colour (b ~ 0.01, not 0 — measured 2026-09-22).
    if (!(b >= 0.5)) continue;
    const code = Math.floor(b / 1000);
    hit[i] = code >= 1 ? 1 : 0;
    cls[i] = code >= 3 ? 3 : code >= 1 ? 1 : 0;
  }
  for (let i = 0; i < n; i++) {
    if (cls[i] !== 1) continue;
    const x = i % w, y = (i / w) | 0;
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !hit[ny * w + nx]) { edge = true; break; }
    }
    if (edge) cls[i] = 2;
  }
  const names = ['miss', 'interior', 'silhouette', 'wound'];
  const acc = names.map(() => ({ px: 0, steps: 0, walkPrims: 0, walkRows: 0, postPrims: 0, postRows: 0 }));
  for (let i = 0; i < n; i++) {
    const c = cls[i];
    if (c < 0) continue;
    const o = i * 4, a = acc[c];
    a.px++;
    a.steps += walk[o + 2] % 1000;
    a.walkPrims += walk[o];
    a.walkRows += walk[o + 1];
    if (hit[i] && total[o + 2] >= 0.5) {
      a.postPrims += Math.max(0, total[o] - walk[o]);
      a.postRows += Math.max(0, total[o + 1] - walk[o + 1]);
    }
  }
  const sum = (k) => acc.reduce((s, a) => s + a[k], 0);
  const P = sum('walkPrims') + sum('postPrims'), R = sum('walkRows') + sum('postRows');
  const classes = Object.fromEntries(names.map((nm, c) => {
    const a = acc[c];
    return [nm, {
      px: a.px,
      primShare: { walk: P ? a.walkPrims / P : 0, post: P ? a.postPrims / P : 0 },
      rowShare: { walk: R ? a.walkRows / R : 0, post: R ? a.postRows / R : 0 },
      perPixel: {
        steps: a.px ? a.steps / a.px : 0,
        walkPrims: a.px ? a.walkPrims / a.px : 0, walkRows: a.px ? a.walkRows / a.px : 0,
        postPrims: a.px ? a.postPrims / a.px : 0, postRows: a.px ? a.postRows / a.px : 0,
      },
    }];
  }));
  return { totals: { prims: P, rows: R, walkPrims: sum('walkPrims'), postPrims: sum('postPrims'), walkRows: sum('walkRows'), postRows: sum('postRows') }, classes };
}
