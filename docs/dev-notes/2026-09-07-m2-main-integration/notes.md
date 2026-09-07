# Deferred M2 integration with latest main

## Inputs and owner acceptance

- Deferred source: `c193f8ad`, including material repair `28b6e51a`.
- Latest local main at start: `931e5483`; fetched remote main: `7a10a4b4`. Local main contains 17 additional commits, including shipped segment bone culling.
- On 2026-09-07 the owner manually playtested the deferred preview, confirmed the material regression fixed, and accepted its current appearance. Gamma and flashlight brightness remain follow-up tuning.
- The owner requested stopping Task 7. It was cancelled with all work preserved. This acceptance does not turn its unfinished shadow/performance assertions into passing results.
- Deferred remains opt-in; the retired game remains runnable separately. Stage 1 repo clarity is included; the proposed physical source migration is not implemented by this integration.

## Merge reconciliation

- Preserve both `drawOnce` and main's `stepTimed` renderer APIs.
- Preserve per-actor deferred registration groups and main's separate transparent character effects scene, rendering those effects in both modes.
- Preserve main's localized visual-wound positions when feeding optional bone geometry.
- Preserve main's shared bone-segment sphere cull, per-ray wound-list infrastructure and authored red-only face glow. Update the parser contract from 81 to 82 inputs for main's added `faceGlowRedOnly` slot, retaining exact legacy/deferred input-order equality.
- Static shader review found the shared cull, wound and face-glow bindings preserved. Review identified soldier corpse baking as requiring mode-aware material creation and deferred lifecycle registration; corrected with a registered corpse parent group and mode-aware shared material initialization. A focused lifecycle test covers route inheritance, damage restoration, and disposal.

- Soldier transparent effects now render inside the deferred coordinator output/depth scope, including with goo disabled; an exception-restoration regression test covers the callback. Effects precede the goo overlay in deferred mode.

## Validation

- Initial merged TypeScript check and production build passed.
- First focused run: 586 passed, one outdated shader parameter-count assertion; corrected against the actual added parameter.
- Full suite: 249 files passed, 4,011 tests passed; 11 failures in two CLI files were sandbox IPC permission errors (`tsx` socket creation). Both CLI files passed on the permission-enabled rerun (11/11); final coordinator and corpse checks passed alongside them (34/34 combined). The final production build passed after all runtime fixes, including the fifth-output contract repair.
- Focused integration lifecycle checks passed (corpse/router 28 tests; coordinator/effects/corpse 25 tests).
- Initial GPU run passed boot, light invariance and level/flesh/held-weapon/bone routing before being intentionally stopped to correct the corpse integration. This is partial evidence only.
- The first complete merged GPU attempt passed 27 checks with zero page errors, then could not attribute a detached limb from its fixed +X view. The driver now tries bounded cardinal views while retaining identical class/on-off-depth/world-distance assertions; the next run proved a piece could settle inside the level wall (x=0.415 while room 2 starts at x=0.8). `gib-chunks.ts` is unchanged from main and only collides with the floor. A diagnostic fallback now hides the level, requires the same exact producer attribution, restores the level, and requires a nearer class-1 occluder at that pixel. This does not claim limb/wall physics correctness; that remains a separate gameplay limitation. Final unchanged-source run passed all 34 checks with zero page errors (2026-09-07T23:09:44Z).
- No performance measurements: the owner's live preview remains available.

## Scope of chunk evidence

The two-shared-chunk assertion proves two exact live producers render, potentially including a wall-occluded piece inspected with level geometry hidden. It does not claim both pieces are simultaneously visible in ordinary play. Restoration requires class-1 geometry nearer than the same chunk pixel. The bake observation tries cardinal views while retaining exact-ID live-to-mesh transition, world bounds, per-producer visibility delta, and normal checks. Static test review found no weakened attribution.

## Baked material contract repair

The Task 7 material repair expanded the G-buffer to five attachments, but baked chunks and the retained optional bone-instance producer still emitted four. Completed bakes therefore lacked attributable mesh pixels even from four camera views. Both producers now explicitly emit zero material-response metadata in `surfaceParams`, matching generic mesh producers. This does not enable bone tubes.

Both producer-contract unit tests failed before the change and passed afterward (22/22 focused tests). An isolated real GPU bake failed before the change and passed afterward: exact live ID retired, mesh ID appeared, class 17 was attributable by visibility/depth delta, normal length 0.9998, front-facing dot 0.369. Evidence is in `bake-before/` and `bake-diagnostic/`; these are partial diagnostics with `fullAcceptance:false`.

The sever fixture now bounds hits per target before trying another ordinary zombie from rooms 2/3. It still requires two actual severed pieces; it does not replace them with synthetic chunks. Main's updated wound model could absorb repeated scripted hits without detachment, making the previous fixed two-target sequence unreliable.

## Final result

- Complete GPU gameplay gate: **34/34 passed**, `scope:full`, `fullAcceptance:true`, no page errors, shell exit 0. Canonical evidence: `../2026-09-06-hybrid-deferred-m2/game-validation.json`.
- TypeScript and production build passed, exit 0. Full CPU suite coverage passed across the original run and permission-enabled CLI rerun; subsequent affected producer/integration tests passed.
- User-accepted material appearance is retained alongside main's repo clarity, soldier changes, wound work and shipped segment culling.
- Deferred stays opt-in. Gamma/flashlight tuning, floor-only cosmetic chunk collision, and unfinished Task 7 shadow/performance measurements remain explicit follow-ups; the 34 functional checks do not claim those complete.
- The primary `gargoyle-character` checkout and its unrelated uncommitted assets were not changed.
