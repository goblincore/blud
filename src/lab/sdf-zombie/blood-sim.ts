// src/lab/sdf-zombie/blood-sim.ts
//
// Pure droplet simulation for the lab's gib blood: FX_13-style burst at the
// gib instant, FX_27-style trails behind flying chunks, splat stamps on
// settle, and heavy scrap hunks riding the same sim (gobs-and-goo §1). All
// tuning comes from the GAME's playtested constants — imported, never
// copied, so the lab and game cannot drift (X1 follow-up: converge the
// lab on Blud's own gib logic). No three import: renderer views live per path.
//
// WOUND BLEED EMITTERS (bleeding-wounds spec, 2026-08-31) live here too —
// per-calibre oozing/spurting/gushing from wounds on the GAME page. Purely
// additive beside the burst/trail/splat paths above them: the lab consumes
// those and must stay bit-identical, so nothing below touches them.
import type { Vec3 } from './types';
import { BLOOD_TRAIL, GIB_BURST, BLOOD_SPLAT } from '../../game/gibs/tuning';
import { add, basisFromAxis, dot, normalize, scale } from './vec';
import { curlAccelAt, type CurlFlow } from './curl-sample';

const MAX_DROPLETS = 600;
const MAX_SPLATS = 256;

/** Path samples a bead keeps for its ribbon — ~0.15 s of arc at 60 Hz.
 *  Short on purpose: a streak, not a snake. */
export const TRAIL_HIST = 9;

/** Mutable xyz — droplets integrate in place each frame (Vec3 is readonly). */
type MutVec3 = [number, number, number];

export interface Droplet {
  pos: MutVec3;
  vel: MutVec3;
  age: number;
  life: number;
  size: number;
  /** 'drop' = bead (burst/trails/bleed); 'scrap' = heavy amorphous hunk;
   *  'mist' = fine short-lived spray haze (bleed only — evaporates, never
   *  stamps a splat, triple drag so it hangs then dies in place);
   *  'gut' = a node of an entrails chain — POSITION IS OWNED BY
   *  `entrails.ts`, so stepBlood must skip it entirely: no integration, no
   *  ageing, no floor cull, no splat. It exists in the sim only so the goo
   *  layer draws it. */
  kind: 'drop' | 'scrap' | 'mist' | 'gut';
  /** Recent path samples, oldest first, newest last — appended by stepBlood
   *  for beads, capped at TRAIL_HIST. The ribbon renderer (X1.bleed-look:
   *  owner asked for "cohesive lines of fluid", not particles) sweeps a
   *  tapered strip through these. Optional so lab fixtures and older
   *  constructors need not carry it; renderers ignore it unless asked. */
  hist?: [number, number, number][];
  /** Marks a WOUND-BLEED bead as ribbon-eligible. Burst/trail beads stay
   *  sprites: at gib speeds (6-8 m/s) a 0.15 s path is a straight metre of
   *  line — rendered as a ribbon it reads as a laser rod, not fluid. Only
   *  the slower bleed streams arc enough to read as liquid. */
  ribbon?: boolean;
  /**
   * STABLE EMITTER IDENTITY. Every droplet an emitter spawns carries the id
   * of that emitter: one wound, one impact, one trail source. It is assigned
   * by the CALLER (game-main / the comparison page), is never rolled, and is
   * never read by the physics — stepBlood ignores it, so the baseline sim
   * stays bit-identical.
   *
   * It exists for blood-connections.ts, whose whole rule is that only
   * droplets from the SAME stream may fuse: a connection must never be
   * invented from proximity between two unrelated wounds. Droplets with no
   * stream (lab bursts, old fixtures) are explicitly UNTAGGED and are
   * skipped by the connection builder rather than guessed at.
   */
  stream?: number;
}

// Scrap feel knobs (gobs-and-goo §1): scraps are the amorphous meat bits
// makeGobs emits at a full gib. They share the droplet sim but must read as
// heavy and SLOW — half the launch band, double the drag, brief arcs, and a
// floor pool wider than a bead's because a hunk of meat squashes wider.
export const SCRAP_TUNING = {
  /** Seconds a scrap arcs before it settles/expires. */
  lifetimeSec: 6,
  /** Airdrag multiplier vs a droplet — chunky things shed speed fast. */
  dragMul: 2,
  /** Splat size multiplier — scraps stamp wider floor pools. */
  splatScale: 2.2,
  /** Launch band as a fraction of the GIB_BURST speed band. */
  speedBandScale: 0.5,
} as const;

export interface Splat { pos: Vec3; size: number; yaw: number }

export interface BloodSim {
  droplets: Droplet[];
  splats: Splat[];
  /** Per-source emission clocks, keyed by chunk id. */
  clocks: Record<number, number>;
}

export function createBloodSim(): BloodSim {
  return { droplets: [], splats: [], clocks: {} };
}

function push(sim: BloodSim, d: Droplet): void {
  sim.droplets.push(d);
  while (sim.droplets.length > MAX_DROPLETS) sim.droplets.shift();
}

/** FX_13-style radial spray at a gib/sever instant. `stream` is the caller's
 *  stable emitter id (optional; untagged droplets are skipped by
 *  blood-connections). It is written to every spawned droplet and does not
 *  touch the RNG stream. */
export function burst(sim: BloodSim, origin: Vec3, rng: () => number, stream?: number): void {
  for (let i = 0; i < GIB_BURST.count; i++) {
    const theta = rng() * Math.PI * 2;
    const speed = GIB_BURST.speedMin + rng() * (GIB_BURST.speedMax - GIB_BURST.speedMin);
    const up = 0.4 + rng() * 0.8;
    push(sim, {
      pos: [origin[0], origin[1], origin[2]],
      vel: [Math.cos(theta) * speed, up * speed * 0.6, Math.sin(theta) * speed],
      age: 0,
      life: GIB_BURST.lifetimeSec,
      // Small beads, not orbs: the lab camera sits close and burst drops
      // read half-size vs the game's distances (playtest 2026-08-16).
      size: 0.03 + rng() * 0.03,
      kind: 'drop',
      ...(stream !== undefined ? { stream } : {}),
    });
  }
}

/** A scrap spawn from gobs.ts — kept structural so gobs.ts need not import. */
export interface ScrapSpawn { pos: Vec3; size: number }

/**
 * Launches gobs' scraps as heavy slow particles: each flies radially AWAY
 * from the body centre at half the burst speed band with the burst up-bias,
 * living SCRAP_TUNING.lifetimeSec under double drag — they arc out and plop
 * into the spray rather than jetting like the mist.
 */
export function addScraps(
  sim: BloodSim, scraps: ScrapSpawn[], origin: Vec3, rng: () => number, stream?: number,
): void {
  for (const s of scraps) {
    const dx = s.pos[0] - origin[0];
    const dz = s.pos[2] - origin[2];
    const hl = Math.hypot(dx, dz);
    // Radial-away in the horizontal plane; a scrap sitting on the centre
    // axis falls back to a random azimuth (the burst's own direction shape).
    const theta = rng() * Math.PI * 2;
    const dirX = hl > 1e-6 ? dx / hl : Math.cos(theta);
    const dirZ = hl > 1e-6 ? dz / hl : Math.sin(theta);
    const speed = SCRAP_TUNING.speedBandScale
      * (GIB_BURST.speedMin + rng() * (GIB_BURST.speedMax - GIB_BURST.speedMin));
    const up = 0.4 + rng() * 0.8;
    push(sim, {
      pos: [s.pos[0], s.pos[1], s.pos[2]],
      vel: [dirX * speed, up * speed * 0.6, dirZ * speed],
      age: 0,
      life: SCRAP_TUNING.lifetimeSec,
      size: s.size,
      kind: 'scrap',
      ...(stream !== undefined ? { stream } : {}),
    });
  }
}

export interface TrailSource {
  id: number;
  pos: Vec3;
  vel: Vec3;
  /** Stable stream id for this trail source (the chunk's own id, namespaced
   *  by the caller). Optional; untagged trail droplets are skipped by the
   *  connection builder. */
  stream?: number;
}

/** FX_27-style droplet trails behind flying chunks: 20 Hz, 1/256 inheritance. */
export function emitTrails(
  sim: BloodSim, sources: TrailSource[], dt: number, rng: () => number,
): void {
  const period = 1 / BLOOD_TRAIL.emitHz;
  // Epsilon guards against float drift: e.g. subtracting period twenty times
  // from 1.0 leaves 0.049999…96, which would silently drop the 20th emission.
  const eps = 1e-9;
  const live = new Set<number>();
  for (const s of sources) {
    live.add(s.id);
    let clock = (sim.clocks[s.id] ?? 0) + dt;
    while (clock >= period - eps) {
      clock -= period;
      push(sim, {
        pos: [s.pos[0], s.pos[1], s.pos[2]],
        vel: [
          s.vel[0] * BLOOD_TRAIL.velScale + (rng() - 0.5) * 0.4,
          s.vel[1] * BLOOD_TRAIL.velScale + (rng() - 0.5) * 0.4,
          s.vel[2] * BLOOD_TRAIL.velScale + (rng() - 0.5) * 0.4,
        ],
        age: 0,
        life: BLOOD_TRAIL.lifetimeSec,
        size: BLOOD_TRAIL.size * (0.7 + rng() * 0.6),
        kind: 'drop',
        ...(s.stream !== undefined ? { stream: s.stream } : {}),
      });
    }
    sim.clocks[s.id] = clock;
  }
  for (const key of Object.keys(sim.clocks)) {
    if (!live.has(Number(key))) delete sim.clocks[Number(key)];
  }
}

// ---------------------------------------------------------------------------
// Wound bleed emitters (bleeding-wounds spec, 2026-08-31)
//
// A wound on the game page oozes/spurts/gushes per its calibre. Spawn
// decisions ONLY happen here — the caller owns anchors (recomputed each
// frame from the posed body via woundWorldPos, so blood rides the walking
// body) and owns the fractional accumulator between frames (returned).
// Every draw goes through the caller's seeded rng so tests pin counts.
// ---------------------------------------------------------------------------

export type BleedKind = 'pellet' | 'slug' | 'stump';

export interface WoundBleedProfile {
  /** Droplets per second at birth. */
  baseHz: number;
  /** Droplets per second the rate decays to — the drip the wound settles into. */
  tailHz: number;
  /** Exponential decay time constant for baseHz -> tailHz, seconds. */
  decayTauSec: number;
  /** Emit lifetime: past this age the emitter is dead (the registry drops it). */
  lifetimeSec: number;
  /** Cone HALF-angle around the emit normal, radians — uniform in disc. */
  coneRad: number;
  /** Launch speed band, m/s. Gravity (BLOOD_TRAIL.gravity) arcs it from there. */
  speedMin: number;
  speedMax: number;
  /** Droplet sprite size band, m — GAME-camera scale (the lab's
   *  DROPLET_VIEW_SCALE compensation does NOT apply to these). */
  sizeMin: number;
  sizeMax: number;
  /** Mist particles spawned alongside EACH bead (owner ask 2026-08-31: finer
   *  mist around the spray, not just oval cells). */
  mistPerDrop: number;
  /** Mist size as a fraction of the bead's rolled size. */
  mistSizeScale: number;
  /** Mist lifetime — short; it evaporates rather than landing. */
  mistLifeSec: number;
  /** Mist launch speed as a fraction of the bead's rolled speed. */
  mistSpeedScale: number;
}

/** Per-calibre bleed tuning — the panel and tests share this one table
 *  (spec: "constants in one exported table"). Pellet = short dribble and
 *  dead in ~2 s; slug = heavy spurt decaying to a drip over ~6 s; stump =
 *  the arcing gush, ~10 s. Burn wounds do not bleed (charred) — no entry
 *  by construction. */
export const WOUND_BLEED: Record<BleedKind, WoundBleedProfile> = {
  // DENSITY IS THE LOOK (X1.bleed-look round 2). The metaball fuses
  // neighbours whose density peaks overlap, so a stream reads as a connected
  // rope only when its droplets are packed tighter than a blob radius apart.
  // Measured 2026-08-31: at the old rates the goo fused only right at the
  // wound and every spread droplet stayed a discrete bead — correct metaball
  // behaviour, wrong picture. So the bleed profiles now trade DROPLET SIZE
  // for DROPLET COUNT (~2.5x the rate, smaller beads), and narrow the cone
  // and the speed spread so a stream stays a stream instead of fanning into
  // isolated specks. Reference: dense continuous jets, not sparse spray.
  pellet: {
    baseHz: 18, tailHz: 18, decayTauSec: 1, lifetimeSec: 2,
    coneRad: 0.32, speedMin: 0.5, speedMax: 0.9, sizeMin: 0.07, sizeMax: 0.11,
    mistPerDrop: 1, mistSizeScale: 0.35, mistLifeSec: 0.35, mistSpeedScale: 0.7,
  },
  slug: {
    baseHz: 110, tailHz: 4, decayTauSec: 0.45, lifetimeSec: 6,
    coneRad: 0.2, speedMin: 1.1, speedMax: 1.7, sizeMin: 0.1, sizeMax: 0.15,
    mistPerDrop: 2, mistSizeScale: 0.3, mistLifeSec: 0.45, mistSpeedScale: 0.65,
  },
  stump: {
    baseHz: 220, tailHz: 12, decayTauSec: 1.4, lifetimeSec: 10,
    coneRad: 0.3, speedMin: 1.5, speedMax: 2.4, sizeMin: 0.12, sizeMax: 0.18,
    mistPerDrop: 2, mistSizeScale: 0.3, mistLifeSec: 0.5, mistSpeedScale: 0.6,
  },
};

export interface ImpactGoutProfile {
  /** Droplets emitted in ONE call. Density is the whole point: a stream
   *  spread over time never overlaps enough for the metaball to fuse, and
   *  the same blood fired as one packed pulse does. */
  count: number;
  /** Cone HALF-angle around the BACKWARD axis, radians. */
  coneRad: number;
  /** Head speed — droplet 0. */
  speedMax: number;
  /** Tail speed — the last droplet. */
  speedMin: number;
  lifeMin: number;
  lifeMax: number;
  sizeMin: number;
  sizeMax: number;
}

/**
 * Per-calibre impact gouts (blood-viscosity spec §a). Fired ONCE at the
 * moment a projectile lands, and once per sever — not a rate.
 *
 * Counts are budgeted against MAX_DROPLETS (600): a shotgun lands 8 pellets
 * at one instant, so `pellet.count * 8` must fit or the blast evicts itself
 * mid-spawn and reads as a single gout instead of eight.
 */
export const IMPACT_GOUT: Record<BleedKind, ImpactGoutProfile> = {
  pellet: {
    count: 14, coneRad: 0.9, speedMax: 5.5, speedMin: 1.2,
    lifeMin: 0.35, lifeMax: 0.7, sizeMin: 0.05, sizeMax: 0.1,
  },
  // Owner's tuned values, 2026-08-31: a nearly STATIONARY gout. At the
  // original 8 m/s the pulse was metres wide within two frames and read as a
  // starburst of needles; at 0.5 it stays where it was born and holds together.
  slug: {
    count: 85, coneRad: 0.7, speedMax: 0.5, speedMin: 0.2,
    lifeMin: 0.4, lifeMax: 0.9, sizeMin: 0.06, sizeMax: 0.14,
  },
  stump: {
    count: 140, coneRad: 1, speedMax: 7, speedMin: 1.5,
    lifeMin: 0.5, lifeMax: 1, sizeMin: 0.07, sizeMax: 0.16,
  },
};

/** Wound droplets die like any mist bead (then cascade into splats). */
const WOUND_DROPLET_LIFE = BLOOD_TRAIL.lifetimeSec;

/** Spawned 2 cm out along the emit direction so a droplet's first frame is
 *  already off the skin (a sprite spawning ON the surface pixel reads as a
 *  flesh flicker at wound size). */
const WOUND_SPAWN_OFFSET = 0.02;

/**
 * One emitter's frame: spawns this step's droplets for ONE wound of `kind`
 * at `ageSec` emitter age, anchored at `anchor`, spraying in a cone around
 * `normal`. PURE — no sim clocks; returns the updated fractional remainder,
 * which the caller must feed back in next frame (rates below 1/step must
 * still emit eventually). Dead past the profile's lifetime; draws exactly
 * 4 rng values per droplet in a fixed order, so seeded streams pin it.
 */
export function spawnWoundDroplets(
  sim: BloodSim, kind: BleedKind, ageSec: number,
  anchor: Vec3, normal: Vec3, dt: number, acc: number, rng: () => number,
  stream?: number,
): number {
  const p = WOUND_BLEED[kind];
  if (ageSec > p.lifetimeSec || dt <= 0) return acc;
  const rate = p.tailHz + (p.baseHz - p.tailHz) * Math.exp(-ageSec / p.decayTauSec);
  const carry = acc + rate * dt;
  const count = Math.floor(carry);
  if (count <= 0) return carry;
  // Orthonormal frame around the emit axis: w along it, u/v perpendicular —
  // the same basis construction damage.ts's frame() uses.
  const axis = normalize(Math.hypot(normal[0], normal[1], normal[2]) < 1e-9 ? [0, 1, 0] as Vec3 : normal);
  const { u, v, w } = basisFromAxis(axis);
  for (let i = 0; i < count; i++) {
    // Uniform-in-disc cone sample (r = θmax·sqrt(u)), matching the house
    // spreadDirections pattern — flat density, not centre-crowded.
    const r = p.coneRad * Math.sqrt(rng());
    const theta = rng() * Math.PI * 2;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const dir = normalize(add(add(scale(w, cr), scale(u, Math.cos(theta) * sr)), scale(v, Math.sin(theta) * sr)));
    const speed = p.speedMin + rng() * (p.speedMax - p.speedMin);
    const size = p.sizeMin + rng() * (p.sizeMax - p.sizeMin);
    push(sim, {
      pos: [anchor[0] + dir[0] * WOUND_SPAWN_OFFSET,
        anchor[1] + dir[1] * WOUND_SPAWN_OFFSET, anchor[2] + dir[2] * WOUND_SPAWN_OFFSET],
      vel: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
      age: 0,
      life: WOUND_DROPLET_LIFE,
      size,
      kind: 'drop',
      ribbon: true,
      ...(stream !== undefined ? { stream } : {}),
    });
    // MIST — fine spray haze riding each bead (X1.bleed-look, owner ask):
    // spawned around the bead's own direction with a wider scatter, smaller,
    // short-lived, and it evaporates (stepBlood skips its splat). Exactly 3
    // rng draws per mist particle, AFTER the bead's 4, so seeded streams
    // stay pinnable: a bead costs 4 + 3*mistPerDrop draws.
    for (let mi = 0; mi < p.mistPerDrop; mi++) {
      const mTheta = rng() * Math.PI * 2;
      const mR = 0.25 * Math.sqrt(rng());
      const mSpeed = speed * p.mistSpeedScale * (0.6 + rng() * 0.8);
      const mDir = normalize(add(dir, add(scale(u, Math.cos(mTheta) * mR), scale(v, Math.sin(mTheta) * mR))));
      push(sim, {
        pos: [anchor[0] + mDir[0] * WOUND_SPAWN_OFFSET,
          anchor[1] + mDir[1] * WOUND_SPAWN_OFFSET, anchor[2] + mDir[2] * WOUND_SPAWN_OFFSET],
        vel: [mDir[0] * mSpeed, mDir[1] * mSpeed, mDir[2] * mSpeed],
        age: 0,
        life: p.mistLifeSec,
        size: size * p.mistSizeScale,
        kind: 'mist',
        // Mist is never a connection node, but it carries the tag so a
        // consumer never has to guess which emitter a haze particle
        // belonged to.
        ...(stream !== undefined ? { stream } : {}),
      });
    }
  }
  return carry - count;
}

/**
 * One impact's gout: the whole pulse in a single call, sprayed BACK along
 * the incoming direction (blood comes toward the shooter, which also means
 * toward the camera — the read overlay mode exists to deliver).
 *
 * PURE. Draws exactly 4 rng values per droplet in a fixed order (cone r,
 * cone theta, size, life), so seeded streams pin it.
 *
 * SPEED IS A DETERMINISTIC RAMP, not a random band: droplet 0 leaves at
 * speedMax and the last at speedMin, so the pulse STRETCHES along its axis
 * into an arcing rope. Jittering it collapses the rope back into a ball —
 * in the 2D prototype that was the entire difference between "one pink
 * blob" and the reference look.
 */
export function spawnImpactGout(
  sim: BloodSim, kind: BleedKind, anchor: Vec3, dirN: Vec3, rng: () => number,
  stream?: number,
): void {
  const p = IMPACT_GOUT[kind];
  // Back along the shot. A zero/degenerate direction falls back to straight
  // up, the same guard spawnWoundDroplets uses for a degenerate normal.
  const back: Vec3 = [-dirN[0], -dirN[1], -dirN[2]];
  const axis = normalize(
    Math.hypot(back[0], back[1], back[2]) < 1e-9 ? [0, 1, 0] as Vec3 : back,
  );
  const { u, v, w } = basisFromAxis(axis);
  for (let i = 0; i < p.count; i++) {
    const r = p.coneRad * Math.sqrt(rng());
    const theta = rng() * Math.PI * 2;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const dir = normalize(add(add(scale(w, cr), scale(u, Math.cos(theta) * sr)), scale(v, Math.sin(theta) * sr)));
    const size = p.sizeMin + rng() * (p.sizeMax - p.sizeMin);
    const life = p.lifeMin + rng() * (p.lifeMax - p.lifeMin);
    const t = p.count > 1 ? i / (p.count - 1) : 0;
    const speed = p.speedMax + (p.speedMin - p.speedMax) * t;
    push(sim, {
      pos: [anchor[0] + dir[0] * WOUND_SPAWN_OFFSET,
        anchor[1] + dir[1] * WOUND_SPAWN_OFFSET, anchor[2] + dir[2] * WOUND_SPAWN_OFFSET],
      vel: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
      age: 0,
      life,
      size,
      kind: 'drop',
      // NOT ribbon-eligible: at gout speeds a 0.15 s path history is a
      // straight metre of line, which renders as a laser rod, not fluid.
      ...(stream !== undefined ? { stream } : {}),
    });
  }
}

function stamp(sim: BloodSim, at: Vec3, rng: () => number, kind: 'drop' | 'scrap' = 'drop'): void {
  const scale = kind === 'scrap' ? SCRAP_TUNING.splatScale : 1;
  const ox = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  const oz = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  sim.splats.push({ pos: [at[0] + ox, 0, at[2] + oz], size: (0.12 + rng() * 0.18) * scale, yaw: rng() * Math.PI * 2 });
  // Raised second-pool chance, same knob the game uses (0xB000 / 0x10000).
  if (rng() < BLOOD_SPLAT.secondChance / 0x10000) {
    sim.splats.push({
      pos: [at[0] - ox * 0.6, 0, at[2] - oz * 0.6],
      size: (0.1 + rng() * 0.12) * scale, yaw: rng() * Math.PI * 2,
    });
  }
  while (sim.splats.length > MAX_SPLATS) sim.splats.shift();
}

/**
 * Integrate droplets; floor hits and expiry both stamp splats (cascade).
 *
 * `flow` is OPTIONAL. When supplied with a non-zero `strength`, every AIRBORNE
 * droplet (drop, mist, scrap — everything except the chain-owned `gut` kind)
 * gets the shared curl volume's vector at its own position added as an
 * acceleration: `vel += curl(pos / scale + time * drift) * strength * dt`. The
 * curl field is divergence-free, so neighbouring droplets get near-identical
 * vectors and a spray advects as one connected volume instead of N particles
 * (blood-curl-spike; the wildfire teardown's §2 idea,
 * docs/dev-notes/2026-09-18-wildfire-fire-teardown.md).
 *
 * BYTE-IDENTICAL WHEN OFF. A missing `flow` or `strength === 0` skips the curl
 * block entirely, so no velocity, position or RNG draw changes and the shipped
 * sim is untouched (pinned by blood-sim.test.ts). Determinism is preserved
 * because the curl sample is pure arithmetic — no Math.random.
 */
export function stepBlood(
  sim: BloodSim, dt: number, rng: () => number, flow?: CurlFlow,
): void {
  const curl = flow !== undefined && flow.strength !== 0 ? flow : null;
  for (let i = sim.droplets.length - 1; i >= 0; i--) {
    const d = sim.droplets[i]!;
    // Guts are chain-driven, not ballistic — see Droplet.kind.
    if (d.kind === 'gut') continue;
    // Scraps are chunky — they feel double the airdrag of a mist bead.
    const drag = Math.max(0, 1 - BLOOD_TRAIL.airdrag
      * (d.kind === 'scrap' ? SCRAP_TUNING.dragMul : d.kind === 'mist' ? 3 : 1) * dt);
    d.vel[1] -= BLOOD_TRAIL.gravity * dt;
    if (curl) {
      // Acceleration, not a velocity override: the divergence-free field nudges
      // the existing ballistic motion, so gravity and drag still own the arc.
      const a = curlAccelAt(curl, d.pos[0], d.pos[1], d.pos[2]);
      d.vel[0] += a[0] * dt; d.vel[1] += a[1] * dt; d.vel[2] += a[2] * dt;
    }
    d.vel[0] *= drag; d.vel[1] *= drag; d.vel[2] *= drag;
    d.pos[0] += d.vel[0] * dt; d.pos[1] += d.vel[1] * dt; d.pos[2] += d.vel[2] * dt;
    d.age += dt;
    // Ribbon history — beads only (mist stays a haze sprite, scraps are
    // flesh). Ring capped at TRAIL_HIST; shift is fine at these sizes.
    if (d.kind === 'drop') {
      (d.hist ??= []).push([d.pos[0], d.pos[1], d.pos[2]]);
      if (d.hist.length > TRAIL_HIST) d.hist.shift();
    }
    if (d.pos[1] <= 0.01 || d.age >= d.life) {
      // Mist evaporates — a splat per mist particle would carpet the floor
      // in confetti within one spurt.
      if (d.kind !== 'mist') stamp(sim, d.pos, rng, d.kind);
      sim.droplets.splice(i, 1);
    }
  }
}
