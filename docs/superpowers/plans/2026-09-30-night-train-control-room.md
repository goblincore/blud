# Night Train Control Room (ending plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Night Train's 3.0 × 8 m cab becomes an **8.0 × 10.0 m control room** (CRT wall, consoles, racks, a firebox door, cable trays) holding a **placeholder egg** on a plinth, and the level still completes when the player reaches the egg.

**Spec:** `docs/superpowers/specs/2026-09-30-night-train-egg-ending-design.md` (§1, §5, §7 build step 1) — read it first. Blockout renders and the `.blend` are in `docs/dev-notes/2026-09-30-egg-ending/`.

**Architecture:** The level pipeline is unchanged: `night_train_layout.py` (tables) → `build_night_train.py` (headless Blender, kit pieces linked from `kit.blend`) → `export_level.py` (level JSON + art GLB). This plan adds seven kit pieces and a few flat materials to `build_train_kit.py`, swaps the cab's table for a control-room table, teaches the build script about the new room, then repoints the tests and gates that hard-code the cab. The Boiler Room's 8.0 × 3.4 m bay pieces (`bay-*-80-34`) are reused for the shell, so no new shell sizes are needed.

**Tech Stack:** Python 3 + Blender 5.2 (`/opt/homebrew/bin/blender`, headless), TypeScript + Vitest, Node headless-Chrome gates (`scripts/*.sh`).

**Scope (this plan only):** the room and a placeholder egg. **Not here:** the egg's WGSL look, the pulse, `egg.touch`, the sequence system, the montage (spec §7 steps 2–5). The completion trigger stays the existing `level.end` (current "LEVEL COMPLETE" overlay); plan 3 renames it to `egg.touch`.

---

## Rules for every task

- **Port-ready by construction** (release is a Rust + wgpu port): this plan touches no game logic; rendering of the egg is deferred to plan 2 (hand-written WGSL).
- Work ONLY in this worktree (`.claude/worktrees/train-monitor-transition-51f385`). Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npx vitest run <file>`) plus `npx tsc --noEmit` if a `.ts` file outside tests changes (none should). Never the bare full suite.
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Gates use `scripts/*.sh`; in a sandbox `export LAB_TMP=.lab-tmp`. Never kill a server you did not start.
- **Prove visual and performance claims with a number** (draw calls, frame ms from the gate) and look at the images yourself.
- Build the kit **in place** (default `--out`): a kit saved elsewhere keeps texture paths relative to that folder and the exported GLB loses its textures.
- Extracted Blood assets are dev placeholders — never commit them (not relevant here).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Room frame (used by every table below)

Carriage frame: x across (−4.0 west … +4.0 east), **u** along from the south door (0) to the north wall (10.0). Game z = `zs − u`, with `zs = −130.4` (the tender's vestibule ends there), so the room spans **z −130.4 … −140.4**. The egg is at **u 6.3** (z −136.7), x 0.

| Thing | Frame | Notes |
| --- | --- | --- |
| West consoles (5) | x −4.0…−3.2, u centres 1.8, 3.3, 4.8, 7.6, 8.8 (each 1.2 long) | `crt-console-<colour>` |
| East consoles (4) | x 3.2…4.0, u centres 1.8, 3.3, 4.8, 7.6 | the firebox takes the north end |
| Racks (2) | x ∓(3.3…4.0), u 5.6…7.0 | `server-rack` |
| Firebox door | x 3.6…4.0, u 8.25…9.55 | `firebox-door`, east wall |
| CRT wall | x −3.4…3.4, u 9.5…10.0 | `crt-wall`, north wall |
| Egg + plinth | x −1.2…1.2, u 5.1…7.5, collision height 2.9 | `egg-plinth` + `egg-placeholder` |
| Cable trays | x ±1.6, u 0.6…9.4 | art only |
| Lamp | one ceiling tube (`moods=["dying"]`) | `lamps()` needs exactly `round(L/8) = 1` mood |
| Fires | egg light (0, u 6.3, y 1.5, power 4.0); firebox (3.3, u 8.9, y 1.0, power 4.0) | `fires` entries are `(id, x, u, y, power)` |
| Completion trigger | x −1.6…1.6, u 4.7…7.9, event `level.end` | replaces the cab's trigger |

The clear aisle between the consoles (x ±3.2) and the plinth (±1.2) is 2.0 m, above the 1.4 m enemy-navigation minimum.

---

## Task 0: Baseline — prove the pipeline reproduces the committed level

**Files:** none changed.

- [ ] **Step 1: Make a scratch folder and rebuild the level unchanged**

```bash
mkdir -p .lab-tmp
blender --background --factory-startup --python scripts/levels/build_night_train.py -- --out .lab-tmp/baseline.blend
blender --background .lab-tmp/baseline.blend --python scripts/levels/export_level.py -- .lab-tmp/baseline.level.json
```

Expected: `saved …/baseline.blend: NNN kit pieces`, then the exporter prints its summary without errors.

- [ ] **Step 2: Diff against the committed JSON**

```bash
diff .lab-tmp/baseline.level.json public/assets/levels/night-train.level.json && echo SAME
```

Expected: `SAME`. If it differs, **stop** and report the diff: the later diffs could not be attributed to this plan. (The exporter writes `baseline.art.glb` next to the JSON; ignore it.)

- [ ] **Step 3: Record the baseline cost**

```bash
export LAB_TMP=.lab-tmp
bash scripts/sdf-game-train-gate.sh 2>&1 | tee .lab-tmp/train-gate-before.txt | tail -20
```

Expected: `PASS sdf-game-train-gate`. Keep the per-pose draw-call and frame-ms table; Task 3 compares against it. No commit.

---

## Task 1: Kit — materials and seven pieces

**Files:**
- Modify: `scripts/levels/build_train_kit.py` (materials block at ~line 360, new piece functions after `cab_shell`, the `pieces` list in `main()`)
- Create: `scripts/levels/check_control_room_kit.py` (the test for this task)
- Regenerate: `assets-source/levels/kit.blend`

- [ ] **Step 1: Write the check script (the failing test)**

Create `scripts/levels/check_control_room_kit.py`:

```python
# scripts/levels/check_control_room_kit.py
"""Checks the control-room kit pieces exist and have sane sizes.

    blender --background assets-source/levels/kit.blend --python scripts/levels/check_control_room_kit.py

Game axes: Blender (x, y, z) = game (x, -z, y), so a piece's game size is (dx, dz', dy') = (bx, bz, by).
Each entry is (name, (dx_min, dx_max), (dy_min, dy_max), (dz_min, dz_max)) in game metres.
"""
import sys

import bpy
import mathutils

EXPECT = [
    ("crt-console-green", (0.75, 0.85), (1.40, 1.50), (1.15, 1.25)),
    ("crt-console-amber", (0.75, 0.85), (1.40, 1.50), (1.15, 1.25)),
    ("crt-console-cyan", (0.75, 0.85), (1.40, 1.50), (1.15, 1.25)),
    ("server-rack", (0.70, 0.80), (2.35, 2.45), (1.35, 1.45)),
    ("crt-wall", (6.7, 6.9), (2.6, 2.75), (0.65, 0.75)),
    ("firebox-door", (0.40, 0.48), (1.75, 1.85), (1.25, 1.35)),
    ("egg-plinth", (2.6, 6.6), (1.25, 1.35), (2.6, 6.6)),
    ("egg-placeholder", (1.7, 2.2), (2.4, 2.7), (1.7, 2.2)),
    ("cable-tray-34", (0.55, 0.65), (0.05, 0.15), (0.95, 1.05)),
    ("end-wall-blank-80-34", (7.9, 8.1), (3.3, 3.5), (0.0, 0.01)),
]
MATERIALS = ["train.beige", "train.crt-green", "train.crt-amber", "train.crt-cyan", "train.crt-dim", "train.egg"]

bad = []
for name in MATERIALS:
    if name not in bpy.data.materials:
        bad.append(f"material {name} missing")
for name, rx, ry, rz in EXPECT:
    coll = bpy.data.collections.get(name)
    if coll is None or not coll.all_objects:
        bad.append(f"piece {name} missing")
        continue
    pts = [o.matrix_world @ mathutils.Vector(c) for o in coll.all_objects for c in o.bound_box]
    size = [max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3)]
    dx, dy, dz = size[0], size[2], size[1]
    for label, val, (lo, hi) in (("dx", dx, rx), ("dy", dy, ry), ("dz", dz, rz)):
        if not lo <= val <= hi:
            bad.append(f"{name}.{label} = {val:.3f} outside {lo}..{hi}")
if bad:
    print("FAIL check_control_room_kit:\n  " + "\n  ".join(bad))
    sys.exit(1)
print(f"PASS check_control_room_kit: {len(EXPECT)} pieces, {len(MATERIALS)} materials")
```

- [ ] **Step 2: Run it against the current kit — it must fail**

```bash
blender --background assets-source/levels/kit.blend --python scripts/levels/check_control_room_kit.py 2>&1 | tail -15
```

Expected: `FAIL check_control_room_kit:` listing every piece and material as missing. (Blender exits non-zero via `sys.exit(1)`.)

- [ ] **Step 3: Add the flat materials**

In `scripts/levels/build_train_kit.py`, the loop in `final_materials()` that starts `for name, rgb, strength in (("train.lamp", …` currently lists `train.lamp`, `train.firebox`, `train.led`. Replace that tuple with:

```python
    for name, rgb, strength in (("train.lamp", (1.0, 0.78, 0.5), LAMP_STRENGTH), ("train.firebox", (1.0, 0.42, 0.1), 1.0),
                                 ("train.led", (1.0, 0.12, 0.05), 1.0),
                                 # Control room (egg ending plan 1): beige plastic, CRT screens, the placeholder egg.
                                 ("train.beige", (0.42, 0.38, 0.29), 0.0),
                                 ("train.crt-green", (0.1, 1.0, 0.3), 1.0), ("train.crt-amber", (1.0, 0.65, 0.15), 1.0),
                                 ("train.crt-cyan", (0.25, 0.9, 0.8), 0.8), ("train.crt-dim", (0.55, 0.75, 0.6), 0.5),
                                 ("train.egg", (0.85, 0.88, 0.82), 0.35)):
```

The loop body is unchanged (base colour = emission colour = `rgb`, emission strength = `strength`), so `train.beige` (strength 0) is an unlit plastic.

- [ ] **Step 4: Add the piece functions**

In `build_train_kit.py`, directly **after** the `cab_shell()` function (and before the `# ---- the second pass` comment), add:

```python
# ---- the control room (egg ending plan 1) ---------------------------------------------------
#
# Wall pieces: origin on the wall plane (x = 0 for a side wall, the room on +x; turn PI for the
# east wall). The CRT wall is modelled like an end wall: at z = 0, the room on the -z side; turn
# PI at the north wall. Floor pieces: origin at the floor centre.

BEIGE = "train.beige"


def crt_console(color):
    """A console against a side wall: steel desk, sloped panel, a beige CRT facing +x with a lit
    screen, a keyboard. 0.8 m deep (x), 1.2 m long (z), 1.45 m high."""
    p = Piece(f"crt-console-{color}")
    p.box(S, (0.0, 0.0, -0.6), (0.8, 0.9, 0.6))
    p.box(SX, (0.05, 0.9, -0.55), (0.6, 0.98, 0.55))
    p.box(BEIGE, (0.1, 0.98, -0.28), (0.6, 1.45, 0.28))
    p.wall_x(f"train.crt-{color}", 0.601, 1, -0.22, 0.22, 1.06, 1.38)
    p.box(BEIGE, (0.62, 0.98, -0.25), (0.78, 1.01, 0.25))
    return p


def server_rack():
    """A tall rack against a side wall, 0.7 m deep, 1.4 m long, 2.4 m high, with a row of LEDs."""
    p = Piece("server-rack")
    p.box(S, (0.0, 0.0, -0.7), (0.7, 2.4, 0.7))
    p.box(SX, (0.7, 0.05, -0.62), (0.72, 2.35, 0.62))
    for i in range(8):
        y = 0.5 + 0.22 * i
        p.box("train.led" if i % 3 == 0 else "train.crt-green", (0.72, y, -0.5), (0.74, y + 0.04, -0.4))
        p.box("train.crt-amber" if i % 2 else "train.crt-cyan", (0.72, y, 0.3), (0.74, y + 0.04, 0.45))
    return p


def crt_wall():
    """The north wall: a base and a grid of beige CRTs (9 across; the bottom and middle rows skip the
    three centre columns), each with a screen, and one big monitor between them. 6.8 m wide."""
    p = Piece("crt-wall")
    screens = ["train.crt-green", "train.crt-amber", "train.crt-cyan", S, "train.crt-green", "train.crt-cyan", "train.crt-amber"]
    p.box(S, (-3.4, 0.0, -0.5), (3.4, 0.57, 0.0))
    k = 0
    for r in range(3):
        for c in range(-4, 5):
            if r < 2 and c in (-1, 0, 1):
                continue
            x, y = c * 0.72, 0.9 + r * 0.72
            p.box(BEIGE, (x - 0.33, y - 0.33, -0.5), (x + 0.33, y + 0.33, 0.0))
            p.wall_z(screens[k % len(screens)], -0.501, -1, x - 0.26, x + 0.26, y - 0.26, y + 0.26)
            k += 1
    p.box(BEIGE, (-1.05, 0.6, -0.7), (1.05, 1.95, 0.0))
    p.wall_z("train.crt-dim", -0.701, -1, -0.85, 0.85, 0.78, 1.77)   # the big monitor, dimly lit
    return p


def firebox_door():
    """The engine's firebox in the east wall: a rusted frame and an orange door. 0.4 m deep, 1.3 m long."""
    p = Piece("firebox-door")
    p.box("train.rust", (0.0, 0.0, -0.65), (0.4, 1.8, 0.65))
    p.wall_x("train.firebox", 0.401, 1, -0.45, 0.45, 0.3, 1.3)
    p.box(BR, (0.4, 0.25, -0.5), (0.44, 0.3, 0.5))
    p.box(BR, (0.4, 1.3, -0.5), (0.44, 1.35, 0.5))
    return p


def egg_plinth():
    """The egg's plinth (a plate, a rusted drum, six clamps) and 14 cables running out across the floor."""
    p = Piece("egg-plinth")
    p.box(PL, (-1.3, 0.0, -1.3), (1.3, 0.16, 1.3))
    p.cyl("train.rust", (0.0, 0.16, 0.0), "y", 0.24, 1.25, 16, r_end=1.0)
    for i in range(6):
        a = 2 * math.pi * i / 6 + 0.3
        p.cyl(SX, (math.cos(a), 0.4, math.sin(a)), "y", 0.9, 0.07, 8, r_end=0.04)
    for i in range(14):
        a = 2 * math.pi * i / 14 + 0.17
        reach = 2.2 + 0.5 * (i % 3)
        p.tube("train.rubber", [(0.6 * math.cos(a), 0.45, 0.6 * math.sin(a)), (1.6 * math.cos(a), 0.06, 1.6 * math.sin(a)),
                                (reach * math.cos(a), 0.04, reach * math.sin(a))], 0.04)
    return p


def egg_placeholder():
    """A milky ellipsoid standing on the plinth (0.95 m semi-axes across, 1.3 m high, narrower at the top).
    A stand-in: plan 2 replaces it with the WGSL egg."""
    p = Piece("egg-placeholder")
    n, layers = 16, 12
    rings = []
    for j in range(layers + 1):
        th = math.pi * (0.04 + 0.92 * j / layers)
        k = 1.0 - 0.12 * math.cos(th)
        r, y = 0.95 * k * math.sin(th), 1.6 + 1.3 * math.cos(th)
        rings.append([(r * math.cos(2 * math.pi * i / n), y, r * math.sin(2 * math.pi * i / n)) for i in range(n)])
    p.loft("train.egg", rings)
    return p


def cable_tray(height):
    """A ceiling cable tray, 0.6 m wide, 1 m long (stretch it along z), hung 0.55 m under the ceiling."""
    p = Piece(f"cable-tray-{dm(height)}")
    y = height - 0.55
    p.box(SX, (-0.3, y, -1.0), (0.3, y + 0.05, 0.0))
    p.box(S, (-0.3, y, -1.0), (-0.27, y + 0.12, 0.0))
    p.box(S, (0.27, y, -1.0), (0.3, y + 0.12, 0.0))
    return p


def end_wall_blank(width, height):
    """A plain bulkhead at a carriage's SOUTH end (z = 0), facing north (-z), no door. Turn it PI for a
    dead-end north wall."""
    W = width / 2
    p = Piece(f"end-wall-blank-{dm(width)}-{dm(height)}")
    p.wall_z(PL, 0, -1, -W, W, 0, DADO)
    p.wall_z(S, 0, -1, -W, W, DADO, height)
    return p
```

- [ ] **Step 5: Register the pieces in `main()`**

In `main()`, the `pieces = [ … ]` list ends with the line `third_bench(), coat_rack(), counter(), dj_deck(), disco_ball(), piston(), steam_vent(), coal_heap(), shovel(),`. Append, before the closing `]`:

```python
        *[crt_console(c) for c in ("green", "amber", "cyan")], server_rack(), crt_wall(), firebox_door(),
        egg_plinth(), egg_placeholder(), cable_tray(3.4), end_wall_blank(8.0, 3.4),
```

- [ ] **Step 6: Rebuild the kit in place**

```bash
blender --background --factory-startup --python scripts/levels/build_train_kit.py 2>&1 | tail -5
git status --short assets-source/levels | head
```

Expected: `saved …/kit.blend: NNN pieces` (7 + 3 + 1 more than before). If `git status` shows **modified PNGs** under `assets-source/levels/kit-textures/` (the bake is not guaranteed byte-stable), restore them so the commit only carries the intended change:

```bash
git checkout -- assets-source/levels/kit-textures
```

- [ ] **Step 7: Run the check — it must pass**

```bash
blender --background assets-source/levels/kit.blend --python scripts/levels/check_control_room_kit.py 2>&1 | tail -5
```

Expected: `PASS check_control_room_kit: 10 pieces, 6 materials`. If a size is outside its range, fix the piece (the ranges come from the piece code above; a real mismatch means a typo), not the range.

- [ ] **Step 8: Look at the pieces**

```bash
blender --background --factory-startup --python scripts/levels/build_train_kit.py -- --out .lab-tmp/kit-look.blend --renders .lab-tmp/kit-look --render-only crt-console-green,server-rack,crt-wall,firebox-door,egg-plinth,egg-placeholder,cable-tray-34
```

Open the PNGs in `.lab-tmp/kit-look/`. Check: screens face the room side (+x, or −z for the wall), the egg stands on the plinth, nothing is inside-out. (Kit built to a scratch path here only for the look; the in-place build in Step 6 is the one that is committed.)

- [ ] **Step 9: Commit**

```bash
git add scripts/levels/build_train_kit.py scripts/levels/check_control_room_kit.py assets-source/levels/kit.blend
git commit -m "feat(kit): control-room pieces (CRT consoles, rack, CRT wall, firebox door, egg plinth + placeholder, tray, blank end wall)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Level — the table, the build script, and the level test

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts` (test first)
- Modify: `scripts/levels/night_train_layout.py` (the cab table, lines ~136-141)
- Modify: `scripts/levels/build_night_train.py`
- Regenerate: `assets-source/levels/night-train.blend`, `public/assets/levels/night-train.level.json`, `public/assets/levels/night-train.art.glb`

- [ ] **Step 1: Update the level test first**

In `src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts`:

1. Line ~18: change the last entry of `ORDER` from `'cab'` to `'control-room'`.
2. The widths assertion: change the trailing `3.4, 3.0]` to `3.4, 8.0]`.
3. The heights assertion: change the trailing `3.4, 2.6, 2.6]` to `3.4, 2.6, 3.4]`.
4. The test title `'starts in the guard\'s van facing the cab'` → `'starts in the guard\'s van facing the control room'`.
5. In the nav `points` record replace `'cab': [0, 0, z('cab', 5)],` with:

```ts
      'control room, door': [0, 0, z('control-room', 2)],
      'control room, west of the egg': [-2.2, 0, z('control-room', 6.3)],
      'control room, east of the egg': [2.2, 0, z('control-room', 6.3)],
      'control room, before the CRT wall': [0, 0, z('control-room', 8.8)],
```

6. In the moods test replace `expect(moods('cab')).toEqual(expect.arrayContaining(['steady', 'fire']));` with `expect(moods('control-room')).toEqual(expect.arrayContaining(['dying', 'fire']));`.
7. Add a new test inside the first `describe`, after the "enemy navigation" test:

```ts
  it('the control room: 8 x 10 m, no enemies, the egg in the middle, completion at the egg', () => {
    const r = room('control-room');
    expect(r.id).toBe(8);
    expect([r.minX, r.maxX, r.minZ, r.maxZ].map(v => +v.toFixed(2))).toEqual([-4, 4, -140.4, -130.4]);
    expect(t.spawns.filter(s => roomAtPoint(t, s.pos[0], s.pos[2])?.name === 'control-room')).toHaveLength(0);
    // The egg and plinth: one collision box 2.4 m square, taller than the player, centred on z -136.7.
    const egg = t.furniture.filter(f => f.room === r.id).find(f => Math.abs(f.minX + 1.2) < 1e-6 && Math.abs(f.maxX - 1.2) < 1e-6);
    expect(egg).toBeDefined();
    expect(egg!.height).toBeGreaterThan(2.8);
    expect((egg!.minZ + egg!.maxZ) / 2).toBeCloseTo(-136.7, 1);
    // Completion: the existing level.end trigger, now a 3.2 m box around the egg.
    const end = t.triggers.find(tr => tr.event === 'level.end')!;
    expect(end.box.min[0]).toBeCloseTo(-1.6, 2);
    expect(end.box.max[0]).toBeCloseTo(1.6, 2);
    expect(roomAtPoint(t, 0, (end.box.min[2] + end.box.max[2]) / 2)?.name).toBe('control-room');
  });
```

(`FurnitureDef` is `{ room, minX, maxX, minZ, maxZ, height }` and `TriggerDef` is `{ id, event, once, box: { min, max } }` — see `game-level.ts` / `level-def.ts`. If the parser leaves `room` unset for authored levels, filter by `f.minZ >= r.minZ - 1e-6 && f.maxZ <= r.maxZ + 1e-6` instead.)

- [ ] **Step 2: Run the test — it must fail**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts 2>&1 | tail -25
```

Expected: FAIL (the committed JSON still has the `cab`).

- [ ] **Step 3: Replace the cab's table**

In `scripts/levels/night_train_layout.py`, replace the whole `dict(rid=8, name="cab", …)` entry (the last element of `CARRIAGES`) with:

```python
    # Control room (egg ending plan 1, spec 2026-09-30): the old 3 x 8 m cab becomes an 8 x 10 m room,
    # "bigger on the inside". CRT wall on the north, consoles and racks down both sides, the firebox door
    # in the east wall, the egg on its plinth at u 6.3. Completion stays level.end until plan 3 (egg.touch).
    dict(rid=8, name="control-room", w=8.0, L=10.0, h=3.4,
         walls=[],
         areas=[("control room: the egg on its plinth", -4.0, 4.0, 0, 10.0)],
         props=[*[("console", -4.0, -3.2, u - 0.6, u + 0.6, 1.0) for u in (1.8, 3.3, 4.8, 7.6, 8.8)],
                *[("console", 3.2, 4.0, u - 0.6, u + 0.6, 1.0) for u in (1.8, 3.3, 4.8, 7.6)],
                ("rack", -4.0, -3.3, 5.6, 7.0, 2.4), ("rack", 3.3, 4.0, 5.6, 7.0, 2.4),
                ("firebox", 3.6, 4.0, 8.25, 9.55, 1.8),
                ("egg", -1.2, 1.2, 5.1, 7.5, 2.9),
                ("crt wall", -3.4, 3.4, 9.5, 10.0, 2.4)],
         spawns=[], pickups=[], gates=[], moods=["dying"],
         fires=[("egg", 0.0, 6.3, 1.5, 4.0), ("firebox", 3.3, 8.9, 1.0, 4.0)],
         triggers=[("end", COMPLETE_ON, -1.6, 1.6, 4.7, 7.9)]),
```

Also update the comment above `COMPLETE_ON` from `# The level ends at the firebox (the Stoker comes later); the CD is a collectible.` to `# The level ends at the egg in the control room (ending plan 1); the CD is a collectible.`

- [ ] **Step 4: Teach the build script about the room**

In `scripts/levels/build_night_train.py`:

(a) In `prop()`, add branches **before** the final `elif label != "backhead":` (keep the existing first `if label == "trunks"` chain intact; the new ones are more `elif`s):

```python
    elif label == "console":   # against a side wall, its screen facing the room; colours cycle with n
        west = xc < 0
        put(f"crt-console-{('green', 'amber', 'cyan')[n % 3]}", -w2 if west else w2, 0, zc, 0.0 if west else PI)
    elif label == "rack":
        west = xc < 0
        put("server-rack", -w2 if west else w2, 0, zc, 0.0 if west else PI)
    elif label == "firebox":   # east wall
        put("firebox-door", w2, 0, zc, PI)
    elif label == "egg":
        put("egg-plinth", xc, 0, zc)
        put("egg-placeholder", xc, 0, zc)
    elif label == "crt wall":   # modelled like a south end wall; turned for the north wall
        put("crt-wall", 0, 0, g(u1), PI)
```

(b) In `carriage()`, replace the `if name == "cab": put("cab-shell", 0, 0, zs)` / `else:` split. The simplest edit: delete the two lines

```python
    if name == "cab":
        put("cab-shell", 0, 0, zs)
    else:
```

and **de-indent** the whole former `else:` body by one level (it becomes the function's normal flow). Then make these four changes inside that body:

```python
            windowed = name not in ("guards-van", "tender", "control-room") or (name == "guards-van" and b in (1, 4))
```

```python
            if b % 2 == 0 and name != "control-room":   # valves and gauges would sit behind the consoles
                fit = "valve" if b % 4 == 0 else "gauges"
                put(fit, -w2, 0, z0 - BAY / 2)
                put(fit, w2, 0, z0 - BAY / 2, PI)
```

(i.e. add `and name != "control-room"` to the existing `if b % 2 == 0:` that guards the industrial dressing), and for the two end walls:

```python
        put(end_piece, 0, 0, zs)
        if name == "control-room":   # a dead end: no door on the north wall
            put(f"end-wall-blank-{dm(w)}-{dm(h)}", 0, 0, g(L), PI)
        else:
            put(end_piece, 0, 0, g(L), PI)
        if w >= 4.0 and name != "control-room":   # exposed gears on each bulkhead (not behind the CRT wall)
            put("gear-housing", -(w2 - 0.6), 1.5, zs - 0.01, PI / 2)
            put("gear-housing", -(w2 - 0.6), 1.5, g(L) + 0.01, -PI / 2)
```

(replacing the existing `put(end_piece, 0, 0, zs)` / `put(end_piece, 0, 0, g(L), PI)` pair and the existing `if w >= 4.0:` block).

(c) Cable trays: directly after the boilers block (`if name in boilers: … gbox("furniture", f"boiler:{rid}" …)`), add:

```python
    if name == "control-room":   # two trays down the ceiling, clear of the centre pipe
        for x in (-1.6, 1.6):
            put("cable-tray-34", x, 0, g(0.6), 0.0, 8.8)
```

(d) Change `if name in ("tender", "cab"):` (the shovel) to `if name == "tender":` and its inner expression `g(1.2 if name == "tender" else 3.0)` to `g(1.2)`.

- [ ] **Step 5: Build, export, test**

```bash
blender --background --factory-startup --python scripts/levels/build_night_train.py 2>&1 | tail -4
blender --background assets-source/levels/night-train.blend --python scripts/levels/export_level.py -- public/assets/levels/night-train.level.json 2>&1 | tail -6
npx vitest run src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts 2>&1 | tail -15
```

Expected: `saved …/night-train.blend: NNN kit pieces` (a `KeyError` here means a piece name in `prop()` does not match the kit; fix the name), the exporter finishes without errors, and the vitest file passes (all tests, including the new one). If the nav test fails for a control-room point, check that no furniture box overlaps the aisle (table above) before touching the point.

- [ ] **Step 6: Check the JSON diff is only the control room**

```bash
git diff --stat public/assets/levels/night-train.level.json
git diff public/assets/levels/night-train.level.json | grep '^[-+]' | grep -c '"name"'
```

Expected: the diff touches room 8 (name `cab` → `control-room`, bounds −4…4 × −140.4…−130.4, height 3.4), its furniture, lights, and the `end` trigger; **nothing south of z −130.4 changes**. Confirm: `git diff public/assets/levels/night-train.level.json | grep -E '^[-+].*-1[0-2][0-9]\.'` shows only lines belonging to the tender's vestibule region or later (the tender is unchanged). If anything in rooms 1-7 changed, stop and find out why.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts scripts/levels/night_train_layout.py scripts/levels/build_night_train.py \
  assets-source/levels/night-train.blend public/assets/levels/night-train.level.json public/assets/levels/night-train.art.glb
git commit -m "feat(level): Night Train cab becomes an 8 x 10 m control room with a placeholder egg

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Gates — repoint the cab coordinates and measure the cost

**Files:**
- Modify: `scripts/sdf-game-train-gate.mjs` (route, final room check, header, a cost pose)
- Modify: `scripts/sdf-game-loop-gate.mjs` (section 5)

- [ ] **Step 1: Train gate — the walk and the room check**

In `scripts/sdf-game-train-gate.mjs`:

1. Header line 8: `van to cab.` → `van to control room.`
2. In `ROUTE`, replace `['vestibule 7', 0, -129.8], ['cab', 0, -134.0],` with:

```js
  ['vestibule 7', 0, -129.8], ['control room, door', 0, -132.0], ['control room, east aisle', 2.6, -134.5],
  ['control room, before the CRT wall', 2.6, -138.8],
```

(the waypoints keep outside the completion box x ±1.6 around the egg, so the walk does not end the level.)
3. Replace `if ((await evaluate('__sdfGame.room()')) !== 'cab') fail('walk ended outside the cab');` with `if ((await evaluate('__sdfGame.room()')) !== 'control-room') fail('walk ended outside the control room');` and the next `pass(...)` text `…to the cab` → `…to the control room`.
4. In `POSES`, add `control: [0, -131.4, 0, 0],` after `boiler: [0, -90.9, 0, 0]`. (Facing north from the door: the egg and the CRT wall in view.)

- [ ] **Step 2: Loop gate — completion at the egg**

In `scripts/sdf-game-loop-gate.mjs`, section 5: replace the comment and the pose:

```js
// 5. COMPLETE — reaching the egg in the control room (the `level.end` trigger, a 3.2 m box around
//    the egg: x -1.6..1.6, z -135.1 .. -138.3; ending plan 1, 2026-09-30).
if (!(await boot('level=night-train&frozen&nospawn&god'))) fail('night-train (god) did not boot');
await evaluate('__sdfGame.setPose(0, -135.3, 0, 0)');
```

and change the two messages `'reaching the firebox did not complete the level'` → `'reaching the egg did not complete the level'`, `'complete: reaching the firebox ends the level'` → `'complete: reaching the egg ends the level'`; line 9's header `5. COMPLETE: reaching the firebox in the cab ends the level.` → `5. COMPLETE: reaching the egg in the control room ends the level.` (The trigger box spans z −135.1…−138.3 and the plinth z −135.5…−137.9, so z −135.3 is inside the box, in the 0.4 m strip in front of the plinth. If `setPose` refuses because the position collides, use −135.2.)

- [ ] **Step 3: Run both gates**

```bash
export LAB_TMP=.lab-tmp
bash scripts/sdf-game-loop-gate.sh 2>&1 | tail -15
bash scripts/sdf-game-train-gate.sh 2>&1 | tee .lab-tmp/train-gate-after.txt | tail -25
```

Expected: `PASS sdf-game-loop-gate` and `PASS sdf-game-train-gate`. The train gate fails on budget by design if any pose exceeds `BUDGET`; if the **new `control` pose** is over, do not raise the budget yourself: report the numbers (draw calls and ms, before vs. after) to the owner and stop. A failure in the walk means a waypoint sits inside furniture: move the waypoint, not the furniture.

- [ ] **Step 4: Compare the cost with the baseline**

```bash
diff <(grep -E '^(office|third|dining|coats|sleeper|boiler) ' .lab-tmp/train-gate-before.txt) <(grep -E '^(office|third|dining|coats|sleeper|boiler) ' .lab-tmp/train-gate-after.txt)
grep '^control' .lab-tmp/train-gate-after.txt
```

Expected: the old poses within noise (frame times ±1.3 ms; the draw calls identical because nothing south of the tender changed). Keep the `control` line for the notes.

- [ ] **Step 5: Commit**

```bash
git add scripts/sdf-game-train-gate.mjs scripts/sdf-game-loop-gate.mjs
git commit -m "test(gates): train and loop gates walk to and complete at the control-room egg

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Look review, other gates, and docs

**Files:**
- Create: `docs/dev-notes/2026-09-30-egg-ending/plan1-notes.md`, `docs/dev-notes/2026-09-30-egg-ending/control-room-ingame.png`
- Modify: `docs/game/levels/01-night-train/layout.md`, `docs/tasks/levels.md`, `TASKS.md`
- Regenerate: the layout drawing referenced by `layout.md` (`layout-draft3.png` or a new `layout-draft4.png`)

- [ ] **Step 1: Look at it in the game**

The train gate's `shoot('train-control')` writes a PNG per pose (find the output folder in `shoot()` in the gate; it is printed as `shot …` in the run). Open `train-control.png` and compare with `docs/dev-notes/2026-09-30-egg-ending/control-room-door.png`. Check and record:

- the egg is centred and reads as a large milky ellipsoid on the plinth;
- the CRT wall is on the north wall with a lit big monitor; screens are lit, consoles line both sides;
- the firebox door glows on the east wall's north end and is not overlapped by a console;
- the cable trays are visible under the ceiling and **not buried in the arch** (if they are, lower `y` in `cable_tray()` by 0.1 and rebuild Tasks 1–2);
- the room is dim with warm pools (egg and firebox lights) and one flickering tube; nothing is pure black or blown out.

Copy the image to `docs/dev-notes/2026-09-30-egg-ending/control-room-ingame.png`.

- [ ] **Step 2: Other gates that could be affected**

```bash
export LAB_TMP=.lab-tmp
bash scripts/sdf-game-light-gate.sh 2>&1 | tail -8
bash scripts/sdf-disco-check.sh 2>&1 | tail -5
```

Expected: both PASS (they work in earlier rooms; the control room changes only the far end). If `light-gate` fails on a pose with z ≤ −130, fix the pose; anything else, stop and report.

- [ ] **Step 3: Update the layout doc and regenerate the drawing**

```bash
python3 scripts/levels/night_train_layout.py --svg .lab-tmp/night-train-layout.svg
rsvg-convert .lab-tmp/night-train-layout.svg -o docs/game/levels/01-night-train/layout-draft3.png
```

In `docs/game/levels/01-night-train/layout.md`: replace the "Cab" row of the carriage table (line ~69) with `| 8 | Control room | 8.0 × 10 m | 3.4 m | CRT wall (north), consoles and racks down both sides, the firebox door (east, north end), the egg on its plinth at u 6.3 — [ending spec](../../../superpowers/specs/2026-09-30-night-train-egg-ending-design.md) |`; change the z line's `cab −76.8…−84.8` to note the current layout (`control room −130.4…−140.4 after the Boiler Room resize`); line ~29 `**cab** (the level ends at the firebox until the Stoker exists)` → `**control room** (the level ends at the egg; the Stoker and the dawn are later)`; lines ~88 and ~100 (`Cab | the Stoker`, `**Cab:** the Stoker's back…`) → control-room wording (the Stoker stays "later"; the room holds the egg and the firebox glow).

- [ ] **Step 4: Write the notes**

Create `docs/dev-notes/2026-09-30-egg-ending/plan1-notes.md` with: what was built (Tasks 1-3, commit hashes from `git log --oneline -4`), the train-gate `control` pose line (draw calls and ms, art on vs off), the before/after rows for the old poses, what the in-game image shows against the blockout, and the open items (the egg is a placeholder; lighting is a first pass; the trays' clearance result; consoles' CRT screens are static emissive colours).

- [ ] **Step 5: Update the task board**

- `docs/tasks/levels.md`, item 4n: change its start to `- [~] 4n **Ending: control room, egg, montage**` and append: `**Plan 1 done** ([plan](../../docs/superpowers/plans/2026-09-30-night-train-control-room.md), [notes](../../docs/dev-notes/2026-09-30-egg-ending/plan1-notes.md)): the cab is an 8 × 10 m control room with a placeholder egg; the level completes at the egg (level.end box). Next: plan 2 (the egg pass).`
- `TASKS.md`, the ending bullet: replace `**Next:** owner review of the spec, then plan 1 (the room).` with `**Plan 1 (the room) built; next: plan 2, the egg pass (WGSL).**`

- [ ] **Step 6: Commit**

```bash
git add docs/dev-notes/2026-09-30-egg-ending docs/game/levels/01-night-train docs/tasks/levels.md TASKS.md
git commit -m "docs(night-train): control room built (plan 1) — notes, layout, task board

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (run by the plan's author, 2026-09-30)

- **Spec coverage.** §1 (room, consoles, CRT wall, firebox, lights, no enemies) → Tasks 1-2. §5 (changes to the level, tests and gates) → Tasks 2-3. §7 step 1 (room with a placeholder egg, gate walks to it) → Tasks 1-3. The spec's `egg.touch`, `completeOn ending.end`, pulse, WGSL egg and `nav` point are **deliberately later** (plans 2-4); this plan keeps `level.end` so the level still ends.
- **Placeholders.** None: every code step shows the code; values that need judgement in the real scene (tray height, the gate pose) carry an explicit check and fallback.
- **Names.** `control-room` (room name), `crt-console-<green|amber|cyan>`, `server-rack`, `crt-wall`, `firebox-door`, `egg-plinth`, `egg-placeholder`, `cable-tray-34`, `end-wall-blank-80-34`, materials `train.beige|crt-green|crt-amber|crt-cyan|crt-dim|egg` are used identically in the kit, the check script, `prop()`, and the tests.
- **Risks.** The kit rebuild may rewrite texture PNGs (Task 1 step 6 restores them); a fresh kit does not reproduce the committed GLB byte for byte, so Task 2's GLB diff is not meaningful, only the JSON diff is; the cost of the room has not been measured until Task 3.
