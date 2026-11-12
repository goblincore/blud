# The crater grid: many exact wounds a body, a few read a step

Date: 2026-11-11. Status: design, not built, nothing measured. Follows
[the baked wound volume](2026-11-11-baked-wound-volume-design.md), which this would replace.

## Why

Two goals stand: dense close mobs at 30 FPS on an M3, and more wounds a body than 32.

The baked wound volume (voxel boxes, on `main` since PR 119) reached the second goal and then hit three walls
in the owner's playtest of `?woundlist=0`:

- **Room.** The atlas holds six to ten wounded bodies. A level has dozens.
- **Size.** A pellet crater is 3 cm across: 1.5 voxels at 2 cm. 1 cm voxels are 8 times the memory.
- **Look.** A fully baked chest is a shallow blocky surface with no ribs. The cause is not found.

The owner's question (2026-11-11): can bodies share wounds? They can share the SHAPE. Every crater is one
formula with a handful of numbers. Nothing needs to be stored a voxel at a time.

What makes wounds dear is not the formula either. Measured 2026-11-11 (`WOUNDS-WALK.md`): cutting the crater maths
by 59 % saved nothing; the cost is that every march step reads all of a body's wound rows (one texel load and a
distance each, 32 a step) to find the one or two it is near.

## The idea

Keep the exact list and its exact formula. Add an index so a step reads only the wounds near it.

`applyWounds` already walks a list of wound indices when it is given one: the per-ray wound list
(`gWoundList`, `wound-list.wgsl.ts`) is built once a pixel and holds the wounds whose reach the ray enters. Its
reach is wide (0.25 m of slack for samples deep in flesh), so on a shot torso it keeps nearly every wound.

The crater grid is the same thing per SAMPLE instead of per ray:

- A body's wounds sit inside its wound bound (`woundBound`, already computed and uploaded each frame). A cube
  round that bound is cut into 8 × 8 × 8 cells.
- Each frame the CPU writes, for every cell, the indices of the wounds whose reach touches it.
- At a sample, `applyWounds` finds the cell (one subtract and multiply), loads its entry, and walks only those
  indices with the loop body it has today.

Wounds stay where they were shot, keep their ragged and torn edges, their depth caps and their cavities, because
nothing about a wound changes: only which ones a step looks at.

## What it stores

All in the body's own data texture (the one bound today; no new binding, no atlas):

| What | Where | Size |
| --- | --- | --- |
| Wound rows (position, meta, cap, flags, cut) | the wound rows, columns 0 to stride − 1 (today 0 to 31) | up to 128 wounds at the base stride |
| Cell table: (offset, count) a cell | 4 new rows (512 texels) | 8 KB a body |
| Index lists: 4 indices a texel | 4 new rows (2,048 indices) | 8 KB a body |

Eight more rows on a 26-row band. No shared pool, so a level of wounded bodies costs what its bodies' own
textures cost, and nothing runs out.

The grid is in WORLD space and rebuilt each frame from the posed wound positions the upload already computes.
That is deliberate: a grid fixed to a body part would need the rest-pose transform the voxel boxes needed, and
that is where the seams came from. Cost on the CPU: for each wound, the cells its reach sphere overlaps (about 8
to 27), so some thousands of writes a wounded body a frame. To be measured; expected tens of microseconds.

## Exact, or nearly

A wound must be listed in every cell where the list loop would not skip it. The loop skips a wound when
`r > depth − d + 4k` and the rim is out of range, where `d` is the flesh distance at the sample.

- **Exact mode:** insert with the bound the per-ray list uses (it assumes `d ≥ −0.25`). Bit-identical to the
  list, and the cells hold nearly everything: little gain.
- **Tight mode (the point):** insert with the reach a sample at or above the surface needs (crater, fillet,
  rim: about 2.4 depths), plus a few centimetres. Samples deeper in the flesh than that see fewer wounds. A ray
  never rests there; the probes that reach in (scatter, thickness) change slightly.

Tight mode is the visual trade. It is the same kind as the re-fold and the cheaper normal: judged by the owner
in play.

## Stages

Each ends at a measurement or an owner look; a stage that fails stops the line.

1. **Spike: the grid over today's 32 wounds.** CPU builds the cell table and index lists; `applyWounds` takes its
   indices from the cell when a flag is on. No cap change, nothing removed. Timed on the wounded 22-body mob
   against `main`, exact and tight, with stills. This answers the only open question that matters: is a step
   that reads one cell and a few wounds cheaper than a step that reads 32 rows? Expected from the walk's share:
   up to about 15 ms of a 60 ms frame. If it is under 5 ms, stop here.
2. **More wounds.** The ring's cap goes from 32 to the stride (128). The wound rows use their free columns. The
   overflow merge and the baked volume go off by default (`?woundvol=0` becomes the default; its code stays until
   stage 4). The shading loops that walk every wound once a pixel (`woundMask`, the tissue ramp, the wound shadow,
   `ngWounds`) take the cell's list too, or they grow fourfold.
3. **Owner playtest** on E1M1 and MAP28: the spider brain, soldiers, shotgun into a mob. Severing needs no
   change: every wound is on the list again, so the sever rules read it as they did before the volume.
4. **Remove** the baked volume, its atlas and `?woundlist`, and the per-ray wound list the grid supersedes.

## What could go wrong

- **No gain.** A dependent texel load and a variable-length loop at every step may cost what 32 predictable loads
  cost. Stage 1 exists to find out before anything else is built.
- **Dense clusters.** A point-blank shotgun blast puts ten craters in one cell; that cell's steps read ten wounds
  (today: 32). The index rows hold 2,048 entries; a body past that keeps its newest wounds' entries and the
  oldest lose cells (they stop carving there). To be sized from stage 1's counts.
- **Crowd tiles and the compute march.** A pixel's table can hold several bodies, each with its own grid; the
  lookup runs per slot, as the wound rows do today. The per-ray list had a flaw here (it walked one list for every
  slot); the grid does not share state between slots.
- **An open head split** reads its wounds at an un-warped point, off the ray. The per-ray list is switched off
  for such a slot; the grid is indexed by the point it is handed, so it should hold. To be checked, not assumed.
- **Rows.** Eight more rows a band is 31 % more data texture and upload for every body, wounded or not, unless
  the rows are written only for wounded bodies (the texture is still that tall).
- **`MAX_WOUNDS` is 32 in many places** (shader arrays, CPU scratch, tests). Stage 2 is where that is paid.

## Not in this design

- Cuts and the melee head craters keep their own rules and rows, as today.
- Shared pre-baked damage patterns (many bodies pointing at one voxel box): cheap, but old wounds would no longer
  sit where they were shot. Rejected.
- Sparse voxel bricks: fixes room, not size or the shallow look. Rejected.
