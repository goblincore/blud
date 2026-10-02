# Body grain: build notes (2026-10-02)

Spec: ../../superpowers/specs/2026-10-02-body-grain-design.md. Plan: ../../superpowers/plans/2026-10-02-body-grain.md.

## Baselines (Task 0, before any code)

- BASE commit: 34e3630cc02e54b1b2203c682d259383acda199b
- BASE Chrome: 154.0.8037.93
- BASE load: 1:25  up 6 days, 13:12, 2 users, load averages: 12.56 5.59 4.03
- BASE k: 0.002029965576663916
- BASE sdf pass: 636x378, fov 75
- Lab fade distances full / half / gone (m): fine 3.5 mm 0.43 / 0.57 / 0.86; coarse 12 mm 1.48 / 1.97 / 2.96
- BASE march-hash room1: d7392d5234c98ddc1babb3b29860abc3a02ced84
- BASE march-hash room1-wounded: 76bd51aa6eb281297999463529a0b782ce2b67f6
- BASE boot drawOnce: 1663.1 1654.4
- npx tsc --noEmit at the base: one pre-existing error (pack-golden.test.ts, node:crypto).

## Progress

- Task 0 done: baselines recorded.
- Task 1 done: FleshMaterial.grain, 0 in every preset; palette parses it (68 tests pass).
- Task 2 done: body-grain.ts (two octaves: fine 3.5 mm, coarse 12 mm; summed deviations; 13 tests pass).
- Task 3 done: BODY_GRAIN_BLOCK written and pinned (10 tests), not spliced yet.
- Task 4 done: applyMaterial writes grain to meltCfg.w and syncs the record; lane comments updated; lab slider (0..0.3).
