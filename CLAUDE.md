# Blud — Claude Code project context

Blood-inspired FPS (short-run roguelike, Weird West × online brainrot setting, claymation sprite enemies with voxel-gib explosions). **TypeScript + Three.js + Rapier3D.js**. Priority: gib/weapon physics *feel* first.

## First thing every session

**Read [`TASKS.md`](TASKS.md) first.** It's the cross-cutting status board: what's in-flight, what's blocked, what's done, and what the next action is. Everything else in this file is a pointer.

## Repo layout

| Path                             | Purpose |
| -------------------------------- | ------- |
| `TASKS.md`                       | Status board — start here |
| `docs/superpowers/specs/`        | Design specs (one per direction change) |
| `docs/superpowers/plans/`        | Implementation plans (one per milestone) |
| `docs/tuning-sources.md`         | NotBlood-extracted enemy HP, damage, timers, gib threshold (=160) |
| `docs/tuning-sources-gibs.md`    | Gib picnum map (tile 2154 = hero blood chunk; 1267/8/9/1454/1456 = body chunks) |
| `docs/dev-notes/`                | Ad-hoc dev notes (sprite extraction, palette decoding, etc) |
| `scripts/extract_blood_sprites.py` | Blood RFF/ART → PNG (dev placeholder pipeline, never ships) |
| `assets-source/blood-extracted/` | Cached extracted Blood asset dump (**gitignored, dev only, never ship**) |
| `src/`                           | Game code (created by M1 dispatch tasks) |
| `public/`                        | Static web assets served by Vite |

## Reference docs

- Design: [docs/superpowers/specs/2026-04-20-blud-design.md](docs/superpowers/specs/2026-04-20-blud-design.md)
- Current plan (M1 — engine & movement): [docs/superpowers/plans/2026-04-20-blud-m1-engine-movement.md](docs/superpowers/plans/2026-04-20-blud-m1-engine-movement.md)

## Execution pattern

Implementation runs via `~/go/bin/dispatch-ui` at <http://localhost:8090> using model `zai/glm-5.1` on the `pi` harness. M1's 11 tasks are already queued at `~/.claude/dispatch/plans/2026-04-20-blud-m1-task-{1..11}.md` with serial `depends_on` chain — trigger task-1 manually, the rest auto-flow.

## Guardrails

- **Extracted Blood assets are dev placeholders only** — never commit to git, never ship. `.gitignore` enforces this for `public/assets/**/*-placeholder*` and `assets-source/blood-extracted/`.
- **Phase 1 gate (end of M5)**: 30min in the arena must feel fun before writing any level code. Don't build levels on top of bad feel.
- **When in doubt, update `TASKS.md`** to reflect new state or a newly-discovered task.
