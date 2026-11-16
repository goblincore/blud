# The zombie's skeleton kit — 2026-11-15

Owner, watching the melt strip a body in bullet time: the mesh skeleton has floating parts and missing bones (no
clavicles, gaps at the shoulder and hip). This is the rework.

## What was wrong

`audit-before.png` is the skeleton as it was, flesh removed. Every bone segment was the surface-nets mesh of its SDF
capsules: a ball for a shoulder, one rod for a forearm, a ball for a hand, a rod for a spine, femurs that began 8 cm
below the pelvis, six tube hoops for a cage, a 7.5 mm wire for a clavicle.

## What is there now

`public/assets/lab/skeleton-kit.glb`: one low-poly mesh for each of the zombie's 19 bone segments (the head keeps its
skull), built by a Blender script against the zombie's rig. `game-rest.png`, `game-walk.png`, `game-walk-close.png`
are the game (arena, `__sdfGame.bareSkeleton(true)`), front, side and back.

| Segment | Bones in its piece | Melt / gib group |
| --- | --- | --- |
| `axial:2-3` | 7 cervical vertebrae on a disc column | skull |
| `axial:1-2` | 12 thoracic and 5 lumbar vertebrae, the extracted cage's six rib hoops a side and its sternum (thinned to half the triangles), sacrum and coccyx | cage |
| `axial:0-1` | the two hip bones: iliac wing and crest, socket, pubic ring | pelvis |
| `limb:arm*:5-5` (shoulder ball) | clavicle, scapula (blade, spine, acromion, socket, coracoid) | cage |
| `limb:arm*:5-7` | humerus: head, tubercle, shaft, condyles | upperArm |
| `limb:arm*:7-9` | radius and ulna | foreArm |
| `limb:arm*:9-9` (hand ball) | a loose fist: carpals, 4 metacarpals, 4 two-bone fingers, thumb | foreArm |
| `limb:leg*:11-12` | femur: head, neck, trochanter, shaft, condyles; kneecap | thigh |
| `limb:leg*:12-15` | tibia with plateau and inner ankle; fibula | shin |
| `limb:leg*:15-15` (ankle ball) | talus column | shin |
| `limb:leg*:15-17` | heel, tarsals, 5 metatarsals, 5 toes | shin |

Not every bone is modelled (owner: "we don't need every single bone accounted for but there should be no obvious
floating bones"). The hand is a fist because the flesh hand is a 6 cm ball; the pelvis is small and the lumbar short
because the rig's hip joints sit at the top of its pelvis bone.

## Cost, per body

| | Vertices | Triangles | Segment meshes |
| --- | --- | --- | --- |
| Before (19 segments, surface nets) | 15,110 | 30,284 | 19 |
| After (19 kit pieces) | 7,503 | 14,174 | 19 |

Same number of meshes and instanced batches as before: a piece replaces a segment's geometry one for one. The skull
(9,144 vertices in the default sculpt) and the organs are unchanged.

## How it holds together when posed

Measured in the game over a walk into an attack (420 frames, `__sdfGame.skeletonPoses` + `kitJointGaps`): how far
apart the two segments at a joint carry the joint's point. Median / 95th percentile / worst, mm.

| Joint | Before the fixes | Now |
| --- | --- | --- |
| Hip (femoral head in socket) | 37 / 56 / 63 | 2 / 6 / 9 |
| Knee | 7 / 15 / 32 | 0 / 0 / 0 |
| Ankle, foot on talus | 10 / 23 / 30 | 0 / 0 / 0 |
| Shoulder, elbow, wrist | 0 / 0 / 2 | 0 / 0 / 2 |
| Clavicle on sternum | 6 / 9 / 29 | 6 / 9 / 29 |
| Neck on chest | 1 / 1 / 10 | 1 / 1 / 10 |
| Skull on atlas | 7 / 8 / 11 | 7 / 8 / 11 |
| Sacrum between the hip bones (meant to slide) | | 30 / 49 / 53 |

Three things did that:

1. **Leg bones run joint to joint.** `zombie.blob` now authors the thigh and shin bones from their joints
   (`from=0 to=1`). The derived ones copied the flesh bars' spans, so each began and ended short of its joints, and a
   leg segment carries that shortfall as an offset that does not turn with the leg.
2. **The hip bones follow the hip joints.** The rig is particles, not a bone chain: its hips swing 3 to 5 cm against
   the base of its spine in every stride. The pelvis piece rides a frame of its own (`KitFrame` `span`: turned by the
   hip line and the spine, held at the middle of the hips). The sacrum is part of the cage's piece instead and slides
   between the hip bones, which is where that 3 to 5 cm now goes. It is a sliding contact, not a gap.
3. **The shoulder girdle turns with the rig's clavicle bone** about the shoulder joint (`KitFrame` `aim`), so the
   socket stays on the humeral head and the clavicle's inner end stays at the top of the chest. The rig's clavicle
   pivots at the top of the spine, mid-chest, and the sternum is 5 cm in front of that, so the clavicle's end slides
   up to a centimetre on the manubrium in a walk (3 cm at the worst of an attack).

Also: leg and one-point limb segments now turn with the body's yaw (`contract.ts`). They did not before, which no one
could see on a round capsule and which pointed a femur's neck at world +x whichever way the body faced.

## The ribcage and the colour, after the owner's first look in the game

Owner, 2026-11-15, looking through a chest wound: the old ribcage "definitely looks better in game, like it feels
inside the body", and the new one did not feel part of the body: colour and texture, and "too thin and too many ribs".
The first kit had ten flat bands painted as clean ivory.

- **Six fat ribs a side**, on the old cage's six heights and envelope, about as thick as its tubes were (2.7 cm tall,
  1.9 cm through). Ribs 1-4 reach the sternum, 5 and 6 the costal margin.
- **A bone a wound exposes is meat.** Both bone paints give a kit piece the skull's ivory only where no wound is
  near (`woundNear`: full within 15 cm of a wound's edge, gone 30 cm out). Through a wound it wears the same patchy
  red tissue an extracted bone always wore. The ivory is for the body with no wound near: the melt.

`game-chest-wound-new-vs-old.png`: the same six slugs to the chest, kit on the left, `?bonekit=0` on the right.

## Contracts

- Segments, liveness and prims are untouched, so a sever hides a piece the frame its segment dies and the melt drops
  it with `groupOf(segment.prims[0].bone)`. `skeleton-kit.test.ts` pins one group per piece and all eleven covered.
- A body draws the kit whole or not at all (`SkeletonKit.admit`): the butcher, deadeye and flayer share the zombie's
  pelvis bones revision for revision and would otherwise have drawn a kit pelvis on extracted femurs.
- A piece is keyed by its segment's revision. Change the zombie's rig or bones and that segment falls back to its
  extracted mesh until `scripts/skeleton-kit/build.sh` is run; the test fails until then.
- `?bonekit=0` is the skeleton as it was.

## Other characters

Only the zombie draws the kit. `npx tsx scripts/skeleton-kit/who-draws-kit.ts` lists it: every other character (the
soldier, cultists, clowns, schoolgirls, butcher, deadeye, flayer, the quadrupeds and the rest) keeps its extracted
bones, unchanged except for the yaw fix above. None broke; none improved. Fitting the kit to other humanoids, and a
different skeleton for non-humanoids, are separate work (owner, 2026-11-15).

## Not done

- **No normal or detail map.** The detail is geometry and the existing procedural bone paint. A tiling bone-grain
  normal map sampled in segment space is the next step if the bones read too smooth up close.
- **The melt was not run against the kit.** The melt lives on `claude/melting-dying-animation-6cffdd`, not on main.
  Its `dropSegments` reads `cache.get(source)` and `source.pose()`, which are the kit's, so it should drop kit pieces
  from where they are drawn, but that is unverified.
- **Chunks and the deferred renderer** keep procedural SDF bones, as before: a gibbed limb's bone is still a capsule.
- **The sacrum's slide** (3 cm typical) is visible from behind if you look for it.
- The walk and attack were looked at in the arena only. Corpses, ragdolls and severed bodies were not looked at.

## Rebuilding

`scripts/skeleton-kit/build.sh` (needs Blender): exports the rig, builds the GLB headless, checks every vertex is at
least 4 mm inside the rest flesh and every piece is a live segment. Shapes are in `build_kit.py`, in game coordinates.

## Update 2026-11-16: the old cage's own ribs, on the kit's spine

Owner, looking at the six fat modelled ribs beside the old skeleton: "i honestly prefer the old ribcage ... a bit flat,
the way the ribs go into the sternum seamlessly", with the sacrum and spine kept from the kit.

- `export-rig.ts` now extracts the surface of the chest's rib and sternum bars alone (the 25 prims of `axial:1-2`
  authored `tall=1.3` or `wide=2.4`; 3,736 vertices) and writes it into the rig data as `ribcage`.
- `build_kit.py build_ribs` welds that surface, keeps half its triangles (`RIB_KEEP`) and puts it in the cage piece
  with the kit's vertebrae, disc column and sacrum. The modelled ribs, costal margin and sternum are gone.
- The kit is 7,503 vertices and 14,174 triangles a body (the extraction: 15,110 and 30,284).
- In the game: [through a chest wound](game-chest-wound-old-ribs-on-kit-spine.png),
  [bare, from behind](game-bare-back-old-ribs-on-kit-spine.png): the rib heads meet the vertebrae.
- Ribs 5 and 6 end free at the front, as they always did in the old cage.
