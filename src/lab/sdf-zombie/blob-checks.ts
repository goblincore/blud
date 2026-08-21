// src/lab/sdf-zombie/blob-checks.ts
//
// WAM's `clip`/`noclip` concepts, ported to an SDF body. WAM answers "am I
// inside this shape" with ~955 lines of triangle raycasting because a mesh
// has no interior — it has to build one by parity-counting ray crossings.
// An SDF answers "am I inside" directly: `sdBody(p) < 0` IS the containment
// test. That is the entire reason these checks are a few lines instead of a
// geometry library.
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { clusterCore, sdBody } from './validate';
import { lerp, len, sub } from './vec';

/**
 * The structural shape `sdBody` actually needs. `validate.ts` keeps its
 * `Body` interface private, but this satisfies it structurally, so no import
 * is needed for that type itself — only for the functions that consume it.
 * `BuiltBody` (extra `bones` field) is assignable here too, so every
 * function below accepts either a real built body or a bare synthetic
 * fixture built just from `prims`/`clusters` (see the crossing-capsule test).
 */
interface Field { prims: Primitive[]; clusters: ClusterInfo[] }

/**
 * Sample `sdBody` along the segment from `a` to `b` and return the WORST
 * (least-negative / most-positive) value seen.
 *
 * This is deliberately `Math.max`, not `Math.min`. "Fused" means the field
 * stays inside solid flesh for the ENTIRE segment — one point poking outside
 * (a positive sample) already breaks that, no matter how deep the rest of the
 * path sits. `Math.min` would report the single deepest-inside sample, which
 * stays negative even when most of the path has left the body; it can only
 * ever prove "these two points both happen to sit in solid flesh somewhere,"
 * never "a solid bridge connects them." `Math.max` is the only reduction that
 * answers the actual question: is there any point along this path where the
 * flesh has already run out? `validateBody`'s own connectivity probe in
 * `validate.ts` (`segmentInside`) makes the same call, early-returning false
 * on the first positive sample — this is that check's max-based sibling,
 * generalised so `.blob` authoring can call it directly on an arbitrary pair.
 *
 * Named for what it RETURNS (the worst sample), not for the reduction it
 * used to use — an earlier draft used `Math.min` and kept the name
 * `minFieldOnSegment` after switching to `Math.max`, which left the name
 * contradicting its own docstring.
 */
export function worstFieldOnSegment(body: Field, a: Vec3, b: Vec3, steps = 64): number {
  let worst = -Infinity;
  for (let i = 0; i <= steps; i++) worst = Math.max(worst, sdBody(lerp(a, b, i / steps), body));
  return worst;
}

/**
 * Two clusters restricted to only their own primitives, with indices
 * remapped so the result is a valid `Field` on its own (cluster `start`s in
 * `BuiltBody.prims` are absolute offsets into the FULL body's array; slicing
 * out a subset without remapping them would make `sdBody` read the wrong
 * primitives, or run off the end).
 *
 * Restricting to just the named clusters — rather than folding the whole
 * body — matters for both checks built on top of this, for opposite reasons:
 *
 * - `clearOf` isolates ONE cluster's own field so it can ask "does the other
 *   cluster's material sit inside JUST this geometry", with no help or
 *   interference from unrelated flesh elsewhere on the body.
 * - `worstFieldOnSegment`, when used for a `fused` check between a specific
 *   pair, should answer whether THOSE TWO clusters' own geometry connects —
 *   not whether some third, uninvolved cluster happens to bridge the gap.
 *   Folding the whole body could let an incidental third cluster paper over
 *   a join that was never actually authored between `a` and `b`.
 */
function restrictedTo(body: Field, clusters: ClusterInfo[]): Field {
  const prims: Primitive[] = [];
  const remapped: ClusterInfo[] = [];
  for (const c of clusters) {
    const slice = body.prims.slice(c.start, c.start + c.count);
    remapped.push({ ...c, start: prims.length, count: slice.length });
    prims.push(...slice);
  }
  return { prims, clusters: remapped };
}

/**
 * Does cluster `a` fuse to cluster `b` through solid flesh? Probes the
 * segment between their `clusterCore`s — NOT their `.center`s.
 *
 * `ClusterInfo.center` is a bounding construct (the centroid of every
 * primitive endpoint in the cluster) and nothing guarantees it lies inside
 * the flesh — `validate.ts` documents this at length above its own
 * `clusterCore` and deliberately avoids `.center` for the same reason. It is
 * not a hypothetical risk here either: measured on the lab zombie, the
 * fused-margin between torso and head is -0.0366 when probed from
 * `clusterCore`, but only -0.0133 from `.center` — nearly 3x thinner, on a
 * body that happens to still pass. A head with a slightly heavier face rig
 * (more primitives dragging the endpoint centroid further off-axis) would
 * cross zero using `.center` while the actual flesh is still solidly
 * connected, and report a false "disconnected" failure that has nothing to
 * do with the geometry.
 *
 * Probed against the full body, matching `validate.ts`'s own connectivity
 * check (`segmentInside`) — a direct join between two adjacent clusters is
 * exactly the case that check already trusts the full field for.
 */
export function fusedOf(body: Field, a: ClusterInfo, b: ClusterInfo): number {
  const from = clusterCore(body, a);
  const to = clusterCore(body, b);
  if (from === null || to === null) return Infinity; // nothing solid to probe from ⇒ not fused
  return worstFieldOnSegment(body, from, to);
}

/**
 * Points to test a primitive's own flesh against another cluster's field.
 *
 * An earlier version of `clearOf` used only the two endpoints `prim.a` and
 * `prim.b` (mirroring `clusterCore`'s "guaranteed inside" reasoning, just
 * applied per-primitive). That misses interpenetration in the MIDDLE of a
 * primitive's shaft — two perpendicular capsules crossing through their
 * mutual midpoint can have both primitives' endpoints roughly a primitive
 * length away from the crossing, while the crossing itself is deeply solid.
 * Crossed forearms, or a leg swept through the far side of the torso
 * mid-limb rather than at a joint, are exactly this shape on a real
 * character — not a contrived case.
 *
 * So: sample along the whole segment, not just its ends. The spacing is
 * tied to the primitive's OWN effective radius (`radius * min(scale)`, the
 * same conservative "thinnest direction" measure `clusterCore` uses) — a
 * crossing primitive of comparable or larger thickness sweeps an overlap
 * region at least as wide as that radius along our axis, so sampling no
 * coarser than one step per effective radius can't step over it. At least 2
 * intervals (3 points: both ends plus the midpoint) even for a primitive
 * shorter than its own radius, so a near-spherical blob is never reduced to
 * its two (nearly identical) ends; capped at 32 intervals so a long, thin
 * primitive can't blow up the sample count.
 *
 * HONEST LIMIT: this is sampling, not an exact test. A crossing primitive
 * THINNER than the one being sampled (so its overlap region is narrower
 * than our spacing) can still be stepped over — e.g. a hair-thin carve
 * crossing a thick limb at a shallow angle near a sample gap. Real body
 * primitives in this project sit in a narrow band of radii (a few cm to a
 * few tens of cm), so that gap is not expected to bite in practice, but it
 * is not proven closed. A closed-form segment-to-segment distance test
 * (accounting for the ellipsoidal `scale`) would close it exactly; sampling
 * was chosen instead because it is simple, cheap enough for authoring-time
 * checks (tens of samples per primitive, not per frame), and — per review —
 * an honest bound stated in a comment beats an implied guarantee from an
 * exact-looking method that quietly doesn't handle `scale`.
 */
function samplesAlong(prim: Primitive): Vec3[] {
  const length = len(sub(prim.b, prim.a));
  const effRadius = prim.radius * Math.min(prim.scale[0], prim.scale[1], prim.scale[2]);
  const intervals = Math.min(32, Math.max(2, Math.ceil(length / Math.max(effRadius, 1e-4))));
  const pts: Vec3[] = [];
  for (let i = 0; i <= intervals; i++) pts.push(lerp(prim.a, prim.b, i / intervals));
  return pts;
}

/**
 * Do clusters `a` and `b` interpenetrate? Positive means clear; <= 0 means
 * they overlap.
 *
 * This is NOT `worstFieldOnSegment` between the two clusters' cores — that
 * was the plan's original design, and it is unsound for two independent
 * reasons, both confirmed by measurement on the lab zombie:
 *
 * 1. A straight line between two cluster cores routinely threads through a
 *    THIRD cluster's solid flesh. `armL` and `legR` sit on opposite sides of
 *    the body and never touch (by construction — that pair is meant to stay
 *    clear at rest), yet the segment between their cores runs straight
 *    through the torso: `worstFieldOnSegment` on that segment measures
 *    -0.107, strongly negative, i.e. it reports them as INTERPENETRATING
 *    when they are nowhere near each other. A "clear" check that fails on
 *    every well-separated limb pair is worse than no check.
 * 2. Even restricted to just the two clusters in question, a single core-to-
 *    core segment only samples ONE line through a possibly multi-primitive
 *    limb. `clusterCore` picks the single FATTEST primitive — for `armL`
 *    that's the shoulder blob, nowhere near the hand. Rotating the upper arm
 *    all the way to a tilt of -40 (driving the forearm/hand into the near
 *    thigh) left the shoulder-to-thigh-core segment reading an UNCHANGED
 *    -0.082 at every tilt tried, because the segment never went anywhere
 *    near the hand. A representative-point probe is blind to collisions at
 *    the far end of a limb it wasn't anchored to.
 *
 * Instead: take every live, solid primitive belonging to `a`, sample points
 * ALONG its whole shaft (`samplesAlong`, not just its two ends — see that
 * function's docstring for why endpoints alone still miss mid-shaft
 * crossings), and evaluate `b`'s field, ISOLATED from the rest of the body,
 * at each one. A negative reading means that material point of `a` sits
 * inside `b`'s own flesh — genuine interpenetration, not an artifact of some
 * unrelated cluster in between. Repeat symmetrically for `b`'s samples
 * against `a`'s isolated field, and report the worst (most negative) of
 * everything sampled.
 *
 * Carve primitives (`op === 'sub'`) and dead primitives are skipped as
 * SOURCES of sample points — they carry no flesh of their own to intrude
 * with — but a carve prim on the TARGET cluster still applies when its
 * isolated field is evaluated, exactly as it would in the full body
 * (`restrictedTo` keeps every primitive belonging to a cluster, and
 * `sdBody` already handles `op` correctly; carving is a property of the
 * target's field, not of which points get tested against it).
 */
export function clearOf(body: Field, a: ClusterInfo, b: ClusterInfo): number {
  const aOnly = restrictedTo(body, [a]);
  const bOnly = restrictedTo(body, [b]);
  let worst = Infinity;
  for (const prim of body.prims.slice(a.start, a.start + a.count)) {
    if (prim.op === 'sub' || prim.dead) continue;
    for (const p of samplesAlong(prim)) worst = Math.min(worst, sdBody(p, bOnly));
  }
  for (const prim of body.prims.slice(b.start, b.start + b.count)) {
    if (prim.op === 'sub' || prim.dead) continue;
    for (const p of samplesAlong(prim)) worst = Math.min(worst, sdBody(p, aOnly));
  }
  return worst;
}
