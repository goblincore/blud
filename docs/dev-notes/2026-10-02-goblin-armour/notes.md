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
