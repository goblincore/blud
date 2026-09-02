# blob:depth — first run: the known-bad minotaur against the schoolgirl control

**Date:** 2026-09-02 · **Task 4 of** [blobforge draft + depth](../../superpowers/plans/2026-09-02-blobforge-draft-and-depth.md) · **Branch:** `dispatch/blobforge-task-4`

The acceptance question, verbatim from the plan: the minotaur's torso is a
featureless blob against a heavily muscled reference, and it passed every
check that existed. **If `blob:depth` does not report a large torso error
here, the tool does not work.**

**Verdict: it does.** The side view's worst three bands are all torso lines —
`torso on chest` 340mm, `torso on pelvis` 312mm, `torso on neck` 253mm — at
6-10× the control character's worst band, with `blob:measure` blaming arms
and `blob:rings` blaming a size instead of a shape. Details, caveats and the
contrast are below; the caveats matter and one of them corrects the plan.

---

## The control first — schoolgirl (converged character, committed mesh)

```
=== front view   mean 32.9mm   signed +16.2mm   over 2,814 both-occupied pixels
  worst: 56.5mm  y 0.313-0.375  armR on upperarm.r (schoolgirl.blob:280)
         53.0mm  y 0.500-0.563  torso on spine1        (schoolgirl.blob:150)
         46.2mm  y 0.125-0.188  torso on chest         (schoolgirl.blob:182)
=== side view    mean 270.1mm  signed +263.9mm  over 8,022 both-occupied pixels
  POSE-DOMINATED (mesh depth span 3.3x the body's — T/A-pose arms out along x)
```

Front view is the usable one and it is modest: worst band 56.5mm, mean
32.9mm. Her two worst torso bands (~53mm, ~46mm) are CLOTH, not sculpt — no
kit is passed to the depth path, so her tee's thickness reads as error; the
minotaur, which has no kit at all, is the cleaner instrument case. The side
view is pose garbage and the tool says so (see caveat 1).

## The known-bad minotaur (round-1 blob from `dispatch/minotaur-character` @1063644)

```
=== front view   mean 54.1mm   signed +22.0mm   over 3,944 both-occupied pixels
  POSE-DOMINATED (mesh depth span 0.8x the body's)
  worst: 102.7mm  y 0.438-0.500  armL on forearm.l   (minotaur.blob:166)
         101.9mm  y 0.500-0.563  armR on hand.r      (minotaur.blob:169)
          93.9mm  y 0.750-0.813  legR on shin.r      (minotaur.blob:223 — the prosthetic)
          ...
          (no torso line in the front top 16 — see caveat 2)
=== side view    mean 193.7mm  signed +124.4mm  over 10,415 both-occupied pixels
  POSE-DOMINATED (mesh depth span 1.5x the body's)
  worst: 340.2mm  y 0.375-0.438  torso on chest      (minotaur.blob:123)
         311.9mm  y 0.438-0.500  torso on pelvis     (minotaur.blob:108)
         252.6mm  y 0.188-0.250  torso on neck       (minotaur.blob:128)
         234.2mm  y 0.500-0.563  torso on pelvis     (minotaur.blob:108)
         227.7mm  y 0.313-0.375  torso on chest      (minotaur.blob:123)
         175.6mm  y 0.625-0.688  legR on shin.r      (minotaur.blob:223)
```

The chest/belly height bands (y 0.31-0.56) are owned by the three torso
lines, all with **positive** signed error: the body's surface sits nearer the
camera than the mesh's — **the drum bulges past the mesh's average surface**.
That is the same finding `blob:rings` reaches by radial average (its rank-1
block asks the chest `deep 1.700 -> 1.213`, i.e. the drum is too deep) but
`blob:depth` adds what the radial average cannot: WHERE in the height the
volume is wrong, and that the disagreement is concentrated exactly on the
torso chain rather than spread over every prim.

## The contrast the plan asked to put on record

| instrument | what it said about the minotaur's torso |
| --- | --- |
| `blob:measure` (silhouette) | **Nothing usable.** IoU 0.608 whole-figure, `POSE MISMATCH` fired (aspect 1.398 vs 0.737), worst bands are `upperarm.r`/`forearm.r`/`clavicle.r`. An outline cannot see relief; the arms dominate the score. |
| `blob:rings` (radial average) | A size, not a shape: rank 1 = `minotaur.blob:123` chest, mean 69.5mm, asking `deep 1.700 -> 1.213`. It can say the drum is the wrong average girth; it cannot say the drum is SMOOTH — a muscled torso and a drum of equal average girth fit identically. |
| `blob:depth` (surface diff) | The worst region of the whole figure, localised: side view top 5 bands are the three torso lines at 228-340mm, signed + (drum bulges past the mesh's surface). |

## Caveats found on the first real runs (all observed, none tuned away)

1. **The pose label is load-bearing and fired on BOTH characters.**
   Schoolgirl's side view (3.3× span) is entirely pose; minotaur's views read
   0.8× (front) and 1.5× (side). A depth diff compares depth VALUES at grid
   pixels, but when the subjects' depth spans differ, the same grid column is
   a different world depth on each side — the per-band numbers then mix
   sculpt with pose. The first unlabelled schoolgirl run printed a 270mm side
   "error" with no warning; the label (and its test pin) exists because of
   that run. Consequence for the minotaur verdict: the torso evidence lives
   in a pose-contaminated view. It is still evidence — the contamination is a
   whole-view scale effect, and the torso lines topping every other prim is
   the signal — but the honest reading is "torso owns the worst bands, by a
   margin no other prim approaches", not "the drum is exactly 340mm wrong".
   Use `blob:depth` as a before/after instrument per edit, which is what the
   label tells every reader.
2. **The front view cannot see this minotaur's pecs at all.** The mesh's
   brawler pose flexes the forearms in front of the chest; the front-view
   z-buffer takes the NEAREST surface, so chest-height rows read the arms
   (front worst bands: `forearm.l` 102.7mm, `hand.r` 101.9mm). The pecs are
   occluded by the reference's own arms. A whole-figure depth diff on a
   T/A-pose reference has this limit by construction; posing the reference
   remains explicitly deferred by the design.
3. **"`blob:rings` reported nothing" is too strong — the plan is corrected
   here.** Rings ranked the chest block FIRST at 69.5mm. What round 1 could
   not see from rings was the difference between "wrong size" (fixable by
   typing its numbers) and "featureless" (not fixable by any girth edit) —
   and rings' own warning block ("TAPER REFUSED… the fit cannot see it")
   shows it knew its read was partial. Depth is the instrument that names
   the shape failure; rings names the size failure. Both were needed.
4. **The signed direction is consistent across tools.** Depth says + at the
   torso (body surface nearer the camera); rings says the chest `deep` is
   too big and asks for -25% of it. Two independent instruments agree the
   round-1 drum is oversized-and-smooth, not undersized.

## How to run

```
npm run blob:depth -- <character>            # text, both views, worst bands first
npm run blob:depth -- <character> --json     # machine-readable (views[], depthSpan, poseSuspect)
npm run blob:depth -- <character> --bands 24
npm run blob:depth -- <character> --glb path/to/mesh.glb
```

Exit 0 whenever it ran (however bad the numbers — a bad score is
information), exit 2 for did-not-run (no `.blob`, no reference mesh, unreadable
mesh). A plate is never a fallback: a plate has no depth to diff. Bands name
their owning `.blob` line in the `name.blob:LINE` format the other tools use.

## Provenance

- CLI + test committed on `dispatch/blobforge-task-4` (`aa25b5b`, `d836d8c`):
  `scripts/blob-depth.ts`, `scripts/blob-depth.test.ts`, `package.json`.
- The round-1 minotaur blob is NOT committed here — its home is
  `dispatch/minotaur-character`. It was authored into the tree untracked from
  `git show dispatch/minotaur-character:src/lab/sdf-zombie/characters/minotaur.blob`
  to run the acceptance; `blob:depth -- minotaur` exits 2 on a tree without it.
- Mutation matrix for the CLI test: 9 mutations applied to committed state —
  7 caught (exit codes, canonical mesh resolution, pose label forced-off,
  span comparison flipped, side view dropped, band owner dropped, worst-first
  sort reversed, `.blob:LINE` text format), 1 survived by design
  (`--bands` passthrough unpinned, matching sibling `blob-measure`), 1
  benign control survived (proves the runner reports survival honestly).
