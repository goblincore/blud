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

---

# blob:draft — first run: the minotaur drafted from scratch, judged against round 1

**Date:** 2026-09-02 · **Task 10 of** [blobforge draft + depth](../../superpowers/plans/2026-09-02-blobforge-draft-and-depth.md) · **Branch:** `dispatch/blobforge-task-10`

The plan's question for this task: is the mesh-drafted body a better starting
point than round 1's rejected hand-authored scaffold? **Verdict: no — and the
reasons are structural, not tuning.** The draft is a working tool (its output
parses, compiles, builds, validates, sits at 67/80 prims with the prosthetic
correctly unmirrored), but for THIS character the hand scaffold is the better
starting point by every measure we have, including the eye.

## What was run

```
npm run blob:draft -- minotaur > /tmp/minotaur-draft.blob   # the plan's verbatim command
# authored (untracked) as src/lab/sdf-zombie/characters/minotaur.blob, then:
npx vitest run src/lab/sdf-zombie/        # 2167 passing / 112 files — no regressions
npm run blob:render-check -- minotaur     # exit 0 — renderer agrees with the field, 0 holes
npm run blob:depth -- minotaur            # below
BLOB_DIST=3.0 npm run blob:shot -- minotaur        # /tmp/blob-shot/minotaur-draft
BLOB_DIST=3.0 npm run blob:shot -- minotaur-r1     # round-1 blob, same framing, for the A/B
```

`minotaur-r1.blob` (untracked, model line renamed) is round 1's
`dispatch/minotaur-character` scaffold; both it and the draft stay UNTRACKED —
the registry edit that makes them shootable (see the tooling trap below) is
also uncommitted local working-tree state.

## The instruments

| instrument | round-1 scaffold | the draft |
| --- | --- | --- |
| `blob:depth` front mean | 54.1 mm | **164.2 mm** |
| `blob:depth` side mean | 193.7 mm (1.5× pose) | **339.6 mm** (0.8× pose) |
| budget | 1995-test-era file, 48 prims | 67/80, worst cluster 16/40, validates clean |
| prosthetic | authored `side=r` boxes | correctly NOT mirrored (asym 0.627) but reads as paint, not plates |

The draft's signed errors are mostly NEGATIVE — the mesh has depth the draft
lacks. The band-medians + budget trim systematically thin the figure: the
minotaur's identity mass (traps, pecs, horn crowns, prosthetic plates) lives
in exactly the sub-band-scale extremes a median discards and a trim removes
first. The one instrument the draft wins: its T-pose matches the mesh's pose
along the depth axes (side span ratio 0.8×, unflagged front), so its numbers
are LESS pose-contaminated than round-1's — and still 3× worse.

## The eye (BLOB_DIST=3.0 turntables, both read whole)

- **Round 1** (`/tmp/blob-shot/minotaur-r1`): brown hulk, huge traps, visible
  black horns, boxy white prosthetic. Its documented flaws are all present —
  smooth drum torso, the prosthetic reading as a gravestone slab — but it
  READS AS A MINOTAUR BRAWLER. Show it and the mesh to a person: same
  character, one badly sculpted.
- **The draft** (`/tmp/blob-shot/minotaur-draft`): a dark-red T-posed figure
  with a tan head — the mesh's own T-pose faithfully inherited (posing the
  reference is explicitly deferred by the design), thin straight arms, bowed
  crouched legs, no horn read, no prosthetic read. It reads as a scarecrow
  mannequin that happens to be painted like the minotaur.

## Why the draft loses, precisely

1. **The pose.** The reference is T-posed; the draft faithfully is too. A
   T-pose figure is not a starting point for a standing character — the
   author's first hour would be re-rigging arm angles the draft refuses to
   emit (`side`-base angles are not derivable, by design).
2. **Identity lives at sub-band scale.** Horns, hooves, fangs, ankle pistons,
   prosthetic plates are discrete features smaller than a band. The draft's
   per-band MEDIAN radius (rightly) ignores extremes and its budget trim
   (rightly) drops least-evidenced detail first — which is exactly where
   this character's identity lives. The tool measures mass distribution
   correctly and in doing so erases the character.
3. **What the draft DOES deliver, credited:** a connected, validating,
   in-budget body in ~4 s with a `# fit:` source on every number; per-band
   dominant texel colour (the draft's paint — dark red body, tan head — is
   genuinely right where round 1 hand-painted); correct non-mirroring of the
   prosthetic pair; and the hand-pass-owed list naming every debt. For a NEW
   creature with no round 1 — the cyclops class — this is a real starting
   point. For a character whose identity is ornament, it is not.

## Tooling traps hit on the way (both would have faked the verdict)

1. **`blob:shot` silently renders the ZOMBIE for any character not in
   `webgpu/lab-main.ts`'s hand-written `CHARACTERS` registry.** First draft
   turntable + the round-1 turntable + a zombie control all rendered the same
   pink latex mannequin; `blob:render-check` still exits 0 because it drives
   the field directly rather than the registry. The A/B above only became
   possible after adding both entries to the registry (the same edit every
   prior character's commit made — e.g. schoolgirl-alt's). ALWAYS sanity-shot
   a known-distinctive committed character before judging a new one.
2. **`npm run blob:draft -- x > file` embeds npm's run banner in the
   artifact** (npm prints `> blud@0.0.1 blob:draft` to STDOUT, and the lab's
   parser accepts it as leading trivia — the file then fails the committed
   round-trip suite only after authoring). Author via
   `npx tsx scripts/blob-draft.ts` instead. The plan's verbatim Step-2
   command produces the polluted file; corrected here.

## Plan gaps found and fixed or reported (Task 9's emitter, first real character)

1. **FIXED (`draft-emit.ts`, commit 1d4c8f6): the derived-bone estimate
   omitted the face block's own derivable prims.** The minotaur's face prims
   (radii 0.118/0.092 ≥ half of skull's fattest) derived 2 bones the
   band-only arithmetic never counted: the draft emitted at 130 > the
   shader's hard 128 while its header claimed inside-budget. The estimate
   now reads `facePrims(DEFAULT_FACE)`'s radii as `skull` mass; pinned by a
   real-build-count assertion in draft-emit.test.ts's budget test and the
   minotaur's `=== draft build: 0 error(s)` CLI pin. Task 9's synthetic
   fixture could never see this — it sits far below the ceiling.
2. **Reported, not fixed (out of Task 10's files): the chain drift problem.**
   The emitter chains bones head-to-tail, so each bone's position is its
   PARENT'S TAIL — but `len=` is the CLOUD'S OWN EXTENT (spec: "not the
   joint-to-joint distance"), and clouds overlap. On non-limb clouds the
   principal axis is not even vertical (schoolgirl's dress measured an 86°
   axis). The CLI contains this with a measured fallback — a cloud whose
   axis sits >45° off the rig's growth direction is not a limb (skirt, hair,
   bilateral pelvis; measured gap in the classification: 41° vs 75-89°), and
   its axis falls back to the rig chain direction while extent/radii/residual
   stay cloud-derived, noted on stderr — without which schoolgirl's draft
   does not even build connected. Residual drift remains: the draft stands
   with soles ~0.3 m above the floor and the torso chain ~8% taller than its
   height line. An author fixes both by moving one number (`at=`), which is
   what a draft is for — but the emitter's root form cannot express the
   fix itself.
3. **Reported:** `parseBlob` accepts arbitrary non-comment garbage as leading
   trivia (the npm-banner file parsed; it only failed the round-trip test).

## Mutation matrix (13 mutations, 13 killed, none vacuous)

| # | mutation (in `scripts/blob-draft.ts` unless noted) | killed by |
| --- | --- | --- |
| M1 | resolver returns first-sorted .glb, not canonical | control test (canonical-mesh stderr pin) |
| M2 | missing-mesh returns '' (exit 0/1, not 2) | exit-2-no-mesh test (caught exit 1 — also exposed `readFileSync` outside the try; fixed) |
| M3 | `--height` parsed then dropped | `--height` test |
| M4 | default height hardcoded 1.8 | default = measured-extent test |
| M5 | global scale g=1 | span-vs-height pin in the `--height` test |
| M6 | `=== mesh` header printed to stdout | control test + round-trip test (2 tests) |
| M7 | degenerate-band (negative wide/deep) filter dropped | control test (negative-scale artifact scan) |
| M8 | `pairAsymmetry` result ignored, every pair mirrorable | minotaur per-side shin test |
| M9 | `=== draft build:` diagnostic dropped | control test (build-diag pin) |
| M10 | axis fallback removed (always cloud axis) | control test + `--height` test (disconnection returns) |
| M11 | CLI strips `# fit:` comments from the artifact | `# fit:` scan test |
| M12 | `--height` validation removed | bad-height exit-2 test |
| M13 | in `draft-emit.ts`: face prims excluded from derivedEstimate again | minotaur `draft build: 0 error(s)` pin |

## Commit provenance

- CLI + test: 371d725; unreadable-mesh exit-2 + negative-scale pin: 64a7e45;
  draft-emit derivedEstimate fix: 1d4c8f6. notes.md (this file): last commit
  of the branch.
- Untracked working-tree state left for review: `characters/minotaur.blob`
  (the draft), `characters/minotaur-r1.blob` (round 1, model line renamed),
  and the `webgpu/lab-main.ts` registry lines that make both shootable.
