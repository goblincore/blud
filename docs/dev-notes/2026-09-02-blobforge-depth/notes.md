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

---

# blob:draft — re-drafted on rig-chain lines, re-judged

**Date:** 2026-09-03 · **Task 4 of** [blob draft chain drift](../../superpowers/plans/2026-09-02-blob-draft-chain-drift.md) · **Branch:** `dispatch/chaindrift-task-4`

Tasks 1-3 moved `len=`/`dir=` from the vertex cloud to the rig's joint-to-joint
segments × one global scale (the chain), demoted the `>45°` cloud-steering
fallback to a REPORTED check, grounded the root, calibrated the scale to the
SURFACE, and made all three acceptance properties tests. This task re-drafted
both characters and answered Task 10's question again.

## Acceptance — both characters, all three properties

| property | minotaur | schoolgirl | Task-10 draft (before) |
| --- | --- | --- | --- |
| soles vs floor | **−0.0001 m** | **0.0000 m** | ~0.3 m above |
| extent vs height line | **+0.02%** (1.2170 vs 1.2168) | **+0.01%** (1.7002 vs 1.7000) | ~8% tall |
| worst mapped `len=` dev | **0.00004 m** (shin) | **0.00003 m** (thigh) | not a property then |
| build | 0 error(s) | 0 error(s) | 0, but floating |

Both drafts printed the numbers in the CLI header and on stderr — no eye
involved. The chain closes.

**Schoolgirl builds connected with NO cloud steering** — the case the fallback
was added for. Her dress/pelvis clouds measure 80-87° off the rig chain and are
now reported (`cloud axis NN° off the rig chain — reported, not corrected` on
nine bones) while her bones take the rig's directions; `buildDraft` +
`validateBody` (bone containment is what disconnection trips) stay clean. The
fallback's steering role is dead code gone, and she no longer needs it.

**Regression — the parts that worked still work.** Minotaur: 72/80 prims
(68 authored + 4 face), worst cluster inside the per-cluster ceiling, and the
prosthetic stays UNMIRRORED — `shin: NOT mirrored (asym 0.627) — prims emitted
per side`; the emitted `shin.l` prims are browns with `mirror`, the `shin.r`
prims greys with `side=r` (5 vs 9 bands, different radii and offsets). The
asymmetry detection is doing exactly what `side=l|r` exists for.

## The instruments, before and after

| instrument | round-1 scaffold | Task-10 draft | THIS re-draft |
| --- | --- | --- | --- |
| `blob:depth` front mean | 54.1 mm | 164.2 mm | **88.0 mm** (POSE-DOMINATED 1.5×) |
| `blob:depth` side mean | 193.7 mm (1.5× pose) | 339.6 mm (0.8×) | **142.0 mm** (unflagged) |
| torso, side worst | +340 mm drum bulge | (same family) | **gone** — chest/pelvis bands now −127…−36 mm |

The signed errors flipped from Task 10's mostly-negative-drum to
mostly-negative-everywhere: the body no longer claims volume it lacks, and the
one region that bulged wrongly (the torso drum) now reads as honest missing
relief. The depth win over round 1's side mean (142 vs 194, and unflagged
against r1's pose-dominated 1.5×) is NEW — Task 10's draft lost every depth
measure by 3×.

## The eye (BLOB_DIST=3.0 and 1.8 turntables, r1 re-shot same-session for the A/B)

The re-draft still reads as a scarecrow mannequin painted like the minotaur:
T-posed (deferred by design), narrow strap torso, long thin arms, bowed
crouched legs, no horn read, no prosthetic-plate read — the prosthetic
distinguishes itself only as a grey ball at one knee. Round 1 in the same
frames: brown hulk, huge traps, horns, boxy prosthetic — flawed sculpt, but
unmistakably the character.

## Verdict: **no** — round 1 remains the better starting point for THIS character.

A second honest no, and the reasons are DIFFERENT, which is the point:

1. **Task 10's structural reasons are FIXED.** The skeleton stands on the
   floor at its own height line with rig-exact lengths — the ~0.3 m and ~8%
   failures no longer exist, and no fallback steers anything. What the spec
   promised (a skeleton that stands) is delivered and measured.
2. **The T-pose** (unchanged, deferred by design): the author's first hour is
   still re-posing arms the draft refuses to angle.
3. **Identity still lives at sub-band scale** (unchanged): horns, hooves and
   prosthetic plates are exactly what band medians discard and the budget trim
   drops first.
4. **NEW — the frame transfer on oblique clouds.** `bandRange` projects
   cloud-frame band edges onto the rig-chain statement line. The prosthetic's
   shin.r cloud axis sits 76° off the rig chain, so bands measured along the
   cloud axis project into a 0.19-0.23 sliver of the bone — several with
   `from>to` (harmless: `resolve` lerps the two endpoints, order-free — but
   the PLACEMENT is wrong), and the trim then leaves a mid-shin gap. Depth
   blames `legR` at −75…−92 mm; the eye sees the grey knee-ball. The old
   pipeline never hit this because it placed bands in the cloud's own frame —
   the chain drift fix is what EXPOSED it, honestly.
5. **NEW — the face block is now the worst side-view band** (−367 mm at
   y 0.188-0.250, "no .blob line — a TS-authored prim owns this height"): with
   the drum gone, the fixed face block's placement vs the drafted
   hair-heavy skull is visible in the numbers.

The likeness gap is the spec's own fenced-off territory ("this spec is about a
skeleton that stands on the floor, not about a character that reads") — and
what is left is exactly that layer, plus the two new placement defects above.

## Defects found and fixed en route (this task's commits)

1. **FIXED (d8f2ec8): the emitted header still told the pre-fix story** —
   "Bone axes are cloud medial lines, never rig joints" — contradicting the
   per-line `# fit:` comments beneath it. Tasks 1-3 changed the code and the
   fit comments but missed the header prose.
2. **FIXED (32308a4, same commit as the re-draft): `emits NO offset=` scanned
   the WHOLE emitted text**, so the corrected header's prose mentioning the
   grammar's own `offset=` argument tripped it. The pin now reads prim lines
   only — its stated intent ("no `offset=(0,0,0)` noise" is a statement about
   prim lines). Mutation-verified: removing the 5e-5 zero-threshold in the
   emitter still fails it.
3. **Reported, not fixed (not this task's files):** the band frame transfer
   (verdict item 4) and the face-block placement (item 5).

Also worth recording: the plan's verbatim command (`npm run blob:draft --
minotaur > /tmp/...`) still embeds npm's stdout banner in the artifact — Task
10's notes already corrected this (`npx tsx scripts/blob-draft.ts` for any
file that will be parsed); the plan text was never updated. And the plan's
baseline figure (2170) was the pre-tasks-1-3 count; this branch's baseline
entering task 4 was 2182 / 112 files, green, tsc clean — recorded before any
edit.

## Mutation matrix (this task's only test change)

| mutation | result |
| --- | --- |
| emitter's `offset=` zero-threshold removed (emit `offset=(0,0,0)` noise) | KILLED — `emits NO offset= when the fit has none` fails |
| restored (`git checkout`), suite re-run | 2182/112 green, `git diff` clean |

The acceptance properties themselves were already pinned as tests by Task 3
(`drafted chain closes`: soles, height line, `len=` == rig × scale) and stayed
green through the re-draft — they are mutation-covered in that task's history.

## Commit provenance

- d8f2ec8 — header names the true source; suite green.
- 32308a4 — re-drafted `characters/minotaur.blob` (the committed Task-10 draft
  replaced; the old one lives in that task's history), plus the
  prim-lines-only offset pin.
- this commit — notes (this section) and the TASKS.md status flip.
- Frames: `/tmp/blob-shot/minotaur-redraft{,-close}` (8+8), A/B:
  `/tmp/blob-shot/minotaur-r1-again` (8). Schoolgirl's draft intentionally NOT
  authored — her hand-authored `.blob` is the converged control.

---

# blob:draft — banding moved into the bone's frame; the plan's Task 1 had to be implemented here; re-drafted and re-judged

**Date:** 2026-09-03 · **Tasks 1-3 of** [blob draft frame and face](../../superpowers/plans/2026-09-03-blob-draft-frame-and-face.md) · **Branch:** `dispatch/framefix-task-3`

## First finding: Task 1 had never landed

The dispatch chain recorded Task 1 (`dispatch/framefix-task-1`) as **done,
exit 0** — but its branch carried **zero commits after the plan** ("no changes
to commit in worktree"). Its agent spent its whole 27-minute run reading code
and verifying the defect against the committed artifact, then died before
writing a line; the harness recorded the run as a success. Task 2's face fix
(5f34bb0) is genuinely on the branch; Task 1's banding fix is **nowhere**. So
this task implemented Task 1 first (tests, fix, mutations — below), then ran
Task 3 verbatim on top of it. Lesson for the dispatch harness, same as the
time-limit lesson already on record: a report is not a commit; only a commit
is a commit.

## Task 1 as implemented — one deviation, forced by the plan's own test 3

The plan says "band against the RIG line, not the cloud line — pass the
bone's rig line", unconditionally. Implemented instead: **band along the
chain's direction only where the cloud's principal axis measures past the
fit's own report bar** (`AXIS_REPORT_DEG`, 45° — the same measured angle the
`# fit:` comment already reports); at or under the bar, today's path is kept
to the bit. Two reasons, both measured:

1. **The plan's third test demands aligned clouds band BIT-identically.** A
   re-band along the exact chain direction changes the direction vector by
   the eigenvector's fp wobble, and mutation M2 (unconditional switch) really
   does flip formatted digits — the guard catches it, so the plan's own test
   falsifies the plan's own unconditional wording.
2. **Radii about the rig axis through the JOINT inflate by √(r²+d²)** once
   flesh sits off the bone (the 9-13 cm trap the chain-drift work
   documented), and would then double-count with `offset=`'s prim
   displacement. So the chain-frame banding line (`cloudBandLine`,
   draft-fit.ts) takes the chain's DIRECTION through the cloud's CENTROID:
   stations land in the statement frame (no transfer), radii stay honest tube
   radii, `offset=` keeps its meaning. `bandRange`'s projection SURVIVES for
   the at-or-under-bar path — honest there, and bit-stability requires the
   same computation — and degenerates to the pure `(t − t_head)/e` fraction
   for chain-frame bands, where it is monotone in t by construction: **from>to
   is structurally gone, not re-sorted.**

The measured defect, refined from the plan's account: the plan said "76° off
the rig chain, cos 76° ≈ 0.24". Two corrections. First, 76.25° is the angle
fitSide reports — measured against a PHANTOM segment: the branch rule extends
the r-side fit's frame from the LEFT knee to the RIGHT foot (the .blob
parent's chain tail is the left joint in a one-sided rig map). Against the
statement line the banding actually uses, the prosthetic's axis sits ~88-95°.
Second, and worse than cosine shortening: at ~90° **the axis itself projects
to a point**, so every band edge lands on one fraction and the whole flesh
footprint rides the "radius" — the emitted 9 bands (3 degenerate-dropped)
crammed into [0.196, 0.233] with four from>to inversions, the mid-shin gap,
the grey ball at one knee. The same collapse stacks the fixture pelvis into
`from=0 to=0` prims — this was never prosthetic-specific; it hits any cloud
whose axis is not a limb axis.

## Task 3 — the numbers

**Chain-drift properties, unchanged** (the fix must not cost them; both
re-drafts build + validate clean, render-check 0 holes):

| property | minotaur | schoolgirl | chain-drift pins |
| --- | --- | --- | --- |
| soles vs floor | **−0.0001 m** | **0.0000 m** | −0.0001 / 0.0000 |
| extent vs height line | **+0.01%** (1.2169 vs 1.2168) | **+0.01%** | +0.02% / +0.01% |
| worst mapped `len=` dev | **0.00005 m** (chest) | **0.00003 m** (thigh) | 0.00004 / 0.00003 |

All three sit at the artifact's own 4-decimal formatting noise (±5e-5 m) —
the minotaur's len= dev moved 4e-5 → 5e-5 and shin → chest, i.e. a different
bone at the same noise floor. Not a regression.

**The prosthetic's emitted statement** (shin.r, per side, unmirrored — asym
0.627 preserved): was 9 bands fit / 6 emitted / 4 inverted / span
[0.196, 0.233]; now **5 bands, 0 inverted, span [0.000, 1.000]**, interior
spread 0.424, radii 0.021-0.106 about the cloud-parallel axis (the
joint-anchored variant would emit ~0.17+ and double-count `offset=`).

**`blob:depth -- minotaur`** (re-drafted artifact committed):

| instrument | round 1 | chain-drift re-draft | THIS re-draft |
| --- | --- | --- | --- |
| front mean | 54.1 mm (0.8× pose) | 88.0 mm (1.5× POSE) | **70.3 mm** (1.5× POSE) |
| side mean | 193.7 mm (1.5× POSE) | 142.0 mm (unflagged) | **95.4 mm** (1.07×, unflagged) |

Side mean improved 142.0 → 95.4 mm (−33%) and now beats round 1's side by 2×,
with a better pose ratio (1.07× vs r1's flagged 1.5×). Front improved
88.0 → 70.3 mm but stays pose-flagged and behind round 1's front — the arms
own the front view's z-buffer (caveat 2 from the first run, unchanged).
Schoolgirl control re-measured identical (32.9 / 270.1 mm — her committed
hand-authored blob; her draft re-drafted to /tmp only, properties above).

**The face band** (Task 2's gate): still the worst side band, now −272.7 mm
at y 0.188-0.250 (was −367/−376). Task 2's finding stands and strengthens:
the band measures T-pose ARM mass at those heights — the arms' own prims
moved under the banding fix (upperarm axis 57° off) and the band moved with
them, while Task 2 measured that genuinely-compared face pixels contribute
−4 mm of it. No face-block placement can clear this gate; the gate itself is
miscalibrated while the reference is T-posed.

## The eye (BLOB_DIST=3.0 and 1.8 turntables, r1 re-shot same-session)

Pre-fix close frames (`/tmp/blob-shot/minotaur-redraft-close`): the
prosthetic is **a grey ball at one knee** — the mass stacked at [0.2] of the
shin, bare below. Post-fix (`/tmp/blob-shot/minotaur-framefix-close`), same
framing: **the ball is gone** — grey material now runs knee → upper shin
(bands [0.017, 0.44], radii ~0.10) and a thin band continues to the boot; the
leg reads as one connected bowed limb with a grey covering on its upper half,
from both 3/4 angles. Round 1 in the same frames still owns the PLATE read —
boxy slab hip-to-ground, unmistakably a prosthetic.

**Verdict on the plan's question: YES at the level this plan owes — the
prosthetic reads as a leg, not as a grey ball at one knee.** The ball was the
frame transfer's output; it is structurally impossible now (monotone bands,
full span). Overall likeness: a third honest **no** — the T-pose, the strap
torso, and the missing horn/plate identity are the same fenced-off gaps as
before (sub-band scale + pose), and this plan does not owe them. The depth
instruments agree with the eye this time: side mean −33% at a better pose
ratio, torso bands −127…−36 mm unchanged-good, the worst side band is now the
T-pose arm artifact, not the figure.

## Task 1's tests and the mutation matrix (4 mutations, 4 killed, none vacuous)

Three tests in `draft-emit.test.ts`, all end-to-end on the synthetic rigling
fixture (real pipeline: detectRig → assembleDraft → emitDraft), plus an
oblique variant whose right shin cloud is a prosthetic plate (900-vert
ellipsoid, long axis across the bone; legs splayed like the brawler stance;
count skew 0.667 vs the real 0.627 so the pair is honestly NOT mirrorable):

- `spans the bone for an OBLIQUE cloud` — interior bands must tile ≥ 0.30 of
  the bone (the plate's honest footprint is ~0.65; the pre-fix sliver
  measured 0.022); plus the median band radius bounded [0.09, 0.15] (kills
  the joint-anchored variant that inflates by √(r²+d²) and double-counts
  `offset=`).
- `never emits from > to` — every band of every bone of BOTH drafted bodies;
  fails pre-fix on the fixture's inverted bands (`from=0.4732 to=0.4726`),
  reproducing the committed artifact's failure band-for-band.
- `leaves an ALIGNED cloud unchanged` — the fixture's limb tubes (long, thin:
  their principal axes ARE their rig segments) pinned to the pre-fix numbers
  VERBATIM, bit-identical. Deliberately NOT pinned: the pelvis ball and the
  short-fat torso tubes — their axes are radial noise that MEASURES past the
  bar (89.9°), so they ride the chain-frame path by measurement, and their
  pre-fix output was the pinned-ends-plus-mid-sliver collapse this plan
  fixes; and the hand band, which rides the budget-trim boundary.

| mutation | killed by |
| --- | --- |
| M1: conditional removed — always cloud-axis banding (pre-fix behaviour) | T1 (span 0.022 < 0.30) + T2 (from>to returns) |
| M2: unconditional chain-frame banding (the plan's literal wording) | T3 (aligned pin — bit-identity breaks) |
| M3: banding line anchored at the rig JOINT, not the centroid | T1 (median radius inflates past 0.15) |
| M4: end-pin perturbed (first band from=0.001) | T3 (aligned pin) + T2 |

Full suite **2185 → 2188 green** (112 files; +3 tests), tsc clean, both
before and after re-authoring `characters/minotaur.blob`. TDD order held:
T1+T2 watched failing for the right reasons (sliver 0.022; the inverted band
line quoted in the failure), T3 watched passing, before the fix existed.

## Plan corrections on record

1. "Pass the bone's rig line" (unconditional) contradicts the plan's own
   bit-identical guard — implemented as conditional at the fit's existing
   report bar; the guard mutation-kills the unconditional variant (M2).
2. The 76° provenance: that angle is measured against the branch rule's
   PHANTOM r-side segment (left knee → right foot), not against the
   statement line the transfer projects onto (~88-95°, negative slope — which
   is what runs from/to BACKWARD). The collapse at ~90° is the axis
   projecting to a point, not cosine shortening to 0.24.
3. "Most bones are this case [aligned]" is false for both real characters —
   of the minotaur's mapped bones only four measure under the bar
   (forearm.l/r 6-8°, shin.l 29°, foot.r 42°); every other bone sits 47-89°
   off its chain. The fixture had to be built to contain genuinely aligned
   bones (the long thin limb tubes) for the guard to mean anything.
4. (Carried from Task 2's commit, restated for the Done-when list:) "the face
   block is no longer the worst side-view band" is not meetable by any
   face-block placement while the reference is T-posed — the band measures
   arm mass. The gate should be re-worded or the pose deferred item done.

## Commit provenance

- 6539a01 — Task 1: conditional chain-frame banding + `cloudBandLine` +
  the three tests + the oblique fixture (tests written and watched failing
  before the fix; mutations applied against the committed state).
- this commit — the re-drafted `characters/minotaur.blob`, notes (this
  section), TASKS.md. Schoolgirl's draft stays unauthored (her hand-authored
  `.blob` is the converged control; her re-draft lives at
  `/tmp/schoolgirl-redraft2.blob`).
- Frames: `/tmp/blob-shot/minotaur-framefix{,-close}` (8+8), A/B
  `/tmp/blob-shot/minotaur-r1-framefix{,-close}` (8+8); the pre-fix
  before-frames are the chain-drift task's `/tmp/blob-shot/minotaur-redraft-close`.
