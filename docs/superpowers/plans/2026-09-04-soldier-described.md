# Soldier, authored from a DESCRIPTION — dispatch brief

In-repo copy of `~/.claude/dispatch/plans/2026-09-04-soldier-described.md`.

**This is a deliberate A/B against the mesh-fitting route**, which was tried on
this exact character on 2026-09-04 and thrown away. That run was a 10-task
chain plus a day of tuning and produced a pot-bellied egg with an unreadable
face — while `blob:rings` reported clean, 2524 tests passed and
`blob:render-check` exited 0. The measurements passed things that looked
wrong, because the bones that mattered were *skipped* and a skipped bone is
indistinguishable from a converged one.

So this brief has **no measurement step at all**. The reference is a picture,
the spec is prose with numeric anchors, and the gate is the render.

Everything from the abandoned attempt is preserved at tag
`blobforge-experiment-2026-09-04`.

---

```markdown
---
title: "Author the soldier from a description — a footsoldier grunt. Judgement over fidelity: to spec, but novel."
status: pending
project: /Users/donny/Projects/blud
model: kimi/k3:high
branch: dispatch/soldier-described
base_branch: claude/soldier-character-modeling-7f88ae
priority: 1
max_runtime: 120m
created: 2026-09-04
depends_on: []
allowed_tools: Edit,Write,Bash,Read,Glob,Grep
harness: pi
---

## THE ONE JOB

`src/lab/sdf-zombie/characters/soldier.blob` — a footsoldier that reads as a
footsoldier from every yaw, and has some character to it. The owner will look
at a turntable. Nothing else is being scored.

## THE REFERENCE IS A STARTING POINT, NOT A TARGET

`docs/dev-notes/refs/soldier-views-ref.png` — front / side / back.

**Read it, then put it down.** You are NOT matching it. There is a mesh in
`docs/dev-notes/refs/soldier-mesh/` and you should **ignore it** — fitting it
is what failed. Do not run `blob:rings`, `blob:measure`, or
`scripts/head-profile.ts`. If a change reads better than the reference, make
it and say why in a comment. That licence is the point of this experiment.

## THE CHARACTER

A heavy-set enlisted grunt. Not elite, not a hero — a guy issued equipment.

**The silhouette must read in three beats from the crown down:** flat top,
then a heavy shoulder yoke, then a wide belted waist. If a viewer at 20 m gets
those three, the character works.

- **Height ~1.70 m.** Head about 1/8 of it. Shoulders roughly 1.4 head-widths
  across — broad, but not a bodybuilder.
- **Green flat-top hair.** Squared off, sitting ON the crown. This is the
  single most identifying feature; if it reads round, the character is lost.
- **Bare, thick arms.** Deltoids and forearms visible. He wears armour over a
  sleeveless top — the bare arms against hard plate are most of the read.
- **Heavy shoulder plates and a chest plate.** Hard-edged, machined, sitting
  proud of the torso. `box` + `metal` exist for exactly this.
- **A wide utility belt with pouches** at the waist, breaking the torso's line.
- **Camo fatigue trousers**, knee plates, heavy boots.
- **A scowling bearded face.** Bake it, do not paint it (see below).

**Palette:** olive/khaki camo, grey-green plate, muted red accents on the
boots and chest, skin around `#cb956a`. Do not skip the `palette` block — a
character without one renders as the zombie in a different shape, which is
documented, not a warning.

**Proportions are ±10%.** They are anchors, not a fit target. Anything not
named above is yours.

## YOUR LOOP — author, shoot, look, adjust

1. Write `.blob` lines. Read `characters/schoolgirl-alt.blob` first — 31 prims,
   a whole clothed human, and the method this brief is returning to.
2. `npm run blob:shot -- soldier`, then **`Read` the frames**.
3. Judge them against the three-beat read above. Adjust. Repeat.
4. `npm run blob:render-check -- soldier` before you finish — exit 0. If it
   fails, the bug is in `webgpu/`, not your file; report and stop.
5. `npx vitest run src/lab/sdf-zombie/` green before you commit.

**There is no measurement step. Do not add one.** No IoU, no residuals, no
bone-length table. You have eyes and the frames are the gate.

**`kimi/k3` HAS vision** (verified in `~/.pi/agent/models.json`, 2026-09-04 —
the skill and template say otherwise and are stale). `Read` the plate and your
own frames directly. Do NOT use `scripts/vision-ask.py`.

## WHAT IS ALREADY ESTABLISHED — do not rediscover this

Each of these cost a day on 2026-09-04.

**Register the character or you will judge the wrong body.** The WebGPU lab
renders the ZOMBIE for any character not hand-listed in
`webgpu/lab-main.ts`'s `CHARACTERS`.

**The face is a BAKED DECAL, never painted prims.** `npm run blob:face-bake --
soldier`, then wear it with `sheet` / `image soldier-face.png` / `decal 1`. Do
not add eye or mouth prims — three separate dispatches tried and read as a
visor band. **`decal` must stay 1**: the loader fetches the baked PNG only
`if (params.decal > 0.5)`, so `decal 0` silently drops the bake and multiplies
the generated procedural sheet instead.

**The decal is gated by surface NORMAL, not distance.** Full strength within
~49° of facing front, gone by ~74°. So a feature that turns the surface away —
a nose's flanks, ears — loses the texture at ANY size. Distance is not the
constraint; the extent gate does not begin until `|hs| 1.95`.

**A painted prim REPLACES the decal over its whole footprint** — "mottle and
face sheet included". So you cannot paint just part of a face feature. This is
why the previous attempt's nose had to be abandoned.

**Paint follows the NEAREST prim, so hair need not enclose the skull** — only
be nearest at the crown. And an ellipsoid's cross-section shrinks going up, so
a crown cap is a fraction of the size of a helmet-shaped box. A big box reads
as "a green rectangle bush"; a small cap reads as hair.

**Do not build the hair from a huge box.** Beyond looking wrong, `headShape()`
picks the largest UNPAINTED head prim for the face projection — that was fixed
2026-09-04 — but an oversized painted prim is still the wrong shape.

## DONE WHEN

- the frames read as a footsoldier from every yaw, with the three-beat
  silhouette intact
- limbs read as separate limbs, not as bulges on the torso
- the face is a baked decal and reads as a face
- `blob:render-check -- soldier` exits 0
- `npx vitest run src/lab/sdf-zombie/` green, `npx tsc --noEmit` clean
- your report says **what you invented and why** — that is the experiment

## COMMIT AS YOU GO

Runs here have been cut off mid-flight and lost everything. Commit after every
step that compiles.
```
