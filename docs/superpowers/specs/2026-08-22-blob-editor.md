# Blob editor — an interactive SDF character builder (spec, not yet planned)

Owner's ask (2026-08-22): "a separate tool where I can manipulate and build
characters from the SDF primitive library we have, smoothly merge them
together, resize and adjust their shape, plus paint them." Agent-driven
authoring works but iterates slowly; the owner is time-poor, so this is
**second** behind the agent toolbox plan
(`docs/superpowers/plans/2026-08-22-sdf-agent-toolbox.md`). Both share
code: the editor is the interactive face on the same measure/emit functions.

## What already exists (do not rebuild)

- **Picking is free.** The march computes `hitBest` — nearest primitive per
  pixel — because paint needed it. Click → primitive index → `.blob` line
  (after the toolbox plan's Task 1 adds `src`).
- **Live re-upload.** The lab rebuilds and re-uploads the data texture on
  every face-slider change (`rebuildBody` → `writeRow`). A primitive edit is
  the same path.
- **Text round-trip that keeps comments.** `blob-emit.ts` splices changed
  values into the original line and replays every other line byte-for-byte.
  Today only `face` overrides; generalising it to primitive args is the one
  real engine task here.
- **Checks that can run on every edit:** `validateBody`, `fused`/`clear`,
  the occluder-hull test, the 64-prim cluster cap.

## Scope (v1)

| feature | mechanism |
|---|---|
| Select a primitive | click (hitBest) or a side list grouped by limb in **fold order** (order within a limb changes the surface — the list must show and preserve it) |
| Highlight selection | shader: tint when `hitBest == selected` (one uniform) |
| Move / resize | `TransformControls` on an invisible proxy at the prim; write back `offset=`, `tip=`, `r=`/`r2=`, `wide/tall/deep` |
| Blend | slider for the selected prim's `blend=`; `chamfer` toggle |
| Paint | colour + gloss → `color=`/`gloss=`; "flesh" clears it |
| Add / delete / mirror | "add blob on bone X at t", delete, `both` toggle (mirrored prims edit the ONE source line) |
| Save | `emitBlob` generalised; writes the `.blob`; comments survive |
| Undo | stack of `.blob` text snapshots — free once save is text |
| Checks | validation errors shown red in the panel, live |
| Measure | the toolbox's `blob-measure` numbers in a panel (IoU, worst bands); clicking a band selects its owning prim |

Out of scope for v1: bone/skeleton editing (rare, fiddly angle derivation — stay in text), carves as a drawing tool, animation, kits.

## Decisions to make before planning

1. Where it lives — a mode of `sdf-lab-webgpu.html` (reuses everything; one more panel) vs a separate page. Recommendation: a mode.
2. `emitBlob` generalisation: per-field splice into `raw` keyed by `words` index, so an unedited field keeps its exact text. Mirrored prims: the editor edits the unsuffixed source and both sides update.
3. Whether the editor can *create* a file from a mesh: a "start from mesh" that places one blob per rig joint of the `.glb`. Tempting; defer.

## Size

Roughly 2–3 sessions: `emitBlob` generalisation (½), select/highlight/list (½), transform + blend + paint panel (1), add/delete/mirror + undo + save (½), measure panel (½, depends on toolbox Task 4).
