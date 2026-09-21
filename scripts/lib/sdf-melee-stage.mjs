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
//     meleeLayout(n, {nearest, spacing, rows})  — staggered arc in front of
//       the camera, body 0's row exactly `nearest` m out, so bodies OVERLAP
//       on screen instead of lining up.
//     woundPlan(bodyCount, perBody)             — per body, aim targets on
//       DIFFERENT owner limbs (chest / head / one arm / one thigh), kinds
//       alternating slug/pellet with one safety: a slug stamps ONLY a chest,
//       because SLUG.severRadius 0.13 severs a limb or head in ONE hit
//       (game-weapon.ts) and a sever adds gib cost no leg asked for.
//     summariseBlocks(rows) / renderMarkdown(summary, staging)
//     censusFromTarget(float32, w, h)           — the mode-4 census.
//     assertMeleeWounds(record, {minLandedFrac})— the three loud checks.
//   browser-driving (take an `evaluate` from connectGame):
//     stageMelee(evaluate, opts)                — spawn an arc, ladder-search
//       it for the highest settled coverage.
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
// meleeLayout — pure
// ---------------------------------------------------------------------------

/**
 * Ground offsets (relative to the player, whose yaw-0 forward is -z — the
 * `setPose`/`teleport` convention) for `n` bodies in a staggered arc.
 *
 * `rows` arcs at distances nearest + r*rowGap (rowGap = max(0.6, 0.75*spacing)
 * — enough that the far row's chests clear the near row's heads at ~1.4 m),
 * bodies assigned round-robin (body i -> row i%rows), slots filled CENTRE-OUT
 * per row and odd rows offset half a slot over so the rows STAGGER: each far
 * body peeks through a gap of the near row instead of hiding behind it.
 * Slot angle = slot / d_r, so each row is an ARC centred on the player —
 * every body of a row stands exactly d_r metres away and the row wraps
 * gently around the camera the way a melee crowd does, rather than reading
 * as a firing squad.
 *
 * Deterministic: same (n, opts) -> same array. Body 0 is always row 0.
 * Returns [{ x, z, dist, theta, row }] ordered by body index; x/z are
 * offsets to ADD to the player's ground position.
 */
export function meleeLayout(n, opts = {}) {
  const nearest = opts.nearest ?? 1.4;
  const spacing = opts.spacing ?? 0.9;
  if (!(n > 0)) return [];
  const rows = Math.max(1, Math.min(opts.rows ?? 2, n));
  const rowGap = Math.max(0.6, spacing * 0.75);
  // Centre-out slot order [0, 1, -1, 2, -2, ...]: body 0 stands straight
  // ahead at exactly `nearest` (the coverage anchor), then the row fills
  // symmetrically outward. Deterministic.
  const centreOut = (k) => (((k + 1) >> 1) * ((k % 2 === 0) ? 1 : -1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = i % rows;
    const d = nearest + row * rowGap;
    const slot = centreOut(Math.floor(i / rows)) - (row % 2 === 1 ? 0.5 : 0);
    const theta = slot * (spacing / d);
    out.push({
      x: Math.sin(theta) * d,
      z: -Math.cos(theta) * d,
      dist: d,
      theta,
      row,
    });
  }
  return out;
}

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
      targets.push({ region: def.region, height: def.height, lateral: def.lateral * side, kind });
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
  L.push('| bodies | nearest | spacing | coverage | rasterised | bodies on screen | room |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  L.push(`| ${staging.n} | ${fmt(staging.nearest)} m | ${fmt(staging.spacing)} m | ${(staging.coverage * 100).toFixed(1)}% | ${(staging.rasterisedFrac ?? 0).toFixed(3)} | ${staging.bodiesOnScreen} | ${staging.room} |`);
  L.push('');
  if (staging.ladder?.length) {
    const key = (r) => (r.dist !== undefined ? `${r.dist} m` : `${r.nearest}/${r.spacing}`);
    L.push(`Ladder tried (camera dist -> coverage): ${staging.ladder.map((r) => `${key(r)} -> ${(r.coverage * 100).toFixed(1)}%`).join(', ')}`);
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

/** Camera framing ladder: distances (m) from the camera to the NEAREST ROW,
 *  tried first-to-last, keeping the rung with the highest settled coverage.
 *  The BODIES never move during the search — placement happens once (see
 *  stageMelee) and only the player pose steps back and forth, exactly like
 *  the close-up stage's tryPose ladder. Re-aiming bodies between rungs was
 *  tried and failed: canTravel refuses hops into the packed arc, so rungs
 *  silently read bit-identical stale coverage. */
export const MELEE_LADDER = [1.0, 0.9, 1.15, 1.3, 1.5];

/** Aim height (m) for the staged pose: chest height, so the crush fills the
 *  frame with the bodies' expensive middle rather than the floor. */
const AIM_Y = 1.1;

/**
 * Stage the melee scene: the room's BOOT bodies moved ONCE into a tight
 * staggered arc (a crush — bodies overlap on screen), then the camera
 * ladder-searched for the highest settled flesh coverage of the march target.
 *
 * WHY BOOT BODIES, NOT SPAWNED ONES (measured 2026-09-21, probes in
 * docs/dev-notes/2026-09-21-melee-harness/NOTES.md): a body added after boot
 * through spawnDebugCharacter renders its skeleton meshes but NEVER marches
 * flesh — and worse, ONE spawn dropped the WHOLE scene's flesh hits to zero
 * (base h 16486 -> 0 with the proxy raster unchanged), recovering on no seam
 * poke (depth-gate re-show, visible force, dispatch re-stamp). The shipped
 * game spawns every actor at boot, so it never hits this; the harness must
 * not either. Boot bodies march fine in every room.
 *
 * HOW THE BODIES MOVE. zombieNudge(id, dx, dz) is the sanctioned placement
 * seam, but it REFUSES a hop when the room's navigation canTravel() says no
 * or the hop lands in furniture — so a long teleport-by-nudge silently
 * fails. stageMelee walks each body to its slot in SHORT hops (<= 0.6 m,
 * re-reading the true position each hop, jittering the heading when a hop is
 * refused) and VERIFIES the landing: bodies that never arrive are reported
 * in placement (err), never silently trusted.
 *
 * THE ATLAS RACE. Each crowd type's colour atlas flushes lazily on its first
 * need; reads before the flush show proxy boxes with ZERO flesh hits for
 * that type (the same 0-hits signature as the spawn poison). warmTypes
 * therefore polls crowdInfo() until every attached type has flushed before
 * the first measurement.
 *
 * opts: room (default 6 — the arena: the only 16x16 m room, the horde room,
 * and the room whose north spawn band gives 6+ boot bodies within short nudge
 * range of one arc), n (6; the room must BOOT that many bodies), rows
 * (default 3 for n >= 5 else 2 — a crush, not a firing squad), spacing
 * (default 0.65 — bodies overlap on screen; the brief IS several bodies
 * close together), nearest (default 1.4 — the nearest row's distance from
 * the player anchor), playerX/playerZ/playerYaw (the arc anchor; default:
 * the teleport(room) centre, yaw kept), ladder (camera distances),
 * settleTries (env MELEE_SETTLE_TRIES; a FIRST cold boot wants 2400), fail.
 *
 * Returns the staging record: { n, room, enclosure, dist (kept camera
 * distance), coverage, rasterised, bodiesOnScreen, pose, ids, placement,
 * ladder }.
 */
export async function stageMelee(evaluate, opts = {}, fail = failHard) {
  const room = opts.room ?? 6;
  const n = opts.n ?? 6;
  const rows = opts.rows ?? (n >= 5 ? 3 : 2);
  const spacing = opts.spacing ?? 0.65;
  const nearest = opts.nearest ?? 1.4;
  const settleTries = Number(opts.settleTries ?? process.env.MELEE_SETTLE_TRIES ?? 30);
  const ladder = opts.ladder ?? MELEE_LADDER;
  // Node-side layout: the pure meleeLayout is the single source of the arc,
  // and the page receives finished ground offsets (no JS duplicate to drift).
  const points = meleeLayout(n, { nearest, spacing, rows });
  const playerX = opts.playerX ?? null;
  const playerZ = opts.playerZ ?? null;
  const playerYaw = opts.playerYaw ?? null;
  const staged = await evaluate(`(async () => {
    const n = ${n};
    const points = ${JSON.stringify(points)};
    const ladder = ${JSON.stringify(ladder)};
    const AIM_Y = ${AIM_Y};
    const roomOk = __sdfGame.teleport(${room});
    if (!roomOk) return { error: 'teleport(${room}) refused — no such room' };
    __sdfGame.freeze(true);
    const p0 = __sdfGame.pose();
    const px = ${JSON.stringify(playerX)} ?? p0.pos[0];
    const pz = ${JSON.stringify(playerZ)} ?? p0.pos[2];
    const pyaw = ${JSON.stringify(playerYaw)} ?? p0.yaw;
    const aimPose = (dist) => {
      // The camera stands ` + '`' + `dist` + '`' + ` m BEHIND the nearest row: pull the anchor
      // back along +forward (forward is -z at yaw 0, so behind is +z).
      const bx = px - Math.sin(pyaw) * dist;
      const bz = pz + Math.cos(pyaw) * dist;
      const pitch = Math.atan2(AIM_Y - 1.62, dist);
      __sdfGame.setPose(bx, bz, pyaw, pitch, 0);
      return { pos: [bx, bz], yaw: pyaw, pitch };
    };
    aimPose(1.5); // park the camera back from the start: bodies hop in while the player stands clear
    const enclosure = __sdfGame.placePlayer({ x: px, z: pz, yaw: pyaw, pitch: 0 });
    // Boot cast of this room.
    const boot = __sdfGame.zombies().filter((q) => q.room === ${room});
    if (boot.length < n) {
      return { error: 'room ' + ${room} + ' boots only ' + boot.length + ' bodies, want ' + n
        + ' — spawned bodies do not march flesh (2026-09-21 probe); lower MELEE_BODIES or pick a room with a bigger boot cast' };
    }
    // WARM THE TYPES: every attached crowd type's atlas must have flushed at
    // least once, or that type's bodies rasterise proxies with zero hits.
    for (let i = 0; i < 90; i++) {
      const ci = __sdfGame.crowdInfo();
      const pending = ci.types.filter((t) => t.attached > 0 && t.atlasFlushes === 0);
      if (pending.length === 0) break;
      __sdfGame.step(6);
      await new Promise((r) => setTimeout(r, 200));
    }
    // Gentle verified hop toward (tx, tz); returns the landed residual. A
    // refused hop retries with a rotated heading (canTravel/furniture reject
    // straight lines through blocked cells; a sidestep often passes).
    const hopTo = (id, tx, tz) => {
      const MAX_HOP = 0.6;
      let cur = __sdfGame.zombies().find((q) => q.id === id);
      for (let hop = 0; hop < 60; hop++) {
        const dx = tx - cur.pos[0], dz = tz - cur.pos[2];
        const dist = Math.hypot(dx, dz);
        if (dist < 0.12) break;
        const step = Math.min(MAX_HOP, dist);
        const ux = dx / dist, uz = dz / dist;
        const before = [cur.pos[0], cur.pos[2]];
        __sdfGame.zombieNudge(id, ux * step, uz * step);
        __sdfGame.step(1);
        cur = __sdfGame.zombies().find((q) => q.id === id);
        if (Math.hypot(cur.pos[0] - before[0], cur.pos[2] - before[1]) < step * 0.25) {
          for (const ang of [0.7, -0.7, 1.4, -1.4]) {
            const jx = Math.cos(ang) * ux - Math.sin(ang) * uz;
            const jz = Math.sin(ang) * ux + Math.cos(ang) * uz;
            __sdfGame.zombieNudge(id, jx * step, jz * step);
            __sdfGame.step(1);
            cur = __sdfGame.zombies().find((q) => q.id === id);
            if (Math.hypot(cur.pos[0] - before[0], cur.pos[2] - before[1]) >= step * 0.25) break;
          }
        }
      }
      return Math.hypot(tx - cur.pos[0], tz - cur.pos[2]);
    };
    // Pair slots to boot bodies greedily by world distance, then hop each
    // body to its slot ONCE. Slots landing > 0.45 m off are reported.
    const slots = points
      .map((pt, i) => ({ i, wx: px + pt.x, wz: pz + pt.z }))
      .sort((a, b) => (Math.hypot(a.wx - px, a.wz - pz) - Math.hypot(b.wx - px, b.wz - pz)));
    const pool = boot.map((q) => ({ id: q.id, pos: q.pos }));
    const pair = [];
    for (const s of slots) {
      let bi = -1, bd = Infinity;
      for (let k = 0; k < pool.length; k++) {
        const d = Math.hypot(pool[k].pos[0] - s.wx, pool[k].pos[2] - s.wz);
        if (d < bd) { bd = d; bi = k; }
      }
      pair.push({ slot: s.i, id: pool[bi].id });
      pool.splice(bi, 1);
    }
    const placement = [];
    for (const p of pair) {
      const pt = points[p.slot];
      const err = await hopTo(p.id, px + pt.x, pz + pt.z);
      placement.push({ id: p.id, err: +err.toFixed(3) });
    }
    const ids = pair.map((p) => p.id);
    const SETTLE_TRIES = ${settleTries};
    const settledOcc = async () => {
      let occ = await __sdfGame.occupancy();
      let prevSig = null;
      for (let t = 0; t < SETTLE_TRIES && !(occ.rasterised > 0 && occ.hits + ':' + occ.rasterised === prevSig); t++) {
        prevSig = occ.hits + ':' + occ.rasterised;
        await new Promise((r) => setTimeout(r, 250));
        occ = await __sdfGame.occupancy();
      }
      return occ;
    };
    let best = null;
    const ladderOut = [];
    for (const dist of ladder) {
      aimPose(dist);
      __sdfGame.step(4);
      const occ = await settledOcc();
      if (!(occ.rasterised > 0)) return { error: 'occupancy never went live on the ladder (cold compile? MELEE_SETTLE_TRIES=2400)' };
      const cov = occ.hits / (occ.targetW * occ.targetH);
      ladderOut.push({ dist, coverage: cov, bodiesOnScreen: occ.bodiesOnScreen });
      if (!best || cov > best.cov) best = { dist, cov, occ };
    }
    aimPose(best.dist);
    __sdfGame.step(2);
    return {
      n, room: ${room}, enclosure,
      dist: best.dist, nearest, spacing,
      coverage: best.cov,
      rasterised: best.occ.rasterised / (best.occ.targetW * best.occ.targetH),
      bodiesOnScreen: best.occ.bodiesOnScreen,
      pose: __sdfGame.pose(),
      ids,
      placement,
      ladder: ladderOut,
    };
  })()`);
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
