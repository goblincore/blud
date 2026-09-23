# Level 1: Night Train — Tasks (draft 1)

**Date:** 2026-09-23 · **Design:** [design.md](design.md) · **Scope:** [../../production-scope.md](../../production-scope.md) (G6)

Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.
**Depends on:** the Wake's level pipeline (level format, Blender export) and
game loop (health, pickups, triggers). See [the Wake implementation brief](../00-the-wake/implementation.md).

---

## Design

- [ ] **N-D1 Carriage plan.** Final dimensions per carriage at goblin scale,
  seat layouts with ≥ 1.4 m aisles. *Done when:* a top-down plan of all nine spaces.
- [ ] **N-D2 Encounter script.** Counts, placement and wake-up triggers per carriage.
- [ ] **N-D3 The Stoker.** Silhouette, scale in the cab, shovel-loop timing
  (it sets the Party's beat). *Done when:* a reference sheet.
- [ ] **N-D4 Lift-off beat sheet.** Second by second: fire, beat, track curve,
  ground falling away, clouds, stars, the pink light.
- [ ] **N-D5 The CD.** Artist, title, cover brief, liner notes.
- [ ] **N-D6 Hub carriages.** Which carriages stay, and what each holds between stops.

## Build

- [ ] **N-B1 Blockout in Blender** through the level pipeline, platform to cab.
  *Deps:* Wake P-2 (exporter/importer).
- [ ] **N-B2 Window marker.** A level-format marker for a window plane that
  shows a scrolling view. *Deps:* Wake P-2.
- [ ] **N-B3 Scrolling scenery.** Night landscape cards past the windows: speed
  and looping. *Deps:* N-B2.
- [ ] **N-B4 Train sway.** Camera roll and bob, and shifting loose props, with no
  effect on collision.
- [ ] **N-B5 Encounters in,** including sleeping guests that wake on a shot and
  passengers bursting out of trunks. *Deps:* N-B1, Wake L-4 (triggers).
- [ ] **N-B6 Emergency brake.** A cord trigger; loose actors and props get a
  forward impulse. *Deps:* N-B5.
- [ ] **N-B7 Firebox and lift-off.** The firebox as a shootable/dynamite target;
  the sky transition from landscape to stars; the pink light. *Deps:* N-D4, N-B3.
- [ ] **N-B8 Hub state.** Load the train in a quiet variant after the lift-off
  (no enemies, departure board live). *Deps:* N-B1. Shared with revisited stops.
- [ ] **N-B9 Playtest pass.** 8–12 minute target, difficulty, readability in the
  narrow carriages.

## Characters and art

- [ ] **N-A1 The Stoker:** a new SDF character with a shovel loop. *Deps:* N-D3.
- [ ] **N-A2 Party dressing** for existing bodies: hats, streamers, bow ties.
- [ ] **N-A3 Carriage kit:** seats, luggage racks, tables, compartment doors,
  bunks, jukebox, coat rails, counter, bell, firebox, gauges.
- [!] **N-A4 Art pass on the blockout.** *Blocked on:* the Wake's pipeline verdict (P-4).

## Blocked / later

- [!] **Wheels, wind, jukebox, the shovel beat:** need audio (G3).
- [!] **Roof route:** needs multi-height floors.

## Suggested order

N-D1 → N-D4 · N-B1 (once the Wake pipeline works) → N-B2 / N-B3 → N-B5 → N-B7 →
N-A1 → N-B6 → N-B8 → N-B9.
