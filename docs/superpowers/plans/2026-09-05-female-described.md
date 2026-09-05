# A female character, authored from a description — dispatch brief

In-repo copy of `~/.claude/dispatch/plans/2026-09-05-female-described.md`.

Second run of the method that produced the soldier: a picture, a written spec
with numeric anchors, the cast for style, no measurement step, and explicit
licence to invent. The soldier took **22 minutes and 24 prims** that way,
against a 10-task mesh-fitting chain and a day that produced a pot-bellied egg.

---

```markdown
---
title: "Author a female character from a description — proportions from the reference, style from the cast, identity yours."
status: pending
project: /Users/donny/Projects/blud
model: kimi/k3:high
branch: dispatch/female-described
base_branch: claude/soldier-character-modeling-7f88ae
priority: 1
max_runtime: 120m
created: 2026-09-05
depends_on: []
allowed_tools: Edit,Write,Bash,Read,Glob,Grep
harness: pi
---

## THE ONE JOB

`src/lab/sdf-zombie/characters/female.blob` — a woman who belongs in this
cast. The owner will look at a turntable. Nothing else is being scored.

## THE REFERENCE GIVES PROPORTIONS. NOTHING ELSE.

- plate: `docs/dev-notes/refs/female-example-views-ref.png` (front / side)
- mesh: `docs/dev-notes/refs/female-example.glb`

**Read the plate, then put it down.** The mesh is there if you want to check a
proportion, but **do NOT fit it** — no `blob:rings`, no `blob:measure`, no
`head-profile.ts`. Its rig is Rigify with 722 joints of IK and MCH helpers, so
the fitting tools cannot read it anyway, and fitting is what failed on the
soldier: it passed every numeric gate while looking wrong.

**The reference is a nude body in an A-pose, and that is deliberate** — it is a
proportion reference, not a character. It also carries clothing meshes (dress,
belt, buckle, necklace, earrings, watch, nails) that the owner has explicitly
told you to IGNORE. Only `Excella_head`, `_torso`, `_arms`, `_legs` and
`excella_hairbun` are the body.

What to take from it: an hourglass line — shoulders and hips reading wider
than a clearly narrow waist — slim limbs, and hair worn UP in a bun rather
than loose.

## LOOK AT THE CAST — SHE HAS TO BELONG BESIDE THEM

Before writing a line, **shoot and LOOK at the four characters the owner has
approved**:

```
npm run blob:shot -- goblin
npm run blob:shot -- soldier
npm run blob:shot -- zombie
npm run blob:shot -- clown
```

`Read` those frames. Read `goblin.blob` too — its comments explain WHY its
nose, ears and lips are shaped as they are, and that reasoning is the house
style more than any single number.

What to notice, and match: how heavy and blended the masses are, how FEW
primitives carry a whole character (the soldier is ~15 for a body,
schoolgirl-alt 31 for a clothed one), how much work bold colour blocking does
against fine detail, and how each character leans on two or three exaggerated
features while everything else stays simple.

## THE IDENTITY IS YOURS

The owner has not said who she is — deliberately. **You decide, from the cast.**
Blud is Weird West crossed with online brainrot; she should read as a member of
that bestiary rather than a figure study.

Pick two or three exaggerated features that carry her silhouette and say, in
your report, WHY you chose them and how you decided she fits beside the goblin
and the soldier. That judgement is half of what this task is for.

**She must not ship nude.** The reference's own clothes are out of scope, so
dress her yourself in the cast's idiom — paint on the sculpt is how the mouse
and schoolgirl do it, and it costs no prims. A polygon `.wam` kit exists for
HARD things (see `soldier-kit.wam`) but is a separate, later task; do not start
one here.

## YOUR LOOP — author, shoot, look, adjust

1. Write `.blob` lines. Read `characters/schoolgirl-alt.blob` first — a whole
   clothed woman in 31 prims, and the closest existing character to this job.
2. `npm run blob:shot -- female`, then **`Read` the frames.**
3. Adjust. Repeat.
4. `npm run blob:render-check -- female` before finishing — exit 0. If it
   fails, the bug is in `webgpu/`, not your file; report and stop.
5. `npx vitest run src/lab/sdf-zombie/` green before you commit.

**There is no measurement step. Do not add one.** You have eyes and the frames
are the gate.

**`kimi/k3` HAS vision** (verified in `~/.pi/agent/models.json`). `Read` the
plate and your own frames directly. Do NOT use `scripts/vision-ask.py`.

## WHAT IS ALREADY ESTABLISHED — do not rediscover this

Each cost a day on 2026-09-04/05.

**Register the character in `webgpu/lab-main.ts`'s `CHARACTERS`** or the lab
renders the ZOMBIE and you will spend an hour judging the wrong body.

**The face is a BAKED DECAL, never painted prims.** `npm run blob:face-bake --
female`, worn as `sheet` / `image female-face.png` / `decal 1`. Three separate
dispatches tried painted eyes and mouths; all read as a visor band. **`decal`
must stay 1** — the loader fetches the baked PNG only `if (params.decal > 0.5)`.

**A bad key in the `sheet` block used to be silent** and put the zombie's face
on the character. It logs loudly now — if you see that error, fix the block;
do not work around it.

**`eyeGlowCut` is what makes baked eyes glow.** It must sit BELOW the bake's
maximum luma or nothing clears the mask. The soldier's tops out at 0.855, so
his cut is 0.670 against a 0.880 default.

**Every prim must touch the body.** `strandedOf` (`blob-checks.ts`) is run over
every character by the suite; a piece that floats clear fails it.

**`blob:shot` captures are reliable for SILHOUETTE and useless for
lighting-dependent judgements** — the turntable exposes darker than the lab, so
glow and tone read differently there. Judge shape from captures.

## DONE WHEN

- the frames read as a woman who belongs in this cast, from every yaw
- limbs read as separate limbs, not bulges on the torso
- she is clothed, in the cast's idiom
- the face is a baked decal and reads as a face
- `blob:render-check -- female` exits 0
- `npx vitest run src/lab/sdf-zombie/` green, `npx tsc --noEmit` clean
- your report says **who you decided she is, what you exaggerated, and why**

## COMMIT AS YOU GO

Runs here have been cut off mid-flight and lost everything. Commit after every
step that compiles.
```
