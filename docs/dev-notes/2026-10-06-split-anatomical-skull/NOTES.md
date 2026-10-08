# The head split on the anatomical skull (2026-10-06)

Branch `claude/split-anatomical-skull`, stacked on the anatomical skull's branch (`codex/anatomical-skull`, PR 32) after
`main` (the axe and the head split, PR 31) was merged into it. Not pushed when this was written.

Read first: the head split's [handoff](../2026-10-04-head-split/HANDOFF.md) and
[spec section 10](../../superpowers/specs/2026-10-04-axe-and-head-split-design.md), and the anatomical skull's
[notes](../2026-10-06-anatomical-skull/NOTES.md).

## Where this started

The head split was built on the sculpted skull: one thin closed shell, carved out of the head's bone envelope. A split
head draws that skull once per piece (the rest, the + half, the - half), each copy turned about the hinge by its bone
angle and clipped along a ragged fracture. The anatomical skull then replaced the sculpt as the default: fourteen
plates with real thickness, drawn two-sided, which pellets and slugs knock out one at a time. The merge of the two
left four things wrong on a split head with the anatomical skull:

1. the split copies were drawn on the sculpted skull's split material, so the plates were painted with the sculpt's
   sockets and tooth rows;
2. every back face was painted as a dark inner wall, which is right for a thin shell and wrong for a plate whose
   inside is its own geometry;
3. a shot was tested against the plates where the CLOSED head has them, and a plate that broke left from the closed
   head's frame, although the bone of an open half is drawn somewhere else;
4. `scripts/head-split-gate.mjs` was pinned to `?skull=sculpt`. Unpinned, 79 of its 80 checks passed and the skull's
   eye landmark failed at 6.80 px against a 5 px bound.

All four are fixed on this branch. The closed head and the sculpted skull's split (`?skull=sculpt`) draw as before.

A review of the branch then found two more gaps, neither a regression, and both are closed here as well:

5. **bone standing in the open gap could not be shot.** The projectile loop finds a hit by tracing the flesh, and the
   skull was tested only from the flesh impact onward. The bone of a split head opens less than its flesh, so it
   stands in the V with no flesh in front of it, and a round on a line through it met nothing;
6. **no gate check looked at a split plate's pixels.** The eye landmark hides the bone, the material check reads
   names, and the bone's turn was read from the matrices on the CPU. A plate split material that compiled and drew
   nothing passed every check.

## What was built

**The plates' split material** (`185013b9`; `webgpu/skeleton-spike/mesh-renderer.ts` `skullSplitMaterial`,
`mesh-split.ts` `MESH_SPLIT_CUT_BONE_WGSL` and its hand twin `meshSplitCutBone`). A split anatomical plate keeps the
anatomical surface on both faces, with its craters read at the clip's un-turned point and its normal map through the
closed material's cotangent frame. It has no inner wall. Within the rim's width of the fracture the surface goes to
the colour of cut bone. A split twin geometry carries `userData.anatomicalSkull`, and `batchFor` picks the material by
it. The atlas sample and the normal (which takes `dpdx` / `dpdy`) are declared ahead of the branch on the clip: WGSL
allows both only in uniform control flow, and a test on the node graph three builds pins that order.

**The rim follows the fracture only** (`cdd2b9cd`; `MESH_SPLIT_FRACTURE_WGSL`, hand twin `meshSplitFracture`). The rim
first read the clip's `keep`, the distance to the copy's nearest edge. A copy has edges that are not the fracture (the
hinge plane and the hold ball, where a half meets the rest of the same bone), and both faces of a plate are seen, so
the outside of the skull showed a pale straight line across the upper teeth and arcs inside the cranium. The rim now
reads the fracture's own distance, built from the same list of lines as the clip (`MESH_SPLIT_SIDE_LINES`). The clip's
WGSL is the same text to the byte and is pinned whole in the tests.

**Shots and pops meet the skull where it is drawn** (`71659a24`; `webgpu/skeleton-spike/skull-split-hit.ts`, pure;
`skull-fracture.ts` `skullRayCast`; `mesh-renderer.ts` `fractureSkull`, `explodeSkull`, `detach`, `pieceTurn`,
`skullSplitFor`). The ray test is the draw read backwards: for each piece the ray is turned back by that piece's bone
angle about the hinge, cast at the closed plates, and a triangle counts only where that piece owns the hit point (the
clip's rule, on the CPU). The nearest hit over the pieces wins. A plate that breaks leaves from the turn of the piece
that was hit, and a head pop releases each plate from the turn of the piece that owns its pivot: the fragment's
position, orientation and launch are the closed head's, turned. With no split the arithmetic is the closed head's, to
the bit.

**The gate on the anatomical skull** (`1bdafe1c`; `scripts/head-split-gate.mjs`, `webgpu/game-seams-skeleton.ts`,
`mesh-renderer.ts` `SEGMENT_MATERIALS`). The pin is gone, the eye landmark measures the whole eye, the gate has a
scenario for the plates of a split skull (P), and the sculpted skull keeps a boot of its own. Details below.

**Bone standing in the gap can be shot** (`70fea1ff`; `skeleton-spike/skull-split-hit.ts` `skullShotCast`, pure;
`mesh-renderer.ts` `impact`, `skullPass`; `webgpu/game-skull-shots.ts` `skullPasses`). The rule applies to an actor
whose head split is drawn and whose skull is the anatomical one:

- A projectile's step that met the actor's flesh casts the skull from the START of the step, as far as the flesh and
  0.14 m on. The nearest plate on the line is the one damaged, in front of the flesh or behind it.
- A step that met none of the actor's flesh is cast along its whole length, when it passes the sphere that holds
  every copy of the skull (the closed skull's sphere turned about the hinge point, `skullCopiesBound`). A plate it
  meets is damaged. The projectile carries on: it stamps no wound and does no damage to the body.
- One projectile damages one plate of a skull at most. It remembers the skulls it has damaged (`Projectile.skulls`)
  and is not cast at them again, so a slug that breaks a plate in the gap on one step and meets that head's flesh on
  the next breaks nothing more.
- A closed head, the sculpted skull and every actor whose split is not drawn take the path they always had: from the
  flesh impact, 0.14 m on, and no cast when no flesh is hit. Tests pin the fragments' numbers to the bit.

The projectile loop (`game-main.ts`) calls the leaf once after its flesh trace, for the open skulls the projectile
did not stop in, and hands the renderer's `impact` the step's start and the projectile. That is two lines in the
loop and no new state on the game's context. The eye ejection in `impact` is unchanged.

**The gate sees the plates on screen** (`1cd81c90`). Four checks read the bone's own pixels or fire a real
projectile; the gate has 100 checks. Details below.

**Smaller fixes** (`a056a080`, `9f684bd6`). A test pins what the split materials read at the clip's un-turned point
(the surface's craters and the fracture's distance, by walking the node graph). `clear()` in the renderer forgets the
last update's `split` and `extra` hooks. The bone angle of a piece's copy is one function (`head-split.ts`
`skullPieceAngle`) for the draw, the per-instance record and the hit test. `detach` takes one argument that answers a
plate's turn.

## Measurements

The first seven rows come from the captures made when each part was built, and were not repeated for the later
changes. The rows marked "gate" are the same in every run.

| What | Measured | Where |
| --- | --- | --- |
| Vertex buffers bound by the plates' split pipeline | 6 of WebGPU's 8: position, normal, uv, the split record (one interleaved instance buffer), `iLights`, `iFill` | recorded from `createRenderPipeline` in a headless boot |
| The sculpted skull's split, before and after the plates got their own material | 4 pixels differ by 1/255, against 30 pixels between two captures of one build | a `?skull=sculpt` capture pair |
| A real slug at the - half's temporal bone, before the hit path knew the split | broke the occipital instead, released at the closed head's pivot, 38.6 mm from where either half draws that plate | in-game capture, a forced full split |
| The same slug, after | broke the plate aimed at (`temporal-right`), 0.00 mm from the pivot as the - half draws it, 37.84 mm from the closed head's | the same capture |
| Real pellets at the + half's parietal, before | three volleys before a plate broke; `parietal-left` then left from the closed head's pivot (0 mm), 58.05 mm from where the + half draws it | the same capture |
| The same pellets, after | `parietal-left` released on the second volley, 14.7 mm from its drawn pivot along the shot line | the same capture; the volley's first pellets push the head before the last one lands |
| A closed head's fragment numbers, before and after | identical | the same capture's control |
| The gate's pellets at the + half's cheekbone | plate released on the third pellet; fragment 0.0000 mm from the pivot as the + half draws it, 36.9 mm from the closed head's | gate, scenario P |
| The gate's eye landmark, the eye seen whole | worst 0.41 px (anatomical, forced head), 0.15 px (anatomical, after chop 1), 0.27 and 0.43 px (sculpted) | gate, scenario M |
| The same landmark with the bone drawn | 6.84 px (anatomical), 3.33 px (sculpted), at the kill's bone angle | gate, reported and not held |
| Level shots from the front at a head opened by the axe's first chop (flesh 25.2 degrees a half, bone 7.6): 350 over a window 12 cm wide and 13 cm tall above the hinge | 125 have drawn bone on their line and no flesh of the head anywhere on it; 153 meet the flesh first with bone behind it; 1 meets bone in front of its flesh | a unit test on the fitted skull and the zombie's flesh field, each shot stepped and traced as the projectile loop does it (0.5 m a frame; the trace samples every 5 cm and counts flesh within 1 cm) |
| The same 350 shots under the rule | each breaks the plate a forward build of the drawn copies says is first on its line, to within a micrometre of its distance; under the old rule the 125 broke nothing | the same test |
| The gun's own slug through the open V at that opening, its predicted line meeting no flesh and the frontal bone 0.796 m from the muzzle, before the rule | nothing released; the slug flew on | in-game capture, a forced split at 0.8 of the full angle |
| The same slug, after | the frontal released; its fragment 0.00 mm from the pivot as the + half's copy draws it, 15.4 mm from the closed head's and 30.7 mm from the - half's; the actor's wounds 2 before and 2 after; zero console errors | the same capture |
| A slug at a closed head, before and after the rule | the same plate (`parietal-right`), position and velocity to the last digit | the same capture's control |
| The split skull's bone pixels along the fracture's line (27 points, 3 to 16 cm above the hinge) | bone at 25 of them on the closed anatomical skull (27 on the sculpted one); at none of those on the open one, at the kill's bone angle | gate, scenario M |
| A mark on each half's brow, 16 mm from the mid-plane | bone over the whole of a 3 px disc where `skullWarpPoint` turns it, 101.6 px from its closed place; no bone there on the open skull | gate, scenario M, both skulls |
| The frame before and after the gate's pellets release the + half's cheekbone | 0.97 of an 8 px disc about the plate's drawn pivot changes; 0.00 of the disc about the closed head's pivot, 59.0 px away | gate, scenario P |
| The gate's slug through the open V | the frontal, 290.8 mm along a line with no flesh of the actor in 1 m, released on the first frame of the slug's flight; fragment 0.0000 mm from the + half's drawn pivot; wounds 2 and 2, damage meter 0 and 0 | gate, scenario P |
| The head-split gate | 100 checks, 0 failed, six boots | see "Verification" |

## The eye landmark: why it read 6.80 px

The check photographs a head with the skull's seated eyes drawn and again without them, takes the two largest blobs
of differing pixels as the eyes, and compares how far each blob's centroid moves when the bone turns with how far
`skullWarpPoint` moves that eye's seat.

**The cause is the measurement, not the eye's place.** An eye is a ball 38 mm across (radius 19.1 mm) seated inside
the skull, and only the part of it that the socket leaves in sight differs between the two photographs. The gate now
reports that part. On the anatomical skull it is 0.53 of one eye and 0.37 of the other on the closed skull (the seats
were placed for the sculpt and sit a few millimetres off the centres of the anatomical orbits), and 0.45 and 0.36 at
the kill's bone angle (26.8 degrees a half). The centroid of that part is not the eye's centre, and the part changes
shape as the halves part, so its centroid does not travel with the eye: it is 0.28 and 0.20 px off the predicted
shift at the thin crack, 0.96 and 1.70 px at the wide crack, and 6.84 and 5.81 px at the kill's angle. The sculpted
skull shows the same effect at half the size (0.51 of each eye seen closed, 0.38 at the kill's angle, 3.31 and
3.33 px), which is why its old reading of 3.4 px sat under the 5 px bound and the anatomical one did not.

**The proof.** With the bone and the flesh out of the frame the whole of each eye is seen (2,937 to 3,013 pixels at
every angle, on both skulls), and its centroid is within 0.41 px of the predicted shift on the anatomical skull and
0.27 px on the sculpted one, over shifts of up to 61 px. So the eye is drawn where `skullWarpPoint` puts it; the old
number measured the socket.

**The fix** (`eyesAgainstRule`). The landmark is taken with the bone and the flesh out of the frame
(`__sdfGame.meshSkeletonShow({ bones: false })`, and the gate's own `hideFlesh`). The bound went from 5 px down to
2 px (1.3 mm at the head). The gate also checks that exactly two blobs differ in that pair (nothing but the two eyes
changes), and that both eyes are still found in their sockets with the bone drawn.

Two things had to be right for the whole-eye measure to work, both found by looking at the frames:

- **The flesh must be out of the frame too.** On the forced head the flesh is thrown open past its full angle, and a
  whole eye still reaches behind its flesh half: with only the bone hidden the two eyes read 3,483 and 4,867 pixels
  and the landmark 3.9 px.
- **The frame must settle after anything is hidden.** The post chain mixes each frame with the ones before it
  (`webgpu/post-aa.ts`, the smear), so a skull that has just been hidden fades over the next few frames. A pair taken
  at once differed over 40,147 pixels of fading skull, and the "eyes" did not move at all (18.4 px off). The gate
  waits its usual 24 frames after hiding the bone.

## The gate

`scripts/head-split-gate.mjs` has 100 checks over six boots (80 over five before this branch; 95 when the gate first
ran on the anatomical skull). It runs on the default skull; a check fails if any boot draws the wrong one, which would
otherwise happen silently when the plates' asset does not load and the page falls back to the sculpt.

- **M, on the boot's skull.** As before, plus two checks.
  - A split head's bone copies are drawn on the split material of the skull the boot draws, and its eyes' copies on
    the eyes'. The materials are named (`mesh-renderer.ts` `SEGMENT_MATERIALS`) and `__sdfGame.skullDrawn(id)`
    reports the name for every draw.
  - **The bone is on screen where the split puts it, and clipped.** With the flesh and the eyes out of the frame, the
    bone's pixels are those that differ between a frame and the same frame with the bone meshes hidden. They are
    taken on the whole skull (follow 0) and at the kill's bone angle (26.8 degrees a half). Along the fracture's line
    (27 points of the old plane, 3 to 16 cm above the hinge) at least 0.8 of the points must be bone closed, and at
    most 0.05 of those may still be bone open: both halves have swung clear and each copy is clipped to its own side.
    And a mark on each half's brow must be bone over the whole of a 3 px disc where `skullWarpPoint` turns it, at
    least 70 px from its closed place, where the closed skull has bone and the open one none.
- **P, the plates of a split anatomical skull** (nine checks, in the range boot, last).
  1. A slug into the face at a closed head's right cheekbone takes that plate off, and the closed head is drawn as
     its 13 other plates.
  2. The same head, split to its full angle, is drawn as those 13 plates in 32 clipped copies on the plates' split
     material (7 of the rest, 13 of the + half, 12 of the - half), with nothing of the missing plate.
  3. The GPU reports no error drawing it (no device loss, `uncapturedCount` 0, no console error).
  4. Three pellets into the face at the + half's left cheekbone, where it is drawn 36.9 mm from its place on the
     closed head, release that plate on the third. Taken as it stands into the closed head's frame, the pellets' line
     runs 10.2 mm clear of that plate's box, so a test made there could not have released it.
  5. Its fragment starts 0.0000 mm from the pivot as the + half's copy draws it, and 36.9 mm from the closed head's.
  6. The open head is drawn on without it: 12 plates in 31 copies.
  7. On screen, the bone alone before the pellets and 30 frames after them (the fragment has left the picture): at
     least 0.8 of an 8 px disc about the plate's pivot as the + half's copy draws it changes, and at most 0.05 of the
     disc about the closed head's pivot.
  8. A slug through the open V at bone with no flesh on its line releases that plate. The same head is put at the
     axe's first chop (flesh 25.2 degrees a half, bone 7.6). The gun's own slug is put in flight 0.3 m in front of a
     point of the + half's frontal bone. Before it flies the gate asks what its line meets: the frontal on the + half
     (`skullRay`), and no flesh of the actor in 1 m by the projectile loop's own trace. The loop then steps it, and
     the frontal must be released on the first frame.
  9. That fragment starts within 0.01 mm of the pivot as the + half's copy draws it, and the actor has the same
     wounds and the same damage meter after as before.

  Checks 1 to 7 put their rounds through `__sdfGame.skullShot(id, point, direction, kind)`, which calls the
  renderer's own `fractureSkull` (what a pellet's or a slug's impact calls first) with a ray the gate lays, and does
  nothing else of a hit: a volley from the gun shoves the head between its pellets. For check 4 the bone is made to
  ride its flesh (`skullSplit({ follow: 1 })`), so the check does not depend on the follow table; at the shipped
  table's angle the same line runs 6.0 mm clear. Checks 8 and 9 use a real projectile, `__sdfGame.slugFrom(origin,
  direction)`: one slug of the gun's own, started where the gate says, and stepped, traced and spent by the
  projectile loop like any other. The gun's aim is still not in the gate.
- **M again on the sculpted skull** (seven checks, a boot of its own with `?skull=sculpt`). The forced landmark and
  the materials, then the three real chops made for the skull alone (`chopsForSkull`: the same chops, with no gap
  read), and M's four checks on them.
- **Seams added or widened** (`webgpu/game-seams-skeleton.ts`, `webgpu/game-seams-weapon-aim.ts`): `skullDrawn(id)`
  rows carry `material` and `plate`, and a `whole` list of the actor's draws that are not copies; `skullPlates(id)`
  carries each plate's box; `skullShot`, `skullRay(id, point, direction, reach)` (the bone a ray meets on the skull
  as drawn, with nothing damaged) and `slugFrom` are new.
- **The three chops of the sculpted skull's boot** follow each chop's spring with the first boot's own function
  (`chopAndFollow`, told not to read the gap). What runs between the chops is not shared: the first boot measures
  the gap and checks at every stage, and stops where `ONLY` says. The sculpted boot's numbers did not move.

**Checks shown to fail.** Seven breaking changes were made, one at a time, and the gate was run against each. The
first three were made to `mesh-renderer.ts` in the worktree, and the file was put back from a saved copy (its diff's
checksum was the same before and after). The last four were made in scratch copies of the tree, with the M and P
scenarios run from each copy; the worktree was never changed.

| Breaking change | What the gate said |
| --- | --- |
| `fractureSkull` tests the ray against the closed head's plates, whatever is drawn | P fails twice: the three pellets release nothing (released 0, 0, 0), and there is no fragment |
| a plate that breaks leaves from the closed head's frame | P's fragment check fails: 36.8551 mm from the drawn pivot (bound 0.01 mm), 0.0 mm from the closed head's |
| the seated eyes are drawn a twentieth short of their bone's turn | M's landmark fails on both skulls: 3.12 px (anatomical) and 3.10 px (sculpted) against 2 px. The old 5 px bound would have passed it |
| the split materials' discard is removed (every copy draws all of its bone) | M's bone check fails on both skulls: 25 of 25 points of the fracture's line are still bone on the open anatomical skull and 27 of 27 on the sculpted one, and there is bone at both marks' closed places. The other 24 checks of the two scenarios pass |
| a copy's turn is left out of its matrix | M's bone check fails on both skulls: no bone at the turned marks (0 of the disc on the anatomical skull, 0.07 and 0.11 on the sculpted). So do nine other checks: the eye landmarks, the bone's turn from its matrices, and five of P's |
| the plates' split material draws nothing | two checks fail, the two that read pixels: M's bone check on the anatomical skull (0 of the disc at the turned marks) and P's on-screen check (0.00 of the disc changes where the plate was drawn). The other 24 pass, as all 95 did before these checks |
| the projectile loop does not pass a step with no flesh to the open skulls | P's two slug checks fail: the line meets the frontal 290.8 mm out and no flesh, and nothing is released |

**A subset with no march-target capture says so.** `ONLY=P` or `ONLY=M` alone make no capture of the march target,
so the depth guard has nothing to look at. Such a run prints that the guard did not run and does not count it as a
check (26 checks for `ONLY=M,P`). A run of every scenario that somehow made no capture still fails the guard's check.

**Run time.** The sculpt boot took 25.6 to 30.6 s of wall clock (page load to its last check) over three whole runs.
P adds about 5 s to the range boot (a boot that ran P alone took 6.5 s in all). The landmark's extra photographs and
settles add an estimated 10 to 15 s to the first boot; that part was not measured on its own. The whole gate took
3 min 29 s on the final run; the last run of the 80-check gate took 3 min 50 s under a different load on the same
machine, so the two totals do not give the difference. The gate prints each boot's wall clock at the end of a run.

With the four checks that read pixels or fire a projectile (100 checks) the whole gate took 3 min 34 s on the final
run, its servers' start included. By boot, from the page's load to the boot's last check: 109.2 s (the chops), 20.9 s
(range and P), 14.0 and 13.8 s (bounds), 25.5 s (the turned zombie) and 27.5 s (the sculpted skull). What the new
checks add was not measured on its own; a run of M and P alone took 15.2 s, 8.9 s and 26.7 s for its three boots.

## The open head's cost on the anatomical skull

The gate's first boot times an open head against the same head closed again (scenario C: `__sdfGame.timeDraws(120)`,
the median of 120 still frames, each drawn and then fenced; one zombie's head centred, a `middle` split at its full
angle, both sides; three rounds of open and closed, interleaved). It reports the figure and does not hold it. "Closed
again" still carries the split's two cut faces, so open minus closed is the split's own cost.

| Gate run | Skull | Untouched head | Open, three rounds | Closed again, three rounds | Open minus closed at 0.6 m | At 2 m |
| --- | --- | --- | --- | --- | --- | --- |
| The last run pinned to `?skull=sculpt` (commit `71659a24`) | sculpted | 35.0 ms | 44.0, 41.8, 41.3 ms | 35.7, 34.3, 33.2 ms | +7.5 ms | +2.9 ms |
| The first run on the default skull (commit `1e88afb2`) | anatomical | 23.7 ms | 33.2, 33.4, 33.5 ms | 25.1, 25.2, 25.1 ms | +8.3 ms | +1.1 ms |
| A run of this tree from a scratch copy | anatomical | 23.6 ms | 34.3, 35.8, 34.8 ms | 28.7, 28.6, 28.2 ms | +6.2 ms | +0.2 ms |
| The final run of this tree | anatomical | 24.4 ms | 33.1, 33.5, 33.0 ms | 24.7, 25.0, 25.2 ms | +8.1 ms | +0.9 ms |

**What the figures can and cannot say.**

- **Other sessions shared the machine's GPU on every one of these runs.** The level moves with them: the sculpted
  run's closed head read 33 to 36 ms where the anatomical runs read 25 to 29 ms, and nothing of the skull explains a
  9 ms difference in a closed head. An earlier sculpt-pinned run (commit `185013b9`) read +9.7 ms and +4.2 ms.
- **At 0.6 m the three anatomical readings are +6.2, +8.1 and +8.3 ms, and the two sculpted ones +7.5 and +9.7 ms.**
  The two ranges overlap. These runs do not show that the anatomical skull's split costs more or less than the
  sculpted skull's.
- **The gate prints no figure that isolates the skull's share.** Open minus closed is the whole split: the flesh's
  march over the open head, its shading, and the bone's copies together. The anatomical plates' own cost was not
  measured on its own, here or anywhere: a split material that samples a normal map and evaluates the fracture a
  second time for the rim. The gate's scene has an intact skull, which is one mesh in three copies as the sculpt is;
  a skull that has lost a plate is drawn plate by plate (13 plates in 32 copies at the full split), and that case
  was not timed at all.

## The follow table on the anatomical skull: look sheets for the owner

The bone opens less than its flesh, by `HEAD_SPLIT.skull.follow`: 0.1, 0.3 and 0.85 of the flesh's angle at flesh
openings of 0.55, 0.8 and 1. That table was tuned by eye on the sculpted skull, which is carved from the head's bone
envelope (201 mm wide and 262 mm tall on the zombie). The anatomical skull is fitted inside that envelope at 0.70 of
its width and 0.78 of its height (141 mm by 204 mm), so the same bone angle leaves it standing further inside the
flesh. **Nothing was retuned.** Whether to retune is the owner's call, and these sheets are for making it:

- [`look/01-follow-flesh.jpg`](look/01-follow-flesh.jpg): the flesh shown, flashlight on.
- [`look/02-follow-bone.jpg`](look/02-follow-bone.jpg): the same frames with the flesh out of the picture.
- [`look/03-follow-above-behind.jpg`](look/03-follow-above-behind.jpg): an extra view of the two standing chops, from
  above and behind.

Columns: the sculpted skull with the shipped table (what was playtested); **the anatomical skull with the shipped
table (what ships, boxed in yellow)**; the anatomical skull with every share times 1.5, held to 1 (0.15, 0.45, 1);
and with every share times 0.6 (0.06, 0.18, 0.51). Rows: the axe's three chops on one zombie, and the `face` preset
forced to its full angle on another.

| Row | Flesh, a half | Bone: shipped | Bone: x 1.5 | Bone: x 0.6 |
| --- | --- | --- | --- | --- |
| Chop 1 (the flesh at 0.8 of its full angle) | 25.2° | 7.6° | 11.3° | 4.5° |
| Chop 2 (the full angle) | 31.5° | 26.8° | 31.5° | 16.1° |
| The kill, 45 frames on, its kick settled (shot on the corpse) | 31.5° | 26.8° | 31.5° | 16.1° |
| `face`, full (the face half alone turns) | 45.8° | 39.0° | 45.8° | 23.4° |

Cameras are the gate's: from the front at 0.6 m for the two standing chops, from the wedge between the halves for
the corpse, and from above and to one side at 0.9 m for `face`. The follow was set live with
`__sdfGame.skullSplit({ follow })`; the sculpted column is a second boot with `?skull=sculpt` and the same steps, and
the corpse lies in the same place in both (its head at the same point to the millimetre). The captures came from a
scratch script built on the gate's helpers; it is not in the repo.

## Not done

- **Paired plates riding their half whole, with no clip** (the "hybrid"). Every plate a half owns part of is still
  drawn as a clipped copy, including plates that lie wholly on one side of the fracture.
- **The axe's kill chop releasing a plate.** Only pellets, slugs, a head pop and the melee brain stage release
  plates. The axe opens the skull and leaves all fourteen in place.
- **The follow table's retune.** The owner's decision, from the sheets above.
- **Anything in the cavity.** The plates' insides are real geometry now, but the cavity is empty and the room shows
  through the opened skull.
- **The gun's aim in the gate.** The gate's slug is a real projectile on a line the gate lays, not a shot from the
  gun's muzzle. The gun itself was fired at an open head in the captures listed under "Measurements".
- **A frame cost for the shots at an open head.** A projectile's step costs one sphere test for each open head it did
  not stop in, and three ray casts at the plates when it passes inside that sphere. It was not timed.

## Known limits

- **A plate the fracture runs through is one plate to a hit.** The frontal, the occipital, the mandible, the cranial
  base, the upper teeth and the nasal core always are, and a parietal or a maxilla where the ragged edge strays into
  it (each head breaks along its own pattern; on one zombie 22 of the left parietal's 650 triangles and 68 of the left
  maxilla's 650 lay across it). Such a plate is drawn in two or three copies. A hit on any copy damages the whole
  plate, and it leaves whole: from the piece that was hit, or on a head pop from the piece that owns its pivot.
- **Eyes on a split head are ejected by the closed head's frame.** `impact()` picks and launches the eyes as it did
  before the split, and only on a flesh hit: a round through the gap that meets no flesh ejects no eye.
- **A round that breaks bone in the gap flies on unchanged.** It loses no speed and is not turned, so it can go on to
  wound the same body's flesh behind the bone, or another actor.
- **One round, one plate of a skull.** A slug whose line crosses two plates of an open skull (the frontal and then
  the occipital, say) damages the first and passes the second. The memory is per skull: a round through two open
  heads in a line can damage a plate of each.
- **The open rule goes by what is drawn.** Beyond the split's draw distance a split head is drawn closed, flesh and
  bone, and takes the closed head's rule. The split a shot is tested against is the one the last frame drew.
- **The flesh trace is coarse.** The projectile loop samples a step every 5 cm and counts flesh within 1 cm of a
  sample, so a line that passes within a centimetre of a cut face can read as a flesh hit there. The skull is then
  cast from the step's start, so the bone the round would have met first is still the one damaged.
- **Across pieces the nearest hit is compared in head-frame metres.** That is exact for a rigid head and off by the
  squash under a head deform.
- **The eyes sit 2 to 5 mm off the centres of the anatomical orbits** (their seats were placed for the sculpt), which
  is why one socket shows 0.53 of its eye and the other 0.37. A separate task is queued for the seats.
- **The gate's plate scenario does not fire the gun.** Its pellets and its first slug are rays handed to the
  renderer, and its last slug is a real projectile started on a line the gate lays. Real rounds from the gun were
  captured in game (the table above); the gate does not hold the weapon's aim.

## Verification

The final runs, from the worktree at commit `9f684bd6` with nothing being edited (the tracked diff's checksum was the
same before and after), on 2026-10-06. The gates and the tree each held the machine's shared GPU lock.

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | the one known error (`pack-golden.test.ts`, `node:crypto`) and no other |
| Head-split gate | `node scripts/head-split-gate.mjs 5261 9261` | 100 checks, 0 failed; 3 min 34 s |
| Axe gate | `node scripts/axe-gate.mjs 5261 9261` | 27 checks, 0 failed |
| Cut-wound gate | `node scripts/cut-wound-gate.mjs 5261 9261` | 30 checks, 0 failed |
| The test tree | `npx vitest run src/lab/sdf-zombie scripts/lib --exclude '**/cut-wound.test.ts'` | 531 files passed; 7,650 tests passed, 1 skipped; 246 s |

When the gate first ran on the anatomical skull (commit `1bdafe1c`) the same five read 95 checks, 27, 30, and 529
files with 7,624 tests.

Each gate ran with its own servers (`scripts/lab-servers.sh`) and an `OUT=` folder outside the repo, so no tracked
picture was rewritten.

**Not verified.**

- `cut-wound.test.ts` was not run (the tree leaves it out, as the handoff says to; nothing here touches the cut
  field).
- No frame time was measured beyond what the gate's cost scenario prints (above); it does not hold them, and it
  does not time the skull alone or a shot at an open head.
- The look sheets were not judged: they are for the owner. The gate's own contact sheets (`M-skull`, `P-plates` and
  their sculpt twins) were looked at once and are not tracked.
- The game was not played by hand. The gun was not fired at a split head in the gate (see "Known limits").
- The seven breaking changes were run against the gate's P and M scenarios alone, not against the whole gate.
- Pellets from the gun were not fired through the gap in the game after the rule was built; one slug was. Pellets
  through the gap are held by the renderer's tests (three projectiles add up on a plate, one hit each).
- The rule under a head deform was not exercised: a split head is never deformed (the melee head damage declines a
  split head, and the split refuses a damaged one).
