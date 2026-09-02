# FPV Weapon Overhaul — the goblin sawed-off — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `sdf-game.html`'s box-stack view-model with a shiny break-action sawed-off double, goblin-green hands and forearms, a muzzle flash that lights both the level and the marched bodies, and a 2-shell Doom-rhythm reload.

**Architecture:** A new procedural Blender script exports a GLB whose barrel assembly is a separate node so the break hinge is a code-driven rotation, not a baked animation. All view-model timing (pose, recoil, hinge, flash envelope, magazine) moves out of the 2,100-line `game-main.ts` into a new `game-viewmodel.ts` whose pure functions are unit-tested; the Three.js wiring stays thin.

**Tech Stack:** Blender 5.2 headless (`bpy`), TypeScript, three/webgpu (TSL), vitest.

**Spec:** [../specs/2026-09-02-fpv-weapon-overhaul-design.md](../specs/2026-09-02-fpv-weapon-overhaul-design.md)
**Blockout the model script is seeded from:** [../../dev-notes/2026-09-02-fpv-weapon-blockout/blockout.py](../../dev-notes/2026-09-02-fpv-weapon-blockout/blockout.py) — committed, complete, and carries every tuned number.

---

## Read before starting

Six facts verified against the code on 2026-09-02. **Do not re-derive them.**

1. `game-main.ts:147` destructures `camera` from `createLabRenderer`, which builds `new THREE.PerspectiveCamera(75, 1, 0.1, 200)` (`lab-renderer.ts:187`). **75 is the VERTICAL fov.**
2. Marched SDF bodies **cannot see Three.js lights.** They are lit only by `spotPos / spotAxis / spotCfg / spotColor / spotCfg2` (`zombie-gpu.ts:239`). Those are **not persistent state** — `game-main.ts:517-524` rewrites them into *every actor* on *every frame* inside `handle.setDrawFn`, replaying the flashlight's pose and cone. There is therefore nothing to "save and restore": the flash biases the values at the point they are computed. `spotCfg` is `(intensityGate, cosInner, cosOuter, range)`, and **a wider cone means a SMALLER cosine.**
3. **Adding or removing a Three.js light at runtime forces a TSL shader recompile.** Any light the flash uses must be allocated once at boot with `intensity = 0` and only modulated.
4. `muzzleWorld()` (`game-main.ts:1070`) does **not** read the gun mesh — it computes an offset from the camera basis so firing is identical headless. Changing the view-model pose does not move the muzzle; that is a separate edit.
5. Blender Z-up → glTF Y-up conversion maps `(x, y, z)` → `(x, z, -y)`. The blockout's "muzzles down −Y" therefore lands at **+Z** in GLB space, which is why `game-main.ts:1048` sets `gunGroup.rotation.y = Math.PI`. **Keep that convention.**
6. `npm test` is `vitest run`. There is no lint script.

**Do not touch `march.wgsl.ts` in this plan.** The sdf-render-perf-r2 chain is rewriting it; the flash borrows existing uniforms specifically to avoid that collision.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/model_grapeshot_shorty.py` | **Create.** Builds + exports `shorty-double.glb`, renders previews, enforces asset gates. |
| `public/assets/lab/shorty-double.glb` | **Create** (build output). |
| `src/lab/sdf-zombie/webgpu/game-viewmodel.ts` | **Create.** Pure view-model timing: pose, recoil, hinge, flash envelope, magazine. No Three.js imports. |
| `src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts` | **Create.** Unit tests for the above. |
| `src/lab/sdf-zombie/webgpu/goblin-skin.ts` | **Create.** Canvas-generated warty normal + mottle maps. |
| `src/lab/sdf-zombie/webgpu/goblin-skin.test.ts` | **Create.** Determinism + range tests. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | **Modify** ~`490–525`, `990–1075`, `1113–1140`, `1726`. Swap the GLB, hands, flash and reload wiring. |

> **Note on the spec's §6.** It says the new module "lifts ~120 lines out of `game-main.ts`". That is optimistic: this plan moves the *timing maths* out, but the Three.js wiring for the hands, flash and reload is new code that lands **in** `game-main.ts`, so the file grows. Splitting the wiring out too would mean handing a new module the scene graph, the actor list and the flashlight, which is a bigger refactor than this work needs and would collide with the perf chain's edits to the same file. Recorded here rather than quietly ignored; a follow-up can do the extraction once perf-r2 merges.
| `docs/dev-notes/2026-09-02-fpv-weapon-shorty/` | **Create.** Captures for the gates. |
| `TASKS.md` | **Modify.** Status row. |

---

### Task 1: The model script

**Files:**
- Create: `scripts/model_grapeshot_shorty.py`
- Output: `public/assets/lab/shorty-double.glb`, `docs/dev-notes/2026-09-02-fpv-weapon-shorty/*.png`

Seed from `docs/dev-notes/2026-09-02-fpv-weapon-blockout/blockout.py`. Copy it, then apply the deltas below. Its geometry **and its material palette** are already owner-approved through seven review rounds — the `MATS` dict in it is exactly the spec's §2 table. **Do not re-tune either.** In particular do not "fix" the steel back toward the old dark value; that darkness is the defect this work exists to remove.

- [ ] **Step 1: Copy the blockout as the starting point**

```bash
cp docs/dev-notes/2026-09-02-fpv-weapon-blockout/blockout.py scripts/model_grapeshot_shorty.py
```

- [ ] **Step 2: Add the output paths near the top, after the imports**

```python
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB   = os.path.join(REPO_ROOT, "public", "assets", "lab", "shorty-double.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-09-02-fpv-weapon-shorty")

# Node names the runtime depends on. game-viewmodel.ts rotates BARREL_NODE about
# HINGE_NODE to break the action; anything not under BARREL_NODE stays still.
BARREL_NODE = "Barrels"
FRAME_NODE  = "Frame"
HINGE_NODE  = "Hinge"
```

- [ ] **Step 3: Split the parts into two groups plus locator empties**

Replace the `GunRoot` block (the one that currently parents everything for the FPV render) with this. It must run **after** every `put(...)` call and **before** any render:

```python
def group_and_locate():
    """Two rigid groups plus locators. The hinge is a code-driven rotation at
    runtime, so the GLB carries NO animation -- it only has to name things."""
    root    = bpy.data.objects.new("GunRoot", None); col.objects.link(root)
    barrels = bpy.data.objects.new(BARREL_NODE, None); col.objects.link(barrels)
    frame   = bpy.data.objects.new(FRAME_NODE, None); col.objects.link(frame)
    barrels.parent = root
    frame.parent = root

    # Everything forward of the hinge pin swings; everything else is the frame.
    swing = ("barrel", "crown", "bore", "rib_top", "bead",
             "chamber", "mouth", "extractor", "foreend", "fe_cap")
    for o in list(col.objects):
        if o.type != 'MESH' or o.parent is not None:
            continue
        o.parent = frame if not o.name.startswith(swing) else barrels

    # Locators. HINGE sits on the hinge-pin axis; the barrels rotate about its X.
    for name, loc in (
        (HINGE_NODE,  (0.0,     -0.070, -0.016)),
        ("Muzzle_L",  (-XSEP,   BMID - BLEN / 2, 0.0)),
        ("Muzzle_R",  ( XSEP,   BMID - BLEN / 2, 0.0)),
        ("Grip_Hand", (0.0,      0.074, -0.074)),
        ("Fore_Hand", (0.0,     -0.155, -0.045)),
    ):
        e = bpy.data.objects.new(name, None)
        col.objects.link(e)
        e.location = loc
        e.empty_display_size = 0.01
        e.parent = barrels if name.startswith("Muzzle") or name == "Fore_Hand" else frame
    bpy.context.view_layer.update()
    return root

ROOT = group_and_locate()
```

- [ ] **Step 4: Do NOT bake the FPV cant into the export**

The blockout rotates its root by `FPV_YAW_DEG` / `FPV_PITCH_DEG` for its preview. That is a **game-side pose**, and baking it would double-apply. Set the rotation only around the FPV render and clear it afterward:

```python
ROOT.rotation_euler = (math.radians(FPV_PITCH_DEG), 0, math.radians(FPV_YAW_DEG))
bpy.context.view_layer.update()
# ... render the FPV preview here ...
ROOT.rotation_euler = (0.0, 0.0, 0.0)
bpy.context.view_layer.update()
```

- [ ] **Step 5: Add export and verification, copied from the k3 script's proven helpers**

```python
def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                              export_apply=True, export_yup=True,
                              export_extras=False)
    return os.path.getsize(path)


def verify_glb(path):
    """Re-import and assert the runtime contract: the named nodes exist and the
    barrels really are a separate subtree. A GLB that exports cleanly but lost
    BARREL_NODE would fail silently at runtime as a reload that does nothing."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    names = {o.name.split('.')[0] for o in new}
    tris = 0
    for o in new:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    required = {BARREL_NODE, FRAME_NODE, HINGE_NODE,
                "Muzzle_L", "Muzzle_R", "Grip_Hand", "Fore_Hand"}
    missing = sorted(required - names)
    barrel_kids = 0
    for o in new:
        p = o.parent
        while p is not None:
            if p.name.split('.')[0] == BARREL_NODE:
                barrel_kids += 1
                break
            p = p.parent
    for o in list(new):
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except ReferenceError:
            pass
    return {"tris": tris, "missing_nodes": missing, "barrel_descendants": barrel_kids}
```

- [ ] **Step 6: Add the gates at the end of the script**

```python
size = export_glb(OUT_GLB)
info = verify_glb(OUT_GLB)
print(f"[shorty] exported {OUT_GLB} ({size} bytes)")
print(f"[shorty] verify: {info}")

ok = True
if size > 1024 * 1024:
    print(f"[shorty] FAIL: glb {size} bytes over 1 MB", file=sys.stderr); ok = False
if info["tris"] > 14000:
    print(f"[shorty] FAIL: {info['tris']} tris over 14000", file=sys.stderr); ok = False
if info["missing_nodes"]:
    print(f"[shorty] FAIL: missing nodes {info['missing_nodes']}", file=sys.stderr); ok = False
if info["barrel_descendants"] < 8:
    print(f"[shorty] FAIL: only {info['barrel_descendants']} meshes under "
          f"{BARREL_NODE}; the hinge would move nothing", file=sys.stderr); ok = False
if not ok:
    sys.exit(1)
print("[shorty] OK")
```

- [ ] **Step 7: Point the renders at NOTES_DIR and run it**

Change the render output directory from the CLI arg to `NOTES_DIR`, keeping all five views (`left`, `threequarter`, `rear34`, `detail`, `fpv`).

Run: `blender -b -noaudio -P scripts/model_grapeshot_shorty.py`
Expected: ends with `[shorty] OK`, `missing_nodes: []`, `tris` under 14000, and five PNGs in `docs/dev-notes/2026-09-02-fpv-weapon-shorty/`.

- [ ] **Step 8: Commit**

```bash
git add scripts/model_grapeshot_shorty.py public/assets/lab/shorty-double.glb docs/dev-notes/2026-09-02-fpv-weapon-shorty/
git commit -m "shorty: the model script, with the barrels on their own node"
```

---

### Task 2: View-model timing (pure, TDD)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-viewmodel.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts`

No Three.js import in either file. These are numbers only, which is what makes them testable.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts
import { describe, expect, it } from 'vitest';
import {
  RELOAD, flashEnvelope, hingeOpenFraction, magazineAfterFire, reloadPhaseAt,
} from './game-viewmodel';

describe('flashEnvelope', () => {
  it('is zero before the shot and after the window', () => {
    expect(flashEnvelope(-0.01)).toBe(0);
    expect(flashEnvelope(0.071)).toBe(0);
  });
  it('peaks at 1 immediately at the shot', () => {
    expect(flashEnvelope(0)).toBeCloseTo(1, 5);
  });
  it('decays monotonically across the window', () => {
    let prev = Infinity;
    for (let t = 0; t <= 0.07; t += 0.005) {
      const v = flashEnvelope(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});

describe('magazineAfterFire', () => {
  it('spends one shell per barrel fired', () => {
    expect(magazineAfterFire(2, 1)).toBe(1);
    expect(magazineAfterFire(2, 2)).toBe(0);
  });
  it('never goes negative when both barrels are pulled on one shell', () => {
    expect(magazineAfterFire(1, 2)).toBe(0);
  });
  it('refuses to fire an empty gun', () => {
    expect(magazineAfterFire(0, 1)).toBe(0);
  });
});

describe('reloadPhaseAt', () => {
  it('walks the six beats in order', () => {
    expect(reloadPhaseAt(0.00)).toBe('present');
    expect(reloadPhaseAt(0.25)).toBe('break');
    expect(reloadPhaseAt(0.40)).toBe('eject');
    expect(reloadPhaseAt(0.55)).toBe('load');
    expect(reloadPhaseAt(0.75)).toBe('snap');
    expect(reloadPhaseAt(0.90)).toBe('settle');
  });
  it('is done past the total', () => {
    expect(reloadPhaseAt(RELOAD.totalSec + 0.01)).toBe('done');
  });
});

describe('hingeOpenFraction', () => {
  it('is shut at rest and shut again when the reload ends', () => {
    expect(hingeOpenFraction(0)).toBeCloseTo(0, 6);
    expect(hingeOpenFraction(RELOAD.totalSec)).toBeCloseTo(0, 6);
  });
  it('is fully open across eject and load', () => {
    expect(hingeOpenFraction(0.40)).toBeCloseTo(1, 6);
    expect(hingeOpenFraction(0.55)).toBeCloseTo(1, 6);
  });
  it('opens monotonically through the break beat', () => {
    let prev = -Infinity;
    for (let t = RELOAD.presentSec; t <= RELOAD.breakEndSec; t += 0.01) {
      const v = hingeOpenFraction(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it('never leaves the unit range', () => {
    for (let t = -0.1; t < RELOAD.totalSec + 0.1; t += 0.005) {
      const v = hingeOpenFraction(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts`
Expected: FAIL — `Failed to resolve import "./game-viewmodel"`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lab/sdf-zombie/webgpu/game-viewmodel.ts
//
// View-model TIMING for sdf-game.html's sawed-off: the reload state machine,
// the hinge curve, the muzzle-flash envelope and the magazine. Numbers only --
// no Three.js import -- because that is what makes the feel testable without a
// renderer, the same split game-weapon.ts already uses for ballistics.
//
// Beat sheet per the spec's §5 (Doom-SSG rhythm).

export const RELOAD = {
  presentSec:  0.18,
  breakEndSec: 0.34,
  ejectEndSec: 0.46,
  loadEndSec:  0.66,
  snapEndSec:  0.82,
  totalSec:    0.95,
  /** How far the barrels swing off the frame, radians (~35 deg). */
  openRad: 0.61,
} as const;

export const FLASH = {
  /** Visible window, seconds. Short on purpose: a muzzle flash that outlasts
   *  two frames reads as a lamp, not a detonation. */
  windowSec: 0.07,
  /** Exponential decay rate. 60 gives ~2% left at the window's end. */
  decay: 60,
} as const;

export const MAGAZINE_CAPACITY = 2;

export type ReloadPhase =
  | 'present' | 'break' | 'eject' | 'load' | 'snap' | 'settle' | 'done';

/** Which beat the reload is in at `t` seconds since it started. */
export function reloadPhaseAt(t: number): ReloadPhase {
  if (t < 0) return 'done';
  if (t < RELOAD.presentSec)  return 'present';
  if (t < RELOAD.breakEndSec) return 'break';
  if (t < RELOAD.ejectEndSec) return 'eject';
  if (t < RELOAD.loadEndSec)  return 'load';
  if (t < RELOAD.snapEndSec)  return 'snap';
  if (t <= RELOAD.totalSec)   return 'settle';
  return 'done';
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 0 = shut, 1 = fully broken open. Opens through the break beat, holds open
 *  across eject and load, slams shut through snap. Clamped so a caller that
 *  runs past `totalSec` cannot drive the barrels through the frame. */
export function hingeOpenFraction(t: number): number {
  if (t <= RELOAD.presentSec) return 0;
  if (t < RELOAD.breakEndSec) {
    return smoothstep(RELOAD.presentSec, RELOAD.breakEndSec, t);
  }
  if (t < RELOAD.loadEndSec) return 1;
  if (t < RELOAD.snapEndSec) {
    return 1 - smoothstep(RELOAD.loadEndSec, RELOAD.snapEndSec, t);
  }
  return 0;
}

/** Flash brightness at `t` seconds since the shot: instant attack, exponential
 *  decay, hard zero outside the window so nothing lingers a frame too long. */
export function flashEnvelope(t: number): number {
  if (t < 0 || t >= FLASH.windowSec) return 0;
  return Math.exp(-FLASH.decay * t);
}

/** Shells left after pulling `barrels` triggers on a gun holding `shells`.
 *  Both barrels on one shell spends the one shell, not minus one. */
export function magazineAfterFire(shells: number, barrels: 1 | 2): number {
  return Math.max(0, shells - Math.min(shells, barrels));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-viewmodel.ts src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts
git commit -m "viewmodel: the reload beats, the hinge curve and the flash envelope, as numbers"
```

---

### Task 3: Goblin skin maps (pure, TDD)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/goblin-skin.ts`
- Test: `src/lab/sdf-zombie/webgpu/goblin-skin.test.ts`

The generator returns raw `Uint8Array` pixel data so it is testable in node; a thin `THREE.DataTexture` wrapper is added in Task 4.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lab/sdf-zombie/webgpu/goblin-skin.test.ts
import { describe, expect, it } from 'vitest';
import { GOBLIN_SKIN, goblinNormalPixels, goblinSkinSrgbHex } from './goblin-skin';

describe('goblinSkinSrgbHex', () => {
  it('matches the goblin.blob palette, not the old orb colour', () => {
    // goblin.blob palette: baseColor 0.34 0.44 0.19 LINEAR.
    const hex = goblinSkinSrgbHex();
    expect(hex).not.toBe(0x5a8f3c);          // the orbs' historical wrong value
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    expect(g).toBeGreaterThan(r);            // green channel dominates
    expect(r).toBeGreaterThan(b);            // olive, not mint
    expect(g).toBeGreaterThan(150);          // pale, not the dark 0x8f
  });
});

describe('goblinNormalPixels', () => {
  it('is deterministic — same size, identical bytes', () => {
    const a = goblinNormalPixels(64);
    const b = goblinNormalPixels(64);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it('returns RGBA for every texel', () => {
    expect(goblinNormalPixels(32).length).toBe(32 * 32 * 4);
  });
  it('encodes unit-ish normals — every texel near the unit sphere', () => {
    const px = goblinNormalPixels(32);
    for (let i = 0; i < px.length; i += 4) {
      const x = px[i] / 127.5 - 1, y = px[i + 1] / 127.5 - 1, z = px[i + 2] / 127.5 - 1;
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0.9);
      expect(Math.hypot(x, y, z)).toBeLessThan(1.1);
    }
  });
  it('points mostly outward — z is the dominant channel', () => {
    const px = goblinNormalPixels(32);
    let zLow = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 2] < 160) zLow++;
    expect(zLow).toBe(0);
  });
  it('is actually bumpy — x and y are not all flat', () => {
    const px = goblinNormalPixels(64);
    const xs = new Set<number>();
    for (let i = 0; i < px.length; i += 4) xs.add(px[i]);
    expect(xs.size).toBeGreaterThan(20);
  });
  it('tiles — the left and right edge columns agree', () => {
    const n = 64, px = goblinNormalPixels(n);
    for (let y = 0; y < n; y++) {
      const l = (y * n) * 4, r = (y * n + n - 1) * 4;
      expect(Math.abs(px[l] - px[r])).toBeLessThan(24);
    }
  });
});

describe('GOBLIN_SKIN', () => {
  it('carries the goblin.blob roughness, not the orbs 0.85', () => {
    expect(GOBLIN_SKIN.roughness).toBeCloseTo(0.42, 2);
  });
  it('sizes the hand from goblin.blob, not the old 0.055', () => {
    expect(GOBLIN_SKIN.handRadius).toBeCloseTo(0.046, 4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/goblin-skin.test.ts`
Expected: FAIL — `Failed to resolve import "./goblin-skin"`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lab/sdf-zombie/webgpu/goblin-skin.ts
//
// The player is the goblin, so its hands must be the goblin's colour and
// texture. Every value here is lifted from characters/goblin.blob's palette
// block rather than picked by eye -- the shipped orbs were 0x5a8f3c at
// roughness 0.85, which is much darker and more saturated than the creature
// has ever been, and 0.055 radius against the .blob's 0.046.
//
// The maps are GENERATED, not baked, for the same reason hands-sheet.ts keeps a
// procedural fallback: deterministic, testable by pixel comparison, live
// tunable, and no load path to fail. Promotable to a baked PNG later.

/** goblin.blob palette + `blob arm on hand at=0.55 r=0.046`. */
export const GOBLIN_SKIN = {
  /** LINEAR rgb, exactly `baseColor 0.34 0.44 0.19`. */
  baseLinear: [0.34, 0.44, 0.19] as const,
  /** `specRoughness 0.42` -- clammy, not the orbs' matte 0.85. */
  roughness: 0.42,
  /** `blob arm on hand at=0.55 r=0.046`. */
  handRadius: 0.046,
  /** Forearm: `bar arm on forearm ... r=0.028`, elbow blob `r=0.038`,
   *  `bone forearm ... len=0.235`. */
  forearmRadius: 0.028,
  forearmElbowRadius: 0.038,
  forearmLength: 0.235,
  /** `mottleScale 1.6` -- "patches a hand-span across, not freckles". The
   *  shader's fbm multiplies its own input by 4 and 9, so this is about a
   *  quarter of the frequency it reads like; matched here by eye to that. */
  mottleScale: 1.6,
  /** `mottleAmp 0.65`. */
  mottleAmp: 0.65,
  /** How far the warts push the normal. Tuned so the silhouette stays smooth. */
  bumpStrength: 0.55,
} as const;

function linearToSrgbByte(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** The goblin's skin as a packed sRGB hex, for a THREE material `color`. */
export function goblinSkinSrgbHex(): number {
  const [r, g, b] = GOBLIN_SKIN.baseLinear;
  return (linearToSrgbByte(r) << 16) | (linearToSrgbByte(g) << 8) | linearToSrgbByte(b);
}

/** Integer hash -> [0,1). Deterministic and dependency-free, so the same
 *  texture comes out in the browser, in node and in CI. */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a TILING lattice of `period` cells. Wrapping the lattice
 *  coordinates is what lets the texture repeat without a visible seam. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a: number, m: number) => ((a % m) + m) % m;
  const n = (a: number, b: number) => hash2(w(a, period), w(b, period), seed);
  return (n(xi, yi) * (1 - u) + n(xi + 1, yi) * u) * (1 - v)
       + (n(xi, yi + 1) * (1 - u) + n(xi + 1, yi + 1) * u) * v;
}

/** Height field: two octaves of mottle plus a sparser, sharper wart layer. */
function height(u: number, v: number): number {
  const base = 8;                       // lattice cells across the texture
  let h = 0;
  h += tileNoise(u * base, v * base, base, 1) * 0.6;
  h += tileNoise(u * base * 2, v * base * 2, base * 2, 2) * 0.3;
  const wart = tileNoise(u * base * 3, v * base * 3, base * 3, 7);
  h += Math.pow(Math.max(0, wart - 0.55) / 0.45, 2) * 0.55;
  return h;
}

/**
 * A tiling tangent-space normal map, RGBA, `size` x `size`.
 *
 * Central differences on the height field, then encode to [0,255]. Z stays
 * dominant (>= 160) so the map perturbs the surface rather than replacing it --
 * a normal map that swings past that reads as noise on a sphere.
 */
export function goblinNormalPixels(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const d = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const hx = height(u + d, v) - height(u - d, v);
      const hy = height(u, v + d) - height(u, v - d);
      let nx = -hx * GOBLIN_SKIN.bumpStrength * size * d * 8;
      let ny = -hy * GOBLIN_SKIN.bumpStrength * size * d * 8;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len;
      const i = (y * size + x) * 4;
      px[i]     = Math.round((nx + 1) * 127.5);
      px[i + 1] = Math.round((ny + 1) * 127.5);
      px[i + 2] = Math.round((nz / len + 1) * 127.5);
      px[i + 3] = 255;
    }
  }
  return px;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/goblin-skin.test.ts`
Expected: PASS, 9 tests.

If `z is the dominant channel` fails, `bumpStrength` is too high — lower it until every texel's blue byte is ≥ 160. Do **not** relax the test; a normal map that tips past that reads as noise.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/goblin-skin.ts src/lab/sdf-zombie/webgpu/goblin-skin.test.ts
git commit -m "goblin skin: the hands take their colour from the .blob, and get warts"
```

---

### Task 4: Swap the view-model in

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:1013-1065`

- [ ] **Step 1: Replace the GLB constant and the gun pose**

Replace `const GUN_GLB = '/assets/lab/grapeshot-gun-k3.glb';` and the `MUZZLE_LOCAL` line with:

```typescript
  const GUN_GLB = '/assets/lab/shorty-double.glb';
  /** Grip-point origin, muzzles down -Y in BLENDER space. The muzzle sits
   *  0.318 m down-barrel of the grip (model script: BMID - BLEN/2). */
  const MUZZLE_LOCAL: [number, number, number] = [0, -0.318, 0];
```

Replace the `gunGroup.position.set(...)` line with the owner-approved FPV pose from the model script, keeping the existing `rotation.y = Math.PI` and its axis comment:

```typescript
    // FPV pose, carried over from the model script's preview constants so the
    // Blender FPV render and the game agree. Yaw cants the barrels toward
    // screen centre so BOTH bores read; pitch lifts the muzzle off the floor.
    gunGroup.rotation.y = Math.PI;
    gunGroup.rotation.z = THREE.MathUtils.degToRad(-4.5);
    gunGroup.rotation.x = THREE.MathUtils.degToRad(2.5);
    gunGroup.position.set(0.125, -0.115, -0.300);
```

- [ ] **Step 2: Capture the barrel and hinge nodes for the reload**

Immediately after `gunGroup.add(gltf.scene);` add:

```typescript
    // The break is a code-driven rotation of this node about the hinge locator
    // -- the GLB carries no animation. A null here means the export lost its
    // grouping, which must be loud: a silent null would present as a reload
    // animation that plays and moves nothing.
    const barrels = gltf.scene.getObjectByName('Barrels') ?? null;
    const hingeNode = gltf.scene.getObjectByName('Hinge') ?? null;
    if (!barrels || !hingeNode) {
      throw new Error('[sdf-game] shorty-double.glb is missing Barrels/Hinge nodes');
    }
    // Rotate about the HINGE, not about the barrel node's own origin -- the
    // latter would swing the barrels through the frame. Standard fix: a pivot
    // group parked at the hinge, with the barrels offset back by the same
    // amount, so the group's rotation IS the break.
    hingePivot = new THREE.Group();
    hingePivot.position.copy(hingeNode.position);
    (barrels.parent ?? gltf.scene).add(hingePivot);
    hingePivot.add(barrels);
    barrels.position.sub(hingeNode.position);
```

And declare alongside `let gunGroup`:

```typescript
  /** Pivot parked at the hinge; rotating it about X breaks the action open.
   *  Blender's "muzzles down -Y" becomes +Z after the glTF y-up conversion, so
   *  a POSITIVE x-rotation swings the muzzles DOWN, which is the way a break
   *  action opens. */
  let hingePivot: THREE.Group | null = null;
```

- [ ] **Step 3: Replace the green orbs with goblin-matched hands and forearms**

Replace the whole `// HANDS ARE GREEN ORBS` block (through `viewModelAnchor.add(gripHand, foreHand);`) with:

```typescript
    // HANDS ARE GREEN ORBS -- deliberate, per the owner: the player is the
    // goblin and its hands were never detailed. Colour, radius and roughness
    // now come from characters/goblin.blob instead of being picked by eye, and
    // each orb gains a FOREARM because the reload swings the support arm into
    // frame. Anchored in VIEW space so the GLB's axis convention cannot move
    // them.
    const skinTex = new THREE.DataTexture(
      goblinNormalPixels(256), 256, 256, THREE.RGBAFormat,
    );
    skinTex.wrapS = skinTex.wrapT = THREE.RepeatWrapping;
    skinTex.needsUpdate = true;
    const orbMat = new THREE.MeshStandardMaterial({
      color: goblinSkinSrgbHex(),
      roughness: GOBLIN_SKIN.roughness,
      normalMap: skinTex,
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
    const orbGeo = new THREE.SphereGeometry(GOBLIN_SKIN.handRadius, 20, 14);
    const armGeo = new THREE.CapsuleGeometry(
      GOBLIN_SKIN.forearmRadius, GOBLIN_SKIN.forearmLength * 0.6, 4, 12,
    );

    function makeHand(hand: THREE.Vector3, elbowBack: number): THREE.Group {
      const g = new THREE.Group();
      const orb = new THREE.Mesh(orbGeo, orbMat);
      // SphereGeometry's UVs pinch at the poles, so aim the pole away from the
      // camera -- into the gun -- where the pinch cannot be seen.
      orb.rotation.x = Math.PI / 2;
      const arm = new THREE.Mesh(armGeo, orbMat);
      arm.position.set(0, -0.02, elbowBack);
      arm.rotation.x = Math.PI / 2.6;
      g.add(orb, arm);
      g.position.copy(hand);
      return g;
    }

    gripHandGroup = makeHand(new THREE.Vector3(0.150, -0.150, -0.250), 0.115);
    foreHandGroup = makeHand(new THREE.Vector3(0.105, -0.150, -0.395), 0.115);
    viewModelAnchor.add(gripHandGroup, foreHandGroup);
```

Declare alongside `let gunGroup`:

```typescript
  let gripHandGroup: THREE.Group | null = null;
  let foreHandGroup: THREE.Group | null = null;
```

- [ ] **Step 4: Raise the gun's env-map intensity (spec §2)**

In the `gltf.scene.traverse` block just above, change `std.envMapIntensity = 0.7;` to:

```typescript
          // The whole point of the new palette is a gun that catches light in a
          // dark dungeon. 0.7 against its private RoomEnvironment was tuned for
          // the old near-black metal.
          std.envMapIntensity = 1.1;
```

- [ ] **Step 5: Add the imports at the top of the file**

```typescript
import { GOBLIN_SKIN, goblinNormalPixels, goblinSkinSrgbHex } from './goblin-skin';
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `CapsuleGeometry` is missing, the three version predates it — use `THREE.CylinderGeometry(GOBLIN_SKIN.forearmRadius, GOBLIN_SKIN.forearmElbowRadius, GOBLIN_SKIN.forearmLength * 0.6, 12)` instead and note the substitution in the commit body.

- [ ] **Step 7: Confirm it renders**

Run: `npm run dev`, open `http://localhost:5173/sdf-game.html`, and check the console has no `missing Barrels/Hinge` throw and no GLTF 404.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "shorty: the new gun and goblin-matched hands replace the plank and the orbs"
```

---

### Task 5: Muzzle flash — geometry

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (after the gun block, and in `fire()` / the tick)

- [ ] **Step 1: Build the flash geometry at boot**

After the hands block:

```typescript
    // MUZZLE FLASH -- geometry half. Two additive cross-billboard quads plus a
    // crown ring, parked invisible. Built ONCE: a flash that allocates on the
    // trigger pull would stutter the first shot of every session.
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    flashGroup = new THREE.Group();
    flashGroup.visible = false;
    for (const roll of [0, Math.PI / 2]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.30), flashMat);
      q.rotation.z = roll;
      flashGroup.add(q);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.115, 18), flashMat);
    flashGroup.add(ring);
    flashGroup.position.set(0.085, -0.060, -0.560);
    viewModelAnchor.add(flashGroup);
    flashMaterial = flashMat;
```

Declare alongside `let gunGroup`:

```typescript
  let flashGroup: THREE.Group | null = null;
  let flashMaterial: THREE.MeshBasicMaterial | null = null;
  /** Seconds since the last shot; >= FLASH.windowSec means no flash. */
  let flashAge = Infinity;
```

- [ ] **Step 2: Import the envelope**

```typescript
import { FLASH, MAGAZINE_CAPACITY, RELOAD, flashEnvelope, hingeOpenFraction, magazineAfterFire, reloadPhaseAt } from './game-viewmodel';
```

- [ ] **Step 3: Trigger it in `fire()`**

Inside `fire()`, immediately after `recoilPitch += GRAPESHOT.kickRadPerBarrel * barrels;`:

```typescript
    flashAge = 0;
    if (flashGroup) {
      // Fresh roll per shot so repeat fire does not strobe an identical shape.
      flashGroup.rotation.z = Math.random() * Math.PI * 2;
    }
```

- [ ] **Step 4: Drive it in the tick**

Next to `recoilPitch *= Math.exp(-9 * dt);` (`game-main.ts:1726`):

```typescript
    flashAge += dt;
    const flashV = flashEnvelope(flashAge);
    if (flashGroup && flashMaterial) {
      flashGroup.visible = flashV > 0;
      flashMaterial.opacity = flashV;
      const s = 0.7 + 0.5 * flashV;
      flashGroup.scale.setScalar(s);
    }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — expected: no errors.
Then `npm run dev`, open `sdf-game.html`, click to fire: a warm flash appears at the muzzle for a fraction of a second and does not persist.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "flash: the visible half, on one envelope"
```

---

### Task 6: Muzzle flash — both light stacks

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (after the flash geometry, and in the `setDrawFn` spot-replay block at `490-525`)

The load-bearing task. Re-read fact 2 and fact 3 before writing anything.

- [ ] **Step 1: Allocate the level light at boot, dark**

After the flash geometry from Task 5:

```typescript
    // MUZZLE FLASH -- level half. Allocated ONCE at intensity 0 and only ever
    // modulated: adding or removing a light at runtime forces a TSL shader
    // recompile, which would hitch on every trigger pull.
    flashLight = new THREE.PointLight(0xffd0a0, 0, 9, 2);
    flashLight.position.copy(flashGroup.position);
    viewModelAnchor.add(flashLight);
```

Declare alongside the other flash state: `let flashLight: THREE.PointLight | null = null;`

- [ ] **Step 2: Drive the level light from the same envelope**

In the tick, beside the Task 5 flash block:

```typescript
    if (flashLight) flashLight.intensity = 26 * flashV;
```

- [ ] **Step 3: Fold the flash into the per-actor beam replay**

This is the half a `PointLight` cannot do. In `game-main.ts`, inside `handle.setDrawFn`, the block that starts `const sAxis = new THREE.Vector3();` computes `spotOn`, `cosInner` and `cosOuter` and then writes them into every actor. Add the flash bias immediately **before** the `for (const a of actors)` loop:

```typescript
      // MUZZLE FLASH -- the marched bodies. They cannot see the PointLight
      // above, so the flash rides the beam that is already replayed here.
      // Nothing is saved or restored: these uniforms are rewritten from the
      // flashlight every frame, so biasing this frame's values IS the effect.
      //
      // Added to spotOn rather than multiplied, so the flash still lights
      // bodies in the gallery rig where the flashlight gate is 0.
      // A WIDER cone is a SMALLER cosine, hence the subtraction.
      //
      // DELIBERATELY TEMPORARY: the right fix is a second light slot in the
      // march, which cannot land while sdf-render-perf-r2 is rewriting
      // march.wgsl.ts. Tracked under the spec's "Deferred".
      const fv = flashEnvelope(flashAge);
      const flashGate  = spotOn + 6 * fv;
      const flashInner = Math.max(-1, cosInner - 0.45 * fv);
      const flashOuter = Math.max(-1, cosOuter - 0.45 * fv);
```

Then change the three assignment lines inside the loop to use them:

```typescript
        a.view.uniforms.spotCfg.value.set(flashGate, flashInner, flashOuter, flashlight.spot.distance);
        a.view.uniforms.spotColor.value.copy(flashlight.spot.color);
        if (fv > 0) {
          // Push warm. The flash is burning powder, not the flashlight's white.
          const c = a.view.uniforms.spotColor.value;
          c.setRGB(c.r + 0.35 * fv, c.g + 0.16 * fv, c.b);
        }
```

**Declaration order matters here.** `setDrawFn` is registered around line 483, well before `flashAge` is declared with the gun block around line 1015. That is safe — the callback only runs after boot finishes, by which point the `let` is initialised — but this file already carries a temporal-dead-zone scar at line 480 (`chunkObjects` goes through an indirection for exactly this reason). If you hit a TDZ `ReferenceError`, hoist `let flashAge = Infinity;` above `setDrawFn` rather than adding another indirection.

Leave `spotPos` and `spotAxis` alone. The muzzle and the flashlight offset are both within ~0.5 m of the eye, so moving the origin buys almost nothing and would visibly jump the beam for the flash frames.

- [ ] **Step 4: Verify the bodies actually light**

Run `npm run dev`, open `sdf-game.html`, stand in a dark room facing a zombie, and fire. The zombie must visibly brighten and warm for the flash frame, and the beam must return to normal immediately after.

If the walls brighten but the zombie does not, the bias was added after the `for (const a of actors)` loop instead of before it — the loop is what writes the uniforms.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "flash: light the level and the marched bodies from one envelope"
```

---

### Task 7: Magazine and reload

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (`fire()`, the keydown handler, the tick)

- [ ] **Step 1: Add the state**

Next to `let cooldown = 0;`:

```typescript
  /** Shells in the gun. The reload animation only means something if running
   *  dry is a state the player can be in. */
  let shells = MAGAZINE_CAPACITY;
  /** Seconds into the reload, or Infinity when not reloading. */
  let reloadAge = Infinity;
```

- [ ] **Step 2: Gate `fire()` on ammo, and auto-reload when dry**

Replace the guard line in `fire()`:

```typescript
    if (!gunReady || cooldown > 0) return false;
    if (reloadAge <= RELOAD.totalSec) return false;   // busy breaking/loading
    if (shells <= 0) { reloadAge = 0; return false; } // click -> start reloading
```

And after `recoilPitch += ...`:

```typescript
    shells = magazineAfterFire(shells, barrels);
    if (shells <= 0) reloadAge = 0;
```

- [ ] **Step 3: Bind `R` to an early reload**

In the keydown handler beside the `KeyE` line (`game-main.ts:978`):

```typescript
    if (e.code === 'KeyR' && shells < MAGAZINE_CAPACITY && reloadAge > RELOAD.totalSec) {
      reloadAge = 0;
    }
```

- [ ] **Step 4: Drive the hinge and the beats in the tick**

Beside the flash tick:

```typescript
    if (reloadAge <= RELOAD.totalSec) {
      reloadAge += dt;
      const phase = reloadPhaseAt(reloadAge);
      // BREAK: the pivot group built at load time is already parked on the
      // hinge, so this one rotation is the whole thing.
      if (hingePivot) hingePivot.rotation.x = hingeOpenFraction(reloadAge) * RELOAD.openRad;
      // PRESENT: roll the gun up and toward the camera so the breech is visible.
      if (gunGroup) {
        const present = Math.sin(Math.PI * Math.min(1, reloadAge / RELOAD.totalSec));
        gunGroup.rotation.z = THREE.MathUtils.degToRad(-4.5 - 16 * present);
        gunGroup.position.y = -0.115 + 0.055 * present;
      }
      // LOAD: the support hand dips out of frame and returns with the shells.
      if (foreHandGroup) {
        const dip = phase === 'load' ? 1 : 0;
        foreHandGroup.position.y = -0.150 - 0.13 * dip;
      }
      if (phase === 'done') {
        shells = MAGAZINE_CAPACITY;
        reloadAge = Infinity;
        if (hingePivot) hingePivot.rotation.x = 0;
        if (gunGroup) {
          gunGroup.rotation.z = THREE.MathUtils.degToRad(-4.5);
          gunGroup.position.y = -0.115;
        }
        if (foreHandGroup) foreHandGroup.position.y = -0.150;
      }
    }
```

- [ ] **Step 5: Show the count in the HUD**

Find `updateHud()` and add the shell count to its output string, e.g. `` `shells ${shells}/${MAGAZINE_CAPACITY}` ``. Call `updateHud()` wherever `shells` changes.

- [ ] **Step 6: Verify**

Run `npx tsc --noEmit` (expected: no errors), then `npm run dev`. Fire twice: the gun breaks open, the barrels swing DOWN and away from the frame (not through it), the support hand dips and returns, it snaps shut and the HUD returns to `2/2`. Press `R` after one shot: the same sequence runs.

If the barrels swing UP through the frame instead of down, negate `RELOAD.openRad` at the call site — do not change the constant, which Task 2's tests pin. If they swing about the wrong point entirely, the pivot group in Task 4 Step 2 did not get the barrels reparented into it.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "reload: two shells, and a break that actually opens"
```

---

### Task 8: Captures, gates and the status board

**Files:**
- Create: `docs/dev-notes/2026-09-02-fpv-weapon-shorty/notes.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS. Record the total count in the notes. If anything unrelated fails, note it as pre-existing with the failing test's name — do not fix it here.

- [ ] **Step 2: Typecheck and build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Capture the gates**

Take four in-engine screenshots from `sdf-game.html` into `docs/dev-notes/2026-09-02-fpv-weapon-shorty/`:

1. `gate-fpv.png` — the gun at rest. **This is the look gate**, not the Blender FPV render.
2. `gate-flash-zombie.png` — mid-flash with a zombie in frame, proving the marched body is lit. This is the one a `PointLight` alone cannot produce.
3. `gate-reload-strip.png` — six frames at the beat boundaries (0.10, 0.26, 0.40, 0.55, 0.74, 0.90 s).
4. `gate-hands.png` — a close view of the orbs showing the warty normal map.

- [ ] **Step 4: Write the notes**

`notes.md` records: the `npm test` count, the `[shorty] OK` gate line with its tri count, which gates passed, and — explicitly — that the flash's borrow of the flashlight uniforms is temporary pending a second march light slot.

- [ ] **Step 5: Update the status board**

Add a row to `TASKS.md` under Current focus recording the spec, this plan, and that the flash borrow is a known temporary.

- [ ] **Step 6: Commit**

```bash
git add docs/dev-notes/2026-09-02-fpv-weapon-shorty/ TASKS.md
git commit -m "shorty: the gates, the captures and the status row"
```

---

## Owner look gate

After Task 8, **stop and get the owner's eyes on `gate-fpv.png` and `gate-reload-strip.png`** before anything becomes the default or merges. The FPV framing numbers in Task 4 are the model script's preview values; they are expected to need one live tuning pass, and that pass is the owner's call.
