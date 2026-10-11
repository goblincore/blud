# The Flat's Entry Hall and Bathroom Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Stop at the markers after Tasks 5, 7 and 9 and show the owner the images.

**Goal:** grow the Flat into a small apartment: an entry hall south of the room (the front door moves to it, the old south wall becomes an arch), and a bathroom east of the hall with a
claw-foot tub and hand shower, a toilet, a sink and a framed dark-glass mirror.

**Spec:** `docs/superpowers/specs/2026-10-11-flat-apartment-design.md` — read it first. Parents: `docs/superpowers/specs/2026-10-11-flat-room-design.md` and its plans
(`docs/superpowers/plans/2026-10-11-flat-room.md`, `2026-10-11-giger-imac.md`); this stacks on them (same branch `claude/flat-room`).

**Architecture:** the footprint and every shared number go in `flat_layout.py`; `flat/shell.py` is generalised (the arch code is parameterised, the long walls get a hall segment each, the vault,
impost and floor run on over the hall); two new builders, `flat/hall.py` and `flat/bath.py`, add the dressing; partitions and the filler are `solids` (collision only). The room stays one engine room
(the format's 1.4 m minimum is for doorways *between* rooms). No renderer change.

**Tech Stack:** Blender 5.2 (headless), Python 3 with Pillow and numpy, Vitest, headless-Chrome capture scripts.

## Rules for every task

- Same as the earlier Flat plans: work only in this worktree (`claude/flat-room`); never `git stash`; targeted tests only (`npx vitest run <path>`, `npm run test:changed`, `npm run typecheck`);
  headless capture only, with its own port pair (`LAB_VITE_PORT=5560 LAB_CDP_PORT=9560`, `LAB_TMP=.lab-tmp`); prove visual claims with a number and look at the images. Do not touch the dev server
  on port 5575 (the owner may be using it; it serves this worktree, so a page reload shows the latest export).
- Rebuild and look with:
  ```bash
  python3 scripts/levels/flat/make_textures.py
  blender --background --factory-startup --python scripts/levels/build_the_flat.py
  blender --background assets-source/levels/flat.blend --python scripts/levels/export_level.py -- public/assets/levels/flat.level.json
  SHOTS=1 bash scripts/sdf-game-flat-gate.sh        # shots land in .lab-tmp/flat/
  ```
- Blender space (x east, y north, z up); game space is (x, z, -y), so the hall (y -2 to 0) is game z 0 to 2. A module-level materials namespace is `MT` where a function has a local matrix called `M`; `shell.py` uses `M`.
- Exporter rules: one material per dressing object, meshes only, textures 1024 px or less. A box lower than about 0.5 m is stepped onto by the player: blockers are at least 0.6 m high.
- Caps (owner: optimise later): 60 draw primitives (40 today), **500 000 triangles (363 000 today; raised in Task 5)**; file size is not a constraint.

## Files

| Path | Responsibility |
| --- | --- |
| `scripts/levels/flat_layout.py` | modify: the footprint, the passage, the bathroom doorway, the genkan step, collision, `SOLIDS`, lights, the start |
| `scripts/levels/flat/make_textures.py`, `flat-textures.test.ts` | modify: hall wall stone, bath tile, bath floor, mirror glass |
| `scripts/levels/flat/materials.py` | modify: the new materials |
| `scripts/levels/flat/shell.py` | modify: the arch refactor, the structure |
| `scripts/levels/flat/hall.py` | create: the genkan step, hooks, cubby, sconce, conduits |
| `scripts/levels/flat/bath.py` | create: lining, floor, ceiling, doorway frame, lamp, tub, taps, toilet, sink, mirror, pipe |
| `scripts/levels/build_the_flat.py` | modify: the new builders, `solids` |
| `src/lab/sdf-zombie/webgpu/level-json.flat.test.ts` | modify: the new footprint, the start, the caps |
| `scripts/sdf-game-flat-gate.mjs` | modify: reach probes, blockers, shots |

---

## Task 1: The numbers

**Files:** modify `scripts/levels/flat_layout.py`.

- [ ] **Step 1: Add the apartment constants** after the door constants (`DX, DHW, DSP = ...`):

```python
# --- The apartment (spec 2026-10-11-flat-apartment-design.md): the flat grows south (an entry hall) and east (a bathroom) of the room.
HY0 = -2.0                                       # the hall's south wall: the front door's plane
BX1 = 3.1                                        # the bathroom's east wall
PX, PHW, PSP = DX, 0.60, 1.55                    # the passage: the room's old south wall (y 0) opens through an arch 1.2 m wide, springing at 1.55 m
BDY, BDHW, BDH = -1.1, 0.40, 1.75                # the bathroom doorway in the hall's east wall: centre y, half width, height
GENKAN_Y, GENKAN_H = -1.3, 0.08                  # the hall's floor is stepped up 8 cm north of this line
PART_T = 0.20                                    # the partition's thickness (the stone blocks are 0.16 deep; the bathroom's lining sits on the far side)
TUB = (2.66, -1.075, 0.74, 1.54)                 # the claw-foot tub: centre x, centre y, width, length
```

- [ ] **Step 2: The room box and the start**: replace `ROOM_BOX = ...` with `ROOM_BOX = ((X0, HY0, 0.0), (BX1, Y1, round(CROWN, 3)))` and `START = (0.12, -1.55, 0.0)` (in the hall, by the front door, facing north).

- [ ] **Step 3: New collision boxes and the solids.** Add to `COLLISION` (fixtures at least 0.6 m high, except the step, which is meant to be stepped onto):

```python
    "genkan": ((X0, GENKAN_Y, 0.0), (X1, -0.16, GENKAN_H)),
    "cubby": ((X0, -1.75, 0.0), (X0 + 0.32, -0.85, 0.6)),
    "tub": ((TUB[0] - TUB[2] / 2, TUB[1] - TUB[3] / 2, 0.0), (TUB[0] + TUB[2] / 2, TUB[1] + TUB[3] / 2, 0.75)),
    "toilet": ((1.64, -0.72, 0.0), (2.06, 0.0, 0.85)),
    "sink": ((1.60, -2.0, 0.0), (2.12, -1.68, 0.90)),
```
and after `COLLISION` add the walls that are not the room box's edge (collision only: the art draws them):

```python
# Solids: the walls inside the room box. The filler is the block east of the room (never seen); the partition is the hall's east wall with the bathroom doorway cut out.
SOLIDS = {
    "filler": ((X1 - 0.02, 0.0, 0.0), (BX1, Y1, round(CROWN, 3))),
    "partition_s": ((X1 - 0.02, HY0, 0.0), (X1 + PART_T, BDY - BDHW, round(CROWN, 3))),
    "partition_n": ((X1 - 0.02, BDY + BDHW, 0.0), (X1 + PART_T, 0.0, round(CROWN, 3))),
    "partition_lintel": ((X1 - 0.02, BDY - BDHW, BDH), (X1 + PART_T, BDY + BDHW, round(CROWN, 3))),
    "passage_w": ((X0, -0.16, 0.0), (PX - PHW, 0.02, round(CROWN, 3))),
    "passage_e": ((PX + PHW, -0.16, 0.0), (X1, 0.02, round(CROWN, 3))),
    "passage_lintel": ((PX - PHW, -0.16, PSP + PHW), (PX + PHW, 0.02, round(CROWN, 3))),
}
```

- [ ] **Step 4: The lights.** Append to `LIGHTS` (both `fixture: "none"`; the sconce and the bulb are art; powers are starting values):

```python
    ("hall", (X1 - 0.2, -0.45, 1.97), (1.0, 0.72, 0.42), 0.9, {"fixture": "none"}),         # the sconce by the bathroom doorway
    ("bath", (2.0, -1.0, 2.12), (0.85, 1.0, 0.82), 0.9, {"fixture": "none"}),               # a bare bulb on the bathroom ceiling
```

- [ ] **Step 5: Extend `check()`** with the apartment's invariants (add before the final `print`):

```python
    def overlaps(a, b):
        return all(a[0][i] < b[1][i] and b[0][i] < a[1][i] for i in range(3))
    for name, box in SOLIDS.items():
        assert inside(box[0], ROOM_BOX, 1e-6) and inside(box[1], ROOM_BOX, 1e-6), f"solid {name} leaves the room"
        assert not inside(START, box), f"start is inside {name}"
    bath_door = ((X1, BDY - BDHW + 0.02, 0.0), (X1 + PART_T, BDY + BDHW - 0.02, BDH - 0.02))
    passage = ((PX - PHW + 0.02, -0.16, 0.0), (PX + PHW - 0.02, 0.02, PSP))
    for name, box in {**COLLISION, **SOLIDS}.items():
        if name not in ("genkan",):
            assert not overlaps(box, bath_door), f"{name} blocks the bathroom doorway"
            assert not overlaps(box, passage), f"{name} blocks the passage"
    assert PSP + PHW + 0.2 < vault_z(PX), "the passage's arch and its surround hit the vault"
    assert -0.16 > BDY + BDHW and BDY - BDHW > HY0 + 0.2, "the bathroom doorway runs off the hall's wall"
    assert TUB[0] + TUB[2] / 2 < BX1 and TUB[1] - TUB[3] / 2 > HY0, "the tub leaves the bathroom"
    assert X1 + PART_T < TUB[0] - TUB[2] / 2 - 0.5, "the tub is too close to the doorway"
```
(`WALL_W`/`WALL_U0` for the hall walls are added in Task 2.)

- [ ] **Step 6: Run** `python3 scripts/levels/flat_layout.py` (expect `flat_layout: ok`) and commit `git commit -am "feat(flat): the apartment's numbers (hall, bathroom, passage, solids, lights, start)"`.

---

## Task 2: Textures

**Files:** modify `flat_layout.py` (the hall walls), `make_textures.py`, `flat-textures.test.ts`.

- [ ] **Step 1: The hall wall textures' numbers** in `flat_layout.py` (the hall segments of the west and east walls meet the room segments at y -0.1):

```python
WALL_W["eh"] = WALL_W["wh"] = 2.0               # the hall segments: y from HY0 - 0.1 to -0.1
WALL_U0["eh"] = WALL_U0["wh"] = HY0 - 0.1
STAINS["eh"] = [(0.8, 1.7, 0.05, 0.6, 0.7), (1.5, 0.45, 0.04, 0.4, 0.6)]
STAINS["wh"] = [(1.3, 1.9, 0.06, 0.9, 0.8)]
```
(Put these lines right after the `STAINS = {...}` dict: `HY0` is defined earlier, in the apartment constants, and `WALL_W`, `WALL_U0` and `STAINS` must already exist. `check()`'s width loop covers the new keys: a stain `u` must lie within 0 to the wall width.)

- [ ] **Step 2: The test first.** In `flat-textures.test.ts` add `'wall_eh', 'wall_wh'` to `STONES` and `'bath_tile.jpg', 'bath_floor.jpg', 'mirror_glass.jpg'` to the end of `FILES`; run it: FAIL.

- [ ] **Step 3: The generators** (before the `__main__` block of `make_textures.py`; call them from it, and add `"eh": 6, "wh": 7` to the seeds dict and `"eh", "wh"` to the wall loop):

```python
def make_bath_tile(px=1024):
    """Small square wall tiles, 10 cm each (one image is 1 m): a dingy pale green, a grey grout, grime. No damp band: the image repeats every metre."""
    n = 10
    x = (np.arange(px)[None, :] + 0.5) / px * n
    y = (np.arange(px)[:, None] + 0.5) / px * n
    fx, fy = x % 1.0, y % 1.0
    d = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    grout = np.clip(1 - d / 0.035, 0, 1)[..., None]
    rnd = np.random.default_rng(8)
    tint = (0.85 + 0.15 * rnd.random((n, n)))[np.floor(y).astype(int) % n, np.floor(x).astype(int) % n]
    base = np.array((0.42, 0.50, 0.44), np.float32) * tint[..., None] * (0.75 + 0.25 * periodic_noise(px, 6, 31))[..., None]
    col = base * (1 - grout) + grout * np.array((0.10, 0.10, 0.09), np.float32)
    save(srgb(col), "bath_tile.jpg")


def make_bath_floor(px=512):
    """The bathroom floor: 20 cm tiles in a dark, grimy checker (one image is 1 m)."""
    n = 5
    x = (np.arange(px)[None, :] + 0.5) / px * n
    y = (np.arange(px)[:, None] + 0.5) / px * n
    checker = ((np.floor(x) + np.floor(y)) % 2)[..., None]
    d = np.minimum(np.minimum(x % 1.0, 1 - x % 1.0), np.minimum(y % 1.0, 1 - y % 1.0))
    grout = np.clip(1 - d / 0.03, 0, 1)[..., None]
    base = np.array((0.07, 0.08, 0.07), np.float32) * (1 - checker) + np.array((0.15, 0.16, 0.14), np.float32) * checker
    base = base * (0.7 + 0.3 * periodic_noise(px, 8, 41))[..., None]
    save(srgb(base * (1 - grout) + grout * np.array((0.03, 0.03, 0.03), np.float32)), "bath_floor.jpg")


def make_mirror_glass(w=256, h=384):
    """The mirror's dark polished glass: a deep warm black, a vignette and two painted glints. It reflects nothing yet (the planar mirror is a later spike)."""
    yy, xx = np.mgrid[0:h, 0:w]
    u, v = xx / w, yy / h
    vig = (0.55 + 0.45 * (1 - np.clip(np.hypot((u - 0.5) * 1.5, (v - 0.5) * 1.05), 0, 1)))[..., None]
    glint = (np.exp(-((u + 0.6 * v - 0.55) / 0.08) ** 2) * 0.5 + np.exp(-((u + 0.6 * v - 0.95) / 0.03) ** 2) * 0.35)[..., None]
    col = np.array((0.014, 0.011, 0.012), np.float32) * vig + glint * np.array((0.50, 0.40, 0.32), np.float32) * 0.45
    save(srgb(col), "mirror_glass.jpg")
```

- [ ] **Step 4: Generate, look, test.** `python3 scripts/levels/flat/make_textures.py`; open `bath_tile.jpg`, `bath_floor.jpg`, `mirror_glass.jpg` (tile: pale green squares with dark grout; floor: dark checker; glass: near black with a soft diagonal glint). `npx vitest run scripts/levels/flat-textures.test.ts`: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(flat): hall wall stone, bath tile, bath floor and mirror glass textures"`.

---

## Task 3: Materials

**Files:** modify `scripts/levels/flat/materials.py` (append before `return M`).

- [ ] **Step 1:**

```python
    # the hall and the bathroom
    M.STONE_EH, M.STONE_WH = stone("stone_eh", "wall_eh"), stone("stone_wh", "wall_wh")
    M.TILE = pbr("bath_tile", (1.0, 1.0, 1.0), rough=0.3, tex="bath_tile.jpg")
    M.BATHFLOOR = pbr("bath_floor", (1.0, 1.0, 1.0), rough=0.35, tex="bath_floor.jpg")
    M.ENAMEL = pbr("enamel", (0.80, 0.80, 0.76), rough=0.12)
    M.CHROME = pbr("chrome", (0.80, 0.82, 0.85), rough=0.18, metal=0.55)          # not metal 1: the engine has no environment to reflect
    M.BRONZE = pbr("bronze", (0.55, 0.30, 0.10), rough=0.4, metal=0.7)
    M.CASTIRON = pbr("cast_iron", (0.025, 0.027, 0.03), rough=0.45, metal=0.6)
    M.MIRROR = pbr("mirror_glass", (1.0, 1.0, 1.0), rough=0.06, metal=0.4, tex="mirror_glass.jpg")
    M.BATHBULB = pbr("bath_bulb", (0.85, 1.0, 0.85), emit=(0.85, 1.0, 0.8))
```
- [ ] **Step 2:** `python3 -m py_compile scripts/levels/flat/materials.py`; rebuild (the build must still pass: the materials are not used yet). Commit `git commit -am "feat(flat): materials for the hall and the bathroom"`.

---

## Task 4: Parameterise the arch code (no geometry change)

The same arch code must build the passage and the front door. Do this refactor first, on the old room, and prove nothing moved.

**Files:** modify `scripts/levels/flat/shell.py`.

- [ ] **Step 1: Record the baseline.** Run the rebuild commands and note the glb's triangle count and primitive count (the `python3` snippet from slice 1: print `triangles` and `primitives` from the GLB JSON). Copy `.lab-tmp/flat/door.png` to `.lab-tmp/door-before.png`.
- [ ] **Step 2: Generalise.** In `shell.py`:
  1. Replace `door_region(z)` with
     ```python
     def arch_region(z, cx, hw, sp):
         """The forbidden interval along an end wall at height z for an arched opening centred on cx (half width hw, springing at sp): the window_region's twin, from the floor."""
         if z <= sp: return (cx - hw - DQB, cx + hw + DQB)
         if z <= sp + hw + DVB:
             r = math.sqrt(max(0.0, (hw + DVB) ** 2 - (z - sp) ** 2))
             r = max(r, hw + DQB) if z < sp + 0.12 else r
             return (cx - r, cx + r)
         return None
     ```
     and in `build_walls` the south wall's `holes=wall_hole_for([door_region])` becomes `holes=wall_hole_for([lambda z: arch_region(z, DX, DHW, DSP)])`.
  2. `door_surround()` becomes `arch_surround(name, cx, hw, sp, py, seed, threshold)`: every `DX` is `cx`, `DHW` is `hw`, `DSP` is `sp`, every `Y0` is `py`, the object names are `f'{name}_voussoirs'`, `f'{name}_quoins'`, `f'{name}_threshold'`;
     the voussoirs' `random.Random(19)` is `random.Random(seed)` and the quoins' `random.Random(23)` is `random.Random(seed + 4)`; the threshold box is built only `if threshold`.
  3. `door_leaf()` becomes `door_leaf(py)`: `Y0` is `py` in its first line (`yf, yb = py - 0.04, py - 0.10`) and in the `door_*` names nothing else changes (`DX, DHW, DSP` stay: it is the front door's leaf).
  4. `build_door()` becomes `build_arches()`: `arch_surround('door', DX, DHW, DSP, Y0, 19, True)` then `door_leaf(Y0)`; `build()` calls `build_arches()`.
- [ ] **Step 3: Rebuild, export, test, compare.** The triangle and primitive counts must equal the baseline exactly and `door.png` must look the same as `door-before.png` (open both). If not, the refactor changed something: fix it before going on.
  Run `npx vitest run src/lab/sdf-zombie/webgpu/level-json.flat.test.ts` and the gate (all `ok`).
- [ ] **Step 4: Commit** `git commit -am "refactor(flat): the arch code is parameterised (no geometry change)"`.

---

## Task 5: The structure: hall, passage, front door, bathroom doorway

**Files:** modify `shell.py`, `build_the_flat.py`, `level-json.flat.test.ts`, `scripts/sdf-game-flat-gate.mjs`.

- [ ] **Step 1: The test first** (`level-json.flat.test.ts`): replace the room test's size expectations with the new footprint and the start test with the hall, and raise the triangle cap:
  ```ts
    expect(+(r.maxX - r.minX).toFixed(2)).toBe(4.45);
    expect(+(r.maxZ - r.minZ).toFixed(2)).toBe(5.6);
  ```
  (the description becomes `'one art-shelled room: the main room, an entry hall and a bathroom (4.45 m by 5.6 m), under a vault about 2.56 m at the crown'`);
  the start test: `expect(lvl.playerStart.z).toBeGreaterThan(1.2); expect(lvl.playerStart.z).toBeLessThan(1.9);` (the hall is game z 0 to 2) and its title `'starts in the entry hall by the front door, facing the room (north, -z)'`;
  add `it('the walls inside the room box are solids', () => { expect(lvl.solids.length).toBeGreaterThanOrEqual(7); });` and change the triangle test to `at most 500 000` with the comment `// Raised from 400 000 (owner, 2026-10-11): the apartment; optimise later.`
  Run it: FAIL (the old export).
- [ ] **Step 2: `build_the_flat.py`:** `build_markers_lights_collision()` also creates the solids: after the `COLLISION` loop add
  `for name, (bmin, bmax) in L.SOLIDS.items(): gbox("solids", name, bmin, bmax, wire=True)`; and `assert_scene()`'s collection list gets `"solids"`.
- [ ] **Step 3: `shell.py` constants** (next to `DX, DHW, DSP = ...`): `HY0, BX1, PX, PHW, PSP = LAY.HY0, LAY.BX1, LAY.PX, LAY.PHW, LAY.PSP` and `BDY, BDHW, BDH = LAY.BDY, LAY.BDHW, LAY.BDH`.
- [ ] **Step 4: The walls.** Replace `build_walls()` with:
  ```python
  def bathdoor_region(z):
      """The bathroom doorway's forbidden interval along the hall's east wall (u is y) at height z, with a half-block margin; a lintel course stays above BDH."""
      if z <= BDH + 0.04: return (BDY - BDHW - 0.10, BDY + BDHW + 0.10)
      return None

  def build_walls():
      # the west and east walls: a hall segment (its own texture, so the stone keeps its resolution) and the room segment; they meet at y = -0.1
      ashlar('wall_wh', 'y', X0, +1, HY0 - 0.1, Y0 - 0.1, 0.0, SPRING - 0.08, 'wh', M.STONE_WH, seed=12)
      ashlar('wall_w', 'y', X0, +1, Y0 - 0.1, Y1 + 0.1, 0.0, SPRING - 0.08, 'w', M.STONE_W, holes=wall_hole_for([niche_region]), seed=2, hole_rect=(NICHE[0], NICHE[1], NICHE[2], NICHE[3]))
      ashlar('wall_eh', 'y', X1, -1, HY0 - 0.1, Y0 - 0.1, 0.0, SPRING - 0.08, 'eh', M.STONE_EH, holes=wall_hole_for([bathdoor_region]), seed=13, hole_rect=(BDY - BDHW, BDY + BDHW, 0.0, BDH))
      ashlar('wall_e', 'y', X1, -1, Y0 - 0.1, Y1 + 0.1, 0.0, SPRING - 0.08, 'e', M.STONE_E, seed=3)
      ashlar('wall_n', 'x', Y1, -1, X0 - 0.1, X1 + 0.1, 0.0, CROWN + 0.1, 'n', M.STONE_N, top=vault_z, holes=wall_hole_for([window_region]), seed=4, hole_rect=(WX - WH, WX + WH, WS - 0.1, WSP + WH))
      # the old south wall is the passage into the hall (an arch 1.2 m wide); the front door is in the hall's south wall
      ashlar('wall_s', 'x', Y0, +1, X0 - 0.1, X1 + 0.1, 0.0, CROWN + 0.1, 's', M.STONE_S, top=vault_z, holes=wall_hole_for([lambda z: arch_region(z, PX, PHW, PSP)]), seed=5, hole_rect=(PX - PHW, PX + PHW, 0.0, PSP + PHW))
      ashlar('wall_front', 'x', HY0, +1, X0 - 0.1, X1 + 0.1, 0.0, CROWN + 0.1, 's', M.STONE_S, top=vault_z, holes=wall_hole_for([lambda z: arch_region(z, DX, DHW, DSP)]), seed=14, hole_rect=(DX - DHW, DX + DHW, 0.0, DSP + DHW))
  ```
  (the `wall_e` line is the existing one: keep its exact current arguments; copy the `wall_n` line from the current file too, the above is its shape.)
- [ ] **Step 5: Extend what runs the length of the flat.**
  - `vault()`: the rings run from the hall's south wall: `Y0 - 0.12` becomes `HY0 - 0.12` and `(Y1 - Y0 + 0.24)` becomes `(Y1 - HY0 + 0.24)` in both the vertex loop and the UV line; `nx, ny = 64, 40` becomes `64, 70`.
  - `build_impost()`: the box centre `Y1 / 2` becomes `(Y1 + HY0) / 2` and the length `Y1 + 0.2` becomes `Y1 - HY0 + 0.2` (both boxes).
  - `build_ribs()`: add `rib(-1.0, seed=9)` (a stone rib over the hall).
  - `build_floor()`: `box('flagstones', (0, Y1 / 2, -0.05), (X1 - X0 + 0.3, Y1 + 0.3, 0.1), M.FLAG, uv_size=1.8)` becomes `box('flagstones', (0, (Y1 + HY0) / 2, -0.05), (X1 - X0 + 0.3, Y1 - HY0 + 0.3, 0.1), M.FLAG, uv_size=1.8)`.
  - `build_arches()` becomes: `arch_surround('passage', PX, PHW, PSP, Y0, 31, False)`, `arch_surround('door', DX, DHW, DSP, HY0, 19, True)`, `door_leaf(HY0)`.
- [ ] **Step 6: The gate.** In `sdf-game-flat-gate.mjs`:
  - add reach probes after the blockers section (a walk must get within 0.45 m of its target: the doorways are passable), using the same plumbing:
    ```js
    const REACH = {                                           // game space (x, z): the hall is z 0 to 2, the room z -3.6 to 0, the bathroom x 1.35 to 3.1
      'hall to room (through the arch)': { from: [0.12, 1.7], to: [0.12, -1.5] },
      'hall to bathroom (through the doorway)': { from: [0.5, 1.1], to: [2.1, 1.1] },
    };
    for (const [name, { from, to }] of Object.entries(REACH)) {
      await evaluate(`__sdfGame.setPose(${from[0]}, ${from[1]}, 0, 0)`);
      await evaluate(`__sdfGame.walkTo(${to[0]}, ${to[1]})`);
      await sleep(4500);
      const [px, , pz] = (await evaluate('__sdfGame.pose()')).pos;
      await evaluate('__sdfGame.walkCancel()');
      const gap = Math.hypot(px - to[0], pz - to[1]);
      if (gap > 0.45) fail(`${name}: stopped ${gap.toFixed(2)} m short of the target (a doorway is blocked?)`);
      pass(`reach: ${name} (${gap.toFixed(2)} m from the target)`);
    }
    ```
  - add shots to `CAMS`: `hall: [[0.12, -1.75], [0.12, 1.5, 1.5]], door2: [[0.12, -0.3], [0.12, -2.0, 1.3]], bathdoor: [[0.3, -1.1], [2.2, -1.1, 1.1]]` (the hall from the front door; the front door from the passage; the bathroom doorway from the hall).
- [ ] **Step 7: Rebuild, export, test, gate.** Expected: the level test passes (footprint, start, 7+ solids, caps); the gate: every old `ok`, the two `reach` lines `ok`. Fix any blocked doorway (the layout's `check()` should already prevent it).
- [ ] **Step 8: Look.** Open `hall.png`, `door2.png`, `bathdoor.png`, `wide.png`. Expected: a stone hall under the vault with the front door at its end; the room seen through the arch; the bathroom doorway with its stone surround (empty, no bathroom lining yet: you will see the unfinished bathroom's void through it: that is expected until Task 6).
  Check the old south wall's arch reads (voussoirs and quoins on the hall side) and the room itself is unchanged in `wide.png`.
- [ ] **Step 9: Commit** `git add -A && git commit -m "feat(flat): the entry hall, the arched passage, the front door moved, the bathroom doorway"` and **STOP**: show the owner the shots.

---

## Task 6: The bathroom's shell

**Files:** create `scripts/levels/flat/bath.py`; modify `build_the_flat.py`.

- [ ] **Step 1: The module.**

```python
# scripts/levels/flat/bath.py
"""The bathroom (spec 2026-10-11-flat-apartment-design.md): tile-lined walls, a tile floor and a flat ceiling, a wooden architrave on the doorway, a bare bulb;
the fixtures are added below (Task 7). Interior: x from X1 + PART_T to BX1, y from HY0 to 0, z up to 2.3. Run inside Blender."""
import math

import bmesh
from mathutils import Vector  # noqa: F401

import flat_layout as LAY
from flat import common as C
from flat.common import box, cyl, obj_from_bm, sphere, torus, tube  # noqa: F401
from flat.giger import vertebral

X1, BX1, HY0, BDY, BDHW, BDH, PART_T = LAY.X1, LAY.BX1, LAY.HY0, LAY.BDY, LAY.BDHW, LAY.BDH, LAY.PART_T
BX0 = X1 + PART_T                 # the bathroom's west plane: the lining sits on the partition's far side
CEIL = 2.3
MT = None                         # the materials namespace, set by build()


def lining():
    cx, cy = (BX0 + BX1) / 2, (HY0 + 0.0) / 2
    w = BX1 - BX0
    box('bath_floor', (cx, cy, -0.02), (w, -HY0, 0.04), MT.BATHFLOOR, uv_size=1.0)
    box('bath_ceiling', (cx, cy, CEIL + 0.02), (w, -HY0, 0.04), MT.TILE, uv_size=1.0)
    box('bath_wall_n', (cx, -0.015, CEIL / 2), (w, 0.03, CEIL), MT.TILE, uv_size=1.0)
    box('bath_wall_s', (cx, HY0 + 0.015, CEIL / 2), (w, 0.03, CEIL), MT.TILE, uv_size=1.0)
    box('bath_wall_e', (BX1 - 0.015, cy, CEIL / 2), (0.03, -HY0, CEIL), MT.TILE, uv_size=1.0)
    # the partition's lining: two pieces and a lintel round the doorway, and reveals on the doorway's sides (the partition is 0.2 deep)
    wx = BX0 + 0.015
    south_len = (BDY - BDHW) - HY0
    box('bath_wall_w_s', (wx, HY0 + south_len / 2, CEIL / 2), (0.03, south_len, CEIL), MT.TILE, uv_size=1.0)
    north_len = 0.0 - (BDY + BDHW)
    box('bath_wall_w_n', (wx, (BDY + BDHW) + north_len / 2, CEIL / 2), (0.03, north_len, CEIL), MT.TILE, uv_size=1.0)
    box('bath_wall_w_lintel', (wx, BDY, (BDH + CEIL) / 2), (0.03, 2 * BDHW, CEIL - BDH), MT.TILE, uv_size=1.0)
    for sy, nm in ((-1, 's'), (1, 'n')):
        box(f'bath_reveal_{nm}', ((X1 + BX0) / 2, BDY + sy * (BDHW - 0.015), BDH / 2), (PART_T, 0.03, BDH), MT.OAK, uv_size=1.0)


def architrave():
    """A plain wooden frame round the doorway, on the hall side of the partition."""
    x = X1 - 0.02
    for sy, nm in ((-1, 's'), (1, 'n')):
        box(f'frame_{nm}', (x, BDY + sy * (BDHW + 0.035), BDH / 2 + 0.03), (0.04, 0.07, BDH + 0.06), MT.OAK, bevel=0.008)
    box('frame_top', (x, BDY, BDH + 0.065), (0.05, 2 * BDHW + 0.14, 0.09), MT.OAK, bevel=0.01)


def lamp():
    """A bare bulb on a cord from the ceiling (the light is in flat_layout.LIGHTS)."""
    cx, cy, z = 2.0, -1.0, 2.12
    tube('bath_cord', [(cx, cy, CEIL), (cx, cy, z + 0.12)], [0.004, 0.004], MT.IRON, res=2, res_u=2)
    cyl('bath_socket', (cx, cy, z + 0.08), 0.018, 0.06, MT.IRON, verts=10)
    sphere('bath_bulb', (cx, cy, z), 0.04, MT.BATHBULB, seg=12)


def build(m):
    global MT
    MT = m
    lining()
    architrave()
    lamp()
```
- [ ] **Step 2: Wire it** in `build_the_flat.py`: `from flat import bath, giger, imac, props, shell` and `bath.build(M)` after `imac.build(M)`.
- [ ] **Step 3: Rebuild, export, test, gate with shots.** Add a `bath` shot to the gate's `CAMS`: `bath: [[1.65, -1.1], [2.8, -1.1, 0.9]]` (from just inside the doorway toward the tub's end). Open `bathdoor.png` and `bath.png`: a tiled bathroom with a dark checker floor, a bare bulb, the oak frame. Primitives stay under 60.
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat(flat): the bathroom's shell (tile lining, floor, ceiling, doorway frame, bulb)"`.

---

## Task 7: The bathroom's fixtures

**Files:** modify `scripts/levels/flat/bath.py`, `scripts/sdf-game-flat-gate.mjs`.

- [ ] **Step 1: Helpers and the tub** (add to `bath.py`, above `build`):

```python
def rr_loop(cx, cy, w, l, r, n=6):
    """A rounded rectangle's points (counter-clockwise) in the xy plane."""
    pts = []
    for qx, qy, a0 in ((w / 2 - r, l / 2 - r, 0), (-w / 2 + r, l / 2 - r, 90), (-w / 2 + r, -l / 2 + r, 180), (w / 2 - r, -l / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + qx + math.cos(a) * r, cy + qy + math.sin(a) * r))
    return pts


def loft(name, rings, material, cap_first=False, cap_last=False):
    """A closed or open shell through rings = [(z, [(x, y), ...]), ...] (the same point count in each)."""
    bm = bmesh.new()
    verts = [[bm.verts.new((x, y, z)) for x, y in pts] for z, pts in rings]
    m = len(rings[0][1])
    for a, b in zip(verts, verts[1:]):
        for i in range(m):
            bm.faces.new((a[i], a[(i + 1) % m], b[(i + 1) % m], b[i]))
    if cap_first:
        bm.faces.new(verts[0])
    if cap_last:
        bm.faces.new(list(reversed(verts[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, material, smooth=True)


def claw_tub():
    """A cast-iron tub (dark outside, white enamel inside and on the rim) on four bone-and-bronze claws."""
    cx, cy, W, Ln = LAY.TUB

    def ring(z, inset):
        return (z, rr_loop(cx, cy, W - 2 * inset, Ln - 2 * inset, max(0.34 - inset, 0.05)))

    loft('tub_outer', [ring(0.20, 0.07), ring(0.27, 0.02), ring(0.40, 0.0), ring(0.62, 0.0), ring(0.74, 0.012)], MT.CASTIRON, cap_first=True)
    loft('tub_inner', [ring(0.74, 0.012), ring(0.755, 0.05), ring(0.70, 0.065), ring(0.36, 0.10), ring(0.27, 0.15)], MT.ENAMEL, cap_last=True)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = cx + sx * (W / 2 - 0.12), cy + sy * (Ln / 2 - 0.22)
            tube(f'tub_claw{sx}{sy}', [(x, y, 0.26), (x + sx * 0.03, y + sy * 0.03, 0.14), (x + sx * 0.07, y + sy * 0.08, 0.05)], [0.032, 0.026, 0.02], MT.BONE, res=3, res_u=4)
            sphere(f'tub_ball{sx}{sy}', (x + sx * 0.075, y + sy * 0.085, 0.04), 0.038, MT.BRONZE, seg=12)
            cyl(f'tub_talon{sx}{sy}', (x + sx * 0.075, y + sy * 0.135, 0.045), 0.018, 0.07, MT.BONE, r2=0.0, rot=(-sy * math.pi / 2, 0, 0), verts=8)


def taps_and_shower():
    """Freestanding supply pipes at the tub's south end: two handles, a spout, a riser with a hand shower; a chrome curtain ring overhead (no curtain yet)."""
    cx, cy, W, Ln = LAY.TUB
    y0 = cy - Ln / 2 - 0.09                                   # the pipes stand just beyond the tub's end
    tube('shower_riser', [(cx, y0, 0.02), (cx, y0, 0.90), (cx, y0, 1.50), (cx, y0 + 0.07, 1.62), (cx, y0 + 0.23, 1.62)], [0.014] * 5, MT.CHROME, res=3, res_u=6)
    cyl('shower_head', (cx, y0 + 0.27, 1.60), 0.065, 0.02, MT.CHROME, rot=(0.35, 0, 0), verts=20)
    tube('tub_spout', [(cx, y0, 0.88), (cx, y0 + 0.03, 0.93), (cx, y0 + 0.10, 0.93), (cx, y0 + 0.12, 0.84)], [0.012] * 4, MT.CHROME, res=3, res_u=6)
    for sx in (-1, 1):
        sphere(f'tap_handle{sx}', (cx + sx * 0.08, y0, 0.93), 0.02, MT.CHROME, seg=10)
    torus('curtain_ring', (cx, cy, 1.95), 0.5, 0.007, MT.CHROME, scale=(0.86, 1.7, 1.0))
    for i, (hx, hy) in enumerate(((0.43, 0.0), (-0.43, 0.0), (0.0, 0.85), (0.0, -0.85))):
        tube(f'ring_hanger{i}', [(cx + hx, cy + hy, 1.95), (cx + hx, cy + hy, CEIL)], [0.004, 0.004], MT.CHROME, res=2, res_u=2)
```

- [ ] **Step 2: Toilet, sink, mirror, pipe** (add to `bath.py`):

```python
def toilet(cx=1.85):
    box('toilet_tank', (cx, -0.12, 0.62), (0.38, 0.20, 0.38), MT.ENAMEL, bevel=0.03)
    box('toilet_lid', (cx, -0.12, 0.825), (0.40, 0.22, 0.03), MT.ENAMEL, bevel=0.012)
    box('toilet_bowl', (cx, -0.40, 0.20), (0.34, 0.56, 0.40), MT.ENAMEL, bevel=0.12)      # a heavily bevelled block reads as a rounded bowl
    seat = cyl('toilet_seat', (cx, -0.42, 0.405), 0.20, 0.03, MT.OAK, verts=32)
    seat.scale = (0.92, 1.25, 1.0)
    hole = cyl('toilet_hole', (cx, -0.43, 0.422), 0.13, 0.005, MT.DARKGLASS, verts=24)
    hole.scale = (0.9, 1.3, 1.0)
    cyl('toilet_flush', (cx + 0.14, -0.12, 0.85), 0.012, 0.05, MT.CHROME, verts=8)


def sink(cx=1.86):
    cyl('sink_pedestal', (cx, -1.88, 0.38), 0.07, 0.76, MT.ENAMEL, verts=20)
    box('sink_basin', (cx, -1.84, 0.82), (0.50, 0.34, 0.14), MT.ENAMEL, bevel=0.07)
    box('sink_back', (cx, -1.975, 0.95), (0.50, 0.03, 0.12), MT.ENAMEL, bevel=0.01)
    tube('sink_spout', [(cx, -1.94, 0.90), (cx, -1.91, 1.0), (cx, -1.84, 1.0), (cx, -1.82, 0.93)], [0.01] * 4, MT.CHROME, res=3, res_u=6)
    for sx in (-1, 1):
        sphere(f'sink_handle{sx}', (cx + sx * 0.09, -1.93, 0.93), 0.016, MT.CHROME, seg=10)


def mirror(cx=1.86, cz=1.5):
    """A stone-and-bone frame round a dark polished glass on the south wall, facing north. The glass reflects nothing yet (the planar mirror is a later spike)."""
    w, h, y = 0.46, 0.62, HY0 + 0.03
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    pts = [(cx - w / 2, cz - h / 2), (cx - w / 2, cz + h / 2), (cx + w / 2, cz + h / 2), (cx + w / 2, cz - h / 2)]
    f = bm.faces.new([bm.verts.new((x, y + 0.002, z)) for x, z in pts])
    for l, uv in zip(f.loops, ((0, 0), (0, 1), (1, 1), (1, 0))):
        l[uvl].uv = uv
    obj_from_bm('mirror_glass', bm, MT.MIRROR, uv_size=0)
    for sx in (-1, 1):
        box(f'mirror_frame_side{sx}', (cx + sx * (w / 2 + 0.03), y + 0.012, cz), (0.06, 0.03, h + 0.12), MT.STONE_DARK, bevel=0.008)
    for sz, nm in ((-1, 'b'), (1, 't')):
        box(f'mirror_frame_{nm}', (cx, y + 0.012, cz + sz * (h / 2 + 0.03)), (w + 0.12, 0.03, 0.06), MT.STONE_DARK, bevel=0.008)
    for sx in (-1, 1):
        sphere(f'mirror_stud{sx}', (cx + sx * (w / 2 + 0.03), y + 0.03, cz + h / 2 + 0.03), 0.014, MT.BONE, scale=(1, 1.2, 1), seg=10)


def pipe_run():
    """A Giger pipe down the north-east corner into the tub, with a flesh collar where it meets the ceiling."""
    vertebral('bath_pipe', [(3.06, -0.20, CEIL - 0.02), (3.07, -0.23, 1.5), (3.05, -0.27, 0.95)], 0.03, lambda p: Vector((-1, 0, 0)), collar=((3.06, -0.2, CEIL - 0.05), (0, 0, -1)))
```
  and extend `build()` to call `claw_tub()`, `taps_and_shower()`, `toilet()`, `sink()`, `mirror()`, `pipe_run()` after `lamp()`.

- [ ] **Step 3: The gate.** Add `tub`, `toilet` and `sink` to `BLOCKERS` (game space; the footprints are the layout's collision boxes with z = -y):
  ```js
    tub: { from: [1.75, 1.1], to: [2.8, 1.1], box: { x0: 2.29, x1: 3.03, z0: 0.305, z1: 1.845 } },
    toilet: { from: [1.85, 1.3], to: [1.85, 0.2], box: { x0: 1.64, x1: 2.06, z0: 0.0, z1: 0.72 } },
    sink: { from: [1.85, 0.9], to: [1.85, 1.9], box: { x0: 1.60, x1: 2.12, z0: 1.68, z1: 2.0 } },
  ```
  and shots: `tub: [[1.7, -0.9], [2.66, -1.4, 0.6]], mirror: [[1.75, -0.8], [1.86, -2.0, 1.5]], toilet: [[2.4, -1.4], [1.85, -0.2, 0.7]]`.
- [ ] **Step 4: Rebuild, export, test, gate.** All blockers `ok`; the level test passes (60 primitives, 500 000 triangles; if over, name the heaviest primitives and lower the tub's `rr_loop` `n` from 6 to 4 or the claws' `res`).
- [ ] **Step 5: Look.** Open `tub.png`, `mirror.png`, `toilet.png`, `bath.png`. Expected: a claw-foot tub (dark outside, white inside) on claws; the shower riser at its south end and the ring overhead; the toilet against the north wall; the pedestal sink under a framed dark mirror; the pipe in the corner. If the tub's inside is dark or the enamel is blown out, adjust `ENAMEL`'s colour or the bulb's power (`bath` light) and look again.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(flat): the bathroom's fixtures (claw-foot tub with a hand shower, toilet, sink, framed mirror, pipe run)"` and **STOP**: show the owner the bathroom.

---

## Task 8: The hall's dressing

**Files:** create `scripts/levels/flat/hall.py`; modify `build_the_flat.py`.

- [ ] **Step 1: The module.**

```python
# scripts/levels/flat/hall.py
"""The entry hall's dressing: the genkan step, coat hooks, a shoe cubby with slippers, a wall sconce, and two vertebral conduits on the vault. Run inside Blender."""
import math

from mathutils import Vector  # noqa: F401

import flat_layout as LAY
from flat import common as C
from flat.common import box, cyl, sphere, tube  # noqa: F401
from flat.giger import vertebral

X0, X1, HY0, GENKAN_Y, GENKAN_H = LAY.X0, LAY.X1, LAY.HY0, LAY.GENKAN_Y, LAY.GENKAN_H
vault_z = LAY.vault_z
MT = None


def genkan():
    """The hall's floor, stepped up 8 cm north of GENKAN_Y (the collider is in the layout, so the player really steps up)."""
    box('genkan_step', (0, GENKAN_Y / 2 - 0.08, GENKAN_H / 2), (X1 - X0, -GENKAN_Y - 0.16, GENKAN_H), MT.STONE_DARK, bevel=0.01, uv_size=1.0)


def hooks():
    box('hook_rail', (X0 + 0.04, -0.95, 1.55), (0.04, 0.9, 0.09), MT.OAK, bevel=0.006)
    for k in range(4):
        cyl(f'hook{k}', (X0 + 0.11, -1.28 + k * 0.22, 1.55), 0.012, 0.10, MT.BONE, r2=0.004, rot=(0, math.pi / 2, 0), verts=8)      # a spur into the hall


def cubby():
    x0, x1, y0, y1 = X0, X0 + 0.32, -1.75, -0.85
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box('cubby_top', (cx, cy, 0.36), (x1 - x0, y1 - y0, 0.03), MT.OAK, bevel=0.005)
    box('cubby_mid', (cx, cy, 0.18), (x1 - x0 - 0.02, y1 - y0 - 0.02, 0.02), MT.OAK)
    for i, yy in enumerate((y0 + 0.01, cy, y1 - 0.01)):
        box(f'cubby_side{i}', (cx, yy, 0.18), (x1 - x0, 0.02, 0.36), MT.OAK)
    for k, y in enumerate((-1.45, -1.12)):                                                  # a pair of slippers on each shelf
        box(f'slipper{k}', (cx + 0.02, y, 0.215), (0.22, 0.10, 0.06), MT.FLESH, bevel=0.025)
        box(f'slipper_b{k}', (cx + 0.02, y, 0.395), (0.22, 0.10, 0.06), MT.LIPS, bevel=0.025)


def sconce():
    """A wall lamp by the bathroom doorway (the light is in flat_layout.LIGHTS)."""
    tube('sconce_arm', [(X1 - 0.01, -0.45, 1.80), (X1 - 0.08, -0.45, 1.84), (X1 - 0.16, -0.45, 1.92)], [0.01] * 3, MT.IRON, res=3, res_u=4)
    cyl('sconce_cup', (X1 - 0.17, -0.45, 1.93), 0.04, 0.04, MT.IRON, r2=0.055, verts=12)
    sphere('sconce_glass', (X1 - 0.17, -0.45, 1.99), 0.045, MT.BULBS[2], seg=12)


def conduits():
    """The room's two vault conduits run on over the hall to its south wall."""
    for sx, x in ((-1, -0.62), (1, 0.58)):
        z = vault_z(x) - 0.09
        pts = [(x, HY0 - 0.1, z), (x, HY0 + 0.4, z), (x, -0.9, z - 0.075), (x, -0.3, z), (x, 0.0, z)]
        vertebral(f'hall_conduit{sx}', pts, 0.032, lambda p: Vector((0, 0, -1)))


def build(m):
    global MT
    MT = m
    genkan()
    hooks()
    cubby()
    sconce()
    conduits()
```
- [ ] **Step 2: Wire it** (`from flat import bath, giger, hall, imac, props, shell`; `hall.build(M)` after `bath.build(M)`).
- [ ] **Step 3: Rebuild, export, test, gate with shots; open `hall.png`.** Expected: the hall with the step near the passage, hooks and a cubby on the west wall, the sconce by the bathroom doorway, conduits on the vault. The hooks are on the wall's inner side (x = X0 + ...): if they float inside the wall, check the wall blocks' protrusion and move them 1 cm.
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat(flat): the entry hall's dressing (genkan step, hooks, cubby, sconce, conduits)"`.

---

## Task 9: Look, light, compare, document

**Files:** modify `flat_layout.py` (powers), notes, task pages.

- [ ] **Step 1: Look at the whole apartment** (`hall.png`, `door2.png`, `bathdoor.png`, `bath.png`, `tub.png`, `mirror.png`, `toilet.png`, `wide.png`). Tune only: the `hall` and `bath` light powers (start 0.9; try 0.5 to 1.6), `ENAMEL` and `TILE` colours, and the bulb. Re-shoot after each change. Note the final values.
- [ ] **Step 2: Frame cost.** Run the gate three times; the frame must stay under 33.3 ms.
- [ ] **Step 3: The sheet and notes.** Compose `docs/dev-notes/2026-10-11-flat-room/apartment.jpg` from six shots (a 3 × 2 grid of 640 × 480: `hall`, `door2`, `bathdoor`, `bath`, `tub`, `mirror`) and append an "## Update: the entry hall and the bathroom" section to `docs/dev-notes/2026-10-11-flat-room/NOTES.md`:
  the plan view (from the spec), the numbers (primitives, triangles, frame), what the doorways and the step do, the mirror (dark glass, no reflection; the planar mirror is a spike) and the dropped door leaf, and the vision's discarded face rule.
  Update `TASKS.md`, `docs/tasks/levels.md` (4o) and the spec's Status line; check `wc -l` before and after each edit.
- [ ] **Step 4: Verify and commit.** `python3 scripts/levels/flat_layout.py && npm run typecheck && npm run test:changed`; then `git add -A && git commit -m "feat(flat): the apartment: tuned, with the sheet and notes"`.
- [ ] **Step 5: STOP.** Show the owner `apartment.jpg` and the numbers; ask whether to push the new commits to PR #45.

---

## Self-review (the plan's author, 2026-10-11)

- **Spec coverage:** §2 the plan view and the passage, the front door and the doorway: Tasks 1 and 5; §3 hall and bathroom contents: Tasks 7 and 8; §4 units: Tasks 1 to 8 (every unit in the spec's table has a task); §5 budget and the light-count check: the caps in the rules, Task 5 (test) and Task 9 (frame); the light list holds 32 (checked while writing) so about 10 lights fit; §6 follow-ups: Task 9's notes.
- **Known soft spots:** the tub is built from lofts and the toilet from bevelled boxes (a first pass, to be judged by eye); the claws are three primitives each; the hall's east wall has two textures (the hall segment and the room segment) that meet at y -0.1 with slightly different stone; the lining panels are one-sided thin boxes (the outside of the bathroom is the void and unreachable);
  the bathroom doorway has no leaf (the spec says why); the mirror's glass is a painted texture.
- **Placeholders:** none; the structural edits name the exact lines and give the code.
