# Four-region torso preview: coverage and measured tradeoff

## Integration with main

The local main integration also includes the soldier's newer localized wound ownership. Visual-row uploads now keep ownership aligned with reordered preset rows. Scoped wounds conservatively use the scalar finite-difference normal fallback until analytic normals support the localized cluster union. The measurements below predate that integration and are historical evidence, not timings of the merged revision. The bounded wound mode remains development-only and opt-in; no performance promotion is claimed.

The approved follow-up separates upper/lower torso and front/back damage. The first impact in each region retains its own primitive-local anchor, tangent plane and depth cap. Region identity is classified against the current **rest** body; the live pose is used only to render the stored wound frames. Each region has the same immutable intact/light/heavy recipe and independent 160 ms state machine. Maximum torso cost is eight cutter rows. Reserving two rows per live region leaves eight stock fallback rows when all four are active, within the existing 16-row upload budget. Gameplay/sever history is unchanged.

Preview: http://localhost:5289/sdf-game.html?slug&bounded-wounds
Matched procedural baseline: http://localhost:5289/sdf-game.html?slug&res=640
Reproduction page: http://localhost:5289/bounded-wounds-bench.html

## Coverage

The same CPU trace/actor diagnostic that found the bug now supports **11/13** follow-up torso impacts after a belly shot, versus **1/13** before the change. All tested upper-chest impacts have carve support. The two remaining misses are lower-side impacts inside the already-damaged lower/front region; that region still retains its first anchor. Fresh torso shots remain 13/13 in the diagnostic. This is improved bounded coverage, not preservation of every individual hole.

The real WebGPU game comparison also renders separate upper-chest and belly cavities. Its completed all-four fixture uploads eight preset cutters and retains the normal sixteen gameplay wounds. The final game image was inspected in the browser. No shader changes were needed for additional regions.

## Performance result

**Do not promote this candidate on performance grounds.** In this controlled fixture it was slower than procedural wounds, despite fewer uploaded cutters.

| Matched damage sequence | Baseline median | Four-region median | Candidate change |
|---|---:|---:|---:|
| Eight front hits across upper/lower torso | 10.9 ms | 11.9 ms | +9.2% |
| Sixteen hits across all four regions | 11.0 ms | 12.0 ms | +9.1% |

These are medians of three run medians, with 120 steady frames per stage. Per-run front medians were baseline 11.1/10.9/10.8 ms versus candidate 12.3/11.9/11.7 ms. All-four medians were baseline 11.0/11.0/11.0 ms versus candidate 12.2/11.9/12.0 ms. Baseline p95 was 12.9–13.9 ms; candidate p95 was 14.4–15.4 ms. Intact controls were close (median-of-medians baseline 10.3 ms, candidate 10.0 ms).

Method: CPU simulation/render submission plus awaited GPU queue completion for each unpaced frame, in the actual game running in a visible iframe. This is **not GPU timestamp timing, capped gameplay FPS, or a combat benchmark**. Each mode was freshly loaded, ordered B/C, C/B, B/C. The same actor, camera and rays were used, with explicit 640x480 output, SDF scale1.0, FXAA on, smear0.25, frozen motion, and blood/spills disabled. Actual output/SDF dimensions, settings, torso ownership, wound counts and visible document state were asserted. The normal game mode in this worktree is the baseline; both modes include the earlier quick shader edits and the negative-type branch.

The camera frames one room-1 actor at 1 m, looking at y=1.22. Two front regions are hit first, then the two back regions. Eight hits per side repeat upper/lower positions. This is a deliberately narrow repeat-hit fixture, not broad arbitrary-hit distribution or a crowd stress test. More visible internal geometry and different field shapes may affect cost; this run does not isolate why the candidate is slower.

Twenty-four transition frames were recorded separately before each steady sample. Their per-run medians were baseline 10.2–11.7 ms and candidate 11.3–12.7 ms. First impact plus one completed frame was baseline 11.1–14.7 ms, candidate 12.4–15.1 ms. Initial intact warmup was separate; some warmup p95 values reached approximately 35–39 ms in both modes. No first-use stall win is established.

Machine one-minute load was 2.24 before the run and 3.71 during, well below the earlier overloaded session. Three runs per mode do not prove behavior on other hardware or in full combat. Given the visual downgrade and this negative result, keep the procedural baseline as the production choice; the four-region code remains opt-in for inspection.

`benchmark-summary.json` retains rounded run summaries captured from the completed page. Full per-frame arrays were present in the live page but are not archived; in-app content export was unavailable. `bench.js` and the root HTML page reproduce the measurement. `coverage-check.ts` and `coverage-report.json` retain the separate CPU geometry diagnostic.

## Validation and limits

- 259 focused tests pass, including region independence, bounded allocation/row count, turn-stable classification, shader helpers, actor behavior, cap-slot clearing and unchanged sever notifications.
- TypeScript and production build pass (existing large-chunk advisory). The real game benchmark boots and renders all six runs successfully with correct per-mode wound counts.
- Independent scoped review found no current-game blocker. A future partial-torso destruction path would need to reanchor a region whose first owner died; current sever paths do not partially sever torso owners.
- Detached chunks and the worker bake path remain unchanged. The shared sampled atlas remains a separate prototype, not a migrated game cache.
