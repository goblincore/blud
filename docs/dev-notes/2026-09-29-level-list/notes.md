# Level materials on the shared list, cheap tier — dev note, 2026-09-29

Spec: [level-list-lighting-design](../../superpowers/specs/2026-09-29-level-list-lighting-design.md). Plan:
[level-list-lighting](../../superpowers/plans/2026-09-29-level-list-lighting.md). `?levellist=1` turns it on (needs the
list on); default off, byte-identical to before.

## Fidelity A/B ([ab-node-vs-three.png](ab-node-vs-three.png))

The Boiler Room's four second-row spots lit by three (`?row2=three`, an experiment flag) versus by the node
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
