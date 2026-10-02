# Goblin armour (phase 2) — working notes

## Task 2: painted pants and shirt (2026-10-02)

- `color=` paint on the new body keeps the body grain's mottle: the pants read as worn cloth, not flat plastic, with
  no renderer change needed. The first hexes (4a4d50 / 383c3f) rendered near-black under the lab's key; the renderer
  darkens low sRGB values, so the shipped values are 7a7e82 (pants) and 585c60 (shirt).
- Painted prims: pelvis bar + gut blob, thigh and shin bars (pants); spine1 and chest bars + 6 spine beads (shirt).
  The ankle knob and feet stay flesh under the boot.
- Removed from the kit: fauld, cleaver, buckler (cleaver/buckler retired by the refinement spec).
- The old boots and greaves are still the pre-phase-2 pieces, replaced in Task 3.
- Frames: `task2-front.png`, `task2-three-quarter.png`.

## Task 3: boots, cuff, knee plate (2026-10-02)

- Boot shaft hugs the shin 6.4-7.9 mm off the flesh over its whole height; the gaiter cuff stands 10.6-14.1 mm off
  (flares over the boot top). Pinned in `goblin-kit.test.ts`.
- **Flesh feet removed** from `goblin.blob` (commented, with the restore lines). In the walk pose the flesh foot swung
  out from under the sole (`BLOB_POSE=walk`); the soldier made the same call on 2026-09-05. The foot bone stays.
  Re-pinned on purpose: `pack.test.ts` goblin prof array (4 fewer prof-0 entries, nothing else) and the
  `pack-golden` snapshot (paint + feet).
- Knee plate is a chain loft across thigh..shin (skinned with blended weights at the joint) and followed the bend in
  the walk frames.
- **Known failing until Task 5:** `silhouette.test.ts` "says kit when the outline there is clothing". It asserted that
  the old fat boots stood proud of the flesh outline; the new kit hugs the flesh by design. The pauldrons will
  protrude again, so re-check it after Task 5 and re-aim the test at the shoulder band if needed.
- Frame: `task3-walk.png` (the walk gait is still the zombie shamble: arms out is phase 4's problem, not the kit's).
