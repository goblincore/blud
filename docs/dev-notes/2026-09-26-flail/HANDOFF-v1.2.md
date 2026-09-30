# Spike flail — hand-off for v1.2 (2026-09-27)

**Branch:** `claude/melee-weapon-design-7d1423` (worktree `.claude/worktrees/melee-weapon-design-7d1423`) ·
**PR:** goblincore/blud#22 (open; v1.1 pushed at `16e705f1`) · **Dev server for the owner:** `.claude/launch.json`
config `blud-censer` → http://localhost:5190/sdf-game.html?level=night-train (start it with preview_start).

## Where things are
- The spec is `docs/superpowers/specs/2026-09-26-spike-flail-design.md`. **§11 is the approved, unbuilt
  v1.2 list**, the next work.
- The plan is `docs/superpowers/plans/2026-09-26-spike-flail.md` (Tasks 1–11 done). Add v1.2 as Tasks 12+.
- Code, all in `src/lab/sdf-zombie/webgpu/`:
  - `flail-swing.ts`: keys, `FLAIL_IMPACT`, `flailBolt`, `flailBallVel`;
  - `flail-chain.ts`: the guided chain sim, `drawChain`, `chainTeleported`;
  - `flail-strike.ts`: the strike window, `isHeadRegion`, `flailWound`, `FLAIL_HEAD`;
  - `game-flail.ts`: the leaf; `FLAIL_FEEL`, `FLAIL_LOOK`, `headHits`, the fill light list;
  - `game-seams-flail.ts`.
- Gate: `scripts/flail-gate.mjs` (run it headless via `scripts/lab-servers.sh`, sourced from **bash**; use
  ports other than 5190). Model: `scripts/model_flail.py` → `public/assets/lab/flail.glb`.
- Notes and photos: `docs/dev-notes/2026-09-26-flail/NOTES.md`, `gate/` and `look/`.

## Next steps (v1.2, spec §11)
1. **Confirm the decapitation cause first** (systematic debugging): add a gate case that aims the CROSSHAIR at
   the head and hits 4×, logging each wound's prim limb, its distance to the head centre and to the neck
   joint, `headHits`, and `limbAlive`.
2. Fix the head region: add a check against the neck joint. Set `hitsToSever` 4 and `faceCraterR` 0.06.
3. Damage: `craterR` 0.09 and `meterCredit` 0.18. The gate must show ≥ 4 body hits to collapse.
4. Keys:
   - move both strike balls up to the crosshair (view y ≈ −0.05…−0.1);
   - re-author KEYS_R as a big overhand swipe (wind-up high over the right shoulder, then a diagonal down);
   - keep the swing and chain tests green.
   - `FLAIL_IMPACT` feeds the strike; re-check the whip gates.
5. `handScale` ~1.3, from photos.
6. Gate, photos (R overhand strip, head hits 1–4), NOTES, then the PR body's v1.2 section, and push.

## Process lessons (this session)
- **Run implementer subagents ONE AT A TIME.** Parallel commits in one worktree share the git index. Always commit
  with an explicit pathspec; never `git reset` or `git stash`.
- **Test at several frame rates** (30/60/144 Hz and jittered), not just 1/60 s. A 1/60 s step is exactly 4
  substeps at 240 Hz and hides bugs.
- **Screenshots lag hand-stepped frames by one**: shoot after two frozen re-renders.
- **Frozen actors don't re-pose**: sever readbacks must use the live body (`a.body`).
- **The in-app browser pane loses WebGPU**: capture headless. The owner tests in Chrome.
- **The one-neck-hit double wound is the sever stump cap**, which is expected.
