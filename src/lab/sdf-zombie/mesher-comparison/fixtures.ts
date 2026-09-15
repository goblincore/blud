// src/lab/sdf-zombie/mesher-comparison/fixtures.ts
//
// The shared fixtures every method is run against. Each fixture exposes a
// `ScalarField`: one closure, one explicit padded domain in metres, one set of
// deterministic metadata. Nothing here is production code.
//
// Fixture set (see the dev-note for the full rationale):
//   * control-sphere      — analytic, exact distance; validates sign, winding,
//                           surface placement, closed-sphere topology.
//   * control-sharp-box   — analytic rounded box with a near-razor corner;
//                           validates crease placement and orientation.
//   * chamfer-groove      — Blud `sdBody` with a `chamfer` fold (a CREASE, not
//                           a fillet) and a `groove` channel; validates sharp
//                           feature preservation on a non-distance field.
//   * character-head      — the real goblin `.blob`, bounded to the head
//                           region so the thin ears and the mouth groove are
//                           inside. The neck is CUT by the domain, so the
//                           surface is open at the boundary: that is a fixture
//                           property, reported as boundary crossings, not a
//                           mesher defect. Torso/limbs/hands/fingers are
//                           omitted (documented cost control).
//   * torn-chunk          — a settled gib chunk built through the production
//                           `chunkBakeField` with non-empty torn data and an
//                           open crater, then extracted with the same meshers.

import type { ClusterInfo, Primitive, Vec3 } from '../types';
import { sdBody, sdGroove, smin, sminChamfer, type Body } from '../validate';
import { chunkBakeField } from '../chunk-bake-field';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import type { ScalarField } from './types';

/** Minimal Primitive factory for hand-built Blud fixtures. */
export function prim(a: Vec3, b: Vec3, radius: number, over: Partial<Primitive> = {}): Primitive {
  return {
    a, b, radius, scale: [1, 1, 1], blendK: 0.01, limb: 'gob' as never, cluster: 0, ...over,
  } as Primitive;
}

export function bodyOf(prims: Primitive[]): Body {
  const cluster: ClusterInfo = {
    id: 0, limb: 'gob' as never, start: 0, count: prims.length,
    center: [0, 0, 0], radius: 1e3, alive: true,
  };
  return { prims, clusters: [cluster] };
}

function fieldOf(
  id: string, f: (p: Vec3) => number, bounds: { min: Vec3; max: Vec3 },
  analyticDistance: boolean, meta: ScalarField['meta'],
): ScalarField {
  return { id, units: 'meters', field: f, bounds, analyticDistance, meta };
}

// ---------------------------------------------------------------------------
// Analytic controls
// ---------------------------------------------------------------------------

export const SPHERE_RADIUS = 0.2;

export function controlSphere(): ScalarField {
  const r = SPHERE_RADIUS;
  const f = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]) - r;
  return fieldOf('control-sphere', f,
    { min: [-0.3, -0.3, -0.3], max: [0.3, 0.3, 0.3] }, true,
    { shape: 'analytic sphere', radiusM: r, exactDistance: true });
}

export function controlSharpBox(): ScalarField {
  // sdPrimitive's box: half-extents radius*(1-round), corner radius
  // radius*round. round = 0 gives a TRUE sharp box (exact distance, scale 1)
  // so the crease is a genuine test, not a 1.5 mm round in disguise.
  const radius = 0.15;
  const box = prim([0, 0, 0], [0, 0, 0], radius, { box: { round: 0 } });
  const body = bodyOf([box]);
  const f = (p: Vec3): number => sdBody(p, body);
  return fieldOf('control-sharp-box', f,
    { min: [-0.25, -0.25, -0.25], max: [0.25, 0.25, 0.25] }, true,
    { shape: 'analytic sharp box', halfExtentM: 0.15, cornerRadiusM: 0, exactDistance: true });
}

// ---------------------------------------------------------------------------
// Blud chamfer + groove control
// ---------------------------------------------------------------------------

export function chamferGrooveControl(): ScalarField {
  const lobeA = prim([-0.04, 0, 0], [-0.04, 0, 0], 0.085, { blendK: 0.02 });
  const lobeB = prim([0.055, 0.01, 0], [0.055, 0.01, 0], 0.075, {
    blendK: 0.03, blendProfile: 'chamfer', box: { round: 0.08 },
  });
  // A groove channel cut along where this thin capsule's surface crosses the
  // lobes; depth/width are metres (march.wgsl.ts sdGroove semantics).
  const cutter = prim([0, 0.02, -0.14], [0, 0.02, 0.14], 0.018, {
    op: 'groove', grooveDepth: 0.014, grooveWidth: 0.011,
  });
  const body = bodyOf([lobeA, lobeB, cutter]);
  const f = (p: Vec3): number => sdBody(p, body);
  return fieldOf('chamfer-groove', f,
    { min: [-0.2, -0.19, -0.2], max: [0.2, 0.19, 0.2] }, false,
    {
      shape: 'two lobes folded with sminChamfer + sdGroove channel',
      blendProfile: 'chamfer', grooveDepthM: 0.014, grooveWidthM: 0.011,
      exactDistance: false,
    });
}

// ---------------------------------------------------------------------------
// Real character region (goblin head)
// ---------------------------------------------------------------------------

export interface CharacterRegion {
  readonly id: string;
  readonly character: string;
  readonly region: { min: Vec3; max: Vec3 };
  readonly included: string;
  readonly omitted: string;
}

export const GOBLIN_HEAD_REGION: CharacterRegion = {
  id: 'character-head',
  character: 'goblin',
  // Head prim bounds are x [-0.202,0.202], y [0.939,1.400], z [-0.102,0.184].
  // Padded by >2 cells at the coarsest ladder step (20 mm). The y-min cut
  // slices the neck: the meshed surface is OPEN there by construction.
  region: { min: [-0.25, 0.9, -0.16], max: [0.25, 1.48, 0.24] },
  included: 'head, both thin ears (x +/-0.09..0.17, thickness ~16 mm), nose, jaw, mouth groove, neck stub',
  omitted: 'torso, arms, hands/fingers, legs — whole-body cost rejected (documented region approximation)',
};

export function buildCharacterBody(blobSource: string): Body {
  const doc = parseBlob(blobSource);
  return buildBody(compileBlob(doc, compileFace(doc)));
}

export function characterRegionFixture(
  blobSource: string, region: CharacterRegion = GOBLIN_HEAD_REGION,
): ScalarField {
  const body = buildCharacterBody(blobSource);
  const f = (p: Vec3): number => sdBody(p, body);
  return fieldOf(region.id, f, region.region, false, {
    shape: `real .blob character '${region.character}' (rest pose, clean CPU field; march silhouette noise excluded)`,
    source: `src/lab/sdf-zombie/characters/${region.character}.blob`,
    included: region.included,
    omitted: region.omitted,
    exactDistance: false,
  });
}

// ---------------------------------------------------------------------------
// Damaged settled chunk (production chunkBakeField)
// ---------------------------------------------------------------------------

export interface TornChunkFixture {
  readonly field: ScalarField;
  readonly craterCentre: Vec3;
  readonly tornCount: number;
  /** Pre-carve flesh field; used to prove the crater removed flesh. */
  readonly preWound: (p: Vec3) => number;
}

export function tornChunkFixture(): TornChunkFixture {
  const flesh = [
    prim([-0.055, 0, 0], [0.02, 0, 0], 0.045),
    prim([0.02, 0, 0], [0.085, 0, 0], 0.031, { radiusB: 0.022 }),
  ];
  const bones = [prim([-0.045, 0, 0], [0.07, 0, 0], 0.012, { op: 'bone' })];
  const crater: Vec3 = [0.1, 0, 0];
  const torn = [{ at: crater, radius: 0.052 }];
  const ev = chunkBakeField({ flesh, bones, torn, carveK: 0.012 });
  const f = (p: Vec3): number => ev.field(p);
  const field = fieldOf('torn-chunk', f,
    { min: [-0.15, -0.12, -0.12], max: [0.19, 0.12, 0.12] }, false, {
      shape: 'settled chunk via chunkBakeField: two flesh capsules + bone + one torn end',
      tornRadiusM: 0.052, carveK: 0.012,
      exactDistance: false,
    });
  // Attach probes so tests/preconditions can assert the crater opened.
  return { field, craterCentre: crater, tornCount: torn.length, preWound: (p) => ev.preWound(p) };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface FixtureDef {
  readonly id: string;
  readonly kind: 'analytic-control' | 'blud-control' | 'production';
  /** Fixtures costlier than this cell size are skipped in the ladder. */
  readonly minCell: number;
  build(blobSource?: string): ScalarField;
}

export const FIXTURES: readonly FixtureDef[] = [
  { id: 'control-sphere', kind: 'analytic-control', minCell: 0.005, build: () => controlSphere() },
  { id: 'control-sharp-box', kind: 'analytic-control', minCell: 0.005, build: () => controlSharpBox() },
  { id: 'chamfer-groove', kind: 'blud-control', minCell: 0.005, build: () => chamferGrooveControl() },
  {
    id: 'character-head', kind: 'production', minCell: 0.005,
    build: (src) => {
      if (!src) throw new Error('character-head requires the .blob source text');
      return characterRegionFixture(src);
    },
  },
  { id: 'torn-chunk', kind: 'production', minCell: 0.0025, build: () => tornChunkFixture().field },
];

export const controlSphereDistance = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]) - SPHERE_RADIUS;

// Re-exports used by probes/tests that want the raw Blud ops.
export { sdBody, sdGroove, smin, sminChamfer };
