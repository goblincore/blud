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
// One hit, in order: wobble; snap any eye left dangling by an earlier hit; pop an exposed orbit's eye when
// it is the nearest region (that orbit is not stripped this hit); strip every region by a Gaussian of its
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

const R_MAX: Readonly<Record<HeadRegion, number>> = { orbitL: 0.035, orbitR: 0.035, brow: 0.05, crown: 0.055, cheekL: 0.045, cheekR: 0.045 };

export const REGION_TUNING = {
  spillSigma: 0.5,
  crownSpill: 0.5,
  orbitExposed: 0.35,
  skullExposed: 0.3,
  /** Spec §15 says 0.5; 0.4 because the hit that exposes the skull also cracks it (rule order), and at 0.5
   *  a brow-centred kill came on hit 4 (below the 5–7 target). At 0.4 it is 5 (jitter 1), 7 (−20%), 5 (+20%). */
  skullPerHit: 0.4,
  jitter: 0.2,
  /** Strip changes below this are applied but not reported as events. */
  stripEventMin: 0.02,
  /** The region's crater radius at a given flesh (1 = untouched). */
  craterR: (r: HeadRegion, flesh: number) => 0.025 + (R_MAX[r] - 0.025) * Math.min(1, (1 - flesh) / 0.7),
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
 *  (0.25 R/L, 0.35 H). `rand`: the zombie's seeded stream in [0, 1); one draw per hit (the jitter). */
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
  const nearSide = sideOf(near);
  if (!dead && nearSide && eyes[nearSide] === 'in-orbit') {
    eyes[nearSide] = 'dangling';
    events.push({ kind: 'eye-pop', side: nearSide });
    popped = near;
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

/** The zombie died some other way (collapse, dynamite): a dangling eye snaps off. */
export function headDeath(s: HeadDamageState): { state: HeadDamageState; events: HeadEvent[] } {
  const events: HeadEvent[] = [];
  const eyes = { ...s.eyes };
  for (const side of SIDES) {
    if (eyes[side] === 'dangling') { eyes[side] = 'gone'; events.push({ kind: 'eye-snap', side }); }
  }
  return events.length ? { state: { ...s, eyes }, events } : { state: s, events };
}
