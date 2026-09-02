# Minotaur character — dispatch plan

Copy of the task queued at `~/.claude/dispatch/plans/2026-09-02-minotaur-character.md`,
kept in-repo so the brief is reviewable and versioned. Built from
`docs/dev-notes/dispatch-character-task-template.md` — **the loop is verbatim
from that template on purpose.** A dispatched agent that improvises its own loop
is how the last several characters drifted.

**Depends on the `box` primitive** (`X1.box-prim`, tasks 1-8 of
`2026-09-02-blob-hard-surface-box.md`). `base_branch` must carry it.

---

```markdown
---
title: "Author the minotaur — a demon brawler with a prosthetic right leg, using the new box primitive for its plates"
status: queued
project: /Users/donny/Projects/blud
model: zai/glm-5.3-flash
branch: dispatch/minotaur-character
base_branch: claude/enemy-characters-blobforge-b45932
priority: 1
max_runtime: 120m
created: 2026-09-02
allowed_tools: Edit,Write,Bash,Read,Glob,Grep
harness: pi
---

## THE ONE JOB

The owner will look at a turntable and judge whether it reads as a heavy
bull-headed brawler whose RIGHT leg is a machined prosthetic — plates that look
milled, not melted.

## REFERENCE

- mesh: `docs/dev-notes/refs/minotaur-mesh/minotaur.glb` (committed — verify with `git ls-files`)
- no plates; the mesh is the only reference

**`zai/glm-5.3-flash` HAS native vision** (`input: ["text","image"]`). `Read` the
frames you produce directly. Do NOT use the `scripts/vision-ask.py` sidecar —
that is the fallback for text-only models, and quoting a description of a frame
is strictly worse than looking at it.

## YOUR LOOP — do not improvise a different one

1. `npm run blob:rings -- minotaur` — record the starting residuals and the
   worst blocks in your report.
2. Apply ONE numbered block, whole. Re-run. Repeat.
3. Every ~5 edits: `npm run blob:shot -- minotaur` and `Read` the frames.
4. Any hole or artefact the fit did not predict:
   `npm run blob:render-check -- minotaur` BEFORE editing further. If it fails,
   report it and stop — the fix is not in the `.blob`.
5. `npx vitest run src/lab/sdf-zombie/` green before you commit.
6. The FACE is not yours to paint. Bake it:
   `npm run blob:face-bake -- minotaur`, then wear it with `sheet` /
   `image minotaur-face.png` / `decal 1`. Do NOT add eye or mouth prims; do NOT
   tune the generated-sheet numbers. Three dispatches of painted faces read as
   a visor band or a zombie.

## WHAT IS ALREADY ESTABLISHED — do not re-derive

Measured on the committed mesh:

| | |
| --- | --- |
| rig | `meshy-biped` (`detectRig`), 24 joints |
| verts | 135,942, of which 21,657 dropped below `MIN_DOMINANT_WEIGHT` |
| bind height | 1.217 m — a wide semi-crouch, arms in a clean T |
| coverage | 72.5% reach a measurable bone (bonewalker 67%, mouse 40%) |
| cyber leg | the character's **RIGHT**: `shin.r` 18,032 verts vs `shin.l` 6,724; `thigh.r` 10,635 vs `thigh.l` 6,981 |
| unmapped | `Head` 7,354, `LeftHand` 4,286, `RightHand` 4,075 |

Reference bone lengths, joint to joint, in reference units:

```
pelvis     0.0771    clavicle.l 0.1939    thigh.l 0.2479    foot.l 0.1276
spine1     0.0771    clavicle.r 0.1909    thigh.r 0.2624    foot.r 0.1408
chest      0.0771    upperarm.l 0.1985    shin.l  0.2860
spine2     0.0310    upperarm.r 0.1934    shin.r  0.2786
neck       0.0681    forearm.l  0.2174
                     forearm.r  0.2312
```

**Derive `len=` from these times your chosen height scale, as bonewalker did.**
That is why no `BONE LENGTH IS OFF` block ever printed on that character — the
failure class that drowned every mouse/schoolgirl fit was absent by
construction. Do not eyeball bone lengths.

**Use `blob:rings`, NOT `blob:measure`.** The reference stands in a wide
semi-crouch, so a rasterised whole-figure score is POSE MISMATCH by
construction — same situation as bonewalker, where no clean `--range` window
existed. Ring-fit measures each bone in its own frame, where pose cancels.

**`blob:rings` is paint-blind, and this character is mostly paint.** The
bonewalker run paid for this: the fit sees the field, not the colour, and twice
asked for the painted spine ridge to shrink to nothing. **Expect it to ask for
the prosthetic plates to shrink. Overrule it there and judge those by render.**

## THE PROSTHETIC — use the `box` primitive

This is the first character authored since `box` landed, and the leg is why it
exists. Read the "Hard surface: the bare word `box`" section of
`.claude/skills/authoring-sdf-characters/reference.md` before starting.

The reference's metal is a smooth slab with panel lines PAINTED on — there are
no modelled bolts or greebles. So: `bar ... box` for the plates, `groove` for
the seams, `color=`/`gloss=` for the metal, `bend=` for the red cable runs.

- Plates want `round=0.05`-ish (machined). Flesh does not want `box` at all.
- **`round=` is a FRACTION of `r`, 0..1** — not metres. `round=1` is exactly a
  capsule.
- **Judging a box by silhouette does not work.** The inset is defined so a box's
  axis-aligned extreme coincides exactly with a capsule's, so every on-axis
  width and every `blob:rings` radial reading is identical for the two. Look at
  a CORNER from a 3/4 yaw: two flat faces meeting at a crisp vertical edge is
  the only reliable tell. See `docs/dev-notes/2026-09-02-box-primitive/` for
  what that looks like when it is working.
- `bend=`, `r2=` and `tip=` are REJECTED on a box, and `carve` is still
  head-only — so you cannot bore the thigh cowl's port. Leave it; it is a known
  gap, not something to route around.

## DONE WHEN

- `blob:rings` mean residuals ≤14 mm everywhere measurable, most ≤10 mm
  (bonewalker's converged numbers — roughly 1% of standing height)
- every mapped bone length within ~5% of the reference table
- `npm run blob:render-check -- minotaur` exits 0
- frames in `/tmp/blob-shot/minotaur/` show: a bull head with horns, a heavy
  brawler torso, and a RIGHT leg whose plates read as MILLED — flat faces, a
  crisp edge at a 3/4 yaw — against a left leg that reads as flesh
- the face is a baked decal, not prims
- your report lists start/end numbers and every line you changed, with the
  reason on the line

## COMMIT AS YOU GO

Runs here have been cut off mid-flight and lost everything. Commit after every
step that compiles.
```
