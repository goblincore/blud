# SDF meshing research — parked

Status: parked by user request on 2026-09-15.
Branch: `codex/research/alice-sdf-meshing`.

This branch preserves the ALICE-SDF-inspired comparison of surface nets,
marching cubes and dual contouring, plus the chamfer/groove follow-up.
It is useful groundwork for Blobforge mesh export and baked geometry, but
is not a current priority and does not directly improve live SDF raymarching.

## Decision

- Baseline dual contouring remains the user's preferred visual candidate.
- The smaller normal-sampling step improves selected geometric measurements,
  but its harsher facets were not preferred visually; keep it experimental.
- No production renderer, mesher or bake default was switched over.
- No further implementation or integration is planned until this work is resumed.

## Results

- [Original comparison](2026-09-15-mesher-comparison/README.md)
- [Original visual preview](2026-09-15-mesher-comparison/preview.html)
- [Chamfer/groove follow-up](2026-09-15-dc-chamfer/README.md)
- [Follow-up visual preview](2026-09-15-dc-chamfer/preview.html)

The reviewed implementation is at `7c8cb8e1`. Independent validation passed
93 focused tests, TypeScript typechecking and the follow-up smoke run.
This is not a full game, GPU or gameplay validation.

If resumed, compare baseline DC against existing surface nets on a real
authored Blobforge asset before deciding whether an editor export workflow
is worth integrating. Judge visual coherence and materials alongside geometry
metrics; the synthetic groove fixture alone is not an adoption gate.
