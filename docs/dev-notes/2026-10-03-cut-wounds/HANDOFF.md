# Cut wounds M1: handoff (2026-10-03)

**Branch:** `claude/head-explosion-effect-d6231e`
**Worktree:** `.claude/worktrees/head-explosion-effect-d6231e`
**HEAD:** `bed903af`

| Document | Path |
| --- | --- |
| Spec | [`docs/superpowers/specs/2026-10-03-cut-wounds-design.md`](../../superpowers/specs/2026-10-03-cut-wounds-design.md) |
| Plan (task texts, with amendments) | [`docs/superpowers/plans/2026-10-03-cut-wounds-m1.md`](../../superpowers/plans/2026-10-03-cut-wounds-m1.md) |
| Measurements and decisions | [`NOTES.md`](NOTES.md), in this folder |

The plan's amendment blocks (`> **Amended ...`) override the original snippets. **Read them.**

Process used so far:
- Subagent-driven development (superpowers): an implementer per task, then a spec review, then a code-quality review.
- Each fix goes back to the same implementer for a re-review.
- The user asked to be told when M1 is ready to playtest.

## Done (all reviewed unless noted)

| Task | What | Commits |
| --- | --- | --- |
| 1 | A full wound ring merges instead of evicting (head slots protected) | `a66c1c4a`… |
| 2 | `MAX_WOUNDS` 32; all WGSL bounds interpolate it. The WebGL lab twin stays at 16. `explosion-aoe` is held at 16 | `0ef1f943`, `049c2080` |
| 3 | `cut-wound.ts`: `cutCarve` (the authoritative CPU mirror), `stampCut`, `cutsFromSweep`, `cutExposureSpheres` | …`b8bfc89d` |
| 4 | Upload: `ROW_WOUND_CUT` 25, flag bit 32, `DATA_ROWS` 26, sag in `META.w` | `d1763c36`, `1b6ccf5e` |
| 5 | WGSL cut branch. Fix round 1 (`73289ded`, `b61beff4`) and fix round 2 (`f2be31cc`, `ef247a0f`) were approved by the quality re-review | `ffe5a3eb` + fixes |
| merge | Synced with `origin/main`. Conflicts resolved in `normal-gradient-probe.ts` (took main's `probeWoundSources`) and in the golden (`-u`) | `f48e0084` |
| 6 | Bones are exposed along cuts (`game-main.ts` crater lists). Hardening: the mask gate uses `nSmooth`; a cut with no cap gets a zero CAP. Exposure spheres follow sag | `a36fa786`, `ee51bc6c`, `0666fc8a`. Controller-checked, no separate reviewer |
| 7 | The rod, weapon slot 6 (`game-rod.ts`, test, seams `cut` / `rod` / `rodPress` / `rodRelease`) | `bed903af`. **NOT YET REVIEWED** |

Task 5 details worth knowing:
- `cutLip` and `cutMask` are CPU mirrors, and the WGSL copies them term for term (text pins in `wounds.wgsl.test.ts`).
- The mask has a back-facing normal gate.
- The raw-plane lid is `dot(rel, inward) + kerf + 0.25·h`.
- `cutThreatWound` has a tight box sphere.
- The lip scale is clamped to 1.1.
- The combined field's Lipschitz bound is 2.075.

## Remaining

1. **Review Task 7** (`git diff 0666fc8a bed903af`): a spec review against the plan's Task 7, then a quality review. The implementer's notes:
   - It added a guard that drops the sweep if the live slot changes mid-hold.
   - It added the `rodPress` / `rodRelease` seams, which bypass pointer lock for the headless gate.
   - The rod rig has never been seen in a render.
2. **Task 8, the capture gate** `scripts/cut-wound-gate.mjs`: see the plan's Task 8 and its amendment.
   - **Scenarios:**
     - **W:** capacity and merge.
     - **G:** wounds 17–32 render on the GPU, plus the frame cost at 0 vs 32 wounds. This is the only GPU check that the wound ring above 16 works.
     - **K:** a seam cut on the torso, with a luma dip between lit lips.
     - **H:** a head cut.
     - **R:** the real rod. Use `__sdfGame.rodPress()` / `rodRelease()` with `setAimPoint` sweeps, because the canvas mousedown needs pointer lock.
     - **C:** cost.
   - **Before writing scenarios,** check that `actorWounds` returns `shape` (in `game-seams-world.ts:203`) and read `stampWoundAt`'s signature (`game-seams-fx.ts:546`: it takes origin and direction).
   - **Servers:**
     - Start them with `export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; lab_servers_up`.
     - `lab-servers.sh` needs **bash**, not zsh. Don't pipe `lab_servers_up`.
     - **Port 5273 is the owner's dev server: never touch it.**
   - **Look at** `K-after.png`, `H-after.png` and `R-after.png` yourself. Then run the look loop: change one `CUT_SHADE` / `ROD_CALIBRE` constant at a time and record each change in NOTES.
   - **Re-check** that the march-hash pins didn't move after the main merge (`node scripts/march-hash.mjs`). If they moved, that is main's change: re-pin with that reason.
3. **Task 9, docs:**
   - `docs/tasks/combat-and-gore.md`: change the "Cut wounds" bullet to `- [~]` M1 built.
   - `TASKS.md`: one line under in flight.
   - The spec: add `## 11. As built (M1)`.
   - Run tsc plus the targeted tests listed in the plan.
4. **Final code review** of the whole M1 range (`3d80e9d2..HEAD`, excluding the main merge). Then tell the user **M1 is ready to playtest**: slot 6, hold the left button and sweep across a zombie. Their dev server is `blud-head-burst` on 5273.
5. **After M1:** write the M2 plan (head split: authored presets, the nearest one to the hit wins, plus a dynamic warp). The spec covers M2.

## Open concerns (not blockers)

- **Boot outliers.** Two new-build boots read ~1925 ms under load ~6–8. Quiet interleaved pairs show +15 ms, within spread. One more quiet pair before merge would close it.
- **Armpit crease.** About 0.35% of samples flip on the oblique armpit cut. This only removes carve: the slot stops short with a small flat roof.
- **Thin limbs.** On r ≤ 0.02 limbs, the mask band wraps the sides (0.146 at the rod's kerf). The back proper is 0.
- **Bone exposure.** `cutExposureSpheres` covers the shell the carve removes. A slash across a thin limb's silhouette does not reach the axis bone. That is how the carve is designed (depth is measured from the nearest skin).
- **Cosmetic test log.** The `character-view.test` line "soldier sheet FAILED TO COMPILE" is a deliberate test input, not a bug.

## House rules

- Never `git stash`.
- Run targeted vitest only (`npx vitest run <pattern>`). `cut-wound.test.ts` takes ~90 s.
- `npx tsc --noEmit` has one allowed pre-existing error (`node:crypto`).
- Headless capture only.
- A WGSL change needs all of:
  - `npx vitest run march-golden -u`, noted in the commit;
  - `node scripts/compile-census.mjs`;
  - a march-hash re-verify;
  - an interleaved cold boot pair. Use a unique hash13 nonce per boot, because the OS Metal cache otherwise warms "cold" boots.
- End commits with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Memory goes in dualmem: checkpoint task `cut wounds M1`.
