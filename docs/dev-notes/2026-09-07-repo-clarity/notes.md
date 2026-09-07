# Repo clarity — Stage 1 notes

- **Date:** 2026-09-07
- **Branch:** `codex/dispatch/2026-09-07-repo-clarity-stage1`
- **Base:** `c120a3e7`
- **Type:** navigation/documentation + npm-script correction. **No runtime code,
  asset, renderer or behavior changes.**

## What this stage did

Made the active SDF FPS obvious and the retired game explicitly reference-only,
corrected the launch commands so the active game is the default, and produced the
dependency-aware Stage 2 handoff plan (still pending, not executed).

## Changed files

- `README.md` — **created.** Human entry: active project statement, setup,
  `dev`/`dev:fps`/`dev:legacy` commands and explicit URLs, character-lab URLs,
  docs links, build/test note.
- `AGENTS.md` — **created.** Cross-harness entry: active paths first, retired
  game reference-only, retired-game vs active-legacy-renderer distinction,
  DualMem/no-`MEMORY.md` rules, focused tests/resource ownership, source-map/status
  links, asset guardrails.
- `CLAUDE.md` — **rewritten** as a short pointer with accurate active scope; removed
  stale April "current plan" and old queued-task execution instructions; kept asset
  setup guidance through canonical links.
- `TASKS.md` — **orientation banner** added near the top identifying historical vs
  active entries and linking the repository map. Content preserved; no checkboxes
  reinterpreted.
- `docs/architecture/repository-map.md` — **created.** Current-state tree (facts),
  active-tree entrypoints, verified external-import edges, shared-set definition,
  and a clearly labeled target-state tree.
- `docs/reference/legacy-dynamite-gibbing.md` — **created.** Behavior → legacy source
  → current SDF counterpart, with units/provenance, presentation-vs-authoritative-sim
  distinction, and comparison run instructions.
- `docs/superpowers/specs/2026-09-07-fps-legacy-repo-structure-design.md` — **created.**
  Approved design: staging, target boundaries, launch/build/test intent,
  compatibility, dependency extraction, validation/integration prerequisite. Stage 2
  stated as pending.
- `docs/superpowers/plans/2026-09-07-fps-legacy-repo-structure.md` — **created.**
  Dependency-aware Stage 2 plan (pending, gated on deferred integration + Stage 1).
- `docs/dev-notes/2026-09-07-repo-clarity/notes.md` — **this file.**
- `package.json` — **modified.** `dev` and `dev:fps` → `vite --open /sdf-game.html`,
  `dev:legacy` → `vite --open /index.html`. All other commands unchanged. No other
  file (lockfile, HTML entrypoints, `vite.config.ts`, runtime modules, server scripts)
  touched.

## Validation evidence (lightweight, per stage intent)

- `package.json` parses as valid JSON (`node -e "JSON.parse(...)"` → ok). The three
  script strings are exactly as spec'd; all other scripts preserved.
- `git diff --check` → clean (no whitespace errors).
- Vite CLI supports `--open [path]` (`vite --help`).
- Programmatic `createServer` smoke test
  (`server: { host: '127.0.0.1', port: 0, open: false, strictPort: false }`):
  bound port `5173`; `GET /sdf-game.html` → `200` with entrypoint
  `src/lab/sdf-zombie/webgpu/game-main.ts`; `GET /index.html` → `200` with
  entrypoint `src/main.ts`; `server.close()` awaited in `finally`. No browser
  launched, no game modules fetched/executed.

## Limitations — what is NOT claimed

- **No** full `npm run build` / `tsc --noEmit` / `vitest run` was run here (out of
  scope for these doc/script changes; a separate M2 dispatcher is running GPU checks).
- **No** gameplay, renderer, GPU, or visual verification.
- The `createServer` check validates **serving and command intent only**, not
  gameplay or GPU acceptance. `port: 0` resolved to `5173` (Vite default) — the
  bound port was inspected from the live HTTP server, not assumed.
- All existing HTML entry URLs and runtime code paths are **unchanged**; `/index.html`
  still serves legacy until Stage 2.

## Exact next step

Coordinate with the M2/integration gate: once the in-flight deferred-rendering work
is reviewed and integrated **and** Stage 1 is committed, re-run the import scan at
the new HEAD, then execute
[`docs/superpowers/plans/2026-09-07-fps-legacy-repo-structure.md`](../../superpowers/plans/2026-09-07-fps-legacy-repo-structure.md).
No Stage 2 work is queued by this stage.
