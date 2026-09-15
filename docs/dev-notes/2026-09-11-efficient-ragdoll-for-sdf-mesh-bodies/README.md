# Efficient ragdoll for SDF+mesh bodies — what already exists, and the two real gaps

**Owner, 2026-09-11:** *"i think we need some kind of efficient way to ragdoll the
SDF+mesh combined bodies hmm"*.

Written after reading the code rather than from memory, because most of what the
question asks for is already built and the interesting part is where it stops.

## 1. The ragdoll exists, and it is already one rig driving both halves

The SDF flesh and the mesh skeleton are **not two bodies to ragdoll separately** —
they are two renderings of one skeleton:

- `rig.ts` `stepRig` is a Verlet solver: integrate, damp, relax distance
  constraints, `constrainRigBends` (with a `floorY` contact), and a **rest-pose
  pull** (`restStiffness`) that is exactly the alive-vs-limp dial. `restStiffness: 0`
  is a ragdoll; the zombie's tuned standing value is 0.18.
- `collapse.ts` owns the limp ramp: `restPull` goes **1 → 0** over the fall, the
  wiring multiplies it into `stepRig` per frame (`game-actor.ts`: `restStiffness:
  STANDING_RIG.restStiffness * f.restPull`), and the state machine is
  `standing → falling → settled` (terminal).
- The fall is not a canned animation: it releases the foot pin (otherwise the body
  crumples around the pinned foot), adds ONE-SIDED max-distance **ropes** — because
  `RigConstraint` is an equality constraint, a full-length hip↔foot limit forbids
  the knee bending at all, so the crumple could never fold — and mirrors the chunk
  stepper's restitution/friction (0.55/0.72) so a corpse bounces and skids exactly
  like the gibs.
- **The SDF flesh follows the rig** through `applyRig(current, bound, yaw)`, which
  the actor already calls every frame, and the mesh skeleton follows the same bone
  transforms. So "SDF+mesh combined" is already the architecture: pose the rig
  once, both halves follow.

Measured consequence in another task: because the pose path re-packs every prim row
and refits every cull bound each frame anyway, a ragdolled body costs no more to
POSE than an animated one. The ragdoll itself is not the expensive part.

## 2. The efficiency answer also exists — for soldiers only

`webgpu/soldier-corpse-bake.ts` is exactly the "efficient way":

- a settled corpse waits **1.5 s of quiet**, then the torso/limbs are baked to a
  **static mesh** by the same worker that bakes gib chunks, and the SDF body is
  hidden — **except the head**, which stays on the exact SDF shader because its
  face and red eyes are textured (`corpsePartition(posed, head)`).
- one corpse in flight at a time (one worker), revision-checked against
  `damageRevision()` so new damage cancels and restores the SDF body.

**`game-actor.ts` gates it on one expression:**

```ts
corpseBakeEligible: () => soldierDamage && state.collapse.phase === 'settled',
```

So a **zombie corpse keeps paying a full SDF march for its whole torso and limbs,
for ever**, plus the whole motion pipeline, while a soldier's becomes a static mesh.

## 3. The two real gaps

1. **Zombies never bake.** Everything the bake needs is archetype-agnostic —
   `corpsePartition` is generic, and the snapshot reads `actor.posed()`,
   `actor.wounds()` and `view.uniforms` (the `look` fields come from the actor's own
   uniforms, so a zombie corpse bakes with the zombie's colours). The soldier-ness
   is in the gate and the function name, not in the mechanism.
2. **A settled corpse never sleeps.** `step()` has no short-circuit for
   `phase === 'settled'`: it still runs the sub-step loop, the motion pipeline, the
   verlet step, `applyRig`, the view upload and `refreshWounds` — the full animation
   pipeline at full rate, for a body that will not move again. For soldiers the bake
   eventually removes the marching geometry; for zombies nothing ever does.

Neither gap is about the ragdoll. Both are about paying for a corpse after it stops
being interesting.

## 4. The third thing, which is a ragdoll gap proper

The blast does **not** inject ragdoll momentum. On a body that survives, `blast()`
does a root knock (`BLAST_KNOCK_MPS` 1.2, horizontal, decaying) plus a single
`impulseAt` shove of ONE joint — and that shove was recently found to be passing a
**velocity in m/s where the function wants metres**, i.e. 25 m/s ≈ 25 m of
displacement (fixed: `shoveFromVelocity`, capped at 0.35 m). A physical ragdoll
flies because a VELOCITY is injected into the particles (`prev = pos − vel·dt` in
Verlet terms), not because one joint is teleported.

So the blast→ragdoll path wants: distribute the impulse across the rig's points as
a VELOCITY (weighted by distance to the blast, which the resolver already
computes), release `restPull` toward 0 for a body that took a lethal-but-not-gibbing
hit, and let the existing ropes + floor contact do the rest. That is a small,
well-bounded change to a mechanism that already works.

## 5. Proposed order, cheapest first

1. **A settled corpse sleeps** (lowest risk, largest CPU win, no visuals change):
   skip the motion/verlet/pose pipeline for `phase === 'settled'` bodies, and wake on
   damage. Measure: `passTimings()` + frame cadence with N live vs N settled bodies.
2. **Extend the corpse bake to zombies** — drop the `soldierDamage &&` gate, make
   the snapshot function archetype-neutral, re-check the corpse material and the
   head-stays-SDF partition on a zombie face. Measure: march cost with N zombie
   corpses before/after, and confirm a corpse is still gibable (the collapse doc's
   contract: "a settled corpse keeps its wounds and stays fully shootable/
   severable/gibable" — baking must not break that, which is a real question for the
   current soldier path too).
3. **Blast → ragdoll impulse** (the visible one): velocity injection distributed
   over the rig, `restPull` release on a non-gibbing lethal hit.

Each is separately shippable and separately measurable. Nothing here needs a new
solver, a new mesh pipeline or a second skeleton.

## 6. The cost measurement ATTEMPTED and why it needs step 0 first

`scripts/sdf-corpse-cost.mjs` was written to answer the cost question paired in one
boot (the same bodies, same camera, first LIVE then settled). **It could not, and the
reason is the first thing to fix:** there is no way to collapse a body on demand in
the game. The `forced` trigger exists in `collapse.ts` but the page never sets it —
the live triggers are the wound METER and both-legs-severed (`forcedCollapse` is
wired in `lab-main.ts` only). So the only way to make a corpse is a blast, and a
blast also gibs the neighbours:

| attempt | result |
| --- | --- |
| 3 blasts at one body | roster 23 → 23, but **22 standing and 1 settled** — not a sample |
| 2 rounds, AOE narrowed to 0.6x, one blast per body | roster 23 → **12 actors**, 9 live chunks left |

Every arm therefore changed the ACTOR COUNT, so the cadence comparison measured the
gibbing rather than the corpses: the same claim read **+7.6 ms** and **−1.4 ms** in
consecutive runs. Both numbers are noise and neither is quoted as a result.

Hence **step 0: a `__sdfGame.collapse(id)` seam.** It is a few lines, and the sleep
(1) and the bake (2) both need it to be testable at all — a bake test needs a corpse
that has not been blown up, and a sleep test needs the same actor count either side.

## 7. What decides the shape of this

The measurements above are NOT taken yet — this note is the design, and every
number in it is a citation of an existing one. Before building step 2 or 3, measure:

- **cost per settled corpse per frame** (live vs settled, `passTimings()`), which
  says whether the sleep (1) is worth more than the bake (2);
- **how many corpses the game is expected to hold** — 23 actors is today's roster,
  and a pile of 50 corpses is a different problem from 23;
- **whether a baked zombie corpse still reads as gore** — the owner judges that, not
  a rig.
