# Blud — agent context

This file is the cross-harness entry point for coding agents (Claude Code,
Codex, DSH, etc.). It is intentionally concise. **The status board is
[TASKS.md](TASKS.md); the current vs. proposed source layout is
[docs/architecture/repository-map.md](docs/architecture/repository-map.md).**

## Active vs. retired — read this first

- **Active project:** the SDF-rendered FPS under
  [`src/lab/sdf-zombie/`](src/lab/sdf-zombie). The `lab` path is a historical
  name, **not** obsolete code. This is the game plus its character-authoring
  tools, WebGPU lab, benchmarks and modules. It keeps its existing default
  renderer; the retired game and the active game's legacy rendering mode are
  different concepts. Deferred rendering stays opt-in.
- **Retired project:** the sprite/bestiary/arena procedural-generation game and
  the old NotBlood simulation. It is reference-only for behavior comparison
  (dynamite, gibbing) **unless explicitly requested.** Do not treat historical
  roadmap entries as current work.

**Do not conflate two different concepts:**

| Concept | What it is |
| --- | --- |
| Retired game | A separate, older gameplay implementation (`src/main.ts`) |
| Active game's legacy rendering mode | The *renderer* for the current game, not the old game |

## Paths

- Active entrypoint: `/sdf-game.html` → `src/lab/sdf-zombie/webgpu/game-main.ts`
- Character/tooling labs: `/sdf-lab.html`, `/sdf-lab-webgpu.html`
- Retired entrypoint: `/index.html` → `src/main.ts`

**Stage 1 keeps every existing HTML URL path and runtime code path unchanged.**
`npm run dev` / `dev:fps` now open `/sdf-game.html`; `dev:legacy` opens
`/index.html`; plain `npx vite` stays non-opening for browser-free automation.
The old `/index.html` still serves legacy until Stage 2.

## Rules

- **Memory:** Use the DualMem launcher
  (`~/.config/dualmem/bin/dualmem-run`) for cross-session memory. **Do not**
  create a `MEMORY.md` or a `/memory/` persistence. Record durable code facts
  with `--files` pinned to the source file(s).
- **Tests:** Run focused tests, not the whole suite, unless asked. GPU captures,
  production builds, previews and heavy indexing are out of scope here — do not
  run them casually.
- **Resource ownership:** Extracted Blood assets are **dev placeholders only** —
  never commit, never ship. `.gitignore` enforces this (`public/assets/**/*-placeholder*`
  and `assets-source/blood-extracted/`). `scripts/link-dev-assets.sh` links
  them from the primary checkout into a worktree; it does not extract them for a
  fresh clone.
- **Shared modules:** some `src/game/*` modules are shared by both projects
  (e.g. `game/gibs/tuning.ts`, `game/weapons/muzzle-pos.ts`). Pay attention to
  provenance — do not move the old tree blindly. See the repository map.

## Verdicts & constraints

- Prefer evidence over claims: run the verification, record the output, report
  limits honestly. Do not claim a full build/test/gameplay/GPU pass from
  lightweight checks.
- No merge/push or primary-checkout edits without explicit instruction.
