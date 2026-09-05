# Blud

## Milestones
- M1: Engine & Movement
- M2: First kill + F1 dynamite port
- M3: One-kill feel pass
- M4: Full arsenal - flare gun + wave runner
- M5: Full bestiary + Phase 1 gate
- M6: Chunks & generator (blocked)
- M7: The Algorithm boss fight (blocked)
- M8: Polish (music, balance, HUD) (blocked)
- M9: Ship to itch.io (blocked)

## Asset Pipeline
- A1-A6, A9-A11: RFF/PAL/ART decoding, sprite extraction, animation system
- A6.5: Manual sprite sheets (superseded)
- A7: Voxelization pipeline (deferred)
- A8: Clay shader / post-process (rolled into M3)

## Research Reference
- R1: NotBlood tuning values
- R2: Gib picnum map
- R3: Sprite extraction toolchain
- R4: Blood palette decoding
- R5: Blood .MAP format + texture/asset co-occurrence
- R5.1: Vision-pass family labels + archetype clustering
- R6: NotBlood source-code map

## Feel/Physics Tuning
- F1: Dynamite throw arc + bundle sprite + sRGB fix
- F2: Broad feel sweep - audio table, palookup hit flash, AI timing, screenshake, decal growth
- F2.bone-visibility: Bones are 20% per spec but visually indistinct
- F2.dynamite-throw-distance: Velocities match NotBlood (3-14 m/s); fuse reduced to 1.5s
- F2.blood-trails-density: Sparser than NotBlood reference
- F2.zombie-burn-drop: Powerup drop on burn-melt (deferred per M5-D)
- F2.cascade-gibs: NotBlood spawns smaller secondary gibs
- F2.flare.cap: Cap max concurrent flares per enemy if stacking-too-many
- F2.cultist.gibs: Cultist-specific gib palette
- F2.cultist.dodge: Dodge/strafe behavior
- F2.cultist.search: Search-after-LOS state
- F2.cultist.los: Real LOS raycast for cultist
- F2.cultist.sfx: Replace placeholder cultist SFX

## Process/Tooling
- P1: Dispatch-UI setup
- P2: Write M2 plan via superpowers:writing-plans
- P3: CI/GitHub Actions - defer
- P4: Dependency audit - 6 vulns (1 critical)
- P5: Prune old branches
- P6: Theme-preview schema merge
- P7: BUNFUSE extraction + cooking visual
