# Handoff — close-up perf, next session (written 2026-09-22)

**Branch:** `claude/march-census-r2` (off main `aab70305` = PR #14 merged), committed, NOT pushed, NOT merged.
Local branch — any worktree of this repo can check it out. Read `NOTES.md` beside this file first.

## Where the frame stands (melee bench, ship, quiet machine)

GPU-bound in every phase (frame ~ GPU span). Budget 16.7 ms (60 fps).

| ms p50 | clean | wounded | wounded + fire |
| --- | ---: | ---: | ---: |
| frame | 13.7 | 17.9 | 31.0 |
| `sdf:march` (bodies) | 10.5 | 14.9 | 21.7 |
| `post:fire-march` (flames) | — | — | 5.0 → ~2 with this branch's 24/0.3 default (re-time quiet) |

The body march is 70–83 % of the frame; nothing else on the GPU is worth more than ~1 ms.

## On this branch (unmerged)

| change | state |
| --- | --- |
| flame march defaults 48 steps / 0.4 res → **24 / 0.3** (`fire-volume-tuning.ts`) | ON — owner: "looks worse but acceptable"; -58 % `post:fire-march` in a LOADED sweep → re-time on a quiet machine before merging |
| flame **streak blur** (`streakPx`, fire composite) | OFF — owner: does not look good; should use the **selective shutter-type blur** (the gib/blood one) instead |
| flame **heat shimmer** (`heatPx`, final blit) | OFF — owner: too high frequency and wrong shape; wants **very large wavelength, subtle** distortion. Also not depth-gated. |
| analytic normals near owned wounds (`setAnalyticOwned`, counts2.z + 64) | OFF — ~2 %, near noise |
| walk re-fold skip (`setWalkSkip`, counts2.z + 128) | OFF — 0.2 %; losing gaps are millimetres |
| debug mode 15 (walk re-folds attempted / won), `MELEE_REFOLD_STUDY` | tooling |
| `setFireVolume` / `fireVolume` seams; bench restore covers them | tooling |

Before merging: re-time the flame default quiet; decide whether to keep or remove the parked switches.

## NEXT: the offline 4x reconstruction experiment (owner-requested)

**Owner correction (2026-09-22):** a LOWER march resolution IS acceptable if the reconstruction matches today's
look. The old "not acceptable in any form" note was a misunderstanding (it was about the adaptive-resolution
feature, which is off). The open question is purely visual quality.

Today: bodies marched at 0.5 (400x300 for 800x600) + trained `t16-rgb` ESPCN 2x upscaler (RGB only, ~0.6 ms).
Proposal: march at **0.25** (200x150, 1/4 of today's rays) and reconstruct 4x with a network that also gets the
coarse march's **depth, normals and material/prim IDs**; silhouettes (the 3–10 % hard pixels) get a real ray
(sparse re-march). Measured ceiling (multiscale NOTES): `sdf:march` -44..72 % at 0.25; depth rebuilds within 5 mm on
95 % of body pixels from 1/16 of samples.

Offline first — no engine work until the owner has seen side-by-side frames:
1. Capture script: for the SAME frozen frames (melee scene via `scripts/lib/sdf-melee-stage.mjs`, plus room 1/4
   close-ups), record the 0.25 march's colour/depth/normal/ID (debug modes 9 = normals, 4 = depth-ish, 11 = ids;
   check what exists) AND today's shipped output (0.5 march + t16 upscale) as the TARGET. Reuse the neural-upscale
   capture tooling (`scripts/upscale-capture-v2.mjs`, the t16 training pipeline).
2. Train a 4x model (start from the t16 ESPCN family, add depth/normal inputs).
3. Show the owner side-by-sides (today vs reconstruction), then decide on engine work.

## Rules that cost time

- GPU A/B = ONE page, alternating legs (melee bench `MELEE_LEGS`), `uptime` < 4 (owner runs Docker). Frame cap off.
- **Cost census** (`MELEE_CENSUS_LEGS`, modes 13/14) counts prims, not steps — steps misled (far misses are ~free).
  **Blind spot:** the analytic normal path (`ngBody`) does not count its prims; use timing for levers that move work there.
- Owner rule: per-pixel accuracy is NOT required ("an FPS, not a simulation") — a shortcut passes if invisible in play (owner A/B).
- Any march shader text edit → one cold compile (~30-50 s now) and `march-golden` must be re-recorded deliberately.
- Worktrees need `scripts/link-dev-assets.sh` once, or gibs render wrong (bone-only / no stump).
- `counts2.z` packs flags: mode (0..4) + 8 exact + 16 cheap probes + 32 normal hint (SHIP) + 64 analytic owned + 128
  walk skip. Setters in `game-seams-world.ts` preserve the other bits; `setOwnerRefold(true)` = full ship reset.
- The mode-4/13/14 debug readbacks read blank in the burn-PANIC state (open bug).
