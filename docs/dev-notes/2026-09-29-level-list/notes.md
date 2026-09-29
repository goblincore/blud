# Level materials on the shared list, cheap tier — dev note, 2026-09-29

Spec: [level-list-lighting-design](../../superpowers/specs/2026-09-29-level-list-lighting-design.md). Plan:
[level-list-lighting](../../superpowers/plans/2026-09-29-level-list-lighting.md). **On by default since 2026-09-29 (owner: no
visible difference in play); `?levellist=0` opts out** (it needs the list on). The A/B numbers below were taken while it was
opt-in: read B as the default and A as `?levellist=0`.

## Fidelity A/B ([ab-node-vs-three.png](ab-node-vs-three.png))

The Boiler Room's four second-row spots lit by three (`?row2=three`, an experiment flag, removed afterwards) versus by the node
(`?levellist=1`), the disco check's party frame, headless, machine loaded (the image comparison does not need quiet):

- noise floor, three vs three: mean |diff| **3.76**; node vs three **4.94**. Bound: floor × 1.5 + 1 = 6.64. **PASS.**
- The diff image is smoke drift and star sparkle; the walls, floor and cones match. Three's specular glints are the
  accepted difference (none of the frame's surfaces showed a missing one).
- `__sdfGame.levelListInfo` in room 5: list indices 1, 2, 5, 7 (the second-row spots) and 9 (the party-boiler fire).

## Cost spike (quiet machine, load 3.5–4 at the runs that count; light-gate cost harness, Boiler Room / third class)

A = baseline (the second row invisible to the level), B = `?levellist=1` (the node shades the second-row spots + the room's fire),
C = `?row2=three` (the second-row spots as three lights). Two runs each, means.

**First cut: the node cost about +4 ms per carriage, even in third class with one node-shaded light** (B GPU ~19 vs A 12.7;
the extra showed as `sdf:polys` in the pass table, which is only the level pass changing label, not a new pass). Cause: the
WGSL looped a fixed 8 iterations over a dynamically indexed `array<f32, 8>` whether or not a pick was live. **Fix: a uniform
`count` (the live leading picks; `cheapLevelIndices` packs from the front) bounds the loop, no local array.**

After the fix (`lvl2-*` runs):

| | A baseline | B node | C three | B − A | C − A |
| --- | --- | --- | --- | --- | --- |
| Boiler Room GPU ms | 11.75 | 10.32 | 12.93 | **−1.44** | +1.18 |
| Boiler Room frame ms | 17.33 | 15.08 | 17.55 | −2.25 | +0.22 |
| third class GPU ms | 12.96 | 12.56 | 12.82 | −0.40 | −0.14 |

**Verdict: GO** by the plan's rule (C − A > 1.0 GPU ms and B − A ≤ 0.5 × (C − A)). Read it with two caveats: B is *negative*
partly because moving the Boiler Room's fire light off three saves a real light (so the node's own per-light cost is not
isolated, only bounded near zero), and C − A is small (+1.2 ms) because three's four spots were not the ~1 ms/light of the
earlier omni measurements. Frame-ms deltas are noisy (loads 3.5–8.6); the GPU span is the steadier column.

## What shipped, and how to use it

- `?levellist=1` (list on): one `LevelListLightingNode` per room shades that room's **cheap-tier** lights — fire-mood lights and
  shadowless (`shadow: false`) tubes — out of the shared list's buffer: diffuse only, three's falloff, up to 8 lights.
  Those lights leave three's level-material lights (`userData.levelCheap`). Shadowed lights (4 tubes/room, beacons, window,
  torch) stay on three. With it off (`?levellist=0`) the level is byte-identical to before (full test suite and light gate pass
  with it off; the tier shades level surfaces, never the march target, so march-hash is not affected).
- Seam: `__sdfGame.levelListInfo` (per room, the list indices its node shades).
- Look: [party-default-vs-levellist.png](party-default-vs-levellist.png). The node lights the side walls from the second
  row (it costs the level nothing measurable) and the fire; no specular glints from those lights.
- The experiment flag `?row2=three` is gone.

## Owner decision — made 2026-09-29

The owner played it in the Boiler Room and did not notice the difference: it is the default. `?levellist=0` restores the old
level lighting (fire lights and the second row as before; the second row then lights the level not at all).

## Follow-ups (not done)

- Move more lights: the four shadowed tubes' *level* light could go through the node with the shadow sampled from three's
  map — needs the atlas; the unshadowed remainder is small.
- The tube omni spill (list-only today) could return through the node for free, if the owner wants the fill back.
- The 32-light list cap can drop a far room's cheap light; watch `levelListInfo` if a level grows.
