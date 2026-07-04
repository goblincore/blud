# Dynamite-First Arena Generator (Greenfield)

**Date:** 2026-07-04
**Status:** Approved design (Sections 1–3 approved in brainstorm)
**Supersedes:** the generation strategy in `src/sim/floorplan.ts` (contract retained, output rejected)

## Context & locked decisions

The existing floorplan generator (`src/sim/floorplan.ts`, 2026-06-24 "arena-first"
pivot) produces uniform scattered cover blocks; the output was rejected. Rather
than iterate on it, we build a greenfield generator. Five decisions locked during
brainstorming:

1. **Arena-is-the-star** — one big readable space, no maze.
2. **Multi-theme**, driven by stats mined from Blood campaign data
   (`public/assets/map-research/patterns.json`: `campaignSummary` /
   `globalStats` / `perMap`, 32,903 sectors).
3. **Blood tile art behind a `ThemeMaterialSet` seam** — Blood is the first
   material set, not a hard dependency.
4. **Dynamite-first grading criterion** for all layout geometry: open
   sightlines, low lob-over cover, enemy-clumping affordances, backpedal room.
   No tall-wall/maze motifs.
5. **Approach 2: greenfield generator** — new module, old generator retired
   once the new path is proven.

Ride-alongs noted for the implementation plan (not part of this design):
zombie wall-ghosting collision fix (zombies are Rapier kinematic with no
static collision; cultists already fixed), wave auto-start, fog removal.

## Section 1 — Architecture & placement

New module `src/sim/arenagen/`, inside the sim determinism firewall (plain
data only, no `three`, no Rapier, imports limited to sim siblings):

```
src/sim/arenagen/
  index.ts        // generate(seed, themeId) → ArenaPlan
  rings.ts        // stage 1: radial zoning (center stage / mid ring / perimeter)
  cover.ts        // stage 2: dynamite-graded cover placement
  grade.ts        // stage 3: dynamite scoring — reject/retry loop
  themes.ts       // theme selection + distilled pattern-stat lookups
  theme-data.ts   // checked-in generated constants (see Section 3)
```

**Generate → grade → retry.** The generator produces a candidate; `grade.ts`
scores it against the four dynamite criteria and rejects candidates below
threshold. Retries are bounded and deterministic — the retry count folds into
the RNG stream so the same seed always yields the same accepted plan.

**Output contract.** A new `ArenaPlan` type, a superset of today's `Floorplan`
shape (occupancy grid `Uint8Array`, rooms, spawns, start, `cellToWorld`
semantics preserved; 28×28 grid, 2 m cells, origin-centered), so
`src/game/arena.ts` migrates via a thin adapter rather than a rewrite.
Additions beyond `Floorplan`:

- Every cover item carries a **height class**: `low` (lob-over, ~1 m) or
  `mid` (sightline breaker). Rendering/collision uses the existing
  mixed-height-cover spec (2.5D vertical collision,
  `2026-06-24-blud-mixed-height-cover-design.md`).
- Every surface carries a **role tag** (`'floor' | 'wall' | 'coverLow' |
  'coverMid' | 'perimeterAccent' | 'pocketFloor'`) for the material seam.
- Pocket cell groups are listed explicitly (for grading, debug overlays, and
  the optional `pocketFloor` role).

**Data boundary.** `patterns.json` is a build-time input only. Theme stats are
distilled offline into the typed `theme-data.ts` constants module; the sim
firewall never performs I/O.

`src/sim/floorplan.ts` stays untouched until the new path is proven in-game,
then is retired along with its tests.

## Section 2 — Ring model & dynamite-serving cover

Three concentric zones on the existing 28×28 grid (radial logic on square
cells; arena stays origin-centered):

**Center stage (~40% of radius).** Mostly open floor with 1–3 `low` cover
pieces only (sandbag lines, rubble mounds, crates). No `mid` cover permitted —
nothing breaks a dynamite arc or a sightline here. This is where fights climax.

**Mid ring (~40–75%).** The tactical band where the four criteria are
engineered structurally:

- *Open sightlines* — every cover piece must leave clear lanes to the center
  stage from at least 2 cardinal directions (radial gap constraint). No piece
  may extend a neighbor into a contiguous wall segment longer than ~6 m: the
  tall-wall/maze ban enforced by construction, not just by grading.
- *Low lob-over cover* — ~70% of mid-ring cover is `low` class: you throw
  over it, enemies path around it.
- *Clumping affordances* — cover is placed in **clusters of 2–3 with a shared
  pocket**: a concave open cell group (2–4 cells) behind the cluster. Enemy
  pathing funnels groups into pockets → dynamite payoff. Pockets face away
  from center so the player reads them as throw targets while backpedaling
  toward open floor.
- `mid`-height pieces live only in this ring, capped at 2–4 per map, never
  adjacent to each other.

**Perimeter (~75% → wall).** A guaranteed **contiguous clear ring lane,
minimum 2 cells (4 m) wide**, running the full circuit, never blocked by
cover. This is the backpedal criterion made structural: kite the clump
backward along the perimeter and lob into the pocket just vacated. Spawn
arches (per `2026-06-24-blud-arena-structure-design.md`) and the player start
punctuate this ring.

**Grading.** `grade.ts` verifies the emergent properties placement rules can't
guarantee by construction:

- *Sightline score* — % of center stage visible from a walk of the perimeter
  lane.
- *Clump score* — pocket count and total pocket capacity.
- *Backpedal score* — perimeter lane continuity and width.
- *Cover ratio* — low:mid class ratio within bounds.

Candidates below threshold trigger the deterministic retry. If all retries are
exhausted (8 attempts), the **best-scoring candidate is
accepted** — generation never fails; a low-scoring map is still playable.

## Section 3 — Themes & the ThemeMaterialSet seam

**The seam.** `ThemeMaterialSet` is promoted from `src/dev/theme-preview.ts`
into a first-class render-side interface under `src/game/level/` (outside the
sim firewall). It maps *roles* to materials, never textures to places:

```
ThemeMaterialSet {
  floor, wall,            // arena shell
  coverLow, coverMid,     // the two height classes
  perimeterAccent,        // lane edge / spawn-arch trim
  pocketFloor?            // optional subtle pocket marking
}
```

The sim side emits role tags only; the render layer resolves role → material
through the active set. Blood tile art is the first implementation; a future
non-Blood set drops in without touching the generator.

**Theme definitions.** `theme-data.ts` is generated offline from
`patterns.json` by a regeneration script in `scripts/` and checked in. Each
theme is a plain record:

- identity: `id`, display name, source-map cluster it was distilled from
  (`perMap` groupings — e.g. temple, carnival, industrial);
- flavor densities: prop density, rubble frequency, mid-cover material bias —
  derived from `globalStats` / `perMap` sector stats;
- material set id, resolved render-side.

**Theme × seed independence.** `generate(seed, themeId)`: geometry derives
only from `seed`. `themeId` selects the material set and modulates cosmetic
densities (prop scatter, decal frequency) via a forked RNG stream, so
switching themes never changes cover positions, pockets, or lanes. Same seed =
same fight in every theme.

**pocketFloor** is a readability affordance, optional and subtle; v1 may ship
it as identity with `floor`.

## Error handling

- Bounded retry (8 attempts) with fallback-to-best-candidate: generation is
  total — every seed produces a plan.
- Grade scores attach to the emitted `ArenaPlan` for debug overlays and test
  assertions.
- The regeneration script validates `patterns.json` shape at build time;
  runtime never parses JSON.

## Testing

Mirrors `src/sim/floorplan.test.ts` conventions:

- **Determinism snapshots** — same seed → byte-identical `ArenaPlan`
  (including across theme switches, for geometry fields).
- **Grade assertions** — over a seed sweep (e.g. 100 seeds): perimeter lane
  continuity holds, no wall segment > 6 m, mid-cover count within 2–4,
  low:mid ratio in bounds, every map has ≥ 2 pockets, center stage contains
  no `mid` cover.
- **Contract tests** — adapter produces a valid `Floorplan`-compatible view
  for `arena.ts` until the migration completes.

## Migration & retirement

1. Land `arenagen` behind the adapter; `arena.ts` consumes `ArenaPlan`.
2. Prove the feel in-game (theme-preview + play sessions).
3. Retire `floorplan.ts` + tests; remove the adapter if `arena.ts` moves to
   `ArenaPlan` natively.
