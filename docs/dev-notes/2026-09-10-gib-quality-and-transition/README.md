# Gib quality — bones, piece shapes, and the body→gib transition

**Date:** 2026-09-10 · **Branch:** `claude/dynamite-weapon-slot` (worktree)
**Owner brief:** *"i still dont see anything bone related like idk rib cage or
something… when the SDF body is gibbed it just breaks into like tubes (arms and
legs) and orbs (torso) which doesnt really read as gibs. There also needs to be
work done about the transition from body -> gib… it doesnt read quite that the
explosion is ripping through the SDF body and tearing it apart — its like the
body disappears and suddenly some pink tubes and balls are flying through the
air."*

## Decisions taken (owner, 2026-09-10)

| Question | Answer |
| --- | --- |
| Pre-bake scope | **Once per body archetype**, not per spawn. |
| Cap sealing | **Cap each part's cut plane at bake time.** |
| Torso | **Split it.** |
| Arms and legs | **Do NOT keep them whole** — a limb must not survive as one tube. |

## 1. Why no bones are visible — evidence, not a guess

The zombie has them and they are being passed:

```
zombie: prims 23, clusters 6, bonePrims 21
clusters: head(5) torso(4) armL(4) armR(4) legL(3) legR(3)
bones per cluster: [3, 4, 4, 4, 3, 3]
gibAll (clusters, the default) -> 6 chunks, bones carried 3,4,4,4,3,3
gibAllPieces (pieces)          -> 19 chunks, bones carried 3,0,0,0,0,…  ← bone-free by design
```

So the gib **is** carrying 3–4 bone prims per limb chunk. The reason none of it
reads is WHERE those bones are drawn, and there are two separate causes:

1. **They are inside the meat.** With the shipped `boneMesh = false`
   (`game-main.ts`), a chunk's bones are packed into the marched field as more
   SDF capsules — unioned with the flesh that encloses them. An intact limb
   chunk is a pink tube with an invisible femur inside it, which is exactly what
   the owner is looking at. Bones only appear where flesh has been CARVED away.
2. **`?boneMesh` (the instanced bone-tube path, ships OFF) does not fix this
   either.** `applyBoneMesh` renders bones as tubes for actors and live chunks,
   but its crater exposure (`boneInstancer.setWounds`) is fed from ACTOR visual
   wounds only — a detached chunk's own wounds are not in that list, so a chunk's
   bones stay buried there too.

**The fix direction is not "make the existing bones visible" — it is to release
the skeleton as its OWN pieces.** Part of the machinery already exists:
`melt.ts` / `melt-bones.ts` partition a body's bones into groups (`BONE_GROUPS`,
`partitionBones`, `releaseOrder`, `MELT_BONE_RELEASE_U`) and `gib-chunks.ts`
already has a `'bone'` chunk kind with its own tuning ("bones THUD where flesh
chunks skip"). A blast should spawn the skeleton as bone chunks alongside the
flesh pieces — a scattered ribcage, spine, femurs — which is what "rib cage or
something" is asking for, and is what makes a pile read as gore rather than
tubes.

## 2. Arms and legs must break up

`gibAll` (clusters) is one chunk per LIMB — the arm is one tube, the torso one
orb. That is the shape the owner rejected. Combined with the decisions above
(torso split, limbs not whole), the piece set should be:

- **Torso → 2–3 pieces** (chest / abdomen / pelvis), cut on planes.
- **Each limb → 2+ pieces** (upper / lower), cut at the joint.
- **Head** → stays whole (its face carves and skull sphere do not survive being
  split — the existing `gibAllPieces` rule for the head, and Blood's own).
- **Skeleton → its own bone pieces**, per §1.
- **Organs** — the field already has an organs fold and `setPackBones` counts
  them; they are another candidate for their own small pieces.

The cut planes are the same data the pre-bake needs (§4), so this and the
pre-bake are ONE change, not two.

## 3. The body→gib transition — a staged design

The jarring read has four separate causes, and they are worth fixing in this
order because the first two are nearly free and carry most of the effect:

**(a) The swap is instant and total.** Today `gibActor` calls `retireActor`
(hiding the body) and spawns every chunk in the SAME frame. There is no frame in
which the body is still there. *Fix:* spawn each piece **at its current posed
transform with ZERO velocity**, and apply the blast impulse over the next 1–3
frames. Frame 0 then shows the body's own silhouette, in place, and it comes
apart from there.

**(b) Nothing is staggered.** A blast that removes a body in one frame reads as a
swap however good the pieces are. *Fix:* release pieces over 2–4 frames, nearest
the blast first, so it reads as the blast ripping outward through the body rather
than a substitution. This needs a small pending-release queue (a few frames of
state), not new geometry.

**(c) The flesh does not react before it tears.** This is the owner's own idea —
*"the SDF flesh potentially allows us to distort the flesh from the shockwave and
jiggle and then rip away"* — and it is the right one. The march already supports
per-prim displacement (wounds carve, the rig re-solves, `bodyFlash`/impulse paths
exist), so a **short pre-tear window (~0.1 s) in which the marched flesh is
pushed outward from the blast and jiggles** is a per-frame uniform plus a shader
term, not a rewrite. It gives the blast a visible beat ON the body before the
body stops existing. Cost: a shader branch and a uniform update; it is the
largest of the four, and the one that makes it read as *ripping*.

**(d) Nothing covers the swap.** Answering the owner's "how would the explosion
hide some of this": a **short-lived, body-sized debris/smoke puff centred on the
BODY at the moment of the swap** (~0.15–0.25 s). The explosion's burst already
exists and has a smoke layer; this is that layer, localised to the body rather
than the blast point. It hides the exact frame(s) where the representation
changes, which is what makes the pre-baked-mesh swap invisible.

## 4. How pre-baked MESH parts transition smoothly (the owner's question)

The concern is real: the gib becomes mesh while the body is SDF, so where does
the seam show? Three mechanisms, in combination:

1. **Exact rigid placement.** A part mesh is baked in the bone/segment's own
   frame, so at the instant of release it can be placed at the LIVE rigid
   transform sampled from the posed rig (`fitRestToPose`/`applyRigidYaw` in
   `game-weapon.ts` already do exactly this fit for severed pieces). Frame 0 is
   then geometrically identical to the SDF body, not an approximation of it — the
   pop reduces to a shading difference, not a shape difference.
2. **Cut planes are capped at bake time** (owner decision), so a released piece
   has real flesh on its cut face instead of an open shell — which is also what
   makes the piece read as MEAT rather than a tube.
3. **The swap happens behind the debris puff** of §3(d). Even a visible shading
   change is invisible if it occurs on the one or two frames the body is covered.

Remaining honest risks: a pre-baked part cannot show damage the SDF body had
accumulated (a wound crater on a thigh that then gibs), so either the parts need
a wound-decal pass or the piece inherits the body's wound carves for its first
frames; and per-archetype caching means a body that was already missing a limb
(the arm shot off earlier) must not emit that limb's part — the `alive` flags
already carry that information, so the release must read them.

## 5. What has been built since this note — 2026-09-11

**§1, §2 and the piece-set half of §4 are IMPLEMENTED** in
[`src/lab/sdf-zombie/gib-parts.ts`](../../../src/lab/sdf-zombie/gib-parts.ts)
(+ 13 tests), wired into `gibActor` in `game-main.ts`. **§3(a) and §3(b) are
implemented.** §3(c), §3(d), the mesh pre-bake of §4 and the whole of §5's
"not done" list below are NOT.

### The piece set, as built

| Cluster | Pieces | Rule |
| --- | --- | --- |
| torso | `chest`, `abdomen`, `pelvis` | pelvic-bone prims are the pelvis; the spine prims split at the middle of their own axial extent along the BODY's cranial axis (torso centre → head centre), not world Y — a blasted actor may be lying down |
| each arm | `upper`, `lower` | by authored bone name (`clavicle`/`upperArm` vs `foreArm`/`hand`) |
| each leg | `upper`, `lower` | same (`thigh` vs `shin`/`foot`) |
| head | `head` (whole) | as decided |
| skeleton | `bone.skull`, `bone.cage`, `bone.pelvis` + the eight long bones | `partitionBones`, released as **bone-only** chunks (`prims: []`, bones passed as the chunk's bone rows) |
| organs | `organ.gut` | the gut coil, which the melt already treats as its own soft group |

Measured on the two shipped bodies: **zombie 24 pieces (12 flesh + 11 bone + 1
organ)**, **soldier 19** (7 bone groups — he authors no arm bones). The bone
names differ between them (`upperArm` vs `upperarm`), so every rule is
case-folded; a rule that matched one spelling would have silently left that
cast's limbs whole again.

### Cut planes are capped — and the neighbours still meet

Two mechanisms, both in `gib-parts.ts`:

1. **Seal.** Each side's boundary prim is extended ALONG ITS OWN AXIS to the cut
   plane, so the two capsule ends land on the same plane.
2. **Cap.** Each side gets a `sub` blob centred `R` beyond its own cut plane.
   A sphere of radius `R` centred `R` past a plane removes everything past it to
   within `t²/2R` — flat to a millimetre over any piece here, and the two sides
   cut at the SAME plane so their union is continuous at release. `sub` prims
   are skipped by `chunkExtent`, so the sphere costs no proxy-box volume.

A cut at exactly the plane *under-covers* the body: the surface between two
blended prims is the smooth-min fillet, which belongs to neither prim, so both
sides lose it. Each side therefore carves `2 × blendK` PAST the plane
(`GibCut.overhang`), which puts the fillet back doubled — invisible while they
are co-located, and gone the instant they move.

**Measured (frame-of-release silhouette fidelity).** Sample the original body's
surface; ask whether the union of the pieces is still there:

| piece set | surface points missing by >2 mm | >5 mm | >10 mm | worst |
| --- | --- | --- | --- | --- |
| `gibAll` (the old one-chunk-per-limb) | 3.66% | 2.23% | 0.98% | 27 mm |
| `gibParts` (this) | 5.39% | 3.27% | 1.44% | 27 mm |

The residual is the CLUSTER SEAM, which no per-cluster piece set can fix — the
armpit and the crotch blend between two clusters, and `gibAll`'s worst is the
same 27 mm. The split set adds ~1.7% of surface with a >2 mm difference, which
is the within-cluster cuts.

### The staged release, as built

`gibActor` spawns every piece **at its current posed transform with ZERO
velocity** and QUEUES its concussion impulse (`pendingGibImpulses`), keyed by
chunk id with a **delay counted in DRAINS, not frames**. Pieces are ordered
**nearest the blast first** and released in `gibStaggerFrames` (default 3)
wavefronts, so frame 0 shows the body's own silhouette in place and the body
then comes apart outward from the epicentre. `?gibstagger=1` is the A/B control.

WHY DRAINS, AND WHY AT LEAST ONE. The drain runs LATER IN THE SAME TICK as the
detonation (`stepDynamite` is before the chunk step in `tick`), so a
frame-indexed queue released the first wave *before the first frame was drawn* —
the opening frame of the explosion showed pieces already 8 cm out of place,
which is the substitution this whole stage exists to prevent. Counting drains, a
delay of 0 still means "not in the tick the blast happened in", and every piece
gets at least one full frame at rest. (A frame-indexed "+2" would have worked
and would have broken silently the day someone reordered the tick.)

**MEASURED, frame by frame** — `node scripts/sdf-gib-look.mjs 5391 9391`, which
writes the release sequence as PNGs and refuses to pass if two consecutive
frames are byte-identical:

| frame | held impulses | delays |
| --- | --- | --- |
| 0 | **24** (all) | 0×8, 1×8, 2×8 |
| +1 | 16 | 0×8, 1×8 |
| +2 | 8 | 0×8 |
| +3 | 0 | — |

and the same run prints what the body became, BY NAME:
`bone.cage bone.skull bone.pelvis bone.upperArm.l/r bone.foreArm.l/r
bone.thigh.l/r bone.shin.l/r torso.chest torso.abdomen torso.pelvis
armL/armR/legL/legR upper+lower head organ.gut` — 24 of 24 pieces, tier `parts`,
0 dropped.

### The pool, and what happens when it cannot afford the gib

Two bugs came out of the measurements, both of which hid bodies:

- **The old budget was `maxChunks − liveChunks.length`.** In a full pool that is
  zero, so a blast's bodies were each given ONE piece and retired anyway — two
  of the arena's three gibbed bodies simply disappeared. The budget is now the
  blast's whole capacity: pre-existing live pieces + unallocated views. A spawn
  recycles a pre-existing chunk or creates a view, so a blast kept inside that
  number can never recycle a piece it just made (which is the original reason
  the slice existed).
- **The shape now degrades before the count does.** Tiers, computed lazily and
  handed out greedily nearest-first with one floor (`GIB_TIER_FLOOR` = 7, six
  limb chunks plus THE RIBCAGE — see below) held back for every body still to
  come: `parts` (24) → `parts-core` (15, drops the eight limb bones but keeps the
  skull and the three torso masses) → `clusters+core` (9: six limb chunks plus
  skull, cage and pelvis as bone-only pieces) → `clusters+cage` (7: six limb
  chunks plus the ribcage ALONE) → `clusters` (6) → a nearest-first slice.

  **THE FLOOR IS 7 BECAUSE OF WHAT 6 DID, and it took the bone census to see
  it.** A reserve of six slots lets a crowded blast spend every body's allowance
  on the shape whose bones are BURIED — and in the arena, the room the owner
  tests in, a point-blank bundle gibs FIVE bodies, so every one of them came out
  with `bonePieces 0`: no visible skeleton at all, his complaint reproduced by
  the ALLOCATION rather than by the asset. With the floor at 7 and the
  `clusters+cage` rung, the same blast leaves the last body holding
  `armR legR torso bone.cage legL head armL` — the ribcage survives even in the
  cheapest rung it uses.

  **THE LADDER USED TO PUT THE SKELETON BACK IN THE MEAT, AND THE BONE CENSUS
  IS WHAT CAUGHT IT.** A rung of twelve bone-free flesh pieces sat between
  `parts-core` and `clusters`, and in a tight pool it won on piece count — so a
  degraded blast spent a body's whole allowance on meat and the next body's on
  six chunks with their bones packed inside. Measured: `bonePieces 0`. That is
  the owner's complaint reproduced by the FALLBACK rather than by the asset, and
  it is the kind of thing a piece-count knob can never show. The bone-free shape
  is still reachable (`?gibbones=off` makes it the first tier, so it needs no
  rung), and the rung that replaced it buys the skull, ribcage and pelvis for
  the three slots it costs.

### THE POOL SHIPPED AT EXACTLY ONE BODY'S WORTH — the owner's look pass, explained

The owner played the pass and reported: *"i didnt see any skeleton chunks and the
gib parts still looked like tubes and orbs"*. The piece set was not broken and
neither were the bones: **`?maxchunks` shipped at 24, which is EXACTLY the size
of the split piece set**, and the pool is GLOBAL — it holds the debris of every
blast that came before, for the life of each piece. So one body could have the
full set and no other could. A blast that gibs three bodies gave the first one
`parts-core`, then walked the rest down to `clusters+cage`: six tubes with their
skeleton packed inside them, plus a single visible ribcage.

Measured by `node scripts/sdf-pile-crowding.mjs 5391 9391 24 64` — five blasts
in a row in the arena, twice, byte-identical both times:

| blast | `?maxchunks=24` (the old default) | `?maxchunks=64` (shipped now) |
| --- | --- | --- |
| 1 body (a soldier) | `parts:19` — pile 19/24, bones visible | `parts:19` — pile 19/64 |
| 3 bodies | `parts-core:16`, then **`clusters+cage:7`**, 17 pieces of that body DROPPED and 18 recycled on the frame they were born; pile `buriedBonePieces 6`, and the last body's piece list contains ONE bone name | **`parts:24`, `parts:24`**; pile 28 bone pieces over 154 bone rows, `buriedBonePieces 0`, 11 bone names in the last body |
| 4-6 bodies | `parts:24` — the newest blast EVICTS the old pile to pay for itself | `parts:24` |

Two things that table says which are easy to get wrong:

- **A single-body blast does NOT suffer, even in a full pile.** At 24/24 the
  next gib still gets the whole split set, because recycling the old debris pays
  for it. It is the blast that gibs SEVERAL bodies at once — the arena, where a
  point-blank bundle gibs 3-5 — that cannot afford them all.
- **The PILE reading "a ribcage survives" is not the same claim as the BODY
  having a skeleton.** `buriedBonePieces 6` and "the ribcage is in there" are
  both true of the same frame: `clusters+cage` is six tubes with buried bones
  PLUS one bone-only cage, and "bone names in the last body: 1" is that cage.
  A census taken over the pile answers a different question from "what did the
  body I just blew up become" — which is why `__sdfGame.dynamite().gibTierLog`
  now records EVERY body's rung in a blast instead of only the last one.

**The default is now 64, and every one of these numbers is a slider in the
panel** (see below), so the owner can find his own pool size rather than argue
with mine. The wider pool costs nothing on the frame cadence — re-measured at
the new default (`sdf-piece-cost.mjs`, 61 pieces live of 64): **16.70 ms in both
arms, paired difference 0.00 ms across all eight bursts**, `sdf:march` 12.82
shown vs 12.42 hidden.

### The gate passed through all of it, which is its own finding

At the old default the gate's gib probe printed `lastGibTier: clusters+cage`,
17 pieces dropped, *"18 of this gib's pieces recycled immediately"* — and
**PASSED**. The bone-census assertion is conditional on
`lastGibTier === 'parts'`, so the degraded tier skipped the check: the assertion
covered exactly the case that was fine and not the case that was broken. The
gate now asserts that the SHIPPED configuration does not degrade the last body
of a multi-body blast (`GATE_QS` knob runs stay exempt and print the row), and
the assertion was proven to FIRE by setting the default back to 24 and watching
it fail with the owner's own condition.

That falsification run then taught a second lesson: **it first reported 64 and
passed, because Chrome served a CACHED transform of `game-main.ts` while vite
was correctly serving the edited file.** Both the gate and the new rig now call
`Network.setCacheDisabled`. A rig whose numbers do not move when the source
does is measuring the cache. The same trap is the leading explanation for an
owner look pass that disagrees with the measurements — **hard-reload the tab.**

### The tuning panel — so the next look pass needs no agent

The owner asked for it in those words: *"or if you want me to manual tune please
add another tuning panel that is collapsible"*. `webgpu/dynamite-panel.ts` is
the fourth slot (right:782px) beside GOO/WOUND/VHS: visible, collapsed, hidden
with the others on `H`.

Its 19 rows come from ONE key table, because "a tuning that LOOKED applied and
was not" has now shipped twice in this project (the beam panel's `setBeam` keys,
then goo) — `dynamite-panel.test.ts` pins every key against `applyDynamiteTuning`'s
switch cases and against the COPY text, so the table cannot drift from the page.
The presets are the comparisons worth one click: **`split`** vs **`tubes (old)`**
(the A/B of this very report: the split piece set with a pool that does not
degrade it, against one-chunk-per-limb) and **`plume`** vs **`ball (old)`** for
the burst. Every gib knob is now `let`, so nothing needs a reload.

### The skeleton, as the PAGE sees it — 2026-09-11

`chunkCensus()` reports what each live piece was spawned AS against what it will
RENDER as, because those are two different claims and only the second one is the
owner's complaint:

| counter | meaning |
| --- | --- |
| `bonePieces`, `boneRows` | bone-only pieces whose view carries `meltCfg.x = 1` (the pale matte branch is the only thing in the shader that paints bone as bone) AND has its rows packed — the piece exists, is pale, and has bone to paint |
| `bonesShadingAsMeat` | a bone piece that lost either: present in the pile, invisible, the failure the whole piece set exists to end |
| `buriedBonePieces` | a FLESH piece carrying bone rows — the cheap `clusters` tier's signature, bones unioned inside the meat that encloses them |
| `organPieces`, `organsShadingAsBone` | the gut coil piece, which is deliberately NOT pale (it tints as viscera) |

The dynamite gate asserts five things about them, and the numbers are in TASKS.md.

### "You can see it" — measured in the frame, not argued

The counters above prove a bone piece is FLAGGED as bone. Whether it reaches the
FRAME is a separate claim, and `scripts/sdf-gib-look.mjs` now measures it by
hiding the bone pieces and asking the RENDERER: the march-target `frameHash`
changes when they go (`2955303833` -> `3281067244`) while a no-change control
reads identical, so the skeleton is in the marched frame, deterministically.

**IT TOOK THREE ATTEMPTS TO GET AN INSTRUMENT THAT COULD SAY THAT**, and each
failure is a trap this repo already documents somewhere:

1. The first version toggled visibility and read the canvas WITHOUT drawing a
   frame. `presentedShot()` returns what was last PRESENTED, so it returned the
   pre-toggle image: "hiding every piece changes 0 px". The same trap as the
   release-frame capture, one layer up.
2. The second added an explicit draw after each toggle. It then reported the
   bone-only diff LARGER than hiding everything — impossible, so the harness was
   unsound: the explosion VFX ages in the RENDER path with its own dt, so with a
   burst still alive (1.15 s) every draw is a different picture. The no-change
   control read 55k px.
3. The third waited for the burst and compared against an EMPTY scene, where the
   skeleton's own pixels came to ~1.7k against a 3.3k noise floor — inconclusive,
   and it is `frameHash`'s header that says why: *"the frame hash measures the
   march target and not the presented image"*, because the presented image is not
   a deterministic function of the frame.

The lesson is not "the pixel differential is bad" — it is that this repo already
has the deterministic instrument, and a shape/visibility question should reach
for it BEFORE spending three attempts on screenshots.
`gib-parts.test.ts` proves the piece SET; this is the wiring, which is the half a
unit test cannot reach (a recycled chunk view that kept a stale `meltCfg` would
render a bone-coloured arm).

### Cost, measured (arena, horde, 3 blasts per boot, median)

`lastBlastMs` medians at `?maxchunks=` 24 / 48 / 64: **17.6 / 18.4 / 17.9 ms** —
the cap is nearly free on the blast's CPU path, which the resolver dominates.

**THE MARCH NUMBERS BELOW WERE WITHDRAWN — they compared two STATES on an
instrument that drifts more than the effect.** The same state read 2.6, 3.8 and
18.8 ms in one boot, so "5.1 → 6.7 ms at `?maxchunks=24`, 4.0 → 13.1 at 48" is
inside the noise. The measurement was redone PAIRED AND INTERLEAVED and is in
[2026-09-11-piece-cost-and-the-pre-bake-decision](../2026-09-11-piece-cost-and-the-pre-bake-decision/README.md):
**≈ 0.5 ms per frame per piece that is IN FRAME** (24 pieces ≈ 0.5 ms; 64 pieces
with 9 in frame ≈ 4.8 ms), and off-screen pieces are nearly free. On that
evidence the §4 mesh pre-bake is **declined** — its prize is a few ms for the
~1 s a gib is airborne, and it would put back the pose seam at release and the
pristine-parts problem. The default stays at 24.

### Why the pre-bake of §4 is not here yet, and why the seam is smaller than the note assumes

The note's §4 assumed the pieces become MESH and worried about the seam that
would show where a mesh meets the still-SDF body. **SDF pieces make that worry
moot**: they march with the body's own template uniforms (the same path a
severed limb has always used), so the swap is a shape question, not a shading
one — and mechanism §4.1 ("exact rigid placement") is strictly better served by
a piece that IS the field than by a mesh baked at a rest pose. What remains of
the pre-bake is its PERFORMANCE argument, which the table above now quantifies,
and the "cap each part's cut plane at bake time" decision, which the cut-sphere
cap above already delivers in the SDF path.

### §3(c) — the pre-tear window — has a prerequisite nobody knew about

The cheapest mechanism for "the flesh bulges outward and jiggles before it
tears" is pumping the struck actor's `woundCfg.z` (rim splay): it is the ONLY
existing uniform that everts flesh outward, it costs zero shader edits, and it
is not in the wound cull's reach formula so it is safe to animate. **It cannot
run today**: a gibbing blast takes the `pb.gibbed` branch in `detonateAt`, which
`continue`s without calling `a.blast()`, and `gibActor` retires the actor in the
same frame. There is no live body to bulge and no wound stamped on it. §3(a)/(b)
— what is now built — is the prerequisite, and the next session's step is to let
the body outlive the swap for the ~0.1 s window (and stamp `pb.wounds` on it).

### §3(c), the pre-tear distortion — BUILT 2026-09-11

The body is now BENT by the shockwave for ~0.1 s before it becomes pieces:
`src/lab/sdf-zombie/gib-tear.ts` (+7 tests) displaces every posed prim outward
from the blast, weighted `e^{-d/0.6}` and shuddering at 20 Hz, and
`?gibtear=<seconds>` (default 0.1, `0` is the old instant swap) sets the window.

**It is a JS prim displacement, not a shader term, and the design note was
wrong about the cost.** Checked against the source: `wounds carve` is per-WOUND
(radial around a crater, and a gibbing blast stamps none), `bodyFlash` is
colour-only, and NO uniform anywhere displaces the marched field per prim — a
new one has to be threaded through `mapBody`'s 19-parameter positional
signature, its 13 call sites, the material's positional bindings and the
chunk-view copy list. The POSE path, by contrast, already re-packs every prim
row and recomputes every cull bound every frame, so displacing the posed prims
costs one pure function and nothing else. It is the idiom `fpv-mode`'s hand
jiggle has shipped since the goblin arms.

**VIEW-ONLY.** `tearPosed` returns a copy and the actor's `posed()` stays clean,
so the resolver's traces, the wound ring and the gib's own piece set all see the
body as it is. That is also what makes the hand-off exact: the pieces are built
from the clean posed body, so the frame the body disappears is the frame the
pieces are, in the same pose. The cluster spheres are refitted through
`rig-bind.refitClusters` (extracted for this: an under-covering bound CULLS, and
extent.ts warns about a ninth site computing that recipe).

**THREE BUGS, all found by the gate and the look rig rather than by review:**

1. `tearing()` stayed true past the window's end, so bodies bent for ever and
   never gibbed (the predicate compared the age against a literal-typed tuning
   field).
2. **The window's clock lived in the body's `step()`, which is SKIPPABLE.**
   `?frozen=1` skips the whole body block — and every capture rig runs frozen —
   so a body mid-tear was never drawn bent and NEVER GIBBED. The clock is now an
   explicit `stepTear(dt)` that game-main drives for the bodies it has queued,
   which also re-draws the bent body on frames the body itself did not step.
3. The deferred spawn's piece counter was never incremented (the census counted
   only the blast frame), and the gate's probe read the census at the blast
   frame — where the count is legitimately ZERO — so a gib that plainly happened
   was reported as none. Both are fixed, and the gate now asserts the WINDOW:
   at the blast frame the body is still there, still tearing, with no pieces;
   after it, the roster has shrunk and the pieces exist.

**MEASURED, frame by frame** (`node scripts/sdf-gib-look.mjs 5391 9391`, frozen,
which is the mode the window had to be made to survive):

| frame | tearing | what is drawn |
| --- | --- | --- |
| 0–2 | 1 (age 0.017 → 0.084) | the BODY, bent outward from the blast and shuddering |
| 3 | 0 | 24 pieces, all impulses held (delays 0/1/2) — the hand-off |
| 4 | 0 | 16 held (wave 1 away) |
| 6 | 0 | 0 held |

### §3(d), the debris puff, is no longer needed either

§3(d) exists to hide the ONE frame where the representation changes — §4's
pre-baked mesh replacing an SDF body. **There is no such frame.** The pieces ARE
SDF, they march with the body's own template, and they spawn at their posed
transform with zero velocity: frame 0 is the body's own silhouette, measured
(24 impulses held, `sdf-gib-look.mjs`). A body-sized puff would therefore buy
nothing except a layer between the player and the gore he is judging — and he
already cut `?fxsmoke` to 0.38 for exactly that. It stays unbuilt unless he
wants debris for its own sake.

What IS still missing from §3 is **(c), the pre-tear distortion** — the flesh
reacting to the shockwave before it tears. That one is real, it is the owner's
own idea, and it is blocked on a prerequisite rather than on taste: a gibbing
blast stamps no wounds on the body and retires the actor in the same frame, so
there is no live, marched body for the shockwave to distort. Keeping the actor
alive (frozen, invisible to the AI) for the ~0.1 s window is the first step, and
it is a state the game does not have today.

## 6. Originally not done in this pass (kept for the record)


Everything above is design; only the diagnosis in §1 is new evidence. The pause
work (the two perf commits before this note) was the priority because it was the
"obviously bad" one. The pre-bake is a session of its own, and §2 + §4 mean it
should be done as one change: split the piece set, cut and cap the planes, bake
per archetype, release at live rigid transforms.
