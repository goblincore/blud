# Blud

Blood-inspired FPS. **The active project is the SDF-rendered FPS** in
[`src/lab/sdf-zombie/`](src/lab/sdf-zombie) (the "lab" name is a historical
artifact, **not** a marker of obsolete code). TypeScript + Vite 5 + Three.js
0.185. Rapier3D.js is **not** the active game's physics/renderer stack — it is
used only by the retired sprite game (see "What is retired").

## What is active

**The active project is the SDF-rendered FPS.** It lives under
[`src/lab/sdf-zombie/`](src/lab/sdf-zombie) — the "lab" name is a historical
artifact, **not** a marker of obsolete code. This is where the current game,
the character-authoring tooling, the WebGPU lab, benchmarks and their modules
live. It keeps its existing default renderer (the forward/legacy path); deferred
rendering stays opt-in and unmerged work is not described as shipped.

- **Active game entrypoint:** `/sdf-game.html` → `src/lab/sdf-zombie/webgpu/game-main.ts`
- **Character/tooling lab:** `/sdf-lab.html`, `/sdf-lab-webgpu.html`
- **SDF dynamite/FPV demo:** `/sdf-lab-webgpu.html` is the lab that mounts the
  dynamite prop and the FPV cook/throw machine (its **`fpv: enter`** button or
  **Tab** toggles FPV). `/sdf-game.html` is the playable FPS but has **no**
  dynamite integration.

## What is retired (reference-only)

**The retired project is the sprite/bestiary/arena procedural-generation game
and the old NotBlood simulation.** It is kept **runnable** as a behavior
reference — especially for dynamite and gibbing comparisons — but it is no
longer the current game.

- **Legacy entrypoint:** `/index.html` → `src/main.ts`

The `index.html` URL and its runtime code paths are **deliberately unchanged**
in Stage 1. Only the launch commands are being corrected so the active game is
the default. The old `/index.html` keeps serving the legacy game until the
physical migration in Stage 2.

> Retired game vs. active legacy rendering mode are **different concepts.** The
> retired game is a separate, older gameplay implementation; the active FPS
> also has a legacy/forward rendering mode, which is the *renderer* for the
> current game, not the old game.

## Setup

```
npm install
```

The **active FPS** (`/sdf-game.html`) serves from the tracked
`public/assets/lab/*` assets, so it needs no extra step. Two other things are
dev-only and are **not** auto-extracted:

- **Retired game (`/index.html`)** needs the gitignored extracted Blood sprite
  placeholders. This is the entrypoint that fails without them (Vite's SPA
  fallback answers a missing file with `index.html` + a `200`, so the manifest
  fetch "succeeds" and the boot dies on a JSON parse error). Run
  [`scripts/link-dev-assets.sh`](scripts/link-dev-assets.sh) once per worktree to
  symlink the placeholders **from your primary checkout** into this worktree. It
  only fills holes; it does **not** extract assets for a fresh clone.
- **WebGL lab (`/sdf-lab.html`) post-fx** loads `/assets/post-fx/BLOOD.PAL.png`
  (a gitignored baked palette LUT under `public/assets/post-fx/`, via
  `lab-main.ts` → `vfx/post-fx/composer.ts`). Without it the WebGL lab's post-fx
  path won't render its palette-grade output. (The WebGPU lab
  `/sdf-lab-webgpu.html` does not load it.)

> **Never commit or ship** the dev-only placeholders/LUTs — enforced by
> `.gitignore` (`public/assets/**/*-placeholder*`,
> `assets-source/blood-extracted/`, `public/assets/post-fx/`,
> `public/assets/map-research/`).

## Run

| Command | Opens | Target |
| --- | --- | --- |
| `npm run dev` | `/sdf-game.html` | **Active** SDF FPS |
| `npm run dev:fps` | `/sdf-game.html` | Active SDF FPS (explicit alias) |
| `npm run dev:legacy` | `/index.html` | Retired legacy game |
| `npx vite` | *(no browser)* | Plain server for browser-free automation |

`npx vite` deliberately does **not** open a browser — `scripts/lab-servers.sh`
and other capture drivers rely on that.

### Direct URLs (all active unless noted)

- `/sdf-game.html` — active game
- `/index.html` — retired legacy game (`src/main.ts`)
- `/sdf-lab.html` — SDF zombie lab (WebGL/forward path, character tooling)
- `/sdf-lab-webgpu.html` — SDF zombie lab (WebGPU path, character tooling)
- `/sdf-bench.html` — SDF benchmark (`bench-main.ts`)
- `/sdf-lab-webgl-bench.html`, `/sdf-lab-webgpu-bench.html` — renderer benchmarks
- `/humanoid-sdf-spike.html`, `/sdf-hull-spike.html`, `/sdf-shell-spike.html` — authoring spikes
- `/normal-gradient-check.html`, `/shared-wounds-probe.html`, `/bounded-wounds-bench.html` — diagnostic probes
- `/theme-preview.html` — theme preview (`src/dev/theme-preview.ts`)

## Build & test

Until Stage 2 these still cover the existing **combined** source tree — they do
not yet separate active from legacy:

- `npm run build` — `tsc --noEmit && vite build`
- `npm test` — `vitest run`

The build/test split and the physical `src/fps` / `src/legacy` migration are
Stage 2 work (see the plan below); the active and retired trees are still
interleaved under `src/` and `src/lab/`.

## Docs

- **Source map / current vs. target layout:** [docs/architecture/repository-map.md](docs/architecture/repository-map.md)
- **Legacy dynamite/gibbing reference (behavior → source → current port):** [docs/reference/legacy-dynamite-gibbing.md](docs/reference/legacy-dynamite-gibbing.md)
- **Approved repo structure design:** [docs/superpowers/specs/2026-09-07-fps-legacy-repo-structure-design.md](docs/superpowers/specs/2026-09-07-fps-legacy-repo-structure-design.md)
- **Stage 2 physical migration plan:** [docs/superpowers/plans/2026-09-07-fps-legacy-repo-structure.md](docs/superpowers/plans/2026-09-07-fps-legacy-repo-structure.md)
- **Status board:** [TASKS.md](TASKS.md)
- **Cross-harness agent context:** [AGENTS.md](AGENTS.md)
