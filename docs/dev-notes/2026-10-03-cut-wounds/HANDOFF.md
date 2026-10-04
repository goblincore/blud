# Cut wounds M1: handoff (2026-10-04)

**Branch:** `claude/head-explosion-effect-d6231e`
**Worktree:** `.claude/worktrees/head-explosion-effect-d6231e`
**State:** M1 is built and through its final code review (verdict: ready for the owner's playtest). The final-review fixes have landed. **Next: the owner's playtest, then the M2 plan.**
**HEAD:** the handoff update after `af3c5e4b`

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

## Done

| Task | What | Commits |
| --- | --- | --- |
| 1 | A full wound ring merges instead of evicting (head slots protected) | `a66c1c4a`… |
| 2 | `MAX_WOUNDS` 32; all WGSL bounds interpolate it. The WebGL lab twin stays at 16. `explosion-aoe` is held at 16 | `0ef1f943`, `049c2080` |
| 3 | `cut-wound.ts`: `cutCarve` (the authoritative CPU mirror), `stampCut`, `cutsFromSweep`, `cutExposureSpheres` | …`b8bfc89d` |
| 4 | Upload: `ROW_WOUND_CUT` 25, flag bit 32, `DATA_ROWS` 26, sag in `META.w` | `d1763c36`, `1b6ccf5e` |
| 5 | WGSL cut branch. Fix round 1 (`73289ded`, `b61beff4`) and fix round 2 (`f2be31cc`, `ef247a0f`) were approved by the quality re-review | `ffe5a3eb` + fixes |
| merge | Synced with `origin/main`. Conflicts resolved in `normal-gradient-probe.ts` (took main's `probeWoundSources`) and in the golden (`-u`) | `f48e0084` |
| 6 | Bones are exposed along cuts (`game-main.ts` crater lists). Hardening: the mask gate uses `nSmooth`; a cut with no cap gets a zero CAP. Exposure spheres follow sag | `a36fa786`, `ee51bc6c`, `0666fc8a`. Controller-checked, no separate reviewer |
| 7 | The rod, weapon slot 6 (`game-rod.ts`, test, seams `cut` / `rod` / `rodPress` / `rodRelease`). Fixes: armed gate, blur and lock-loss reset, actor-local sweep samples, one-frame run slack, longest cuts across runs, dispose | `bed903af`, `5f075950`, `fb35b370` |
| 8 | The capture gate `scripts/cut-wound-gate.mjs` (W, G, K, H, R, C): 24 checks, 0 failed (runs 7 and 8). Measurements and photos in `NOTES.md` and `gate/`. No look constant changed, no WGSL changed | `87903eb3` |
| 9 | Docs: task board, `TASKS.md`, spec section 11 (as built), this handoff | `58a296a5`, `c33fbb1d` |
| final review | No critical issues. Fixed: (1) bone exposure used yaw 0 while wounds live in the yawed body frame, so the bone stain landed ~0.15 m off on turned bodies; there is now one `boneExposureOf`, and gate T uses a turned body; (2) a full ring merges craters before evicting a cut; gate X measured 32 cuts ≈ 32 craters, so there is no shader early-out; (3) minors: a straight melee ray for the rod (no slug drop), a time-based sample cap, the seam's undefined filter, the soldier bake/lobes skip cuts, corrected comments. Gate: 30 checks, 0 failed | `8d2d5d1a`, `62b855d9`, `c7211255`, `afc9a2a6`, `af3c5e4b` |

Task 5 details worth knowing:
- `cutLip` and `cutMask` are CPU mirrors, and the WGSL copies them term for term (text pins in `wounds.wgsl.test.ts`).
- The mask has a back-facing normal gate.
- The raw-plane lid is `dot(rel, inward) + kerf + 0.25·h`.
- `cutThreatWound` has a tight box sphere.
- The lip scale is clamped to 1.1.
- The combined field's Lipschitz bound is 2.075.

## Remaining

1. **Owner playtest.** Tell the user M1 is ready: weapon slot 6, hold the left button and sweep across a zombie. Their dev server is `blud-head-burst` on 5273 (never touch it). The pointer-lock mousedown path has not been exercised by any gate (the gate's R scenario uses the `rodPress` / `rodRelease` seams), so the playtest is its first real check.
2. **The M2 plan** (head split: authored presets, the nearest one to the hit wins, plus a dynamic warp). The spec covers M2.

## Open concerns (not blockers)

- **Boot outliers.** Two new-build boots read ~1925 ms under load ~6–8. Quiet interleaved pairs show +15 ms, within spread. One more quiet pair before merge would close it.
- **Armpit crease.** About 0.35% of samples flip on the oblique armpit cut. This only removes carve: the slot stops short with a small flat roof.
- **Thin limbs.** On r ≤ 0.02 limbs, the mask band wraps the sides (0.146 at the rod's kerf). The back proper is 0.
- **Bone exposure.** `cutExposureSpheres` covers the shell the carve removes. A slash across a thin limb's silhouette does not reach the axis bone. That is how the carve is designed (depth is measured from the nearest skin).
- **Rupture transform.** On a body mid-rupture, the upload applies the per-region transform `xf` but the bone exposure does not (this predates the cuts).
- **Gate T** depends on the ring's walking sim to produce a turned zombie (deterministic so far at −81.2°).
- **32-wound frame cost.** With the torso filling the frame (0.6 m), 32 wounds add +17 to +25 ms over a ~20 ms baseline; at 2 m, +4 to +6 ms. The 16 far-side wounds alone add ~2.5 ms. The 32-wound reading spreads by 8 ms between runs (`NOTES.md`, Task 8 frame cost).
- **Look suggestions (not applied; the owner's call, `NOTES.md` Task 8):**
  1. Lips read darker than the uncut skin in shadow (the wet-lip band darkens the ridges). Try `CUT_SHADE.lipHeight`, or less darkening of a cut's band. At 0.6 m the rod's 1 cm kerf is ~5 march px, so a lip may need to be larger than the CPU slope tests assume.
  2. The rod's slit (`ROD_CALIBRE.kerf` 0.01, 2 cm wide) reads as a thin line at 0.6 m in shadow. A wider kerf is one constant.
  3. Exposed bone renders crisp at output resolution inside the soft upscaled flesh (hard-edged pink patches). This predates the cuts (skeleton=mesh).
- **Gate thresholds.** The H outside-band margin is thin (0.78 vs a 1.0 limit); the residue near the right eye's lower lid was not isolated. A large flat pale-yellow polygon fills the lower left of the C photos before any cut; not investigated.
- **Fixed on main, merged in `f48e0084`.** The `ngWoundProbe` arity bug found in Task 2: the probe now calls the 8-argument `applyWounds` (`normal-gradient-probe.wgsl.ts`, pinned by `normal-gradient-probe.wgsl.test.ts`).
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
