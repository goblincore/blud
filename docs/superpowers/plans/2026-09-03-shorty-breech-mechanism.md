# Shorty Breech Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sawed-off's break-open reload show a real mechanism — hollow chambers with shells sitting in them, cases that extract straight out of the tilted bores, a working extractor and top lever.

**Architecture:** Three layers, each independently testable. The **model script** (headless Blender) grows hollow chambers and six new named nodes. The **view-model** (`game-viewmodel.ts`, pure numbers, no Three.js) owns the retimed beat sheet and three new curve functions. The **runtime** (`game-main.ts`) stops using hardcoded positions and drives the GLB's named nodes, reading breech locators every frame so the eject origin follows the hinge for free.

**Tech Stack:** Python + Blender 5.2 (`bpy`, `bmesh`) for the model; TypeScript + Three.js for the runtime; Vitest for unit tests; a headless CDP gate (`scripts/sdf-game-shorty-gate.mjs`) for the in-game check.

**Spec:** [`docs/superpowers/specs/2026-09-03-shorty-breech-mechanism-design.md`](../specs/2026-09-03-shorty-breech-mechanism-design.md)

---

## Axis conventions — read this before touching any coordinate

Getting these wrong is the single most likely way to waste an hour.

**Blender space** (what `scripts/model_grapeshot_shorty.py` works in): origin at the grip, **muzzles down −Y**, **Z up**, **+y is REARWARD**.

**`cyl()` / `tube()` build along local Z.** Every barrel part is placed with `rot=(RY,0,0)` where `RY = math.pi/2`. That rotation maps **local +Z → world −Y**, so:
- local `+d/2` is the **FORWARD (muzzle)** end
- local `−d/2` is the **REARWARD (breech)** end

**Blender → glTF** with `export_yup=True` maps `(x, y, z) → (x, z, −y)`. So:
- Blender −Y (muzzle direction) → **glTF +Z**
- Blender +Z (up) → glTF +Y

**In the runtime**, `gunGroup.rotation.y = Math.PI` then turns glTF +Z into the camera's −Z (forward). But `Shell_*` and `Extractor` are driven in **local GLB space, inside `Barrels`**, so for them:

> **Sliding a shell out of the breech is `position.z -= travel`.** Larger z is closer to the muzzle.

**Key Y landmarks** (Blender space), all defined in Task 1:

| landmark | y |
| --- | --- |
| muzzle | −0.318 |
| barrel tube rear end | −0.109 |
| forcing cone | −0.109 … −0.101 |
| chamber floor (`CY0`) | −0.101 |
| **breech face (`CY1`)** | **−0.031** |
| hinge pin | −0.070 |

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `scripts/model_grapeshot_shorty.py` | builds + gates `shorty-double.glb` | modify — hollow chambers, 6 new nodes, raycast gate |
| `src/lab/sdf-zombie/webgpu/game-viewmodel.ts` | reload timing, pure numbers | modify — retimed beats, 3 new functions |
| `src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts` | unit tests for the above | modify — retimed expectations, new describes |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | Three.js runtime | modify — node wiring, two-stage eject |
| `public/assets/lab/shorty-double.glb` | the shipped model | regenerated artifact |
| `docs/dev-notes/2026-09-03-shorty-breech/` | before/after renders | add after-renders |

No new files. The view-model already has the right boundary (numbers vs. renderer) and this work does not strain it.

---

## Task 1: Hollow the chambers

The core defect. `chamber{i}` is built with `cyl()`, which caps both ends.

**Files:**
- Modify: `scripts/model_grapeshot_shorty.py` — barrel block at `:236-247`, breech-face block at `:288-297`, gate at `:489-523`

- [ ] **Step 1: Add the `taper_tube` helper**

Insert immediately after the existing `tube()` function (which ends at `:143`, just before `def outline_normals`):

```python
def taper_tube(ro, ri_front, ri_back, d, segs=32):
    """Tube of constant OUTER radius whose INNER radius differs end to end.

    This is the forcing cone: the chamber's mouth is wider than the bore, and a
    real barrel tapers between them rather than presenting a flat shoulder.

    Local axis is Z. Placed with rot=(RY,0,0), local +Z points down -Y in world
    space -- i.e. toward the MUZZLE -- so `ri_front` is the radius at +d/2.
    """
    bm = bmesh.new()
    def ri_at(z):
        t = (z + d/2) / d              # 0 at the back, 1 at the front
        return ri_back + (ri_front - ri_back) * t
    for i in range(segs):
        a0 = 2*math.pi*i/segs; a1 = 2*math.pi*(i+1)/segs
        zb, zf = -d/2, d/2
        rb, rf = ri_at(zb), ri_at(zf)
        # outer wall
        bm.faces.new([bm.verts.new((ro*math.cos(a), ro*math.sin(a), z))
                      for a, z in ((a0, zb), (a1, zb), (a1, zf), (a0, zf))])
        # inner wall, wound the other way so it faces into the bore
        bm.faces.new([bm.verts.new((r*math.cos(a), r*math.sin(a), z))
                      for a, z, r in ((a0, zb, rb), (a1, zb, rb),
                                      (a1, zf, rf), (a0, zf, rf))][::-1])
        # annular end caps
        for z, r, flip in ((zb, rb, False), (zf, rf, True)):
            v = [bm.verts.new((rr*math.cos(a), rr*math.sin(a), z))
                 for rr, a in ((ro, a0), (ro, a1), (r, a1), (r, a0))]
            bm.faces.new(v[::-1] if flip else v)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('tt'); bm.to_mesh(me); bm.free(); return me
```

- [ ] **Step 2: Replace the barrel block with chamber-aware landmarks**

Replace lines `236-247` (the whole `# ---------------- barrels ----------------` block through the `bead` line) with:

```python
# ---------------- barrels ----------------
# The chamber is a real, hollow, 70 mm sleeve because our shell is 70 mm long.
# The previous build used cyl() -- capped at both ends -- so breaking the action
# open showed two solid domed knobs where the mouths should be.
RO, RI, XSEP = 0.0225, 0.0166, 0.0234
RCH  = RI * 1.10             # chamber bore, wider than the barrel bore
CY1  = -0.031                # THE BREECH FACE. Everything breech-y lives here.
CHAMBER_DEPTH = 0.070        # set by our shell length, not by realism
CY0  = CY1 - CHAMBER_DEPTH   # -0.101, chamber floor
CONE_LEN  = 0.008
BY_BACK   = CY0 - CONE_LEN   # -0.109, barrel tube's rear end
BY_MUZZLE = -0.318           # unchanged: game-main's MUZZLE_LOCAL depends on it
BLEN = BY_BACK - BY_MUZZLE   # 0.209
BMID = (BY_MUZZLE + BY_BACK) / 2
for i,x in enumerate((-XSEP,XSEP)):
    put(tube(RO,RI,BLEN),f'barrel{i}','Blue',loc=(x,BMID,0),rot=(RY,0,0),bevel=0.0012,smooth=True)
    put(tube(RO*1.09,RI,0.012),f'crown{i}','Steel',loc=(x,BY_MUZZLE+0.006,0),rot=(RY,0,0),
        bevel=0.0016,smooth=True)
    # Forcing cone: chamber mouth (RCH) tapering down to the bore (RI).
    put(taper_tube(RO,RI,RCH,CONE_LEN),f'cone{i}','Bore',
        loc=(x,(BY_BACK+CY0)/2,0),rot=(RY,0,0),bevel=0,smooth=True)
    # Dark plug. Starts at the cone's front so the open breech reads as DEPTH
    # rather than a lit tube wall, and stops short of the muzzle so looking down
    # the bores from the front still has somewhere to look into.
    put(cyl(RI*0.99,0.121),f'bore{i}','Bore',loc=(x,-0.1695,0),rot=(RY,0,0),bevel=0,smooth=True)
# The rib runs the full barrel assembly, breech to muzzle.
put(box(XSEP*2.0,(CY1-BY_MUZZLE)*0.94,0.010),'rib_top','Blue',
    loc=(0,(BY_MUZZLE+CY1)/2,RO*0.62),bevel=0.0016,segs=2)
put(cyl(0.0042,0.0075,14),'bead','Brass',loc=(0,BY_MUZZLE+0.010,RO*0.62+0.006),bevel=0,smooth=True)
```

- [ ] **Step 3: Rebuild the breech face at the right end of the part**

Replace lines `288-297` — the `# breech face: chamber mouths + extractor rim` block, from the `for i,x in enumerate((-XSEP,XSEP)):` line down to and including the `toplever` `put(...)` call — with:

```python
# THE BREECH FACE, at y = CY1. The previous build put the mouths and the
# extractor at y ~ -0.066 -- the chamber's FRONT, 35 mm away, buried inside the
# frame beside the hinge pin, where they were never once visible.
for i,x in enumerate((-XSEP,XSEP)):
    put(tube(RO*1.07,RCH,CHAMBER_DEPTH),f'chamber{i}','Steel',
        loc=(x,(CY0+CY1)/2,0),rot=(RY,0,0),bevel=0.0022,smooth=True)
    # A machined rim at the mouth. Steel, not 'Bore': the darkness now comes
    # from the real hole behind it rather than from painting a disc black.
    put(tube(RO*1.07,RCH,0.004),f'mouth{i}','Steel',
        loc=(x,CY1-0.002,0),rot=(RY,0,0),bevel=0,smooth=True)
put(box(0.052,0.007,0.016),'extractor','Steel',loc=(0,CY1+0.0035,0),bevel=0.0018)
for sx in (-1,1):
    put(cyl(0.0092,0.009,20),'hinge','Brass',loc=(sx*0.040,-0.070,-0.016),rot=(0,RY,0),
        bevel=0.0014,smooth=True)
put(box(0.011,0.038,0.0055),'toplever','Steel',loc=(0,0.032,0.0228),rot=(0,0,math.radians(9)),
    bevel=0.0022,segs=3)
```

- [ ] **Step 4: Add the hollowness raycast to the gate**

This is the check that would have caught `cyl()` where `tube()` was meant. Add this function immediately before `size = export_glb(OUT_GLB)` (currently `:507`):

```python
def verify_bores_hollow():
    """Cast a ray down each bore from just behind the breech face.

    A solid chamber stops the ray within a couple of millimetres. A hollow one
    lets it run at least the chamber's depth before the forcing cone or the
    dark plug catches it. Shells are hidden for the cast -- we are asking about
    the STEEL, not about what is loaded into it.
    """
    hidden = []
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name.split('.')[0].startswith('shell'):
            hidden.append((o, o.hide_viewport))
            o.hide_viewport = True
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    bad = []
    for x in (-XSEP, XSEP):
        origin = Vector((x, CY1 + 0.005, 0.0))
        hit, loc, _n, _idx, obj, _m = bpy.context.scene.ray_cast(
            dg, origin, Vector((0.0, -1.0, 0.0)))
        dist = (loc - origin).length if hit else float('inf')
        if dist < CHAMBER_DEPTH:
            bad.append((x, round(dist, 5), obj.name if obj else None))
    for o, v in hidden:
        o.hide_viewport = v
    bpy.context.view_layer.update()
    return bad
```

- [ ] **Step 5: Wire the raycast into the gate's pass/fail**

Immediately after the existing `if info["barrel_descendants"] < 8:` block (currently `:520-522`), add:

```python
blocked = verify_bores_hollow()
if blocked:
    print(f"[shorty] FAIL: bore not hollow -- ray stopped short at {blocked}; "
          f"a chamber built with cyl() instead of tube() looks like a solid knob "
          f"the moment the action opens", file=sys.stderr); ok = False
```

- [ ] **Step 6: Run the model script and confirm the gate passes**

Run: `blender -b -noaudio -P scripts/model_grapeshot_shorty.py`
Expected: `[shorty] OK` on the last line, and **no** `bore not hollow` line.

To prove the check has teeth, temporarily change `tube(RO*1.07,RCH,CHAMBER_DEPTH)` back to `cyl(RO*1.07,CHAMBER_DEPTH)`, re-run, and confirm it FAILS with `bore not hollow`. Then change it back and re-run to green.

- [ ] **Step 7: Commit**

```bash
git add scripts/model_grapeshot_shorty.py public/assets/lab/shorty-double.glb
git commit -m "shorty: the chambers are tubes now, and the breech face is on the breech"
```

---

## Task 2: Shells in the chambers, and four driven nodes

**Files:**
- Modify: `scripts/model_grapeshot_shorty.py` — new geometry before `group_and_locate`, and the `group_and_locate` function at `:357-390`, and the gate's `required` set at `:489`

- [ ] **Step 1: Build the seated shells**

Insert immediately before the `# ---- two rigid groups + locator empties.` comment (currently `:357`):

```python
# ---- shells, seated in the chambers ----------------------------------------
# Parented under BARREL_NODE so they inherit the break rotation for free. That
# is the whole trick: the runtime slides them along their own LOCAL bore axis
# and they come out of the tilted tubes correctly without anyone anywhere
# computing a rotated basis.
MATS['Hull'] = M('Hull', (0.66, 0.075, 0.06, 1), 0.0, 0.55)
MATS['Head'] = M('Head', (0.62, 0.44, 0.16, 1), 0.9, 0.35)
SHELL_HEAD = 0.021           # brass head length
SHELL_LEN  = CHAMBER_DEPTH   # 0.070 -- a shell exactly fills the chamber
for i, x in enumerate((-XSEP, XSEP)):
    tag = 'L' if i == 0 else 'R'
    # Hull runs forward from the head to the chamber floor.
    hull_len = SHELL_LEN - SHELL_HEAD
    put(cyl(RCH*0.985, hull_len), f'shell_hull_{tag}', 'Hull',
        loc=(x, CY1 - SHELL_HEAD - hull_len/2, 0), rot=(RY,0,0), bevel=0, smooth=True)
    # Brass head, rim flush with the breech face.
    put(cyl(RCH*1.02, SHELL_HEAD), f'shell_head_{tag}', 'Head',
        loc=(x, CY1 - SHELL_HEAD/2, 0), rot=(RY,0,0), bevel=0.0008, smooth=True)
```

- [ ] **Step 2: Replace `group_and_locate` with the six-node version**

Replace the whole `def group_and_locate():` function (currently `:357-390`, ending at `return root`) with:

```python
def group_and_locate():
    """Rigid groups, driven nodes and locators. The GLB carries NO animation --
    every moving part is a code-driven transform at runtime, so this only has to
    name things. A name the runtime cannot find is a reload that plays and moves
    nothing, so the gate below treats a missing name as fatal."""
    root    = bpy.data.objects.new("GunRoot", None); col.objects.link(root)
    barrels = bpy.data.objects.new(BARREL_NODE, None); col.objects.link(barrels)
    frame   = bpy.data.objects.new(FRAME_NODE, None); col.objects.link(frame)
    barrels.parent = root
    frame.parent = root

    # Driven nodes. Each owns exactly the meshes the runtime moves as a unit.
    driven = {}
    for name, parent, loc in (
        ("Shell_L",   barrels, (-XSEP, 0.0,    0.0)),
        ("Shell_R",   barrels, ( XSEP, 0.0,    0.0)),
        ("Extractor", barrels, ( 0.0,  CY1,    0.0)),
        ("TopLever",  frame,   ( 0.0,  0.026,  0.0228)),
    ):
        e = bpy.data.objects.new(name, None); col.objects.link(e)
        e.location = loc; e.empty_display_size = 0.01; e.parent = parent
        driven[name] = e
    bpy.context.view_layer.update()

    # Everything forward of the hinge pin swings; everything else is the frame.
    swing = ("barrel", "crown", "cone", "bore", "rib_top", "bead",
             "chamber", "mouth", "foreend", "fe_cap")
    for o in list(col.objects):
        if o.type != 'MESH' or o.parent is not None:
            continue
        base = o.name.split('.')[0]
        if base.startswith("shell_") and base.endswith("_L"):
            o.parent = driven["Shell_L"]
        elif base.startswith("shell_") and base.endswith("_R"):
            o.parent = driven["Shell_R"]
        elif base == "extractor":
            o.parent = driven["Extractor"]
        elif base == "toplever":
            o.parent = driven["TopLever"]
        else:
            o.parent = frame if not base.startswith(swing) else barrels
        # Parenting in bpy does not re-seat the child, so its world position is
        # already right; only the driven empties need their offset removed.
        o.matrix_parent_inverse = o.parent.matrix_world.inverted()

    # Locators. HINGE is the axis the barrels rotate about. Breech_L/R are the
    # chamber mouths, read EVERY FRAME by the runtime so the eject origin and
    # the load destination follow the hinge instead of being guessed once.
    for name, loc, parent in (
        (HINGE_NODE,  (0.0,     -0.070,     -0.016), frame),
        ("Muzzle_L",  (-XSEP,   BY_MUZZLE,   0.0),   barrels),
        ("Muzzle_R",  ( XSEP,   BY_MUZZLE,   0.0),   barrels),
        ("Breech_L",  (-XSEP,   CY1,         0.0),   barrels),
        ("Breech_R",  ( XSEP,   CY1,         0.0),   barrels),
        ("Grip_Hand", (0.0,      0.074,     -0.074), frame),
        ("Fore_Hand", (0.0,     -0.155,     -0.045), frame),
    ):
        e = bpy.data.objects.new(name, None)
        col.objects.link(e)
        e.location = loc
        e.empty_display_size = 0.01
        e.parent = parent
    bpy.context.view_layer.update()
    return root
```

- [ ] **Step 3: Extend the gate's required-node set**

Replace the `required = {...}` literal (currently `:489-490`) with:

```python
    required = {BARREL_NODE, FRAME_NODE, HINGE_NODE,
                "Muzzle_L", "Muzzle_R", "Grip_Hand", "Fore_Hand",
                "Breech_L", "Breech_R", "Shell_L", "Shell_R",
                "Extractor", "TopLever"}
```

- [ ] **Step 4: Run the model script**

Run: `blender -b -noaudio -P scripts/model_grapeshot_shorty.py`
Expected: `[shorty] OK`, with `missing_nodes: []` in the verify line and `barrel_descendants` at 8 or more.

If any of `Breech_L`, `Shell_R`, `Extractor`, `TopLever` shows up in `missing_nodes`, the glTF exporter dropped an empty with no children — confirm the corresponding meshes actually re-parented in Step 2.

- [ ] **Step 5: Render the open breech and eyeball it**

```bash
blender -b -noaudio -P /tmp/shorty-open.py -- /tmp/after-open45.png "$PWD/public/assets/lab/shorty-double.glb" 45
```

Write `/tmp/shorty-open.py` as a copy of the diagnostic used to produce `docs/dev-notes/2026-09-03-shorty-breech/before-open45.png`: import the GLB, park a pivot at `Hinge`, re-parent `Barrels` to it, set `rotation_euler = (radians(45), 0, 0)`, then render from an FPV camera at Blender `(0.125, 0.300, 0.115)` looking down −Y with a 75° vertical FOV at 820×820.

Expected: **two open holes with brass shell heads seated in them.** Not two domed knobs. Compare side by side against the before-render.

- [ ] **Step 6: Commit**

```bash
git add scripts/model_grapeshot_shorty.py public/assets/lab/shorty-double.glb docs/dev-notes/2026-09-03-shorty-breech/
git commit -m "shorty: shells that live in the chambers, and nodes the runtime can drive"
```

---

## Task 3: Widen the standing breech to carry its barrels

The owner spotted the open action looking misaligned. Measured, **every part group's
lateral centre is exactly `0.00000`** — nothing is off-centre. The real cause is a
proportion: the barrel cluster is **±0.0475** (95 mm) but the receiver is **±0.0389**
(78 mm), so the barrels overhang the frame by 8.6 mm a side. Under the oblique FPV
camera the near-side overhang foreshortens differently from the far side, and two
symmetric parts read as offset.

It is also backwards mechanically — a break-action's standing breech has to be at
least as wide as the barrels, because the barrels seat *against* it.

This is a proportion relationship between two parts, not a realism-rescale of the
gun, so it does not touch the fantasy silhouette: `RO`, `RI`, `XSEP` and the gun's
length are all unchanged.

**Files:**
- Modify: `scripts/model_grapeshot_shorty.py` — `HW()` at `:251-256`

- [ ] **Step 1: Widen the breech end of the lofted body**

Replace the `HW` function (currently `:251-256`) with:

```python
def HW(y):
    # THE STANDING BREECH MUST CARRY ITS BARRELS. At 0.039 the receiver was
    # +-0.0389 against a barrel cluster of +-0.0475, so the barrels overhung the
    # frame by 8.6 mm a side -- which is both backwards for a break action (the
    # barrels seat AGAINST this face) and the reason the open action read as
    # misaligned even though every part is centred on 0.00000 exactly.
    # 0.050 clears the cluster by 2.5 mm. The grip end is untouched.
    if y <= -0.020: return 0.050
    if y >=  0.058: return 0.026
    t = (y + 0.020) / 0.078
    return 0.050 + (0.026-0.050) * (t*t*(3-2*t))     # smoothstep, no crease
```

- [ ] **Step 2: Rebuild and confirm the receiver now clears the barrels**

Run: `blender -b -noaudio -P scripts/model_grapeshot_shorty.py`
Expected: `[shorty] OK`, and the printed `BLOCKOUT7 ... gripwidth<=` line unchanged at
`0.099` (the barrels, not the body, set the gun's overall width — so this number
staying put is the confirmation that the body grew *into* the existing envelope
rather than past it).

- [ ] **Step 3: Verify the overhang is gone, with numbers not eyes**

Write `/tmp/shorty-width.py`:

```python
import bpy, sys
from mathutils import Vector
GLB = sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
def xspan(pred):
    mn, mx = 1e9, -1e9
    for o in bpy.data.objects:
        if o.type != 'MESH' or not pred(o.name.split('.')[0]): continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = min(mn, w.x); mx = max(mx, w.x)
    return mn, mx
bmn, bmx = xspan(lambda n: n.startswith('barrel') or n.startswith('chamber'))
rmn, rmx = xspan(lambda n: n == 'body')
print(f"barrels  {bmn:9.5f} {bmx:9.5f}  centre {(bmn+bmx)/2:9.5f}")
print(f"receiver {rmn:9.5f} {rmx:9.5f}  centre {(rmn+rmx)/2:9.5f}")
print(f"overhang per side: {(bmx-rmx)*1000:.2f} mm  (want <= 0)")
```

Run: `blender -b -noaudio -P /tmp/shorty-width.py -- "$PWD/public/assets/lab/shorty-double.glb"`
Expected: both centres `0.00000`, and `overhang per side` **negative** (the receiver is now the wider part).

- [ ] **Step 4: Commit**

```bash
git add scripts/model_grapeshot_shorty.py public/assets/lab/shorty-double.glb
git commit -m "shorty: a standing breech wide enough to carry its own barrels"
```

---

## Task 4: Retime the reload to the reference

Pure numbers, no renderer. The existing tests mostly reference `RELOAD.*` rather than literal times, so they survive — the two that hardcode times do not, and are fixed here.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-viewmodel.ts:10-27` (RELOAD), `:58-72` (RELOAD_KEYS), `:246-254` (SUPPORT_KEYS)
- Modify: `src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts:39-52` (reloadPhaseAt), `:53-79` (hingeOpenFraction)

- [ ] **Step 1: Write the failing tests for the new beat sheet**

Append to `game-viewmodel.test.ts`:

```ts
describe('the retimed beat sheet', () => {
  it('runs 1.30 s, the reference tempo', () => {
    expect(RELOAD.totalSec).toBeCloseTo(1.30, 3);
  });
  it('orders every beat', () => {
    const beats = [
      RELOAD.presentSec, RELOAD.extractAtSec, RELOAD.breakEndSec,
      RELOAD.ejectEndSec, RELOAD.loadStartSec, RELOAD.loadSeatSec,
      RELOAD.snapEndSec, RELOAD.totalSec,
    ];
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i]!).toBeGreaterThan(beats[i - 1]!);
    }
  });
  it('opens to 45 degrees', () => {
    expect(RELOAD.openRad).toBeCloseTo(Math.PI / 4, 3);
  });
  it('shuts harder than it opens — the asymmetry IS the clack', () => {
    const open = RELOAD.breakEndSec - RELOAD.presentSec;
    const shut = RELOAD.totalSec - RELOAD.snapEndSec;
    expect(shut).toBeLessThan(open);
    expect(open / shut).toBeGreaterThan(1.8);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts -t "retimed beat sheet"`
Expected: FAIL — `RELOAD.extractAtSec` is `undefined`, `totalSec` is 1.05.

- [ ] **Step 3: Replace the RELOAD constants**

Replace lines `10-27` (the whole `export const RELOAD = {...} as const;`) with:

```ts
export const RELOAD = {
  /** Gun rolled into view AND the top lever thrown. The reference has no
   *  present beat at all -- it is a fixed camera -- so ours is folded INTO the
   *  lever throw rather than added in front of it, which is what keeps the
   *  whole reload at the reference's 1.30 s instead of 1.46 s. */
  presentSec:  0.18,
  /** Barrels at full 45 deg. 0.33 s of travel, straight off the reference. */
  breakEndSec: 0.51,
  ejectEndSec: 0.65,
  loadEndSec:  1.11,
  snapEndSec:  1.16,
  totalSec:    1.30,
  /** How far the barrels swing off the frame, radians (45 deg). The reference
   *  opens this wide; our old 35 deg barely showed the breech. */
  openRad: Math.PI / 4,
  /** When the spent cases start their AXIAL slide out of the bore -- a beat
   *  before the hinge finishes, exactly as the reference does it. */
  extractAtSec: 0.45,
  /** When they clear the mouth and the free tumble takes over. */
  ejectAtSec: 0.51,
  /** When fresh cases first appear coming up from under the frame, and when
   *  they seat. Seating well before the snap so the gun never closes on a
   *  shell that is still visibly outside it. */
  loadStartSec: 0.74,
  loadSeatSec:  1.11,
} as const;
```

- [ ] **Step 4: Restretch the pose keyframes to 1.30 s**

Replace lines `58-72` (the `RELOAD_KEYS` array literal) with:

```ts
const RELOAD_KEYS: readonly (ReloadPose & { t: number })[] = [
  { t: 0.00, roll:   0, pitch:  0, dy: 0.000, dz: 0.000, hinge: 0 },
  { t: 0.18, roll: -22, pitch: 11, dy: 0.085, dz: 0.055, hinge: 0 },
  { t: 0.51, roll: -30, pitch: 21, dy: 0.115, dz: 0.080, hinge: 1 },
  { t: 0.65, roll: -30, pitch: 22, dy: 0.118, dz: 0.082, hinge: 1 },
  { t: 1.11, roll: -27, pitch: 19, dy: 0.108, dz: 0.074, hinge: 1 },
  // The snap. 0.14 s to shut against 0.33 s to open, so it closes far harder
  // than it opened -- that asymmetry IS the "clack".
  { t: 1.16, roll:  -9, pitch:  3, dy: 0.022, dz: 0.012, hinge: 0 },
  { t: 1.30, roll:   0, pitch:  0, dy: 0.000, dz: 0.000, hinge: 0 },
];
```

- [ ] **Step 5: Restretch the support-hand keyframes**

Replace lines `246-254` (the `SUPPORT_KEYS` array literal) with:

```ts
const SUPPORT_KEYS: readonly (SupportHandPose & { t: number })[] = [
  { t: 0.00, dx:  0.000, dy:  0.000, dz: 0.000, carrying: false },
  { t: 0.18, dx: -0.020, dy: -0.060, dz: 0.020, carrying: false },
  { t: 0.51, dx: -0.060, dy: -0.200, dz: 0.060, carrying: false },
  { t: 0.74, dx: -0.050, dy: -0.160, dz: 0.100, carrying: true  },
  { t: 1.11, dx:  0.020, dy:  0.020, dz: 0.120, carrying: true  },
  { t: 1.16, dx: -0.010, dy: -0.040, dz: 0.060, carrying: false },
  { t: 1.30, dx:  0.000, dy:  0.000, dz: 0.000, carrying: false },
];
```

- [ ] **Step 6: Fix the two tests that hardcode beat times**

In `game-viewmodel.test.ts`, replace the `reloadPhaseAt` body at `:40-46`:

```ts
  it('walks the six beats in order', () => {
    expect(reloadPhaseAt(0.00)).toBe('present');
    expect(reloadPhaseAt(0.40)).toBe('break');
    expect(reloadPhaseAt(0.60)).toBe('eject');
    expect(reloadPhaseAt(0.90)).toBe('load');
    expect(reloadPhaseAt(1.13)).toBe('snap');
    expect(reloadPhaseAt(1.25)).toBe('settle');
  });
```

and the `hingeOpenFraction` "fully open" assertions at `:57-59`:

```ts
  it('is fully open across eject and load', () => {
    expect(hingeOpenFraction(0.60)).toBeCloseTo(1, 6);
    expect(hingeOpenFraction(0.90)).toBeCloseTo(1, 6);
  });
```

- [ ] **Step 7: Run the whole view-model suite**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts`
Expected: PASS, all describes green.

If `ejectedShell`'s "stops being drawn eventually" fails, its window (`dt > 0.85`) now runs past `totalSec`; that is fine and expected — the case keeps flying after the gun is loaded. Only fix it if the assertion itself fails.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-viewmodel.ts src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts
git commit -m "reload: the reference tempo — 45 deg over 0.33 s, shut in 0.14"
```

---

## Task 5: The three new curves

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-viewmodel.ts` — append after `loadShellTravel` (`:169-174`)
- Modify: `src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `game-viewmodel.test.ts` (and add `extractStage, extractorOffset, topLeverAngle, CHAMBER_DEPTH_M` to the import list at `:3-6`):

```ts
describe('topLeverAngle', () => {
  it('is home at rest and home again at the end', () => {
    expect(topLeverAngle(0)).toBeCloseTo(0, 6);
    expect(topLeverAngle(RELOAD.totalSec)).toBeCloseTo(0, 6);
  });
  it('LEADS the break — fully thrown while the hinge is still shut', () => {
    const t = RELOAD.presentSec * 0.9;
    expect(topLeverAngle(t)).toBeGreaterThan(0.6);
    expect(hingeOpenFraction(t)).toBeCloseTo(0, 6);
  });
  it('reaches the reference throw of 40 degrees', () => {
    const peak = Math.max(...Array.from({ length: 131 }, (_, k) => topLeverAngle(k / 100)));
    expect(peak).toBeCloseTo(Math.PI * 40 / 180, 2);
  });
});

describe('extractStage', () => {
  it('is absent before the extract beat and after the hand-off', () => {
    expect(extractStage(0)).toBeNull();
    expect(extractStage(RELOAD.extractAtSec - 0.01)).toBeNull();
    expect(extractStage(RELOAD.ejectAtSec + 0.01)).toBeNull();
  });
  it('runs 0 -> 1 monotonically across the extract window', () => {
    expect(extractStage(RELOAD.extractAtSec)).toBeCloseTo(0, 5);
    let prev = -1;
    for (let t = RELOAD.extractAtSec; t <= RELOAD.ejectAtSec; t += 0.005) {
      const v = extractStage(t)!;
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(prev).toBeCloseTo(1, 5);
  });
  it('has fully cleared the chamber by the hand-off, or the case would be reparented mid-steel', () => {
    expect(extractStage(RELOAD.ejectAtSec)! * CHAMBER_DEPTH_M)
      .toBeGreaterThanOrEqual(CHAMBER_DEPTH_M - 1e-6);
  });
});

describe('extractorOffset', () => {
  it('is home at rest and home once the fresh cases are seated', () => {
    expect(extractorOffset(0)).toBeCloseTo(0, 6);
    expect(extractorOffset(RELOAD.totalSec)).toBeCloseTo(0, 6);
  });
  it('is thrown out while the breech is empty', () => {
    expect(extractorOffset(RELOAD.ejectAtSec)).toBeGreaterThan(0.005);
    expect(extractorOffset(RELOAD.loadStartSec)).toBeGreaterThan(0.005);
  });
  it('retracts as the fresh cases seat, not after', () => {
    expect(extractorOffset(RELOAD.loadSeatSec)).toBeCloseTo(0, 4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts -t "topLeverAngle"`
Expected: FAIL — `topLeverAngle is not a function`.

- [ ] **Step 3: Implement the three curves**

Append to `game-viewmodel.ts` immediately after `loadShellTravel` (currently ends `:174`):

```ts
/** Chamber depth in metres, mirroring CHAMBER_DEPTH in the model script. A
 *  shell has cleared the mouth once it has travelled this far. */
export const CHAMBER_DEPTH_M = 0.070;

/** Extractor throw in metres. Proportional to the reference's, which pushes
 *  its slugs about 65% of a case length clear of the mouth. */
export const EXTRACTOR_THROW_M = 0.009;

const LEVER_THROW_RAD = Math.PI * 40 / 180;

/**
 * Top-lever yaw at `t`, radians. Thrown open across the present beat, held
 * while the action is open, home again as it snaps shut.
 *
 * It has to LEAD the break: on a real break-action the lever unlocks the bolt
 * before the barrels can drop, and the reference animates exactly that (its
 * `release` is at full throw a sixth of a second before `front` starts to
 * move). A lever that swings WITH the barrels reads as decoration.
 */
export function topLeverAngle(t: number): number {
  if (t <= 0 || t >= RELOAD.totalSec) return 0;
  if (t < RELOAD.presentSec) {
    return LEVER_THROW_RAD * smoothstep(0, RELOAD.presentSec, t);
  }
  if (t < RELOAD.snapEndSec) return LEVER_THROW_RAD;
  return LEVER_THROW_RAD * (1 - smoothstep(RELOAD.snapEndSec, RELOAD.totalSec, t));
}

/**
 * Normalised 0..1 axial travel of a seated case, or `null` outside the extract
 * window. Multiply by CHAMBER_DEPTH_M for metres.
 *
 * This is stage one of a TWO-STAGE eject, which is the thing that makes cases
 * leave a tilted gun correctly. The case is a child of the barrel group, so
 * this slide happens in the barrels' own frame and needs no rotated basis;
 * `ejectedShell` then takes over for the free tumble.
 */
export function extractStage(t: number): number | null {
  if (t < RELOAD.extractAtSec || t > RELOAD.ejectAtSec) return null;
  return smoothstep(RELOAD.extractAtSec, RELOAD.ejectAtSec, t);
}

/**
 * Extractor throw in metres at `t`. Rides out with the cases, HOLDS while the
 * breech is empty, and retracts as the fresh ones seat -- the reference's
 * `unloader` channel exactly.
 */
export function extractorOffset(t: number): number {
  if (t < RELOAD.extractAtSec || t >= RELOAD.loadSeatSec) return 0;
  if (t < RELOAD.ejectAtSec) {
    return EXTRACTOR_THROW_M * smoothstep(RELOAD.extractAtSec, RELOAD.ejectAtSec, t);
  }
  if (t < RELOAD.loadStartSec) return EXTRACTOR_THROW_M;
  return EXTRACTOR_THROW_M * (1 - smoothstep(RELOAD.loadStartSec, RELOAD.loadSeatSec, t));
}
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts`
Expected: PASS, all describes green.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-viewmodel.ts src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts
git commit -m "reload: the lever leads, the case slides, the extractor holds"
```

---

## Task 6: Wire the named nodes, delete the constant

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:39-40` (imports), `:1084-1102` (node handles), `:1185-1205` (load-time wiring)

- [ ] **Step 1: Extend the view-model import**

Replace lines `39-40`:

```ts
  FLASH, MAGAZINE_CAPACITY, RECOIL, RELOAD, CHAMBER_DEPTH_M, ejectedShell,
  extractStage, extractorOffset, fireRecoil, flashEnvelope, loadShellTravel,
  magazineAfterFire, reloadPhaseAt, reloadPose, supportHandPose, topLeverAngle,
```

- [ ] **Step 2: Add handles for the new nodes**

Immediately after `let hingePivot: THREE.Group | null = null;` (`:1088`), add:

```ts
  /** Driven GLB nodes. Shells and the extractor live INSIDE Barrels, so they
   *  inherit the break rotation and the runtime only ever writes their LOCAL
   *  position -- no rotated basis is computed anywhere. */
  let shellNodes: THREE.Object3D[] = [];
  let breechNodes: THREE.Object3D[] = [];
  let extractorNode: THREE.Object3D | null = null;
  let topLeverNode: THREE.Object3D | null = null;
  /** Each shell's seated local position, so the extract slide is a delta. */
  const shellRestZ: number[] = [];
  let extractorRestZ = 0;
```

- [ ] **Step 3: Resolve the nodes at load, loudly**

Immediately after the existing `if (!barrels || !hingeNode) { throw ... }` block (`:1191-1193`), add:

```ts
    // Every moving part is a named node. A missing one must be LOUD: silently
    // skipping it presents as a reload that animates and moves nothing, which
    // is precisely the class of bug this whole change exists to remove.
    const need = (n: string): THREE.Object3D => {
      const o = gltf.scene.getObjectByName(n);
      if (!o) throw new Error(`[sdf-game] shorty-double.glb is missing the ${n} node`);
      return o;
    };
    shellNodes = [need('Shell_L'), need('Shell_R')];
    breechNodes = [need('Breech_L'), need('Breech_R')];
    extractorNode = need('Extractor');
    topLeverNode = need('TopLever');
    for (const s of shellNodes) shellRestZ.push(s.position.z);
    extractorRestZ = extractorNode.position.z;
```

- [ ] **Step 4: Add a per-frame breech reader**

Immediately after the `locatorInView` function (`:1128-1136`), add:

```ts
  /** A breech locator's position in aim-rig space RIGHT NOW. Unlike
   *  locatorInView this is called every frame, so it assumes the caller has
   *  already refreshed the view-model's matrices this frame.
   *
   *  This is what replaces the hardcoded breech vector. That constant was both
   *  4 cm right of the real chambers (it predated the gun being centred) and
   *  static, so it could not follow the barrels through their swing -- which is
   *  the whole of "the shells don't come out of the right location". */
  function breechInRig(i: 0 | 1, out: THREE.Vector3): boolean {
    const n = breechNodes[i];
    if (!n) return false;
    n.getWorldPosition(out);
    (aimRig ?? viewModelAnchor).worldToLocal(out);
    return true;
  }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Unused-variable warnings for `shellRestZ` / `extractorRestZ` are expected until Task 7 and are not errors under this config.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "shorty: resolve the driven nodes at load, and fail loudly without them"
```

---

## Task 7: The two-stage eject

The payload. Replaces the hardcoded breech vector with locators read every frame.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:2226-2295` (the per-frame reload block)

- [ ] **Step 1: Refresh matrices after posing the gun**

Immediately after the `if (hingePivot) hingePivot.rotation.x = rp.hinge * RELOAD.openRad;` line (`:2239`), add:

```ts
    // The breech locators are read below in RIG space, and they hang off the
    // hinge pivot that was just rotated. Without this the eject would trail the
    // barrels by exactly one frame.
    if (gunGroup) viewModelAnchor.updateMatrixWorld(true);
    if (topLeverNode) topLeverNode.rotation.y = topLeverAngle(reloading ? reloadAge : 0);
```

- [ ] **Step 2: Replace the eject and load block**

Replace lines `2252-2278` — from the `// SPENT CASES thrown up and back out of the open breech.` comment through the end of the fresh-cases `for` loop (ending `m.rotation.set(Math.PI / 2, 0, 0); }`) — with:

```ts
      // ——— STAGE 1: EXTRACTION ———————————————————————————————————————
      // The seated cases are children of Barrels, so they are already carrying
      // the 45 deg tilt. Sliding them along their own LOCAL -Z walks them
      // straight back out of the bores. Larger z is toward the muzzle.
      const ex = extractStage(reloadAge);
      for (let i = 0; i < shellNodes.length; i++) {
        const s = shellNodes[i];
        const restZ = shellRestZ[i];
        if (!s || restZ === undefined) continue;
        if (ex === null) {
          // Seated before the extract beat, gone after the hand-off.
          const seated = reloadAge < RELOAD.extractAtSec;
          s.visible = seated || reloadAge >= RELOAD.loadSeatSec;
          s.position.z = restZ;
        } else {
          s.visible = true;
          s.position.z = restZ - ex * CHAMBER_DEPTH_M;
        }
      }
      if (extractorNode) {
        extractorNode.position.z = extractorRestZ - extractorOffset(reloadAge);
      }

      // ——— STAGE 2: THE TUMBLE ———————————————————————————————————————
      // Handed off at the moment the case clears the mouth, from the breech
      // locator's CURRENT world position -- so it starts exactly where stage
      // one left it, on a gun that may be at any point in its swing.
      const breech = new THREE.Vector3();
      for (let i = 0; i < ejectedShells.length; i++) {
        const m = ejectedShells[i];
        if (!m) continue;
        const e = ejectedShell(reloadAge, i === 0 ? 0 : 1);
        if (!e || !breechInRig(i === 0 ? 0 : 1, breech)) { m.visible = false; continue; }
        m.visible = true;
        m.position.set(breech.x + e.x, breech.y + e.y, breech.z + e.z);
        m.rotation.set(Math.PI / 2 + e.spin, e.spin * 0.6, 0);
      }

      // FRESH CASES riding up with the hand and seating in the chambers.
      const travel = loadShellTravel(reloadAge);
      for (let i = 0; i < loadShells.length; i++) {
        const m = loadShells[i];
        if (!m) continue;
        if (travel === null || !breechInRig(i === 0 ? 0 : 1, breech)) {
          m.visible = false; continue;
        }
        m.visible = true;
        // From under the frame, in the support hand, to the real chamber mouth.
        const from = new THREE.Vector3(
          FORE_HAND_REST.x + sh.dx + (i === 0 ? -0.024 : 0.024),
          FORE_HAND_REST.y + sh.dy + 0.03,
          FORE_HAND_REST.z + sh.dz,
        );
        m.position.lerpVectors(from, breech, travel);
        m.rotation.set(Math.PI / 2, 0, 0);
      }
```

- [ ] **Step 3: Reset the new nodes when the reload finishes**

Inside the `if (reloadPhaseAt(reloadAge) === 'done') {` block, immediately after `if (hingePivot) hingePivot.rotation.x = 0;` (`:2282`), add:

```ts
        if (topLeverNode) topLeverNode.rotation.y = 0;
        if (extractorNode) extractorNode.position.z = extractorRestZ;
        for (let i = 0; i < shellNodes.length; i++) {
          const s = shellNodes[i];
          const restZ = shellRestZ[i];
          if (!s || restZ === undefined) continue;
          s.visible = true;              // loaded gun: two heads at the breech
          s.position.z = restZ;
        }
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; vitest all green.

- [ ] **Step 5: Run the headless in-game gate**

Run: `LAB_VITE_PORT=5281 LAB_CDP_PORT=9281 node scripts/sdf-game-shorty-gate.mjs`
Expected: all five gates pass, including `5. RELOAD`.

The gate asserts the hinge returns shut and the magazine refills. If it times out, the reload is now 1.30 s rather than 1.05 s — check whether the gate's wait window needs widening rather than assuming a logic failure.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "eject: two stages, and an origin that follows the barrels"
```

---

## Task 8: Verify it visually

The failure was visual. So is the verification.

**Files:**
- Add: `docs/dev-notes/2026-09-03-shorty-breech/after-open45.png`, `after-fpv.png`

- [ ] **Step 1: Capture the after-renders**

Re-run the Task 2 Step 5 diagnostic and save into the dev-notes folder:

```bash
cp /tmp/after-open45.png docs/dev-notes/2026-09-03-shorty-breech/after-open45.png
```

Expected, side by side with `before-open45.png`: two solid domed knobs become two open chamber mouths with brass shell heads seated in them.

- [ ] **Step 2: Capture an in-game reload**

Play a reload in `sdf-game.html` (press `R` on an empty gun) and confirm by eye:
1. the top lever throws **before** the barrels drop
2. the cases slide straight back out of the **tilted** bores, not sideways out of mid-air
3. the extractor is visibly out while the breech is empty
4. the fresh cases seat into the mouths and the action snaps shut

- [ ] **Step 3: Confirm the alignment complaint is actually gone**

Task 3 widened the receiver so it carries its barrels. Capture the open action from
the FPV camera and check the specific thing the owner reported: the chambers should
now read as seated *in* the frame rather than overhanging it, under the same oblique
view that made them look off-centre before.

If it still reads odd, the remaining cause is the FPV camera sitting at `x = +0.125`
against a gun centred on `x = 0` — an oblique view of a symmetric object. That is a
camera-placement question, not a model one, and belongs in its own change.

- [ ] **Step 4: Update TASKS.md**

Per `CLAUDE.md`: "When in doubt, update `TASKS.md` to reflect new state." Mark the FPV weapon reload work as done and note the reload is now 1.30 s.

- [ ] **Step 5: Final commit**

```bash
git add docs/dev-notes/2026-09-03-shorty-breech/ TASKS.md scripts/model_grapeshot_shorty.py public/assets/lab/shorty-double.glb
git commit -m "shorty: the after-renders, and the breech that finally reads as a mechanism"
```

---

## Self-review notes

**Spec coverage.** §A model → Tasks 1–2, plus Task 3 for the receiver width the owner asked for after the spec was written. §B timing → Task 4. §C runtime → Tasks 6–7. §D tests → Task 1 Steps 4–6 (raycast gate), Tasks 4–5 (unit tests). §E attribution → already committed in `17b6395`/`6ed2170`. Verification section → Task 8.

**Type consistency.** `CHAMBER_DEPTH_M`, `EXTRACTOR_THROW_M`, `extractStage`, `extractorOffset`, `topLeverAngle` are defined in Task 5 and used under those exact names in Tasks 6–7. `RELOAD.extractAtSec` and `RELOAD.ejectAtSec` are defined in Task 4 and consumed in Task 5. The Python `CHAMBER_DEPTH` (0.070) and the TS `CHAMBER_DEPTH_M` (0.070) are two sides of the same number in two languages; Task 5's comment says so, and Task 5's `extractStage` test pins the shell clearing exactly that far.

**Known duplication, accepted.** The chamber depth exists in both the model script and the view-model. A shared manifest would be the DRY answer, but the model script is Python run at author time and the view-model is TypeScript run at play time, with no build step between them — so the cheap correct fix is the cross-reference comment plus the gate that would catch a divergence.
