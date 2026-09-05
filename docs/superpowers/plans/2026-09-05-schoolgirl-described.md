# Schoolgirl, re-authored from a description — dispatch brief

In-repo copy of `~/.claude/dispatch/plans/2026-09-05-schoolgirl-described.md`.

Third run of the described-authoring method, and the only one where a true A/B
is possible: **the same character, the same reference, two methods.**
`schoolgirl.blob` was built to that mesh with `blob:measure` and is 31 prims;
`schoolgirl-alt.blob` is its ring-fit twin, which `TASKS.md` calls an
"instrument trial". This run authors a THIRD, from a picture and a description,
with no measurement step. Both existing files stay untouched so the owner can
flip between them in the lab and delete whichever loses.

Method scoreboard so far: the soldier took 22 minutes and 24 prims against a
10-task fitting chain and a day; the Widow 28 minutes and 25 prims.

---

```markdown
---
title: "Re-author the schoolgirl from a description — creative choices yours, no mesh fitting. A/B against the two measured versions."
status: pending
project: /Users/donny/Projects/blud
model: kimi/k3:high
branch: dispatch/schoolgirl-described
base_branch: claude/soldier-character-modeling-7f88ae
priority: 1
max_runtime: 120m
created: 2026-09-05
depends_on: []
allowed_tools: Edit,Write,Bash,Read,Glob,Grep
harness: pi
---

## THE ONE JOB

`src/lab/sdf-zombie/characters/schoolgirl-described.blob` — the same character
as `schoolgirl.blob`, authored the opposite way. The owner will put the two
side by side in the lab.

**Do NOT touch `schoolgirl.blob` or `schoolgirl-alt.blob`.** They are the
control in this comparison. Write a new file and register it under its own
name.

## WHY THIS RUN EXISTS

Two schoolgirls already exist and BOTH were fitted to the mesh:
`schoolgirl.blob` via `blob:measure`, `schoolgirl-alt.blob` via ring-fit (its
own `TASKS.md` entry calls it an instrument trial). The method that produced
them was retired on 2026-09-04 after it spent a 10-task chain and a day on the
soldier and produced a pot-bellied egg with an unreadable face — while every
numeric gate passed, because the bones that mattered were SKIPPED and a skipped
bone is indistinguishable from a converged one.

She is the last character still defined by that method, and the only one where
the comparison can be made cleanly.

## THE REFERENCE IS A STARTING POINT, NOT A TARGET

- plate: `docs/dev-notes/refs/schoolgirl-views-ref.png` (front / side)
- mesh: `docs/dev-notes/refs/schoolgirl-mesh/schoolgirl.glb` — **ignore it**

**Read the plate, then put it down.** Do NOT run `blob:rings`,
`blob:measure`, or `scripts/head-profile.ts`. Fitting is the thing this run
exists to be compared against; using it makes the comparison meaningless.

You may also read `schoolgirl.blob` for its FACTS — its measured landmark
table, and its hard-won notes about what broke — but do not copy its
primitives. Its header is a good example of the house comment voice.

What the plate carries: a sailor uniform (white middy blouse, navy collar and
cuffs, a red neckerchief), a navy pleated skirt, bare midriff, white calf
boots, and a dark bob. 1.70 m.

## LOOK AT THE CAST — SHE HAS TO BELONG BESIDE THEM

Before writing a line, **shoot and LOOK at the four the owner has approved**:

```
npm run blob:shot -- goblin
npm run blob:shot -- soldier
npm run blob:shot -- zombie
npm run blob:shot -- female
```

`Read` those frames. `female.blob` is the most recent and the closest in
method — read its header for how it reasoned about fitting into a bestiary
rather than copying a body. Read `goblin.blob` for why its features are shaped
as they are.

## THE CREATIVE CHOICES ARE YOURS

That is the whole point of this run. The plate says "schoolgirl in a sailor
uniform"; it does not say who she is in a Weird West bestiary that already
holds a goblin, a grunt, a gothic widow, a clown and a zombie.

Pick two or three exaggerated features that carry her silhouette, and say in
your report WHY — and how she differs from the two measured versions. The
existing schoolgirl's own notes admit her torso once read as "stacked discs"
and that her outfit is carried by PAINT alone; you are free to solve either
differently.

**Proportions are ±10% anchors, not targets.** 1.70 m, head about 1/8 of it.
Everything else is yours.

## YOUR LOOP — author, shoot, look, adjust

1. Write `.blob` lines. `characters/female.blob` (25 prims) and
   `characters/soldier.blob` (15) are the two authored this way; read one.
2. `npm run blob:shot -- schoolgirl-described`, then **`Read` the frames.**
3. Adjust. Repeat.
4. `npm run blob:render-check -- schoolgirl-described` — exit 0. If it fails,
   the bug is in `webgpu/`, not your file; report and stop.
5. `npx vitest run src/lab/sdf-zombie/` green before you commit.

**There is no measurement step. Do not add one.**

**`kimi/k3` HAS vision.** `Read` the plate and your own frames directly. Do NOT
use `scripts/vision-ask.py`.

## WHAT IS ALREADY ESTABLISHED — do not rediscover this

**Register her in `webgpu/lab-main.ts`'s `CHARACTERS`** or the lab renders the
ZOMBIE and you will judge the wrong body for an hour.

**The face is a BAKED DECAL.** `npm run blob:face-bake -- schoolgirl-described`
— it will need `--out` pointed at
`public/assets/lab/faces/schoolgirl-described-face.png`, and it resolves its
mesh from `refs/<name>-mesh/<name>.glb`, so either pass the mesh explicitly or
reuse `schoolgirl-face.png` if one already exists. **The bake now PRINTS a
paste-ready sheet block — use those numbers.** Start at `decal 0` (multiply, so
the face takes the body's light) and projection near 0.19/0.22. The 0.45/0.58
defaults are for the GENERATED sheet and put a baked face at ~40% of the size
it wants; every character so far started too small.

**`projScale` is a FREQUENCY — lower means BIGGER.**

**`eyeGlowCut` must sit BELOW the bake's max luma** or nothing glows.

**Every prim must touch the body.** `strandedOf` runs over every character in
the suite; a piece that floats clear fails it.

**HER HAIR IS THE INTERESTING CASE.** The existing schoolgirl spends 5 of her
7 head prims on hair. If you find yourself doing the same, SAY SO in your
report and say what you would want instead — there is a `hairlock` primitive
(one bezier, grid-repeated into many strands) specced but deliberately NOT
built, waiting for a character to prove it is needed. Do not build it here.
Just report honestly whether you wanted it.

**Captures are reliable for SILHOUETTE and useless for lighting** — the
turntable exposes darker than the lab.

## DONE WHEN

- the frames read as a schoolgirl who belongs in this cast, from every yaw
- limbs read as separate limbs, not bulges on the torso
- the face is a baked decal and reads as a face
- `blob:render-check -- schoolgirl-described` exits 0
- `npx vitest run src/lab/sdf-zombie/` green, `npx tsc --noEmit` clean
- `schoolgirl.blob` and `schoolgirl-alt.blob` are UNCHANGED — `git diff` on
  them must be empty
- your report says what you chose, why, how she differs from the measured
  versions, and whether you wanted `hairlock`

## COMMIT AS YOU GO

Runs here have been cut off mid-flight and lost everything. Commit after every
step that compiles.
```
