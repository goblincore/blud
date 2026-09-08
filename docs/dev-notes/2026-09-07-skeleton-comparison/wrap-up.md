# Skeleton migration wrap-up — 2026-09-08

Owner accepted the current visual result and requested stopping polish, merging into main, and making mesh default. Integration landed at ffbf3243; this follow-up promotes mesh to the forward default in both dev and production. No remote push has been performed. Unrelated thornbeast edits were preserved.

## Runtime

- `/sdf-game.html`: mesh actor skeletons by default.
- `?skeleton=procedural`: original SDF reference, available in dev/production.
- `?skeleton=volume`: sampled SDF experiment, development only; production falls back to mesh.
- Deferred renderer and detached chunks retain procedural bones.
- `src/lab/sdf-zombie/webgpu/skeleton-spike/` contains the accepted mesh runtime despite the old experiment name.

Accepted work: stable bind geometry, bent-knee limb rotation, bounded cache cleanup, patchy tissue finish, sculpted zombie skull/jaw/nose/cheeks, raised dental rows, glowing veined eyes and actor-owned head-impact eye ejection. Soldier geometry remains unchanged by the zombie skull sculpt. Teeth are material detail on physical dental ledges; individual teeth and a separately animated jaw are not modeled.

## Remaining limitations / stop rule

Do not resume polish without an owner request. Torso wound cavity still appears brighter than the SDF control. Mesh removes bone contributions from secondary SDF shading; source diagnosis also found control bone/meat pixel ambiguity. No controlled pixel attribution or structural AO restoration has been completed. See cavity-lighting-diagnosis.md. Cosmetic eye debris uses a simplified floor. Frozen capture drift prevents exact parity/performance claims; user perceived mesh faster, but no controlled timing result is claimed.

## Verification and handoff

Before integration: 395 renderer/packing tests passed. Main integration: 68 packing/gargoyle tests and production build passed. Earlier actual WebGPU captures verified skull geometry and eye removal; focused eye/geometry tests passed. Model experiment DeepSeek4.1 completed both tasks, but lacked image input and game-browser verification; coordinator fixed duplicate TSL shader dependency nodes and confirmed the real game pipeline.

Historical dated specs/notes record earlier opt-in decisions. This wrap-up and selector.ts supersede those default-mode statements.

Default promotion verification: selector5/5 tests passed; clean integration production build passed. Primary working checkout build is blocked by an unrelated uncommitted thornbeast test readonly-Vec3 annotation (TS2769); left untouched. DualMem decision and warning entries saved.
