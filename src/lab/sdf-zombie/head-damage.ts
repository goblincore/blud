// src/lab/sdf-zombie/head-damage.ts
//
// MELEE HEAD DAMAGE v2 (spec §15). Pure. The flesh wears away region by region and events follow from
// state, not from a hit count: an orbit stripped to bone shows a 3D eye in it, the next hit there pops it
// (a dark empty orbit), the next head hit snaps the dangling eye; the brow or crown stripped to bone shows
// skull, and about two more hits there crack it — the brain comes out and the zombie dies. Per-zombie
// jitter (rand) moves every threshold crossing.
//
// AS BUILT (spec §15, v2 fixes): the skull is PER REGION — any non-orbit region (brow, crown, cheekL, cheekR)
// exposes skull below skullExposed and cracks there, so hits on the side of the head kill too (they land
// nearest a cheek). And a non-orbit region's crater is ANCHORED (state.anchor) at the hs of the first blow
// that struck it (it was the nearest region and lost flesh); later strips grow it there. A region only
// spilled on has no anchor (the leaf puts its crater at the region centre); the orbits never anchor — the
// eye lives at the orbit.
//
// One hit, in order: wobble; snap every eye left dangling by an earlier hit; pop an exposed orbit's eye when
// it is the nearest region (that orbit is not stripped this hit) — and the other eye with it (v1.5a: both eyes
// pop at once, the next head hit or death snaps both); strip every region by a Gaussian of its
// hs distance (the upper face also strips the crown at crownSpill); cross the orbit / skull thresholds
// once; then crack an exposed skull that was hit (the crown counts for brow hits too).
export type EyeSide = 'L' | 'R';
export type HeadRegion = 'orbitL' | 'orbitR' | 'brow' | 'crown' | 'cheekL' | 'cheekR';
/** The regions with a skull under them (every region but the orbits). */
export type SkullRegion = Exclude<HeadRegion, 'orbitL' | 'orbitR'>;
export const SKULL_REGIONS: readonly SkullRegion[] = ['brow', 'crown', 'cheekL', 'cheekR'];
type HS = readonly [number, number, number];   // head-local ÷ half-extents (x right, y up, z face-forward)

export const HEAD_REGIONS: Readonly<Record<HeadRegion, HS>> = {
  orbitL: [-0.498, 0.096, 0.9], orbitR: [0.451, 0.179, 0.9],   // the face-sheet eye centroids (plan decision 6)
  brow: [0, 0.5, 0.85], crown: [0, 1, 0], cheekL: [-0.55, -0.3, 0.75], cheekR: [0.55, -0.3, 0.75],
};

const REGION_NAMES = Object.keys(HEAD_REGIONS) as HeadRegion[];

/** v1.5b BIGGER BITES (owner: "hits to the face should take off more bigger chunks"): every R_MAX ~40% up (was
 *  orbits 0.035, cheeks 0.045, brow 0.05, crown 0.055) and the first crater starts at CRATER_R0 0.04 (was 0.025). */
const R_MAX: Readonly<Record<HeadRegion, number>> = { orbitL: 0.05, orbitR: 0.05, brow: 0.07, crown: 0.075, cheekL: 0.065, cheekR: 0.065 };
const CRATER_R0 = 0.04;

export const REGION_TUNING = {
  spillSigma: 0.5,
  crownSpill: 0.5,
  orbitExposed: 0.35,
  skullExposed: 0.3,
  /** v1.5b BIGGER BITES (owner: too gradual, the eyes took too long): the strips doubled (R/L 0.40, H 0.55;
   *  game-head-damage.ts HEAD_LEAF.strip), so a region is bone on hit 2 (3 at jitter −20%) and the hit that exposes
   *  the skull also cracks it (rule order). 0.32 cracks it in 4 hits at jitter 1 (0.96 after 3) and at −20%
   *  (0.256 × 4 = 1.02), 3 at +20%: a single region dies on hit 5 (jitter 1), 6 (−20%), 4 (+20%); with H, 5 / 5 / 4.
   *  (v1.4 was 0.25 with strips 0.20/0.28: 7 / 9 / 6. v2 was 0.4 with 0.25/0.35.) */
  skullPerHit: 0.32,
  jitter: 0.2,
  /** Strip changes below this are applied but not reported as events. */
  stripEventMin: 0.02,
  /** The region's crater radius at a given flesh (1 = untouched). */
  craterR: (r: HeadRegion, flesh: number) => CRATER_R0 + (R_MAX[r] - CRATER_R0) * Math.min(1, (1 - flesh) / 0.7),
} as const;

export type EyeState = 'painted' | 'in-orbit' | 'dangling' | 'gone';
export interface HeadDamageState {
  hits: number;
  flesh: Record<HeadRegion, number>;
  skull: Record<SkullRegion, number>;
  eyes: Record<EyeSide, EyeState>;
  dead: boolean;
  /** Where each struck non-orbit region's crater sits: the hs of the first blow that struck it. */
  anchor: Partial<Record<SkullRegion, HS>>;
}

export type HeadEvent =
  | { kind: 'wobble' }
  | { kind: 'strip'; region: HeadRegion; flesh: number }        // one per region whose flesh changed
  | { kind: 'orbit-exposed'; side: EyeSide }
  | { kind: 'eye-pop'; side: EyeSide }
  | { kind: 'eye-snap'; side: EyeSide }
  | { kind: 'skull-exposed'; region: SkullRegion }
  | { kind: 'brain'; region: SkullRegion }
  | { kind: 'kill' };

const SIDES: readonly EyeSide[] = ['L', 'R'];
const orbitOf = (side: EyeSide): HeadRegion => (side === 'L' ? 'orbitL' : 'orbitR');
const sideOf = (r: HeadRegion): EyeSide | null => (r === 'orbitL' ? 'L' : r === 'orbitR' ? 'R' : null);
export const isSkullRegion = (r: HeadRegion): r is SkullRegion => r !== 'orbitL' && r !== 'orbitR';
const d2 = (a: HS, b: HS): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export function makeHeadDamage(): HeadDamageState {
  return {
    hits: 0,
    flesh: { orbitL: 1, orbitR: 1, brow: 1, crown: 1, cheekL: 1, cheekR: 1 },
    skull: { brow: 0, crown: 0, cheekL: 0, cheekR: 0 },
    eyes: { L: 'painted', R: 'painted' },
    dead: false,
    anchor: {},
  };
}

/** The region whose centre is nearest `hs` (head-local ÷ half-extents). */
export function nearestRegion(hs: HS): HeadRegion {
  let best: HeadRegion = REGION_NAMES[0]!, bd = Infinity;
  for (const r of REGION_NAMES) {
    const d = d2(hs, HEAD_REGIONS[r]);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

const skullBare = (flesh: Record<HeadRegion, number>, r: SkullRegion): boolean => flesh[r] < REGION_TUNING.skullExposed;

/** One head-region hit. `hs`: the hit point, head-local ÷ half-extents. `strip`: the swing's flesh strip
 *  (0.40 R/L, 0.55 H; game-head-damage.ts HEAD_LEAF.strip). `rand`: the zombie's seeded stream in [0, 1); one draw per hit (the jitter). */
export function headHit(
  s: HeadDamageState, hit: { hs: HS; strip: number }, rand: () => number,
): { state: HeadDamageState; events: HeadEvent[] } {
  const T = REGION_TUNING;
  const jitter = 1 + T.jitter * (2 * rand() - 1);
  const near = nearestRegion(hit.hs);
  const events: HeadEvent[] = [{ kind: 'wobble' }];
  const flesh = { ...s.flesh };
  const skull = { ...s.skull };
  const eyes = { ...s.eyes };
  const anchor = { ...s.anchor };
  let dead = s.dead;

  if (!dead) {
    // 2. An eye left dangling by an earlier hit snaps.
    for (const side of SIDES) {
      if (eyes[side] === 'dangling') { eyes[side] = 'gone'; events.push({ kind: 'eye-snap', side }); }
    }
  }
  // 3. Pop an exposed orbit's eye; that orbit keeps its flesh this hit.
  let popped: HeadRegion | null = null;
  // A hit aimed at the middle of the face lands nearest the BROW, not an orbit: it pops an exposed eye too
  // (owner: "too hard to get to that point"), so aiming between the eyes is not a way to never pop them.
  const orbitSide = sideOf(near);
  const nearSide: EyeSide | undefined = orbitSide && eyes[orbitSide] === 'in-orbit' ? orbitSide
    : near === 'brow' ? SIDES.find(sd => eyes[sd] === 'in-orbit') : undefined;
  if (!dead && nearSide) {
    eyes[nearSide] = 'dangling';
    events.push({ kind: 'eye-pop', side: nearSide });
    if (orbitSide === nearSide) popped = near;
    // BOTH EYES POP AT ONCE (flail spec §14.1 item 8): the other eye comes out in the same hit from whatever state
    // it is in. Painted, its orbit is exposed first (its flesh set to at most the threshold: the leaf's crater and
    // glow-off follow orbit-exposed); in its orbit, it just pops. Gone stays gone (dangling cannot happen here:
    // step 2 snapped it). That orbit is still stripped normally below.
    const other: EyeSide = nearSide === 'L' ? 'R' : 'L';
    if (eyes[other] === 'painted') {
      flesh[orbitOf(other)] = Math.min(flesh[orbitOf(other)], T.orbitExposed);
      eyes[other] = 'in-orbit';
      events.push({ kind: 'orbit-exposed', side: other });
    }
    if (eyes[other] === 'in-orbit') {
      eyes[other] = 'dangling';
      events.push({ kind: 'eye-pop', side: other });
    }
  }
  // 4. Strip.
  const base = hit.strip * jitter;
  const upperFace = near === 'brow' || near === 'orbitL' || near === 'orbitR';
  const sig2 = T.spillSigma * T.spillSigma;
  // The falloff is RELATIVE to the nearest region, so the nearest one always takes the full strip —
  // a hit on the back or side of the head (far from every region centre) still strips its nearest
  // region (the crown, from behind) instead of nothing.
  const dNear = d2(hit.hs, HEAD_REGIONS[near]);
  for (const r of REGION_NAMES) {
    if (r === popped) continue;
    let amt = base * Math.exp(-(d2(hit.hs, HEAD_REGIONS[r]) - dNear) / sig2);
    if (r === 'crown' && upperFace) amt += T.crownSpill * base;
    const was = flesh[r];
    flesh[r] = Math.max(0, was - amt);
    if (was - flesh[r] >= T.stripEventMin) events.push({ kind: 'strip', region: r, flesh: flesh[r] });
  }
  // The struck region's crater anchors where this blow landed, once (before its strip event is handled).
  if (isSkullRegion(near) && !anchor[near] && flesh[near] < s.flesh[near]) anchor[near] = [hit.hs[0], hit.hs[1], hit.hs[2]];
  if (!dead) {
    // 5. Thresholds, crossed once.
    for (const side of SIDES) {
      if (eyes[side] === 'painted' && flesh[orbitOf(side)] < T.orbitExposed) {
        eyes[side] = 'in-orbit';
        events.push({ kind: 'orbit-exposed', side });
      }
    }
    for (const r of SKULL_REGIONS) {
      if (s.flesh[r] >= T.skullExposed && flesh[r] < T.skullExposed) events.push({ kind: 'skull-exposed', region: r });
    }
    // 6. Skull: the hit region's bare skull cracks (a brow hit cracks the bare crown if the brow is covered).
    //    Orbit hits crack nothing.
    const target: SkullRegion | null =
      !isSkullRegion(near) ? null
      : skullBare(flesh, near) ? near
      : near === 'brow' && skullBare(flesh, 'crown') ? 'crown'
      : null;
    if (target) {
      skull[target] += T.skullPerHit * jitter;
      if (skull[target] >= 1) {
        events.push({ kind: 'brain', region: target }, { kind: 'kill' });
        dead = true;
      }
    }
  }
  return { state: { hits: s.hits + 1, flesh, skull, eyes, dead, anchor }, events };
}

/** The zombie died some other way (collapse, dynamite): every dangling eye snaps off (one eye-snap each). */
export function headDeath(s: HeadDamageState): { state: HeadDamageState; events: HeadEvent[] } {
  const events: HeadEvent[] = [];
  const eyes = { ...s.eyes };
  for (const side of SIDES) {
    if (eyes[side] === 'dangling') { eyes[side] = 'gone'; events.push({ kind: 'eye-snap', side }); }
  }
  return events.length ? { state: { ...s, eyes }, events } : { state: s, events };
}
