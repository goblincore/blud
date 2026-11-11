# A baked wound volume, in the replay (2026-11-11)

Follows [WOUNDS-WALK.md](WOUNDS-WALK.md): the wound list costs about 26 ms of the wounded mob's march, spread out.
This spike reads the wounds from a 3D texture where the march walks the list. **It works: −16 ms (−27 %) on the
wounded 22-body mob, 57.9 to 42.4 ms, of a ceiling of −23 ms**, at a look that differs from the game's mostly where
the re-fold is dropped. Replay only (`scripts/native-spike/wound-volume.mjs`); no renderer code.

## What was built

- **The bake uses the game's own crater code.** The captured pass is replayed once per 1 cm depth slice: every pixel
  evaluates `mapBody` at `camPos + rd * t` and returns what `applyWounds` made of it. Those froxels are resampled on
  the CPU into a regular world-space grid, at 1 cm and at 2 cm.
- **Four values a voxel, and a body id.** A wound is not one carve. The list does, per wound,
  `d = smax(d, carve)` then `d = d - bump * gate(dIn)`, and inside the body the bump fills a large part of its carved
  sphere back in. Carve alone over-carved 2.5 times; carve less the sum of bumps under-carved, because a later crater
  cuts through an earlier one's bump. What reproduces the list is `max(dIn - gate * sumBumps, chain)`, with the chain
  (the list run from deep inside) baked at both ends of the gate and mixed by it. So a voxel holds: the chain with
  bumps, the chain without, the bumps' sum, the largest bump amplitude; and, in a second texture, which body the
  carve belongs to, so a body reads its own wounds only.
- **The read** replaces the whole of `applyWounds` after its bound test: one `textureLoad` (the id), one trilinear
  sample, a smoothstep and an smax. No owner is recorded, so the owner re-fold never runs.

## Numbers

Wounded mob (`mobw`, 400 x 300, about 8 wounds a hit body), 5 repeats by alternation, a quiet machine (load 1 to 3).
The grid is 180 x 88 x 181 at 1 cm (29 MB) and 93 x 47 x 94 at 2 cm (4 MB): one box round every wound in the frame.

| Leg | ms | Against shipped (median, range) | Pixels over 0.1 | Hit flips |
| --- | --- | --- | --- | --- |
| Shipped | 57.9 | | | |
| The same again | 58.7 | +0.9 (−5.2 to +3.0) | 0 | 0 |
| No wounds at all (ceiling) | 35.6 | −23.1 (−28.8 to −20.9) | 28,147 | 2,304 |
| No re-fold, list kept | 48.3 | −10.1 (−17.3 to −9.1) | 8,553 | 0 |
| Volume in the walk only, 1 cm | 50.1 | −9.7 (−15.6 to −5.8) | 11,337 | 12 |
| Volume in the walk and the probes, 1 cm | 45.8 | −12.1 (−19.2 to −10.5) | 11,845 | 12 |
| **Volume everywhere, 1 cm** | 42.4 | **−15.8 (−21.8 to −13.8)** | 11,562 | 12 |
| Volume everywhere, 2 cm | 42.2 | −15.7 (−22.3 to −14.4) | 12,070 | 38 |
| Volume everywhere, 1 cm, with a rest-point lookup a read | 44.4 | −13.5 (−21.0 to −12.4) | 11,562 | 12 |

- **The voxel size does not change the time** and barely changes the picture: 2 cm is 26 more hit flips.
- **A rest-frame lookup costs about 2 ms.** The real design reads the volume at the limb's rest point; the last leg
  calls `restPoint` on every read to charge for it.
- **About 10 of the 16 ms is the re-fold going away**, which the list could also drop (the no-re-fold leg). The
  volume's own part is the other 6. The re-fold is what stops one limb's crater eating another limb; per-limb volumes
  are meant to replace it, and this spike does not show that they do.
- **The picture.** Against the real field, froxel by froxel: the real carve removes 81,177 froxels; the volume
  removes 5,112 that the no-re-fold field keeps and keeps 11,545 that it removes (14 % of the carve, at crater
  edges: the gate mix is a chord over a convex curve). Sheets (game | replay | difference x 8) are in
  [`look/wound-volume/`](look/wound-volume/).

## What this does not show

- **A per-limb rest-frame volume.** The frame is frozen and the grid is world space. Joints, blended limbs and
  motion are untested; so is whether per-limb volumes give the re-fold's result.
- **The bake on a hit.** This bake is offline, through the walk's own code. A stamp per hit has to write the four
  values; the chain is order-dependent (later craters cut earlier bumps), so a stamp is not a plain `max`.
- **Memory for a level.** One 29 MB box round one frame's wounds says nothing about a hundred bodies.
- The analytic normal (`ngBody`) still walks the wound list in every leg, as do the wound masks. Cut wounds, an open
  head split, the clean mob (which the volume should not touch), the compute march, `?ngloose` (the capture predates
  it) and live frame time were not run.
- Where two bodies' wounds overlap in space the voxel holds the larger carve's body only.

## Running it

```bash
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 scripts/native-spike/servers.sh \
  node scripts/native-spike/wound-volume.mjs bake .scratch/compute/mobw-ship
LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 scripts/native-spike/servers.sh \
  node scripts/native-spike/wound-volume.mjs run 5 .scratch/compute/mobw-ship .scratch/woundvolume/mobw
rm -rf /tmp/blud-gpu-timing.lock
```

`replay.html` gained `sweep` (one pass run per value of a 1 x 1 parameter texture, each result posted back) and
`sweep-chrome.mjs` drives it. Three traps met: the page clamps colour at 0, so signed values go out offset; a
private global set by an earlier field call in the pixel must be reset before the bake's call; and the re-fold's own
`applyWounds` calls run a shorter chain, so only the whole-body call may be baked.

Raw: [`results/woundvolume-mobw.json`](results/woundvolume-mobw.json).
