# Analytic normals: current-main integration and manual playtest

2026-09-06. Candidate branch `codex/zombie-analytic-normals`, integration commit `eb6e61d`, includes main `2c3a3da`. Main has not received this feature. The new dev-only `?normal-playtest` panel starts hybrid analytic normals with automatic fallback; N or the button toggles original normals. Ordinary game default remains original.

Manual URL: http://127.0.0.1:5251/sdf-game.html?slug&normal-playtest

Fresh checks: 214 Vitest files / 3,514 tests, 27 Node harness tests, TypeScript and production build passed. Eight actual GPU chunk-bake lifecycle checks passed with the merged asynchronous CPU worker: spawn, live-to-baked, both pooled modes, real weapon re-gib, bounded ring reuse and subsequent toggle. Browser checks passed analytic startup, keyboard/button toggle and no uncaptured GPU errors. Wounded beauty pair visually inspected; no obvious normal regression. Original derivative/appearance evidence remains under `2026-09-05-zombie-analytic-normals`.

## Small timing check, not final Task 5

Actual renderer GPU queue captured before boot. Native performance.now around one zero-dt frame plus GPUQueue.onSubmittedWorkDone; CPU + GPU completion wall latency, not GPU timestamps or ordinary gameplay FPS. One seeded frozen scene per wound state, 800x600 SDF target, roughly 29.6% flesh coverage and 46.4% proxy coverage. Default helper pins, adaptive off, smear off, baking on; no detached chunks. Each leg 60 warm frames and 100 measured frames, three alternating legacy/hybrid pairs. Dungeon light flicker remains live. Harness snapshot retains absolute paths/ports for local reproduction; raw samples and load recorded in quick-timing.json.

| Scene | Original per-run medians ms | Analytic per-run medians ms |
|---|---|---|
| Intact torso | 23.0, 23.7, 23.8 | 22.6, 21.5, 22.2 |
| Torso with slug wound | 32.3, 35.5, 40.0 | 32.3, 33.1, 36.9 |

Intact median of run medians: 23.7 versus 22.2 ms, about 6% lower. Wounded sequence drifts substantially; no reliable wound speedup conclusion. This same-shader toggle cannot quantify expanded-shader compiler/register overhead relative to main's original shader. No direct-main control, multi-body, moving gameplay or impact-spike test here. Full original Task 5 remains incomplete; this is a bounded smoke comparison supporting a fresh owner playtest, not a net shipping performance claim.

The user requested eventual merge, with a fresh feel check first. Main/default flip/push remain pending that check. The cached-wound prototype is separate and not included.


## Owner approval and default — 2026-09-06

Owner passed the integrated playtest on `5b6579a`: it feels smoother, but the contribution of analytic normals versus the accumulated changes is uncertain. The final game default is now hybrid (1), with automatic fallback. The generic renderer/lab default stays legacy; the game applies its chosen mode to all actors and pooled chunks. All three normal browser harnesses now expect hybrid at game boot and still explicitly select their comparison modes. Earlier default-off statements and raw reports above describe their captured revisions, not the final default. Broader Task 5 remains incomplete; merge acceptance rests on correctness, integrated lifecycle checks and owner visual/feel approval, not a proven net performance gain.

Final default-on verification: 214 Vitest files / 3,514 tests passed, 27 Node harness tests passed, TypeScript and production build passed. Fresh default-on GPU bake lifecycle passes all eight checks (default-on-bake-integration.json). Final scoped review found no actionable issues in initialization, inheritance or the three updated harnesses. Main publication follows this verified tree; source behavior is unchanged by the documentation commit.
