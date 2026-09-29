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
