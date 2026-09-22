# Handoff — close-up march performance (written 2026-09-21)

> **UPDATE 2026-09-22:** steps 1-4 are DONE. The raiser gate ships (bit-identical, -2.6 to -3.6 ms wounded);
> ragged soldier craters ship; mode 4 is parked behind `?limbs` (it loses to the gate). Everything is on
> branch `claude/sdf-raymarch-multiscale-22412b` with main merged in. Results and compile lessons:
> [WOUND-COST.md](WOUND-COST.md) "2026-09-22". **Next: step 5** (miss-ray culling, fire raising the body march).

**Goal (owner):** make the close-up, multi-body, wounded, with-FX frame fit the budget. The
owner is also narrowing FOV 72/60 -> 58/46 (separate session), which puts ~1.7-1.85x more body
pixels on screen, so this gets worse before it gets better.

## Where things are

| what | where | state |
| --- | --- | --- |
| research + wound-cost work | worktree `.claude/worktrees/sdf-raymarch-multiscale-22412b`, branch `claude/sdf-raymarch-multiscale-22412b` | **UNCOMMITTED** (6 modified, 3 new paths). Commit it first. |
| melee perf harness | branch `dispatch/2026-09-21-melee-closeup-harness` @ `78def24b` (worktree `~/.claude/dispatch/worktrees/2026-09-21-melee-closeup-harness`), based on `main` | committed, **not merged** |
| FOV 58/46 + weapon re-framing | separate session (task chip) | running independently |

Read, in order: `NOTES.md` (multi-scale verdict), `WOUND-COST.md` (root cause, gates, options),
then the harness notes on the dispatch branch.

## What is known (measured)

- Close-up cost is the ray WALK (70-87 % of `sdf:march`); hit rays take only ~4.2 steps, so
  ray-start priors (depth prepass, cone, learned depth) are dead. Savings = not running pixels,
  or making each field sample cheaper.
- **Wounds: the owner re-fold in `march/map-body.wgsl.ts` is ~95 % of the wound cost.**
- Melee scene, quiet machine: frame 17.0 clean / 22.8 wounded / **36.7 ms wounded+fire**.
  Fire also raises the BODY march 19.3 -> 27.7 ms (walk-only leg too) — not investigated.
- Rays that hit nothing are 46-50 % of walk steps in the melee scene.
- `counts2.z` modes now: 0 ship · 1 re-fold off (wrong frame, attribution only) · 2 raiser gate
  (`setOwnerRefoldGate`) · 3 CPU threat mask (`setOwnerRefoldMask`, includes 2). Both gates ship
  OFF. Gate: 14.95 -> 13.41 ms quiet, image inside the frame's own flicker. Mask: untimed.
- OWNER DECISION: lowering march resolution is not acceptable in any form ("too noticeable").
  Do not propose it. A reconstruction idea must not be a plain lower-res march.

## Next steps, in order

1. Commit this worktree. Merge `dispatch/2026-09-21-melee-closeup-harness` into it (no file
   overlap except `TASKS.md`).
2. On a QUIET machine (`uptime` load < 4 — the owner runs Docker; every timing taken under load
   this session was junk): run the harness with
   `MELEE_LEGS='gate=__sdfGame.setOwnerRefoldGate(true);mask=__sdfGame.setOwnerRefoldMask(true)'`
   to time both gates in the real scene. Owner has offered to eyeball them: raised arm over a
   torso crater, jaw/neck near a chest wound — the limb must survive, as it does in ship.
3. Cheap exact fixes: pre-scan retry with the own-amp bound; wound reach `0.25 -> max(0, -dIn)`.
4. **Owner-preferred: option 3 (one noise-ragged crater instead of blast + 3 satellites), then
   option 4 (per-limb accumulators, delete the re-fold).** Both change the look; the owner
   approves by eye. Details and the cull trap are in `WOUND-COST.md`.
5. Then: coarse-miss culling (the parked quarter-res prepass ignored coarse misses), why fire
   raises the body march, and the ~4 ms `sdf:march` costs looking at nothing.
6. Parked idea the owner liked: a (possibly learned) test for WHICH pixels need a real ray,
   with the rest filled by the existing refine pass. Hand-written rule first.

## Rules that cost time this session

- GPU A/B = ONE page, `__sdfGame.setFrameCap(0)`, alternate legs, compare block medians, and
  check `uptime` first. Never compare across page loads.
- A march shader text edit = one cold compile (minutes) on next boot, and `march-golden` must be
  re-recorded deliberately. `march-step-soundness` "shades 11 mm inside" fails on base too.
- Wounds are irreversible: stage clean legs first. 5 stamps = 16 wound ROWS.
- March debug mode 4 alpha is CLIP depth, not metres.
- Bodies spawned after boot never march; `zombieNudge` is not a teleport; `applyShipDefaults`
  in `sdf-closeup-stage.mjs` is NOT the ship state; fire needs the sim unfrozen.
