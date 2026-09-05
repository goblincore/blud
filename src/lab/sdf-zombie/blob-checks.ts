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
 * HONEST LIMIT: this is sampling, not an exact test, and there are TWO
 * distinct ways it can miss a real crossing — not one.
 *
 * 1. A crossing primitive THINNER than the one being sampled (so its
 *    overlap region is narrower than our spacing) can still be stepped
 *    over — e.g. a hair-thin carve crossing a thick limb at a shallow angle
 *    near a sample gap. Real body primitives in this project sit in a
 *    narrow band of radii (a few cm to a few tens of cm), so this is not
 *    expected to bite in practice, but it is not proven closed.
 * 2. The `intervals` cap below (32) exists to bound cost, but the whole
 *    "can't step over a crossing of comparable thickness" argument only
 *    holds while actual spacing equals `effRadius`. Once
 *    `length / effRadius` exceeds the cap, spacing becomes `length / 32`
 *    instead — which can be far coarser than `effRadius`, and at that point
 *    the invariant fails even against a THICK crossing primitive, not just
 *    a thin one at a shallow angle. Not triggered by anything on the lab
 *    zombie today (its longest thin primitive, the thigh bar, has a
 *    length/radius ratio around 4-5, nowhere near 32), but the project
 *    plan commits to porting a cast of eight further characters, and
 *    slender limbs, tails, and held weapons are exactly where this ratio
 *    crosses 32. Handled below with a loud `console.warn` rather than left
 *    to fail silently — the mismatch is per-primitive and would otherwise
 *    show up only as a quiet false "clear" on whichever future character
 *    first has a limb long and thin enough to trigger it.
 *
 * A closed-form segment-to-segment distance test (accounting for the
 * ellipsoidal `scale`) would close gap 1 exactly and make gap 2 moot;
 * sampling was chosen instead because it is simple, cheap enough for
 * authoring-time checks (tens of samples per primitive, not per frame), and
 * — per review — an honest bound stated in a comment beats an implied
 * guarantee from an exact-looking method that quietly doesn't handle
 * `scale`.
 *
 * The cap itself stays at 32 rather than growing to chase this: the
 * project's own review already measured that an all-pairs check across a
 * full MAX_CLUSTERS (6) x MAX_CLUSTER_PRIMS (64) cast stays in the low
 * millions of `sdPrimitive` evaluations at 32 intervals/primitive, but no
 * FINITE cap can be proven to cover every primitive a future character
 * might author — a longer cap just moves the threshold, it doesn't remove
 * the possibility. The warning is what actually closes this, by making the
 * threshold's existence visible instead of assumed away.
 */
function samplesAlong(prim: Primitive): Vec3[] {
  const length = len(sub(prim.b, prim.a));
  const effRadius = prim.radius * Math.min(prim.scale[0], prim.scale[1], prim.scale[2]);
  const CAP = 32;
  const needed = Math.ceil(length / Math.max(effRadius, 1e-4));
  const intervals = Math.min(CAP, Math.max(2, needed));
  if (needed > CAP) {
    const spacing = length / intervals;
    console.warn(
      `blob-checks: primitive on limb "${prim.limb}" (length ${length.toFixed(3)}, effective ` +
      `radius ${effRadius.toFixed(4)}) would need ${needed} sampling intervals to keep spacing ` +
      `at or under its own radius, but clearOf caps sampling at ${CAP} intervals to bound cost. ` +
      `Actual spacing is ${spacing.toFixed(4)} (${(spacing / effRadius).toFixed(1)}x the radius) ` +
      `— a crossing primitive of comparable or even GREATER thickness than this one could now be ` +
      `stepped over and missed, producing a false "clear". If this fires for a real character, ` +
      `thicken the primitive, shorten it, or split it into multiple bones.`,
    );
  }
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

/**
 * How much AIR there is between two clusters' surfaces, in metres, ignoring
 * the region right around where they join.
 *
 * `clearOf` and this answer different questions, and the goblin needed both.
 * `clearOf` samples a primitive's AXIS and reports the other cluster's field
 * there, so it detects one limb's centreline entering another's flesh — real
 * interpenetration. It says nothing about daylight, because two surfaces can
 * be a hair apart while both centrelines stay comfortably outside each other.
 * Measured on the goblin before this was fixed: `clearOf(armL, torso)` read a
 * healthy +13.4 mm while the upper arm's SURFACE was 5.4 mm from the torso's,
 * and the owner's verdict on the render was that the arms were fused to the
 * body. A limb reads as a limb when there is visible space around it, and no
 * check in this file measured that.
 *
 * So: subtract each sampled primitive's own effective radius, giving surface-
 * to-surface distance rather than centre-to-surface.
 *
 * `join` / `joinRadius` exist because an ATTACHED limb is deeply negative by
 * construction at the attachment — the goblin's shoulder ball sits 38 mm
 * inside the torso, which is the join doing its job, not a defect. Without
 * excluding it the answer is always "deeply merged" and carries no
 * information. Pass the attachment point (the clavicle tail, the hip) and a
 * radius that covers the joint, and the result describes the limb's free
 * length only.
 *
 * DELIBERATELY ONE-DIRECTIONAL, unlike `clearOf`. `clearOf` has to sample both
 * ways because "is a centreline inside flesh" is asymmetric — a thin prim's
 * axis can sit deep inside a fat one while the fat one's axis stays far
 * outside. Surface-to-surface distance is not asymmetric like that: walking
 * `limb` and reading `against`'s field already measures the air on both sides
 * of the gap, so a torso ring bulging out toward a thin arm shows up as the
 * arm's own clearance shrinking. Sampling the second direction adds nothing
 * and actively breaks the join exclusion, because a torso ring's SAMPLES sit
 * on its centreline — metres from the shoulder, and so never excluded — while
 * its SURFACE is right at the join. That reported the goblin's healthy arms as
 * -38 mm: the chest cap's own radius, measured against the shoulder it is
 * supposed to be welded to.
 */
export function daylightOf(
  body: Field, limbC: ClusterInfo, against: ClusterInfo, join: Vec3, joinRadius: number,
): number {
  const field = restrictedTo(body, [against]);
  let worst = Infinity;
  for (const prim of body.prims.slice(limbC.start, limbC.start + limbC.count)) {
    if (prim.op === 'sub' || prim.dead) continue;
    const eff = prim.radius * Math.min(...prim.scale);
    for (const p of samplesAlong(prim)) {
      if (len(sub(p, join)) < joinRadius) continue;
      worst = Math.min(worst, sdBody(p, field) - eff);
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Knee stance
// ---------------------------------------------------------------------------

/**
 * Signed forward offset of the knee from the straight hip-to-ankle line, in
 * metres. Positive is FORWARD (+z): a humanoid knee. Negative is a backward
 * hock — a hound, a kangaroo.
 *
 * Returns null when the character has no leg chain by these names, so a body
 * that simply has no legs is not reported as having the wrong kind.
 */
export function kneeOffset(
  bones: Map<string, { head: Vec3; tail: Vec3 }>, side: 'l' | 'r',
): number | null {
  const thigh = bones.get(`thigh.${side}`);
  const shin = bones.get(`shin.${side}`);
  if (!thigh || !shin) return null;
  const [hip, knee, ankle] = [thigh.head, thigh.tail, shin.tail];
  const span = ankle[1] - hip[1];
  if (Math.abs(span) < 1e-6) return null; // degenerate: hip and ankle level
  const t = (knee[1] - hip[1]) / span;
  return knee[2] - (hip[2] + (ankle[2] - hip[2]) * t);
}

/**
 * Checks the knees fold the way the document declared.
 *
 * Both folds are legitimate — a beast wants the backward hock — but a knee
 * folded the wrong way by accident reads as a modelling error, and it also
 * fights the rig: `ik.poleReflect` exists because an unconstrained FABRIK
 * solve folded a knee backwards and KEPT it, which that code's comments call
 * the "cow walk". So the direction is declared in the `.blob` and verified
 * here rather than left implicit in the sign of a pitch.
 *
 * This is the first INTENT check in the format — the spec deferred that whole
 * category on the grounds that a turntable and an eye judge intent better. It
 * earns an exception because it has an unambiguous measurable definition, and
 * because the failure it catches actually happened: porting WAM's leg pitches
 * verbatim produced a kangaroo hock that passed every geometric check.
 *
 * `tolerance` ignores a knee within a few millimetres of straight, where the
 * fold direction is not meaningfully either way.
 */
export function checkStance(
  bones: Map<string, { head: Vec3; tail: Vec3 }>,
  stance: 'humanoid' | 'digitigrade' | null,
  tolerance = 0.004,
): string[] {
  // Null means the document declared no stance, so there is no intent to check
  // against. Accepted here rather than left to each caller to guard, because a
  // caller that forgets turns "undeclared" back into a guess — which is the bug
  // this parameter's nullability exists to prevent (see BlobDoc.stance).
  if (stance === null) return [];
  const errs: string[] = [];
  for (const side of ['l', 'r'] as const) {
    const off = kneeOffset(bones, side);
    if (off === null || Math.abs(off) <= tolerance) continue;
    const actual = off > 0 ? 'humanoid' : 'digitigrade';
    if (actual !== stance)
      errs.push(
        `leg ${side} folds ${actual} (knee ${off >= 0 ? '+' : ''}${off.toFixed(4)} m ` +
        `from the hip-to-ankle line) but the model declares stance ${stance} — ` +
        `flip the thigh/shin pitch signs, or change the declaration`);
  }
  return errs;
}

/**
 * The worst STRANDED primitive in a cluster: one whose surface never reaches
 * the rest of its own cluster's flesh, so it renders as a lump hanging in the
 * air beside the body it belongs to.
 *
 * Returns the gap in metres — positive means stranded by that much, negative
 * or zero means every primitive touches something. `null` when the cluster has
 * fewer than two additive primitives, which is not a failure: a one-prim limb
 * has nothing to be stranded from.
 *
 * WHY THIS IS NOT COVERED BY `fusedOf`. That check works between CLUSTERS, so
 * it asks whether the head joins the torso — never whether the pieces INSIDE
 * the head join each other. The soldier's flat-top was authored floating 13.5
 * mm clear of his cranium and shipped that way: it sits in the head cluster
 * alongside the skull, `fusedOf` was satisfied by the neck, and nothing looked
 * any closer. It only became visible when the pauldrons that hid it were
 * removed, weeks later.
 *
 * That is the second time. `lab-main.ts`'s reset button carries the first, from
 * 2026-08-23: "the schoolgirl's cranium stayed a skin dome above her hair".
 * Same shape of defect, found the same way — by eye, long after authoring.
 *
 * WHAT THIS DOES NOT CATCH, measured rather than assumed. It probes the
 * BLENDED field, which is what renders — so a gap that smooth-min bridges
 * reads as contact, correctly. The soldier's flat-top, the defect that
 * prompted this, measures −0.1 mm here: its box corner is close enough to the
 * cranium that the field never separates, and what looked like a floating
 * block was a shading artefact, not a disconnection. So this is a guard
 * against GROSS strands, not a visual-float detector. The 142 mm gap it did
 * catch — a flesh foot left hanging when the boots moved to the kit — is the
 * class it exists for.
 *
 * SUBTRACTIVE PRIMITIVES ARE SKIPPED. A carve is a hole; it is supposed to sit
 * where there is no flesh, and asking whether it touches anything is the wrong
 * question.
 *
 * The probe is the field of the cluster WITHOUT the primitive under test,
 * evaluated at points on that primitive's own surface. Sampling the surface
 * rather than the centre is what makes the number a real gap: a fat prim whose
 * centre is far from its neighbours can still be touching them.
 */
export function strandedOf(body: Field, c: ClusterInfo): number | null {
  const all = body.prims.slice(c.start, c.start + c.count);
  const additive = all.filter(p => p.op !== 'sub');
  if (additive.length < 2) return null;
  // Probed against the WHOLE body's additive flesh, not just this cluster's.
  // Restricting to the cluster looks tighter and is wrong: a primitive can
  // legitimately fuse to a NEIGHBOURING cluster and never touch its own
  // siblings -- the cyclops's brow sits 58 cm forward of the rest of its head
  // cluster and joins the torso, which a cluster-local probe reports as a
  // 422 mm strand. The question worth asking is "does this piece touch any
  // flesh at all", and that is a whole-body question.
  const everything = body.prims.filter(p => p.op !== 'sub');

  let worst = -Infinity;
  for (const p of additive) {
    const rest = everything.filter(q => q !== p);
    // One cluster holding every other additive primitive, with the cull sphere
    // opened right up: sdBody culls against it, and any bound tight enough to
    // be meaningful would drop real flesh and report false strands. This is a
    // check, not a hot path.
    const restField: Field = {
      prims: rest,
      clusters: [{ ...c, start: 0, count: rest.length, center: c.center, radius: 1e3 }],
    };
    // Surface points: along the primitive's own axis, pushed out to its
    // radius on each of the three axes. Cheap, and it brackets the surface
    // closely enough that the reported gap is the real one rather than a
    // centre-to-centre distance wearing a disguise.
    let nearest = Infinity;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const c0: Vec3 = [
        p.a[0] + (p.b[0] - p.a[0]) * t,
        p.a[1] + (p.b[1] - p.a[1]) * t,
        p.a[2] + (p.b[2] - p.a[2]) * t,
      ];
      // 26 DIRECTIONS, not 6 axis-aligned ones. The nearest point between two
      // primitives that are offset from each other is almost never on an axis:
      // with 6 samples the soldier's foot and shin read as 28 mm apart while
      // they overlap by centimetres, because every probe missed the contact.
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const n = Math.hypot(dx, dy, dz);
        const q: Vec3 = [
          c0[0] + (dx / n) * p.radius * (p.scale?.[0] ?? 1),
          c0[1] + (dy / n) * p.radius * (p.scale?.[1] ?? 1),
          c0[2] + (dz / n) * p.radius * (p.scale?.[2] ?? 1),
        ];
        nearest = Math.min(nearest, sdBody(q, restField));
      }
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}
