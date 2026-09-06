---
created: 2026-09-06
author: Codex
topic: SDF rendering wrap-up and shared wound preset handoff
tags: [blud, sdf, wounds, performance, handoff]
---

# SDF rendering: session handoff

## Start here next session

Continue **shared wound presets and fewer texture reads**. The product goal is stable **30 fps during current combat**: enemies onscreen, repeated wounds, gibbing and chunk settling. Aim for a 33.3 ms frame budget with headroom, and inspect missed-frame frequency and sustained spikes as well as averages. Define the intended encounter load and resolution before claiming this target is met. Temporal upscaling is being pursued in a separate session.

The owner accepts reduced exact hit positioning and arbitrary damage accumulation. Wounds need to feel forceful and read clearly; anatomical simulation accuracy and high internal-skeleton fidelity are secondary. Prefer the simplest representation that meets the frame budget.

## Shipped and verified

Main was pushed and remote-verified at **a68a217e1a3e59cfd928d8664be97581418ad490** before this documentation wrap-up.

- Analytic flesh and procedural-wound normals are enabled by default in the game. Unsupported surfaces retain the existing finite-difference normals. Generic lab renderer defaults remain independent. The manual N/button comparison remains available with `?normal-playtest`.
- The owner passed the integrated playtest on `5b6579a`, reporting smoother play. Do not attribute that impression solely to analytic normals: several improvements are combined.
- Settled detached-chunk mesh extraction now runs in a CPU worker (`4049547`, documented by `2c3a3da`). Pending pieces remain rendered and shootable; hits/recycling cancel stale work, and completed results swap to meshes. This is separate from sampled wound caching and is not a GPU mesher or a general whole-body corpse cache.
- Final analytic-default validation: 214 Vitest files / 3,514 tests; 27 Node harness tests; TypeScript; production build; eight actual GPU bake/re-gib/recycle checks. Scoped integration and default reviews found no blockers.

Evidence: `docs/dev-notes/2026-09-06-analytic-normal-integration/` and `docs/dev-notes/2026-09-05-chunk-bake-worker.md`.

## What the measurements establish

A small frozen torso comparison measured CPU frame work plus actual GPU queue completion, **not GPU timestamps or normal gameplay FPS**. Intact median-of-run medians was 23.7 ms original versus 22.2 ms analytic (about 6% lower). Wounded results drifted and are inconclusive. This same-shader toggle does not quantify expanded-shader overhead relative to the previous main shader. The original full analytic Task 5 performance study remains incomplete; no broad net speedup or stable-30-fps verdict is claimed.

The corrected sampled-wound experiment has not demonstrated a reliable performance benefit. In its eight-hit frozen fixture, original96 / cached96 / cached512 median-of-run medians were **37.4 / 37.4 / 39.45 ms**. Target coverage was only about 12.8% flesh / 20.2% proxy, one body. Settings and measurement differ from older matrix runs, so do not combine their numbers into one claim.

Cache visual problems included a quaternion component/sign error and an entry-cap issue. After those corrections, some cavity holes were still caused by ray exhaustion. Raising 96 to 512 steps recovered pixels but cost time; it is not proof of convergence for every view and is not a production default change.

## Why shared presets are the next direction

The current experiment stores a mutable composed wound field per actor. At 64 cubed it reserves approximately **24 MiB GPU per enabled zombie**, plus CPU atlas backing and per-active-region source/target arrays. This is allocation per instance, not per draw or visible frame. Detached pieces borrow their parent's atlas; separate actors have separate atlases. Shared stamp inputs already exist, but their mutable composed outputs are duplicated.

Replace that requirement with a shared immutable region/variant/severity library and small per-instance state IDs and transition metadata. A hit selects or advances a state; it need not preserve every historical hole. A shared library also costs memory; 24 MiB for the whole library is an aspiration, not a promised budget. Sharing storage alone does not reduce steady per-pixel sampling cost.

## Bounded investigation to resume

1. Begin with torso intact/light/heavy states. Compare a bounded analytic-cutter preset with a shared sampled-region preset before committing to the volume approach. Expand to head after the small experiment is useful.
2. For a sampled preset, derive its final-hit trilinear gradient from the same eight corner values. This can remove repeated field samples for normals; it does not eliminate the eight-corner march sample. Shipped procedural analytic normals do not automatically provide gradients for sampled wound volumes.
3. Investigate hardware filtering as an alternative to eight explicit loads and software interpolation. One sampling instruction still accesses neighboring texels. Verify supported format/filtering and replace the current corner-spread safety bound with a justified conservative bound before marching with it. Avoid reintroducing ray-exhaustion holes.
4. Keep region overlap and state-transition work bounded. Measure both settled states and two-state blends. The existing cache already skips the unused endpoint at a completed blend; do not count that as a new optimization.
5. Measure shared memory, steady frame work, first-hit/state-transition stalls and gib/bake lifecycle separately, then validate together in representative combat. Report first-use shader stalls separately from recurring costs without erasing their impact on the player experience.

These are investigation candidates, not a completed implementation plan or a requirement to build every option. Do not start a large benchmark campaign before checking that the candidate actually improves the relevant workload.

## Code and evidence landmarks

- `src/lab/sdf-zombie/webgpu/game-main.ts`: game defaults, normal toggle, actor/chunk configuration, playtest seams.
- `normal-gradient.wgsl.ts`, `march.wgsl.ts` in that directory: analytic derivative path, final-hit normal selection and fallback.
- Experimental branch: `zoned-wounds.wgsl.ts` for sampling/interpolation and march safety; `zoned-wound-volume.ts` for atlas allocation; `game-actor.ts` for per-actor runtime creation.
- Experimental worktree: `/Users/donny/Projects/blud/.worktrees/zoned-wounds-visual-fix`, branch `codex/zoned-wounds-visual-fix`, checkpoint **7e4651f**. Contains prior visual corrections plus saved `scripts/zoned-wound-step-timing.mjs` and `docs/dev-notes/2026-09-06-zoned-step-timing/`. It is **local, not merged or pushed**. Its source predates the current worker and analytic-normal main; use it as evidence, not the next baseline without integration.
- Analytic worktree: `/Users/donny/Projects/blud/.worktrees/zombie-analytic-normals`, merged to main. Its comparison URL was left running at `http://127.0.0.1:5251/sdf-game.html?slug&normal-playtest`; restart Vite if the machine stops it. Owned benchmark browsers were closed.

## Notes and preservation

Obsidian references under `Codex Notes/`:

- `Planning/2026-09-06-sdf-session-handoff.md` — this handoff.
- `Planning/2026-09-05-zombie-analytic-normals.md` — implementation, acceptance and publication history.
- `Research/2026-09-06-zoned-wound-step-budget-and-memory.md` — detailed measurements, allocation accounting and owner-approved preset direction.

Main has unrelated asset edits preserved: deleted `docs/dev-notes/refs/scarecrow-reference.png`, untracked `docs/dev-notes/refs/scaracrow/`, and untracked `public/assets/lab/faces/soldier-face-grey-2.png`. Do not stage or reset them as part of this work. No need to repeat the completed analytic visual approval when resuming preset research.
