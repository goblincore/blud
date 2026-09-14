# Blood and goo — audit, optimize, and make behavior configurable

Status: Ready for implementation

Purpose: A self-contained engineering task for testing an agent without Dispatcher UI access.

## Task

Audit the active SDF game's blood and goo pipeline, fix demonstrated bugs and inefficiencies, then assess and implement a small, justified refactor that enables behavior customization by character and by situation. Prioritize correctness and measured improvements over architectural novelty. This task tests investigation, engineering judgment, performance analysis, and maintainable implementation; visual checks still matter because this is a rendering system.

Work through normal repository tools, without Dispatcher UI or delegated tasks. Read `AGENTS.md`, inspect the current checkout and relevant project memory, and preserve unrelated edits. The active project is `src/lab/sdf-zombie/`; its name does not mean retired code. Shared modules under `src/game/` may still supply active tuning. Trace consumers before changing them.

## Desired outcome

The existing blood effects remain recognizable and correct, demonstrated defects are addressed, and the system has a clear route for differences such as:

- A heavy brute producing fewer, larger, longer-lived drops than a normal zombie.
- A shotgun wound, severed limb, or explosive death selecting different emission behavior for the same character.
- A temporary actor state modifying one event without changing another actor or blood already in flight.

These are engineering examples, not requests to retune the roster or create new effects. Use fixtures or an explicit development override to demonstrate customization while preserving shipping defaults. Do not depend on the Sump task being implemented.

## 1. Audit before editing

Produce a concise audit in `docs/dev-notes/blood-goo-audit/README.md`. Trace the actual flow from damage/event source through profile selection, emitter lifecycle, simulation, connections, GPU upload, composition, and cleanup. Include how persistent splats, mist, scraps, entrails, and impact splashes participate or intentionally use separate paths. Establish which settings belong to simulation, appearance, rendering quality, or debug controls.

Record findings with source locations, reproduction or measurement evidence, severity/impact, and proposed action. Separate confirmed bugs, measured inefficiencies, plausible hypotheses, and intentional tradeoffs. An audit finding is not automatically permission to rewrite a neighboring subsystem.

Investigate these questions rather than assuming each is a defect:

- Are emitters retired correctly on death, actor removal, reset, or scene changes? Are buffers, targets, and subscriptions resized and disposed correctly?
- Are particle limits, overflow policy, lifetime, timestep handling, and retained history bounded and predictable? Who owns simulation updates for special particle kinds?
- Do connection builders preserve emitter identity and avoid linking unrelated wounds? What happens when streams expire or identifiers are reused?
- Are there unnecessary allocations, copies, scans, uploads, target clears, or render passes in idle and busy frames? Can cached or skipped work become stale after reset or resize?
- Do mist and goo classifications omit or double-render particles unintentionally? Do depth, transparency, reconstruction, and composition respect opaque geometry and subsequent passes?
- Are configuration values duplicated or mutated globally? Which differences between lab and game are intentional? Do UI setters and copied presets actually control the same values used at runtime?

Read current code to establish defaults. Historical plans and header comments may predate changes; do not reinstate an old default because a comment calls it canonical.

## Starting map

Paths are repository-relative. Confirm the connections and follow their callers; this is a starting map, not a prewritten audit.

| Area | Starting files |
| --- | --- |
| Pure simulation, emissions, profiles and limits | `src/lab/sdf-zombie/blood-sim.ts`, `blood-sim.test.ts`, `src/game/gibs/tuning.ts` |
| Game event wiring, emitters and frame composition | `src/lab/sdf-zombie/webgpu/game-main.ts`, `game-actor.ts` |
| Goo targets, density, reconstruction and surface composition | `src/lab/sdf-zombie/webgpu/goo-layer.ts`, `goo-layer.test.ts` |
| Billboard blood and derived stream geometry | `src/lab/sdf-zombie/webgpu/blood-view-gpu.ts`, `blood-connections.ts` and its tests |
| Tuning, presets and comparison controls | `src/lab/sdf-zombie/webgpu/goo-presets.ts`, `goo-panel.ts`, `blood-compare-main.ts` and related tests |
| Adjacent effects and ownership boundaries | `src/lab/sdf-zombie/entrails.ts`, `entrails-spawn.ts`, `webgpu/impact-splash.ts`, `webgpu/impact-splash-profiles.ts` |
| Character configuration | `src/lab/sdf-zombie/character-registry.ts` |
| Existing performance and capture tooling | `scripts/goo-bench.mjs`, `scripts/goo-capture.mjs`, `scripts/sdf-game-bench.mjs`, `src/lab/sdf-zombie/webgpu/gpu-pass-timing.ts` |

## 2. Fix and optimize from evidence

Implement confirmed, locally tractable fixes and the highest-value supported optimization opportunities. Add regression coverage for each meaningful bug. Separate behavior fixes from performance changes in the audit so a visual difference cannot be mistaken for free speed.

Measure a baseline before changing hot paths. Include an idle scene, sustained bleeding, and a dense burst/gib scene, followed by settling and cleanup. Use comparable seeds, camera, resolution, settings, counts, warm-up, and hardware. Reuse existing tools where suitable, verifying their scenarios and switches still work. Record CPU simulation/update costs separately from GPU passes and total frame time. Include median and tail timings, particle/connection counts, and coverage or resolution when available; record unavailable metrics honestly.

Repeat/interleave baseline and candidate runs enough to identify noise. Do not claim an optimization based on one faster run, a source-code guess, or fewer particles doing less visible work. Do not silently reduce quality, caps, lifetime, or output size to claim a speedup. A correct audit may conclude that a suspected optimization is not worthwhile; retain the evidence and reject it.

## 3. Assess extensibility, then make the smallest useful change

After mapping the code, document the proposed configuration boundary and why it belongs there. Reuse existing profiles and override APIs if they already solve the problem. Implement a bounded improvement when justified; do not manufacture a framework merely to satisfy the word “refactor.” If meaningful extensibility requires a broad renderer redesign, complete the safe fixes and record a concrete follow-up design with costs and limitations.

The preferred contract is typed, data-driven behavior resolved at event/emitter creation, with explicit precedence such as **existing event default → character override → situation override → explicit event override**. Choose and document the exact rule, including missing values and invalid input. “Situation” should be explicit context supplied by the caller, such as impact versus sustained wound versus severing, not a collection of character-name checks inside shaders or simulation loops.

Required properties for any implemented customization:

- Existing callers without overrides retain the current defaults and seeded behavior except for documented bug fixes.
- Two characters with different settings can emit in the same frame without affecting each other. Shared presets are not mutable runtime state.
- Define whether an emitter snapshots its resolved configuration or observes later changes. Prefer stable snapshots unless an existing behavior requires live updates; spawned effects must not accidentally inherit a different actor's later settings.
- Keep actor identity, emitter/stream identity, and effect profile identity distinct. Preserve provenance through derived connections and cleanup.
- Keep render-wide quality controls separate from event behavior. Avoid per-particle profile resolution and unbounded per-character GPU layers.
- Explain which properties can actually vary simultaneously. A shared density field/material may prevent independent fluid colors or shading without additional grouping and compositing rules. Do not expose per-character material knobs that silently change the entire scene; document unsupported variation rather than pretending it works.

Demonstrate one character-level override and one situation-level override through the actual event-to-simulation path, using existing characters or fixtures. Test both sources concurrently, plus a default actor. A resolver tested in isolation but never consumed by real emitters is incomplete integration. No customization UI, plugin architecture, arbitrary callbacks, or new fluid solver is required.

## Acceptance and verification

1. The audit documents the pipeline, ownership, defaults, findings, implemented fixes, rejected ideas, and unresolved issues with evidence.
2. Focused regression tests exercise changed behavior: as applicable, configuration precedence/isolation, deterministic seeds, lifecycle/reset, capacity limits, stream provenance, empty frames, and resize/disposal. Prefer observable behavior over source-text assertions or tests that mirror the implementation.
3. Run relevant existing blood, goo, connections, presets, and affected adjacent-effect tests, plus `npx tsc --noEmit`. Explain pre-existing failures separately. Broaden tests only where the changed dependencies warrant it.
4. Before/after captures inspect occlusion against bodies/walls/floors, overlapping streams, mist and goo transitions, persistent splats, and any affected entrails/splash path. Preserve accepted defaults, reconstruction choice, and lab/game distinctions unless a documented fix necessarily changes behavior. Do not promote experimental modes.
5. Report measured performance changes and regressions under matched conditions. If performance is unchanged within noise, say so. Include evidence that the idle fast path does not leave stale output and that busy scenes remain bounded.
6. Any implemented extensibility has a short usage example, a default-preservation test, and a concurrent character/situation demonstration. If deferred, identify the exact blocker and smallest follow-up rather than leaving an unwired abstraction.

Coordinate GPU/heavy jobs with existing work; use task-owned available ports and clean up only resources you started. If GPU execution or image inspection is unavailable, continue CPU investigation, fixes, tests, and architecture work. Mark GPU performance and visual acceptance unverified, and provide reproducible commands for the remaining checks. Do not claim a rendering or speed pass from CPU tests.

## Scope and handoff

Keep changes focused on this pipeline and necessary callers. Do not rewrite the renderer, alter unrelated gameplay, change the retired game, merge, or push. Treat ongoing blood/splash work and unrelated plans as existing work to preserve, not a backlog to absorb.

Deliver the implementation and audit together, with changed files, test commands/results, benchmark conditions and raw-result paths, screenshot paths, configuration examples, and remaining limitations. The target is a better-understood, more reliable and efficient blood system with a practical customization boundary—not maximum code churn.
