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

**The gate on the anatomical skull** (this change; `scripts/head-split-gate.mjs`, `webgpu/game-seams-skeleton.ts`,
`mesh-renderer.ts` `SEGMENT_MATERIALS`). The pin is gone, the eye landmark measures the whole eye, the gate has a
scenario for the plates of a split skull (P), and the sculpted skull keeps a boot of its own. Details below.

## Measurements

The first seven rows come from the captures made when each part was built, and were not repeated for the gate's
change. The last four are the gate's, and are the same in every run.

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
| The head-split gate | 95 checks, 0 failed, six boots | see "Verification" |

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

`scripts/head-split-gate.mjs` now has 95 checks (80 before) over six boots (five before). It runs on the default
skull; a check fails if any boot draws the wrong one, which would otherwise happen silently when the plates' asset
does not load and the page falls back to the sculpt.

- **M, on the boot's skull.** As before, plus one check: a split head's bone copies are drawn on the split material
  of the skull the boot draws, and its eyes' copies on the eyes'. The materials are named
  (`mesh-renderer.ts` `SEGMENT_MATERIALS`) and `__sdfGame.skullDrawn(id)` reports the name for every draw.
- **P, the plates of a split anatomical skull** (six checks, in the range boot, last).
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

  The rounds go through `__sdfGame.skullShot(id, point, direction, kind)`, which calls the renderer's own
  `fractureSkull` (what a pellet's or a slug's impact calls first) with a ray the gate lays, and does nothing else of
  a hit. The gun itself is not fired: a volley shoves the head between its pellets. For check 4 the bone is made to
  ride its flesh (`skullSplit({ follow: 1 })`), so the check does not depend on the follow table; at the shipped
  table's angle the same line runs 6.0 mm clear.
- **M again on the sculpted skull** (seven checks, a boot of its own with `?skull=sculpt`). The forced landmark and
  the materials, then the three real chops made for the skull alone (`chopsForSkull`: the same chops, with no gap
  read), and M's four checks on them.
- **Seams added or widened** (`webgpu/game-seams-skeleton.ts`): `skullDrawn(id)` rows carry `material` and `plate`,
  and a `whole` list of the actor's draws that are not copies; `skullPlates(id)` carries each plate's box;
  `skullShot` is new.

**Checks shown to fail.** Three breaking changes were made to `mesh-renderer.ts`, one at a time, the gate was run
against each, and the file was put back from a saved copy (its diff's checksum was the same before and after).

| Breaking change | What the gate said |
| --- | --- |
| `fractureSkull` tests the ray against the closed head's plates, whatever is drawn | P fails twice: the three pellets release nothing (released 0, 0, 0), and there is no fragment |
| a plate that breaks leaves from the closed head's frame | P's fragment check fails: 36.8551 mm from the drawn pivot (bound 0.01 mm), 0.0 mm from the closed head's |
| the seated eyes are drawn a twentieth short of their bone's turn | M's landmark fails on both skulls: 3.12 px (anatomical) and 3.10 px (sculpted) against 2 px. The old 5 px bound would have passed it |

**A subset with no march-target capture fails one line.** `ONLY=P` or `ONLY=M` alone make no capture of the march
target, and the depth guard's check wants at least one, so such a run ends with that check failing. It is not P's or
M's failure.

**Run time.** The sculpt boot took 25.6 to 30.6 s of wall clock (page load to its last check) over three whole runs.
P adds about 5 s to the range boot (a boot that ran P alone took 6.5 s in all). The landmark's extra photographs and
settles add an estimated 10 to 15 s to the first boot; that part was not measured on its own. The whole gate took
3 min 29 s on the final run; the last run of the 80-check gate took 3 min 50 s under a different load on the same
machine, so the two totals do not give the difference. The gate prints each boot's wall clock at the end of a run.

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

## Known limits

- **A plate the fracture runs through is one plate to a hit.** The frontal, the occipital, the mandible, the cranial
  base, the upper teeth and the nasal core always are, and a parietal or a maxilla where the ragged edge strays into
  it (each head breaks along its own pattern; on one zombie 22 of the left parietal's 650 triangles and 68 of the left
  maxilla's 650 lay across it). Such a plate is drawn in two or three copies. A hit on any copy damages the whole
  plate, and it leaves whole: from the piece that was hit, or on a head pop from the piece that owns its pivot.
- **Eyes on a split head are ejected by the closed head's frame.** `impact()` picks and launches the eyes as it did
  before the split.
- **Across pieces the nearest hit is compared in head-frame metres.** That is exact for a rigid head and off by the
  squash under a head deform.
- **The eyes sit 2 to 5 mm off the centres of the anatomical orbits** (their seats were placed for the sculpt), which
  is why one socket shows 0.53 of its eye and the other 0.37. A separate task is queued for the seats.
- **The gate's plate scenario does not fire the gun.** Real rounds at an opened half were captured once, in game
  (the table above); the gate holds the renderer's hit path and the fragment's start, not the weapon's aim.

## Verification

The final runs, from the worktree with nothing being edited (the tracked diff's checksum was the same before and
after), on 2026-10-06. The gates and the tree each held the machine's shared GPU lock.

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | the one known error (`pack-golden.test.ts`, `node:crypto`) and no other |
| Head-split gate | `node scripts/head-split-gate.mjs 5261 9261` | 95 checks, 0 failed; 3 min 29 s |
| Axe gate | `node scripts/axe-gate.mjs 5261 9261` | 27 checks, 0 failed |
| Cut-wound gate | `node scripts/cut-wound-gate.mjs 5261 9261` | 30 checks, 0 failed |
| The test tree | `npx vitest run src/lab/sdf-zombie scripts/lib --exclude '**/cut-wound.test.ts'` | 529 files passed; 7,624 tests passed, 1 skipped; 249 s |

Each gate ran with its own servers (`scripts/lab-servers.sh`) and an `OUT=` folder outside the repo, so no tracked
picture was rewritten.

**Not verified.**

- `cut-wound.test.ts` was not run (the tree leaves it out, as the handoff says to; nothing here touches the cut
  field).
- No frame time was measured. The gate's cost scenario prints draw times and does not hold them.
- The look sheets were not judged: they are for the owner. The gate's own contact sheets (`M-skull`, `P-plates` and
  their sculpt twins) were looked at once and are not tracked.
- The game was not played by hand. The gun was not fired at a split head in the gate (see "Known limits").
- The three breaking changes were run against the gate's P and M scenarios alone, not against the whole gate.
