# FPV Goblin Arms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the FPV's two flat green tubes with Blender-authored goblin arms — thicker skin with ball joints that reads as mottled goblin hide (no glow), a leather bracer with brass hardware matching the shotgun, and a smartwatch with a glowing, drawable screen on the left wrist — and put the same watch on the third-person goblin's kit.

**Architecture:** A headless Blender script (`scripts/model_goblin_arm.py`, the shotgun script's pattern) builds both arms and exports `public/assets/lab/goblin-arm.glb` with named nodes, gated on tri count, size, node contract and UV presence. A new runtime module `src/lab/sdf-zombie/webgpu/game-arms.ts` loads it, applies generated skin maps (`goblin-skin.ts` gains a tiling colour map) and the watch's canvas screen, and hands two arm groups to `game-main.ts`, which swaps them in where the sphere+capsule hands were. Pure math (arm basis, material mapping) lives in `game-arms-math.ts` so it is unit-tested without Three. Kit parity is two lines of WAM plus a test.

**Tech Stack:** TypeScript, Three.js (`three/webgpu`), vitest, Blender 4.x headless (`/opt/homebrew/bin/blender`), WAM (`~/Projects/2026/wam`, via `scripts/build-wam-kit.sh`), the CDP gate `scripts/sdf-game-shorty-gate.sh`.

**Spec:** [docs/superpowers/specs/2026-09-04-fpv-goblin-arms-design.md](../specs/2026-09-04-fpv-goblin-arms-design.md)

---

## Conventions every task relies on

* **Run from the worktree root.** All paths below are relative to it.
* **Tests:** `npx vitest run <file>`; **typecheck:** `npx tsc --noEmit -p .`
* **Blender:** `/opt/homebrew/bin/blender -b -noaudio -P <script>`. The shotgun script overwrites tracked renders in `docs/dev-notes/2026-09-02-fpv-weapon-shorty/`; the arm script writes ONLY to `docs/dev-notes/2026-09-04-fpv-goblin-arms/`, so nothing needs restoring.
* **Gate:** `LAB_VITE_PORT=5287 LAB_CDP_PORT=9287 GAME_OUT=<dir> bash scripts/sdf-game-shorty-gate.sh` (pick a free port pair if those are taken).
* **Axes.** Blender is Z-up; the glTF export is Y-up: Blender `(x, y, z)` → glTF `(x, z, -y)`. The arm is authored along Blender **+Z** (hand at the origin, elbow at z 0.235) so that in glTF/Three **local +Y runs hand → elbow**. Dorsal (back of the hand, watch, knuckles) is Blender **−Y** → Three **+Z**.
* **Commit after every task** with the message given. Attribution trailer on every commit:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`

## File structure

| File | Role |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/goblin-skin.ts` | **modify** — add `goblinAlbedoPixels(size, seed)`, a tiling sRGB colour map with the blob's mottle patches + wart darkening |
| `src/lab/sdf-zombie/webgpu/goblin-skin.test.ts` | **modify** — tests for the albedo map |
| `src/lab/sdf-zombie/webgpu/game-arms-math.ts` | **create** — `ARM_NODES`, `armMaterialKind`, `armBasis`; no Three import |
| `src/lab/sdf-zombie/webgpu/game-arms-math.test.ts` | **create** |
| `scripts/model_goblin_arm.py` | **create** — builds, exports, verifies, gates, renders |
| `public/assets/lab/goblin-arm.glb` | **generated** by the script; committed like `shorty-double.glb` |
| `src/lab/sdf-zombie/webgpu/game-arms.ts` | **create** — `loadGoblinArms`, `makeSkinMaterial`, `makeWatchScreen`, `drawWatchFace`, `aimArm` |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | **modify** — replace the sphere+capsule hands with the two arm groups; `__sdfGame.arms` seam; `setGunTuning` hand knobs |
| `scripts/sdf-game-shorty-gate.mjs` | **modify** — check 2b (arms present, skin has no emissive, watch present) |
| `src/lab/sdf-zombie/characters/goblin-kit.wam` | **modify** — watch band + body on `forearm.l` |
| `public/assets/lab/goblin-kit.gltf` | **regenerated** by `scripts/build-wam-kit.sh goblin` |
| `src/lab/sdf-zombie/characters/goblin-kit.test.ts` | **modify** — material list + watch-is-left-only test |
| `docs/dev-notes/2026-09-04-fpv-goblin-arms/` | **create** — turntable renders, gate frames, notes.md |
| `TASKS.md` | **modify** — F-arm.1 status |

---

### Task 1: The skin colour map — `goblinAlbedoPixels`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/goblin-skin.ts` (append after `goblinNormalPixels`)
- Test: `src/lab/sdf-zombie/webgpu/goblin-skin.test.ts`

Today the hand material is base green + a wart **normal** map + `emissive 0.30`. The emissive is what flattens it, and with only a normal map the colour never varies. This adds a tiling colour map: the blob's `baseColor` with `mottleColor (0.21, 0.19, 0.06)` patches mixed in at `mottleAmp`, plus a faint dark ring around each wart, on the SAME lattice/seed as the normal map so bumps and blotches agree.

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/webgpu/goblin-skin.test.ts` (add `goblinAlbedoPixels` to the existing import from `./goblin-skin`):

```ts
describe('goblinAlbedoPixels', () => {
  const size = 64;
  const px = goblinAlbedoPixels(size);

  it('is deterministic — same size, identical bytes', () => {
    expect(goblinAlbedoPixels(size)).toEqual(px);
  });

  it('returns opaque RGBA for every texel', () => {
    expect(px.length).toBe(size * size * 4);
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255);
  });

  it('averages to the goblin base colour, within 8% — mottle darkens, it does not recolour', () => {
    const base = goblinSkinSrgbHex();
    const want = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let i = c; i < px.length; i += 4) sum += px[i]!;
      const mean = sum / (size * size);
      expect(Math.abs(mean - want[c]!) / want[c]!, `channel ${c} mean ${mean} vs ${want[c]}`).toBeLessThan(0.08);
    }
  });

  it('is not flat — every channel varies by more than 6 byte-steps of standard deviation', () => {
    for (let c = 0; c < 3; c++) {
      let sum = 0, sq = 0;
      for (let i = c; i < px.length; i += 4) { sum += px[i]!; sq += px[i]! * px[i]!; }
      const n = size * size, mean = sum / n;
      const sd = Math.sqrt(sq / n - mean * mean);
      expect(sd, `channel ${c} sd`).toBeGreaterThan(6);
    }
  });

  it('tiles — opposite edge rows and columns agree within one step', () => {
    for (let y = 0; y < size; y++) {
      for (let c = 0; c < 3; c++) {
        const l = px[(y * size + 0) * 4 + c]!, r = px[(y * size + size - 1) * 4 + c]!;
        expect(Math.abs(l - r), `row ${y} ch ${c}`).toBeLessThanOrEqual(6);
      }
    }
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        const t = px[(0 * size + x) * 4 + c]!, b = px[((size - 1) * size + x) * 4 + c]!;
        expect(Math.abs(t - b), `col ${x} ch ${c}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('darkens where the normal map has a wart, so bumps and blotches agree', () => {
    // The wart layer is tileNoise(u*6, v*6, 6, seed 7) > 0.55 in height(). Find
    // the darkest texel and the brightest; the darkest must sit on a wart.
    let dark = Infinity, darkAt = 0;
    for (let i = 0; i < px.length; i += 4) {
      const lum = px[i]! + px[i + 1]! + px[i + 2]!;
      if (lum < dark) { dark = lum; darkAt = i / 4; }
    }
    const u = (darkAt % size) / size, v = Math.floor(darkAt / size) / size;
    expect(goblinWartField(u, v)).toBeGreaterThan(0.55);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/goblin-skin.test.ts`
Expected: FAIL — `goblinAlbedoPixels is not a function` (and `goblinWartField`).

- [ ] **Step 3: Implement**

In `src/lab/sdf-zombie/webgpu/goblin-skin.ts`, add to `GOBLIN_SKIN` (after `mottleAmp`):

```ts
  /** `mottleColor 0.21 0.19 0.06` -- the patch colour, LINEAR rgb. */
  mottleColorLinear: [0.21, 0.19, 0.06] as const,
```

Then append after `goblinNormalPixels`:

```ts
/** The wart layer of the height field on its own, 0..1, on the same lattice
 *  and seed `height()` uses -- so the colour map can darken exactly where the
 *  normal map bumps. Exported for the test that pins that agreement. */
export function goblinWartField(u: number, v: number): number {
  const base = 3;
  return tileNoise(u * base * 2, v * base * 2, base * 2, 7);
}

/**
 * A tiling sRGB colour map, RGBA, `size` x `size`: the goblin's base green
 * with the blob's mottle patches mixed in, and a soft dark ring on each wart.
 *
 * WHY A COLOUR MAP. With only a normal map the hand was one flat green that
 * a 0.30 emissive then washed out completely (the owner's "thin green
 * tubes"). Colour variation at mottleScale is what the marched goblin has
 * and what reads at arm's length; the normal map alone reads only in
 * specular. Same lattice and seeds as the height field, so the two agree.
 */
export function goblinAlbedoPixels(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const [br, bg, bb] = GOBLIN_SKIN.baseLinear;
  const [mr, mg, mb] = GOBLIN_SKIN.mottleColorLinear;
  const base = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Mottle: two octaves, centred on 0 so the MEAN stays the base colour.
      let m = tileNoise(u * base, v * base, base, 1) * 0.65
            + tileNoise(u * base * 2, v * base * 2, base * 2, 2) * 0.35;
      m = (m - 0.5) * 2 * GOBLIN_SKIN.mottleAmp;          // -amp .. +amp
      const k = Math.max(0, m) * 0.55;                    // only the dark half mixes toward mottleColor
      // Warts: a soft ring of darkening, strongest at the wart's crown.
      const w = Math.pow(Math.max(0, goblinWartField(u, v) - 0.55) / 0.45, 1.5) * 0.45;
      const mix = Math.min(1, k + w);
      const lin = [
        br + (mr - br) * mix + Math.min(0, m) * 0.10 * br,
        bg + (mg - bg) * mix + Math.min(0, m) * 0.10 * bg,
        bb + (mb - bb) * mix + Math.min(0, m) * 0.10 * bb,
      ];
      const i = (y * size + x) * 4;
      px[i]     = linearToSrgbByte(lin[0]!);
      px[i + 1] = linearToSrgbByte(lin[1]!);
      px[i + 2] = linearToSrgbByte(lin[2]!);
      px[i + 3] = 255;
    }
  }
  return px;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/goblin-skin.test.ts`
Expected: PASS (all). If the mean test fails by a small margin, lower the `0.55` mix factor toward `0.45`; if the sd test fails, raise it. Do not touch the tiling — `tileNoise` wraps by construction.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: no output.

```bash
git add src/lab/sdf-zombie/webgpu/goblin-skin.ts src/lab/sdf-zombie/webgpu/goblin-skin.test.ts
git commit -m "goblin-skin: a tiling colour map with the blob's mottle patches (F-arm.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Arm math without Three — `game-arms-math.ts`

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-arms-math.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-arms-math.test.ts`

The arm group's origin is the hand; its quaternion must point local +Y at the elbow anchor AND keep local +Z (the dorsal side, where the watch is) facing the camera as far as the geometry allows. That basis, and the GLB material-name → treatment mapping, are pure functions.

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/webgpu/game-arms-math.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-arms-math.test.ts
import { describe, expect, it } from 'vitest';
import { ARM_NODES, armBasis, armMaterialKind, type V3 } from './game-arms-math';

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];

describe('armBasis', () => {
  const dir: V3 = [-0.4, -0.5, 0.3];
  const hint: V3 = [0, 0, 1];
  const b = armBasis(dir, hint);

  it('points local +Y along the hand-to-elbow direction, unit length', () => {
    expect(len(b.y)).toBeCloseTo(1, 9);
    const d = len(dir);
    expect(dot(b.y, [dir[0] / d, dir[1] / d, dir[2] / d])).toBeCloseTo(1, 9);
  });
  it('is orthonormal and right-handed', () => {
    for (const v of [b.x, b.y, b.z]) expect(len(v)).toBeCloseTo(1, 9);
    expect(dot(b.x, b.y)).toBeCloseTo(0, 9);
    expect(dot(b.y, b.z)).toBeCloseTo(0, 9);
    expect(dot(b.x, b.z)).toBeCloseTo(0, 9);
    expect(dot(cross(b.x, b.y), b.z)).toBeCloseTo(1, 9);
  });
  it('turns the dorsal side (+Z) toward the hint as far as the arm allows', () => {
    // z is the hint with its along-arm component removed: positive dot, and
    // no other unit vector perpendicular to y is closer to the hint.
    expect(dot(b.z, hint)).toBeGreaterThan(0);
    const h = len(dir);
    const along = dot(hint, b.y);
    const rest: V3 = [hint[0] - b.y[0] * along, hint[1] - b.y[1] * along, hint[2] - b.y[2] * along];
    const r = len(rest);
    expect(dot(b.z, [rest[0] / r, rest[1] / r, rest[2] / r])).toBeCloseTo(1, 9);
    expect(h).toBeGreaterThan(0);
  });
  it('still returns an orthonormal basis when the hint is parallel to the arm', () => {
    const p = armBasis([0, 0, 2], [0, 0, 1]);
    for (const v of [p.x, p.y, p.z]) expect(len(v)).toBeCloseTo(1, 9);
    expect(dot(p.y, p.z)).toBeCloseTo(0, 9);
    expect(dot(cross(p.x, p.y), p.z)).toBeCloseTo(1, 9);
  });
});

describe('armMaterialKind', () => {
  it('maps every GLB material name, and strips Blender suffixes', () => {
    expect(armMaterialKind('Skin')).toBe('skin');
    expect(armMaterialKind('Skin.001')).toBe('skin');
    expect(armMaterialKind('Leather')).toBe('leather');
    expect(armMaterialKind('Steel')).toBe('steel');
    expect(armMaterialKind('Brass')).toBe('brass');
    expect(armMaterialKind('Band')).toBe('band');
    expect(armMaterialKind('WatchBody')).toBe('watchBody');
    expect(armMaterialKind('Screen')).toBe('screen');
  });
  it('is null for anything else, so the loader can be loud about it', () => {
    expect(armMaterialKind('Wood')).toBeNull();
    expect(armMaterialKind('')).toBeNull();
  });
});

describe('ARM_NODES', () => {
  it('names both arms, three locators each, and the screen', () => {
    expect([...ARM_NODES].sort()).toEqual([
      'Arm_L', 'Arm_R', 'Elbow_L', 'Elbow_R', 'Hand_L', 'Hand_R',
      'Watch_Screen', 'Wrist_L', 'Wrist_R',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-arms-math.test.ts`
Expected: FAIL — cannot find module `./game-arms-math`.

- [ ] **Step 3: Implement**

Create `src/lab/sdf-zombie/webgpu/game-arms-math.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-arms-math.ts
//
// The FPV arms' pure half: the node contract, the material-name mapping, and
// the basis that aims an arm. No Three import, so it is tested as numbers --
// the same split game-viewmodel.ts uses for the reload.

export type V3 = readonly [number, number, number];

/** Every node game-arms.ts requires in goblin-arm.glb. A missing one throws
 *  at load, like the gun: a silently absent locator is an arm that aims at
 *  nothing and reads as a bug three tasks later. */
export const ARM_NODES = [
  'Arm_L', 'Arm_R', 'Hand_L', 'Hand_R', 'Wrist_L', 'Wrist_R',
  'Elbow_L', 'Elbow_R', 'Watch_Screen',
] as const;
export type ArmNode = typeof ARM_NODES[number];

export type ArmMaterialKind =
  | 'skin' | 'leather' | 'steel' | 'brass' | 'band' | 'watchBody' | 'screen';

const KINDS: Record<string, ArmMaterialKind> = {
  Skin: 'skin', Leather: 'leather', Steel: 'steel', Brass: 'brass',
  Band: 'band', WatchBody: 'watchBody', Screen: 'screen',
};

/** GLB material name -> runtime treatment. Blender appends `.001` when a
 *  name collides on import/export; the exporter can carry that through. */
export function armMaterialKind(name: string): ArmMaterialKind | null {
  const base = name.split('.')[0] ?? '';
  return KINDS[base] ?? null;
}

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * An orthonormal right-handed basis for an arm whose origin is the hand:
 * `y` runs along `dir` (hand -> elbow), `z` is `dorsalHint` with its
 * along-arm component removed (so the back of the hand -- the watch -- faces
 * the hint, normally the camera at rig +Z), `x = y cross z`.
 *
 * A hint parallel to the arm has no perpendicular part; fall back to rig +X
 * so the basis stays orthonormal instead of collapsing.
 */
export function armBasis(dir: V3, dorsalHint: V3): { x: V3; y: V3; z: V3 } {
  const y = norm(dir);
  const along = dorsalHint[0] * y[0] + dorsalHint[1] * y[1] + dorsalHint[2] * y[2];
  let z: V3 = [dorsalHint[0] - y[0] * along, dorsalHint[1] - y[1] * along, dorsalHint[2] - y[2] * along];
  if (Math.hypot(z[0], z[1], z[2]) < 1e-6) {
    const alt: V3 = [1, 0, 0];
    const a2 = alt[0] * y[0] + alt[1] * y[1] + alt[2] * y[2];
    z = [alt[0] - y[0] * a2, alt[1] - y[1] * a2, alt[2] - y[2] * a2];
  }
  z = norm(z);
  const x = cross(y, z);
  return { x, y, z };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-arms-math.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p .
git add src/lab/sdf-zombie/webgpu/game-arms-math.ts src/lab/sdf-zombie/webgpu/game-arms-math.test.ts
git commit -m "game-arms-math: arm basis and material mapping, tested without Three (F-arm.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The asset — `scripts/model_goblin_arm.py`

**Files:**
- Create: `scripts/model_goblin_arm.py`
- Generates: `public/assets/lab/goblin-arm.glb`, `docs/dev-notes/2026-09-04-fpv-goblin-arms/turntable-{0..3}.png`

The script has no unit test; its **gate is the script itself** (`[goblin-arm] OK` / `FAIL`), like the shotgun's. The verify step re-imports the GLB and asserts the runtime contract.

- [ ] **Step 1: Write the script**

Create `scripts/model_goblin_arm.py`:

```python
# scripts/model_goblin_arm.py: builds the FPV goblin arms and exports
# public/assets/lab/goblin-arm.glb. Run headless:
#
#   /opt/homebrew/bin/blender -b -noaudio -P scripts/model_goblin_arm.py
#
# Prints "[goblin-arm] OK" or "[goblin-arm] FAIL: ..." and exits 1 on failure.
# Same pattern as model_grapeshot_shorty.py: build, export, RE-IMPORT and
# verify the runtime contract, gate, then render evidence. Writes only to
# docs/dev-notes/2026-09-04-fpv-goblin-arms/ (no tracked file elsewhere).
#
# FRAME (Blender space, before export): the hand centre is the origin and the
# arm runs along +Z toward the elbow. glTF Y-up export maps Blender +Z to glTF
# +Y, which is the local +Y game-arms.ts aims at the elbow anchor. Dorsal --
# the back of the hand, knuckles, rivets, watch -- is Blender -Y, which lands
# on Three +Z: the side armBasis() turns toward the camera.
#
# The left arm is authored; the right is the same build with x negated
# (build_arm(sx=-1)) so nothing is mirrored by a negative scale, which flips
# winding on export. The watch exists on the left only.
import bpy, bmesh, math, sys, os
from mathutils import Vector

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB   = os.path.join(REPO_ROOT, "public", "assets", "lab", "goblin-arm.glb")
NOTES_DIR = os.path.join(REPO_ROOT, "docs", "dev-notes", "2026-09-04-fpv-goblin-arms")
os.makedirs(NOTES_DIR, exist_ok=True)

# ---- numbers ---------------------------------------------------------------
HAND_R   = 0.046          # == GOBLIN_SKIN.handRadius; loadHold() depends on it
WRIST_Z, ELBOW_Z, STUB_Z = 0.055, 0.235, 0.70
WRIST_R, FORE_R0, FORE_R1, ELBOW_R, STUB_R = 0.034, 0.036, 0.042, 0.046, 0.040
BRACER_Z0, BRACER_Z1 = 0.075, 0.180
STRAP_Z = (0.100, 0.155)
TILE_M   = 0.060          # one tile of the generated skin maps per 60 mm of arm
TRI_CAP  = 14000

REQUIRED_NODES = ["Arm_L", "Arm_R", "Hand_L", "Hand_R", "Wrist_L", "Wrist_R",
                  "Elbow_L", "Elbow_R", "Watch_Screen"]

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
col = bpy.data.collections.new('Arm'); bpy.context.scene.collection.children.link(col)

def M(n, base, met, rough):
    m = bpy.data.materials.new(n); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = base
    b.inputs["Metallic"].default_value = met
    b.inputs["Roughness"].default_value = rough
    return m
MATS = {
    'Skin':      M('Skin',      (0.34, 0.44, 0.19, 1),   0.0, 0.42),   # goblin.blob palette
    'Leather':   M('Leather',   (0.14, 0.09, 0.06, 1),   0.0, 0.75),
    'Steel':     M('Steel',     (0.205, 0.215, 0.245, 1), 1.0, 0.22),  # == model_grapeshot_shorty.py
    'Brass':     M('Brass',     (0.62, 0.44, 0.16, 1),   1.0, 0.28),   # == model_grapeshot_shorty.py
    'Band':      M('Band',      (0.035, 0.035, 0.04, 1), 0.0, 0.60),
    'WatchBody': M('WatchBody', (0.06, 0.06, 0.07, 1),   0.6, 0.35),
    'Screen':    M('Screen',    (0.02, 0.03, 0.04, 1),   0.0, 0.20),
}

# ---- mesh helpers ---------------------------------------------------------
def sphere(r, segs=24, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    me = bpy.data.meshes.new('s'); bm.to_mesh(me); bm.free(); return me

def frustum(r0, r1, d, segs=24):
    """r0 at -d/2, r1 at +d/2, along local Z, capped."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=r0, radius2=r1, depth=d)
    me = bpy.data.meshes.new('f'); bm.to_mesh(me); bm.free(); return me

def lathe(profile, segs=28, name='lathe'):
    """A closed (r, z) polygon spun about local Z. Outer edge listed going up,
    inner edge coming back down gives a hollow band WITH thickness -- the
    cuff, straps, lip plate and watch band are all this."""
    bm = bmesh.new(); rings = []
    for (r, z) in profile:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs),
                                    r * math.sin(2 * math.pi * i / segs), z))
                      for i in range(segs)])
    n = len(profile)
    for j in range(n):
        a, b = rings[j], rings[(j + 1) % n]
        for i in range(segs):
            k = (i + 1) % segs
            bm.faces.new((a[i], a[k], b[k], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); return me

def box(sx, sy, sz):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    me = bpy.data.meshes.new('b'); bm.to_mesh(me); bm.free(); return me

def plane_uv(w, h):
    """One quad in the XZ plane facing -Y (dorsal), UVs 0..1 -- the watch
    screen. game-arms.ts maps a canvas straight onto it."""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
    v = [bm.verts.new(p) for p in ((-w/2, 0, -h/2), (w/2, 0, -h/2), (w/2, 0, h/2), (-w/2, 0, h/2))]
    f = bm.faces.new(v)
    for l, st in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        l[uv].uv = st
    bm.normal_update()
    if f.normal.y > 0:
        bmesh.ops.reverse_faces(bm, faces=[f])
    me = bpy.data.meshes.new('screen'); bm.to_mesh(me); bm.free(); return me

def cyl_uv(obj, tile=TILE_M):
    """Cylindrical UVs about local Z: u around, v along, one tile per `tile`
    metres. The wrap seam is fixed PER FACE (a quad may not span u 0.98 ->
    0.02, or the whole map streaks backward across it). The generated maps
    tile, so the seam itself is invisible. A skin mesh WITHOUT UVs samples one
    texel -- flat green, the thing this asset exists to remove -- and the gate
    below rejects it."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        us = []
        for l in f.loops:
            x, y, z = l.vert.co
            us.append((math.atan2(y, x) / (2 * math.pi)) % 1.0)
            l[uv].uv = (0.0, z / tile)
        if max(us) - min(us) > 0.5:
            us = [u + 1.0 if u < 0.5 else u for u in us]
        for l, u in zip(f.loops, us):
            l[uv].uv = (u, l[uv].uv.y)
    bm.to_mesh(obj.data); bm.free()

def put(me, name, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, segs=2,
        smooth=True, uv=False):
    o = bpy.data.objects.new(name, me); col.objects.link(o)
    o.location = loc; o.rotation_euler = rot; o.parent = parent
    bpy.context.view_layer.objects.active = o
    if bevel:
        b = o.modifiers.new('bv', 'BEVEL'); b.width = bevel; b.segments = segs
        b.limit_method = 'ANGLE'; b.angle_limit = math.radians(32)
        bpy.ops.object.modifier_apply(modifier='bv')
    o.data.materials.append(MATS[mat])
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    if uv:
        cyl_uv(o)
    return o

def locator(name, parent, loc):
    e = bpy.data.objects.new(name, None); col.objects.link(e)
    e.location = loc; e.empty_display_size = 0.01; e.parent = parent
    return e

# ---- the arm ----------------------------------------------------------------
def fore_r(z):
    """Forearm radius at height z: a taper from the wrist to the elbow."""
    return FORE_R0 + (FORE_R1 - FORE_R0) * (z - WRIST_Z) / (ELBOW_Z - WRIST_Z)

def build_arm(sx, tag, watch):
    root = bpy.data.objects.new(f'Arm_{tag}', None); col.objects.link(root)
    P = lambda x, y, z: (sx * x, y, z)

    # SKIN. Ball joints on purpose (the blob's stylisation: "a shaft alone
    # reads as a pipe"), radii up from the blob's 0.028 shaft per the owner.
    put(sphere(HAND_R, 24, 16), f'hand_{tag}', 'Skin', root, uv=True)
    # Three knuckle nubs on the back of the fist (dorsal = -Y).
    for i, (x, y, z) in enumerate(((-0.018, -0.036, 0.012), (0.0, -0.040, 0.016), (0.018, -0.036, 0.012))):
        put(sphere(0.011, 12, 8), f'knuckle{i}_{tag}', 'Skin', root, loc=P(x, y, z), uv=True)
    put(sphere(WRIST_R, 16, 12), f'wrist_{tag}', 'Skin', root, loc=(0, 0, WRIST_Z), uv=True)
    put(frustum(FORE_R0, FORE_R1, ELBOW_Z - WRIST_Z, 24), f'forearm_{tag}', 'Skin', root,
        loc=(0, 0, (WRIST_Z + ELBOW_Z) / 2), uv=True)
    put(sphere(ELBOW_R, 16, 12), f'elbow_{tag}', 'Skin', root, loc=(0, 0, ELBOW_Z), uv=True)
    # Upper-arm stub: runs on past the elbow so the far end is never in frame
    # on a hard look down (the aim rig pitches the view-model about the grip).
    put(frustum(STUB_R, STUB_R, STUB_Z - ELBOW_Z, 16), f'upperarm_{tag}', 'Skin', root,
        loc=(0, 0, (ELBOW_Z + STUB_Z) / 2), uv=True)
    # Warts: on the hand, the wrist, and between bracer and elbow -- never
    # under the cuff, where they would be hidden geometry for nothing.
    for i, (x, y, z, r) in enumerate(((0.030, -0.030, -0.010, 0.004), (-0.026, -0.024, 0.030, 0.003),
                                      (0.022, -0.026, 0.062, 0.0035), (-0.030, 0.014, 0.198, 0.004),
                                      (0.012, -0.041, 0.216, 0.0035))):
        put(sphere(r, 8, 6), f'wart{i}_{tag}', 'Skin', root, loc=P(x, y, z), uv=True)

    # BRACER: leather cuff, steel lip at the wrist end, two straps with brass
    # buckles on the OUTER face (-X for the left arm; sx mirrors it), six
    # brass rivets along the dorsal ridge.
    z0, z1 = BRACER_Z0, BRACER_Z1
    cuff = [(fore_r(z0) + 0.007, z0), (fore_r(0.100) + 0.008, 0.100), (fore_r(0.130) + 0.009, 0.130),
            (fore_r(0.155) + 0.009, 0.155), (fore_r(z1) + 0.008, z1),
            (fore_r(z1) + 0.001, z1), (fore_r(z0) + 0.001, z0)]
    put(lathe(cuff, 28, 'cuff'), f'bracer_{tag}', 'Leather', root)
    lr = fore_r(z0)
    put(lathe([(lr + 0.009, z0 - 0.001), (lr + 0.009, z0 + 0.003), (lr + 0.001, z0 + 0.003), (lr + 0.001, z0 - 0.001)],
              28, 'lip'), f'lip_{tag}', 'Steel', root)
    for k, zs in enumerate(STRAP_Z):
        r = fore_r(zs) + 0.008
        put(lathe([(r + 0.0035, zs - 0.006), (r + 0.0035, zs + 0.006), (r - 0.001, zs + 0.006), (r - 0.001, zs - 0.006)],
                  28, 'strap'), f'strap{k}_{tag}', 'Leather', root)
        put(box(0.003, 0.012, 0.008), f'buckle{k}_{tag}', 'Brass', root, loc=P(-(r + 0.005), 0, zs),
            bevel=0.0006, smooth=False)
        put(box(0.0045, 0.0015, 0.010), f'pin{k}_{tag}', 'Brass', root, loc=P(-(r + 0.006), 0, zs),
            bevel=0, smooth=False)
    for k in range(6):
        zs = 0.085 + k * 0.016
        put(sphere(0.002, 8, 6), f'rivet{k}_{tag}', 'Brass', root, loc=(0, -(fore_r(zs) + 0.0085), zs))

    # SMARTWATCH, left wrist only: silicone band round the wrist ball, a
    # rounded-square body on the dorsal side, the screen a separate quad with
    # clean 0..1 UVs so a canvas maps onto it straight.
    if watch:
        zb = 0.050
        rb = math.sqrt(WRIST_R ** 2 - (zb - WRIST_Z) ** 2) + 0.0005   # on the wrist ball's surface
        put(lathe([(rb, zb - 0.004), (rb + 0.003, zb - 0.004), (rb + 0.003, zb + 0.004), (rb, zb + 0.004)],
                  28, 'band'), f'band_{tag}', 'Band', root)
        body_y = -(rb + 0.003 + 0.003)
        put(box(0.030, 0.006, 0.026), f'watchbody_{tag}', 'WatchBody', root, loc=(0, body_y, zb),
            bevel=0.0025, segs=3, smooth=False)
        put(plane_uv(0.024, 0.020), 'Watch_Screen', 'Screen', root, loc=(0, body_y - 0.0031, zb), smooth=False)

    locator(f'Hand_{tag}',  root, (0, 0, 0))
    locator(f'Wrist_{tag}', root, (0, 0, WRIST_Z))
    locator(f'Elbow_{tag}', root, (0, 0, ELBOW_Z))
    return root

ARM_L = build_arm(-1, 'L', watch=True)
ARM_R = build_arm(+1, 'R', watch=False)
bpy.context.view_layer.update()

# ---- export + verify ---------------------------------------------------------
def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True,
                              export_yup=True, export_extras=False)
    return os.path.getsize(path)

def verify_glb(path):
    """Re-import and assert the runtime contract game-arms.ts relies on."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    base = lambda o: o.name.split('.')[0]
    names = {base(o) for o in new}
    tris = 0; no_uv = []; hand_dim = None
    def under(o, root):
        p = o.parent
        while p is not None:
            if base(p) == root: return True
            p = p.parent
        return False
    for o in new:
        if o.type != 'MESH': continue
        o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
        mats = {m.name.split('.')[0] for m in o.data.materials if m}
        if 'Skin' in mats and not o.data.uv_layers:
            no_uv.append(o.name)
        if base(o) == 'hand_L':
            hand_dim = max(o.dimensions)
    screen = next((o for o in new if base(o) == 'Watch_Screen'), None)
    return {
        'tris': tris,
        'missing_nodes': sorted(set(REQUIRED_NODES) - names),
        'skin_without_uv': no_uv,
        'hand_dim': hand_dim,
        'screen_under_arm_l': bool(screen and under(screen, 'Arm_L')),
    }

size = export_glb(OUT_GLB)
info = verify_glb(OUT_GLB)
print(f"[goblin-arm] exported {OUT_GLB} ({size} bytes)")
print(f"[goblin-arm] verify: {info}")
ok = True
if size > 1024 * 1024:
    print(f"[goblin-arm] FAIL: glb {size} bytes over 1 MB", file=sys.stderr); ok = False
if info['tris'] > TRI_CAP:
    print(f"[goblin-arm] FAIL: {info['tris']} tris over {TRI_CAP}", file=sys.stderr); ok = False
if info['missing_nodes']:
    print(f"[goblin-arm] FAIL: missing nodes {info['missing_nodes']}", file=sys.stderr); ok = False
if info['skin_without_uv']:
    print(f"[goblin-arm] FAIL: skin meshes without UVs {info['skin_without_uv']} -- "
          f"they would sample one texel and read flat", file=sys.stderr); ok = False
if info['hand_dim'] is None or abs(info['hand_dim'] - 2 * HAND_R) > 0.002:
    print(f"[goblin-arm] FAIL: hand diameter {info['hand_dim']} != {2 * HAND_R} "
          f"(GOBLIN_SKIN.handRadius; loadHold depends on it)", file=sys.stderr); ok = False
if not info['screen_under_arm_l']:
    print("[goblin-arm] FAIL: Watch_Screen is not under Arm_L", file=sys.stderr); ok = False

# ---- render: a four-angle turntable of the LEFT arm --------------------------
# The imported copy is deleted first so the render shows the authored scene.
for o in list(bpy.data.objects):
    if o.name not in {ob.name for ob in col.objects}:
        bpy.data.objects.remove(o, do_unlink=True)
ARM_R.hide_render = True
for o in col.objects:
    if o.parent is ARM_R or (o.parent and o.parent.parent is ARM_R): o.hide_render = True
w = bpy.context.scene.world = bpy.data.worlds.new('W'); w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.16, 0.17, 0.19, 1)
sun = bpy.data.objects.new('S', bpy.data.lights.new('S', 'SUN')); sun.data.energy = 3.5
sun.rotation_euler = (math.radians(52), 0, math.radians(38)); bpy.context.collection.objects.link(sun)
rim = bpy.data.objects.new('R', bpy.data.lights.new('R', 'AREA')); rim.data.energy = 260; rim.data.size = 2.0
rim.location = (-1.2, 1.1, 0.9); rim.rotation_euler = (math.radians(60), 0, math.radians(-135))
bpy.context.collection.objects.link(rim)
cam = bpy.data.objects.new('C', bpy.data.cameras.new('C')); bpy.context.collection.objects.link(cam)
bpy.context.scene.camera = cam
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE'
sc.eevee.taa_render_samples = 64
sc.render.resolution_x = 860; sc.render.resolution_y = 640
ctr = Vector((0, 0, 0.12)); R = 0.55
for n, (az, el) in enumerate(((-90, 10), (-30, 20), (40, 15), (150, 25))):
    a = math.radians(az); e = math.radians(el)
    cam.location = ctr + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * R
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(NOTES_DIR, f'turntable-{n}.png')
    bpy.ops.render.render(write_still=True)

if not ok:
    sys.exit(1)
print("[goblin-arm] OK")
```

- [ ] **Step 2: Run the script**

Run: `/opt/homebrew/bin/blender -b -noaudio -P scripts/model_goblin_arm.py 2>&1 | grep -E "\[goblin-arm\]|Traceback|Error"`
Expected:
```
[goblin-arm] exported .../public/assets/lab/goblin-arm.glb (NNNNN bytes)
[goblin-arm] verify: {'tris': <under 14000>, 'missing_nodes': [], 'skin_without_uv': [], 'hand_dim': 0.092, 'screen_under_arm_l': True}
[goblin-arm] OK
```
If `tris` is over the cap, drop `sphere(HAND_R, 24, 16)` to `(20, 14)` and the forearm frustum to 20 segments before anything else. If `hand_dim` is off by more than the bound, the exporter applied a transform to the hand — check `export_apply` and that `hand_L` has no rotation.

- [ ] **Step 3: Look at the turntable**

Open `docs/dev-notes/2026-09-04-fpv-goblin-arms/turntable-1.png` (Read tool). Check: ball hand with three knuckles on the −Y side; a fatter forearm than the old capsule with wrist and elbow balls; the leather cuff with a steel lip, two straps with buckles on the −X side, rivets along −Y; the watch band and body at the wrist on the −Y side; nothing floating. Fix positions in `build_arm` and re-run until it reads.

- [ ] **Step 4: Commit the script, the GLB and the renders**

```bash
git add scripts/model_goblin_arm.py public/assets/lab/goblin-arm.glb docs/dev-notes/2026-09-04-fpv-goblin-arms/turntable-*.png
git commit -m "goblin-arm: Blender-authored FPV arms — ball joints, leather bracer with brass, smartwatch (F-arm.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The runtime module — `game-arms.ts`

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-arms.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-arms.test.ts` (the parts that need no GPU: material construction and the watch face draw)

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/webgpu/game-arms.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-arms.test.ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { drawWatchFace, makeSkinMaterial, aimArm, WATCH_SCREEN_SIZE } from './game-arms';
import { GOBLIN_SKIN } from './goblin-skin';

describe('makeSkinMaterial', () => {
  const env = new THREE.Texture();
  const m = makeSkinMaterial(env, 1.1);
  it('has NO emissive — the glow was what flattened the hands', () => {
    expect(m.emissiveIntensity).toBe(0);
  });
  it('carries a colour map AND a normal map, both tiling', () => {
    expect(m.map).not.toBeNull();
    expect(m.normalMap).not.toBeNull();
    expect(m.map!.wrapS).toBe(THREE.RepeatWrapping);
    expect(m.normalMap!.wrapT).toBe(THREE.RepeatWrapping);
    expect(m.map!.colorSpace).toBe(THREE.SRGBColorSpace);
  });
  it('is lit by the gun\'s environment at the gun\'s intensity, with the blob\'s roughness', () => {
    expect(m.envMap).toBe(env);
    expect(m.envMapIntensity).toBe(1.1);
    expect(m.roughness).toBeCloseTo(GOBLIN_SKIN.roughness, 6);
  });
});

describe('drawWatchFace', () => {
  it('draws a dark face with a ring and glyphs — records the calls it makes', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, k: string) => (..._a: unknown[]) => { calls.push(k); },
      set: () => true,
    });
    drawWatchFace(ctx, WATCH_SCREEN_SIZE.w, WATCH_SCREEN_SIZE.h);
    expect(calls).toContain('fillRect');   // background
    expect(calls).toContain('arc');        // the ring
    expect(calls.filter((c) => c === 'fillRect').length).toBeGreaterThan(3);  // glyph bars
  });
});

describe('aimArm', () => {
  it('points the arm\'s local +Y at the elbow and its +Z (the watch) toward rig +Z', () => {
    const arm = new THREE.Group();
    arm.position.set(-0.05, -0.18, -0.45);
    const elbow = new THREE.Vector3(-0.45, -0.60, 0.05);
    aimArm(arm, elbow);
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(arm.quaternion);
    const want = elbow.clone().sub(arm.position).normalize();
    expect(y.dot(want)).toBeCloseTo(1, 6);
    const z = new THREE.Vector3(0, 0, 1).applyQuaternion(arm.quaternion);
    expect(z.z).toBeGreaterThan(0);
    expect(Math.abs(z.dot(want))).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-arms.test.ts`
Expected: FAIL — cannot find module `./game-arms`.

- [ ] **Step 3: Implement**

Create `src/lab/sdf-zombie/webgpu/game-arms.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-arms.ts
//
// The FPV goblin arms: loads goblin-arm.glb, dresses it, and hands two arm
// groups (origin = hand centre, local +Y = toward the elbow) to game-main.
// Split out of game-main.ts (4,000+ lines) on purpose; the pure half is
// game-arms-math.ts.
//
// WHY A GLB AND NOT THE OLD SPHERE+CAPSULE. The owner's read of the capsule
// hands was "thin green tubes": one radius, one flat green, a 0.30 emissive
// that erased the normal map. The asset has ball joints, a real bracer with
// hardware matching the shotgun, and a smartwatch; the SKIN is dressed here
// from generated maps so it stays deterministic and pixel-testable.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GOBLIN_SKIN, goblinAlbedoPixels, goblinNormalPixels } from './goblin-skin';
import { ARM_NODES, armBasis, armMaterialKind, type V3 } from './game-arms-math';

export const GOBLIN_ARM_GLB = '/assets/lab/goblin-arm.glb';
export const WATCH_SCREEN_SIZE = { w: 128, h: 112 } as const;

export interface WatchScreen {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  /** Call after drawing on `canvas` so the GPU copy updates. */
  redraw(): void;
}

export interface GoblinArms {
  left: THREE.Group;
  right: THREE.Group;
  /** The one skin material both arms share. */
  skin: THREE.MeshStandardMaterial;
  screen: WatchScreen;
}

/** The goblin's skin: generated colour + normal maps, the blob's roughness,
 *  the gun's environment so it catches the same light -- and NO emissive. */
export function makeSkinMaterial(env: THREE.Texture, envMapIntensity: number): THREE.MeshStandardMaterial {
  const albedo = new THREE.DataTexture(goblinAlbedoPixels(256), 256, 256, THREE.RGBAFormat);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.needsUpdate = true;
  const normal = new THREE.DataTexture(goblinNormalPixels(256), 256, 256, THREE.RGBAFormat);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,               // the map carries the colour
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: GOBLIN_SKIN.roughness,
    metalness: 0,
    envMap: env,
    envMapIntensity,
  });
  m.emissiveIntensity = 0;
  return m;
}

/** A static smartwatch face: dark ground, a thin ring, a few glyph bars, a
 *  dot. No text -- nothing is readable at 25 mm and it must not try. The
 *  canvas is exposed so a later pass can draw shells / health / a timer. */
export function drawWatchFace(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#0b1014';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#4fd1c5';
  ctx.lineWidth = Math.max(2, w * 0.03);
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.46, w * 0.30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#4fd1c5';
  ctx.fillRect(w * 0.14, h * 0.86, w * 0.20, h * 0.06);
  ctx.fillRect(w * 0.40, h * 0.86, w * 0.12, h * 0.06);
  ctx.fillRect(w * 0.58, h * 0.86, w * 0.28, h * 0.06);
  ctx.fillRect(w * 0.47, h * 0.24, w * 0.06, h * 0.22);   // a "hand" of the ring
  ctx.fillStyle = '#ff7a59';
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.46, w * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

export function makeWatchScreen(): WatchScreen {
  const canvas = document.createElement('canvas');
  canvas.width = WATCH_SCREEN_SIZE.w; canvas.height = WATCH_SCREEN_SIZE.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[sdf-game] no 2d context for the watch screen');
  drawWatchFace(ctx, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture, redraw: () => { texture.needsUpdate = true; } };
}

/** The one emissive on the arms: the screen glows faintly in the dark. */
function makeScreenMaterial(screen: WatchScreen): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: screen.texture,
    emissive: 0xffffff,
    emissiveMap: screen.texture,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0,
  });
}

const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/** Aim an arm (origin = hand) so local +Y points at `elbow` and local +Z --
 *  the back of the hand, the watch -- faces rig +Z (the camera) as far as the
 *  arm allows. The hand never moves: only the arm swings behind it. */
export function aimArm(arm: THREE.Object3D, elbow: THREE.Vector3): void {
  _dir.copy(elbow).sub(arm.position);
  const b = armBasis([_dir.x, _dir.y, _dir.z] as V3, [0, 0, 1]);
  _x.set(b.x[0], b.x[1], b.x[2]); _y.set(b.y[0], b.y[1], b.y[2]); _z.set(b.z[0], b.z[1], b.z[2]);
  _m.makeBasis(_x, _y, _z);
  arm.quaternion.setFromRotationMatrix(_m);
}

/**
 * Load and dress the arms. Throws on a missing node or an unknown material
 * name -- like the gun, a quiet fallback here would be an arm that aims at
 * nothing or a screen with no glow, found three tasks later.
 */
export async function loadGoblinArms(
  url: string,
  opts: { env: THREE.Texture; envMapIntensity: number },
): Promise<GoblinArms> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const need = (n: string): THREE.Object3D => {
    const o = gltf.scene.getObjectByName(n);
    if (!o) throw new Error(`[sdf-game] goblin-arm.glb is missing the ${n} node`);
    return o;
  };
  for (const n of ARM_NODES) need(n);
  const left = need('Arm_L') as THREE.Group;
  const right = need('Arm_R') as THREE.Group;
  const skin = makeSkinMaterial(opts.env, opts.envMapIntensity);
  const screen = makeWatchScreen();
  const screenMat = makeScreenMaterial(screen);
  const dressed = new Map<THREE.Material, THREE.Material>();
  for (const root of [left, right]) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map((mat) => {
        const kind = armMaterialKind(mat.name);
        if (kind === null) throw new Error(`[sdf-game] goblin-arm.glb: unknown material ${JSON.stringify(mat.name)} on ${mesh.name}`);
        if (kind === 'skin') return skin;
        if (kind === 'screen') return screenMat;
        let d = dressed.get(mat);
        if (!d) {
          const std = mat as THREE.MeshStandardMaterial;
          std.envMap = opts.env;
          // Metal at the gun's intensity so steel and brass match the kit it
          // sits next to; leather and the watch's plastics take less.
          std.envMapIntensity = kind === 'steel' || kind === 'brass' ? opts.envMapIntensity : 0.6;
          std.needsUpdate = true;
          d = std; dressed.set(mat, d);
        }
        return d;
      });
      mesh.material = out.length === 1 ? out[0]! : out;
    });
  }
  // Detach from the loader's scene so the caller parents them where it likes.
  left.removeFromParent(); right.removeFromParent();
  left.position.set(0, 0, 0); right.position.set(0, 0, 0);
  return { left, right, skin, screen };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-arms.test.ts`
Expected: PASS (5 tests). `makeWatchScreen` and `loadGoblinArms` need a DOM/GPU and are exercised by the gate in Task 6, not here.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p .
git add src/lab/sdf-zombie/webgpu/game-arms.ts src/lab/sdf-zombie/webgpu/game-arms.test.ts
git commit -m "game-arms: load and dress the goblin arms — generated skin, no glow, a glowing watch screen (F-arm.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Wire the arms into `game-main.ts`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` — the imports (~line 32), the `FOREARM_LEN`/`aimForearm` block (search `const FOREARM_LEN`), the hand-building block (search `HANDS ARE GREEN ORBS`), the two `aimForearm(` call sites in the reload code (search `aimForearm(foreHandGroup`), `setGunTuning` (search `handEmissive`), and the `__sdfGame` seam object (search `get lastEjectOrigin`).

No new unit test: this is glue over tested parts; the gate in Task 6 is its test.

- [ ] **Step 1: Imports**

Replace the line
```ts
import { GOBLIN_SKIN, goblinNormalPixels, goblinSkinSrgbHex } from './goblin-skin';
```
with
```ts
import { GOBLIN_SKIN } from './goblin-skin';
import { GOBLIN_ARM_GLB, aimArm, loadGoblinArms, type GoblinArms } from './game-arms';
```
(`goblinSkinSrgbHex` / `goblinNormalPixels` have no other users in this file after this task; if `tsc` says otherwise, keep the import that is still used.)

- [ ] **Step 2: Remove the capsule forearm helper**

Delete the whole block from the comment `/** Forearm capsule length. Runs well past the elbow...` through the closing `}` of `function aimForearm(...)`. Keep `ELBOW_L` / `ELBOW_R` exactly as they are — they are the anchors `aimArm` targets.

Add, right after `let handMaterial: THREE.MeshStandardMaterial | null = null;`:
```ts
  /** The loaded arms, for the gate's seam. */
  let arms: GoblinArms | null = null;
```

- [ ] **Step 3: Replace the hand-building block**

Delete from the comment `// HANDS ARE GREEN ORBS -- deliberate, per the owner:` down to and including
```ts
    gripHandGroup = makeHand(GRIP_HAND_REST.clone(), ELBOW_R);
    foreHandGroup = makeHand(FORE_HAND_REST.clone(), ELBOW_L);
    (aimRig ?? viewModelAnchor).add(gripHandGroup, foreHandGroup);
```
and put in its place:
```ts
    // THE ARMS. goblin-arm.glb, dressed by game-arms.ts: mottled skin with no
    // glow, a bracer whose steel and brass match the gun, a smartwatch on the
    // left wrist. Each group's origin is the HAND, so the rest positions read
    // off the gun's locators go straight onto it, and aimArm() swings the arm
    // behind the hand toward a fixed elbow without moving the hand.
    arms = await loadGoblinArms(GOBLIN_ARM_GLB, { env, envMapIntensity: 1.1 });
    handMaterial = arms.skin;
    gripHandGroup = arms.right;
    foreHandGroup = arms.left;
    gripHandGroup.position.copy(GRIP_HAND_REST);
    foreHandGroup.position.copy(FORE_HAND_REST);
    aimArm(gripHandGroup, ELBOW_R);
    aimArm(foreHandGroup, ELBOW_L);
    (aimRig ?? viewModelAnchor).add(gripHandGroup, foreHandGroup);
```
`env` is the PMREM texture created a few lines above for the gun (`const env = pmrem.fromScene(...)`); it is in scope because this block sits inside the same `try`.

- [ ] **Step 4: The two per-frame call sites**

Replace both occurrences of
```ts
aimForearm(foreHandGroup, ELBOW_L);
```
with
```ts
aimArm(foreHandGroup, ELBOW_L);
```
(one in the reload block after `foreHandGroup.position.copy(handNow)`, one in the reload-done block after `foreHandGroup.position.copy(FORE_HAND_REST)`).

- [ ] **Step 5: The tuning seam**

In `setGunTuning`, the parameter type and body: replace `handEmissive?: number;` with `handNormalScale?: number;`, and replace
```ts
        if (t.handEmissive !== undefined) handMaterial.emissiveIntensity = t.handEmissive;
```
with
```ts
        if (t.handNormalScale !== undefined) handMaterial.normalScale.setScalar(t.handNormalScale);
```
and in the returned object replace
```ts
        handEmissive: handMaterial?.emissiveIntensity ?? null,
```
with
```ts
        handNormalScale: handMaterial?.normalScale.x ?? null,
```
Update the doc-comment example above it from `handEmissive: 0.45` to `handNormalScale: 1.4`.

- [ ] **Step 6: The gate seam**

Next to `get lastEjectOrigin() { return lastEjectOrigin; },` add:
```ts
    /** The arms, for the gate: both present, skin has no emissive, the watch
     *  screen exists. `watchScreen` is the drawable canvas for a later pass. */
    get arms() {
      return {
        left: !!arms?.left.parent, right: !!arms?.right.parent,
        skinEmissive: arms?.skin.emissiveIntensity ?? null,
        watch: !!arms?.left.getObjectByName('Watch_Screen'),
      };
    },
    get watchScreen() { return arms?.screen ?? null; },
```

- [ ] **Step 7: Typecheck, then boot the page**

Run: `npx tsc --noEmit -p .` — expected: no output. If it reports unused `goblinSkinSrgbHex`/`goblinNormalPixels`, they were removed in Step 1 correctly; if it reports them as missing, some other use survives — keep that import.

Then run the whole shorty gate (it boots the page and fails on any console error):
`LAB_VITE_PORT=5287 LAB_CDP_PORT=9287 GAME_OUT=/tmp/goblin-arms-t5 bash scripts/sdf-game-shorty-gate.sh 2>&1 | tail -6`
Expected: `done — 13 shots in /tmp/goblin-arms-t5`, exit 0. Look at `/tmp/goblin-arms-t5/fpv-rest.png` and `reload-960.png`: the arms are there, the watch is on the support hand, the skin is not glowing.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "sdf-game: the goblin arms replace the sphere+capsule hands (F-arm.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Gate check 2b and evidence

**Files:**
- Modify: `scripts/sdf-game-shorty-gate.mjs` (after check 2, before the panel dismissal)
- Create: `docs/dev-notes/2026-09-04-fpv-goblin-arms/notes.md` + gate frames

- [ ] **Step 1: Add the check**

After the line `if (!gunOk.barrels) fail('Barrels node not present under the view-model anchor');` insert:

```js
// 2b. THE ARMS — goblin-arm.glb loaded, both arms parented, the skin has NO
//     emissive (the 0.30 glow was what flattened the old hands), and the
//     watch screen exists on the left arm. game-arms.ts throws on a missing
//     node, so a clean boot already proved the node contract; this proves
//     the dressing.
const armsOk = await evaluate('__sdfGame.arms');
if (!armsOk || !armsOk.left || !armsOk.right) fail(`arms not loaded: ${JSON.stringify(armsOk)}`);
if (armsOk.skinEmissive !== 0) fail(`skin emissive is ${armsOk.skinEmissive}, expected 0 — the glow is back`);
if (!armsOk.watch) fail('Watch_Screen missing from the left arm');
console.log('arms: both present, skin emissive 0, watch present');
```

- [ ] **Step 2: Run the gate and keep the frames**

Run: `LAB_VITE_PORT=5287 LAB_CDP_PORT=9287 GAME_OUT=docs/dev-notes/2026-09-04-fpv-goblin-arms/gate bash scripts/sdf-game-shorty-gate.sh 2>&1 | grep -E "arms:|eject origin|reload:|FAIL|done"`
Expected: the `arms:` line, `eject origin: 3.50 cm ...`, `reload: shells 2 -> 0 -> 2 ...`, `done — 13 shots`.

Then a close-up of the support hand at rest for the notes:
```bash
python3 -c "
from PIL import Image
im=Image.open('docs/dev-notes/2026-09-04-fpv-goblin-arms/gate/fpv-rest.png')
w,h=im.size; im.crop((int(w*0.25),int(h*0.55),int(w*0.75),int(h*1.0))).resize((1200,1080),Image.LANCZOS).save('docs/dev-notes/2026-09-04-fpv-goblin-arms/rest-closeup.png')"
```
Look at `rest-closeup.png` and `gate/reload-960.png` (Read tool): mottle visible on the skin, bracer hardware catching light, the watch screen glowing, no flat green. If the skin reads too dark under the dungeon rig, raise `envMapIntensity` for the skin only (the `1.1` in Task 5 Step 3) — do not reintroduce emissive.

- [ ] **Step 3: Write the note**

Create `docs/dev-notes/2026-09-04-fpv-goblin-arms/notes.md`:

```markdown
# FPV goblin arms — 2026-09-04

Spec: docs/superpowers/specs/2026-09-04-fpv-goblin-arms-design.md
Plan: docs/superpowers/plans/2026-09-04-fpv-goblin-arms.md

## What changed
* `scripts/model_goblin_arm.py` -> `public/assets/lab/goblin-arm.glb`: ball
  hand (r 0.046, unchanged), knuckles, wrist/elbow balls, forearm 0.036-0.042,
  upper-arm stub to 0.70; leather bracer with steel lip, two straps with brass
  buckles, six rivets; smartwatch (band, body, `Watch_Screen` quad) on the left.
* `goblin-skin.ts`: `goblinAlbedoPixels` — tiling colour map with the blob's
  mottle patches and wart darkening, same lattice as the normal map.
* `game-arms.ts`: loads + dresses; skin has NO emissive; the watch screen is a
  CanvasTexture exposed as `__sdfGame.watchScreen` for a later device pass.
* `game-main.ts`: the sphere+capsule hands are gone; `aimArm` keeps the hand
  fixed and swings the arm toward the fixed elbow anchors.
* Gate check 2b: arms present, skin emissive 0, watch present.

## Evidence
* `turntable-0..3.png` — the authored left arm from four angles.
* `gate/fpv-rest.png`, `rest-closeup.png` — at rest: mottle, bracer, watch glow.
* `gate/reload-900.png`, `gate/reload-960.png` — the support arm crossing the frame.

## Numbers
* tris: (from the script's verify line) / 14000 cap
* skin envMapIntensity: 1.1 (same as the gun)
```
Fill the tris number from the script's output.

- [ ] **Step 4: Commit**

```bash
git add scripts/sdf-game-shorty-gate.mjs docs/dev-notes/2026-09-04-fpv-goblin-arms/
git commit -m "gate: prove the arms are dressed — no skin emissive, watch present; evidence frames (F-arm.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Kit parity — the watch on the third-person goblin

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin-kit.wam` (palette block ~line 64; the `parts` block after the `mirror ... end` that holds the bracer, ~line 175)
- Regenerate: `public/assets/lab/goblin-kit.gltf` via `scripts/build-wam-kit.sh goblin` (needs `~/Projects/2026/wam`; `WAM_DIR=` overrides)
- Test: `src/lab/sdf-zombie/characters/goblin-kit.test.ts`

WAM facts this relies on (from `~/Projects/2026/wam/SPEC.md`): a `mirror` block authors the left side and the compiler emits `.l` and `.r`; outside it, `forearm.l` targets the left bone literally; `+X` is the character's **left**; `attach ... kind=box` takes `size`/`w`/`d`; `on=<part>` snaps a part onto another part's surface so the offset is only an aim.

- [ ] **Step 1: Write the failing test**

In `src/lab/sdf-zombie/characters/goblin-kit.test.ts`, change the material list in `decodes the compiled kit`:
```ts
    expect([...groups.keys()].sort()).toEqual(['band', 'brass', 'glass', 'iron', 'leather', 'screen']);
```
and add after that `it`:
```ts
  // THE WATCH IS ON THE LEFT WRIST ONLY — the FPV asset's left arm wears it,
  // and the kit must agree. +X is the character's left (SPEC.md: "side=+X=
  // left"), so every band and screen vertex sits at x > 0, and no mirrored
  // copy exists.
  it('wears the smartwatch on the left forearm only', () => {
    for (const name of ['band', 'screen']) {
      const vs = groups.get(name)!;
      expect(vs.length, name).toBeGreaterThan(8);
      for (const v of vs) expect(v[0], `${name} vertex x`).toBeGreaterThan(0);
    }
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-kit.test.ts`
Expected: FAIL — the material list has no `band`/`screen`.

- [ ] **Step 3: Author the watch**

In `goblin-kit.wam`'s `palette` block add:
```
  band    #1c1c20
  screen  #22282e
```
After the `mirror ... end` block in `parts` that contains the bracer (the one ending after the boot loft), add:
```
  # SMARTWATCH — LEFT WRIST ONLY, matching the FPV arm asset (goblin-arm.glb,
  # F-arm.1). Outside the mirror block and pinned to forearm.l so no .r copy
  # is emitted. The band is a ring just above the wrist, proud of the flesh
  # (forearm shaft r 0.028, wrist blob r 0.030 -> 0.060 across) by 2 mm; the
  # body is a box snapped ONTO the band with on= so its landing needs no
  # offset guesswork, the screen a thinner box snapped onto the body.
  loft watchband bones=forearm.l..forearm.l material=band
    ring 0.88 w=0.062 d=0.062
    ring 0.92 w=0.064 d=0.064
    ring 0.96 w=0.062 d=0.062
    cap start=none end=none
  attach watchbody bone=forearm.l kind=box at=0.92 offset=(0,0,0.040) size=0.026 w=0.030 d=0.008 on=watchband material=band
  attach watchface bone=forearm.l kind=box at=0.92 offset=(0,0,0.048) size=0.020 w=0.024 d=0.002 on=watchbody material=screen
```

- [ ] **Step 4: Rebuild the kit**

Run: `bash scripts/build-wam-kit.sh goblin`
Expected: `wrote .../public/assets/lab/goblin-kit.gltf`. If WAM rejects `on=watchband` for an `attach`, drop `on=` from both attaches and set `offset=(0,0,0.034)` / `(0,0,0.039)` instead (the band's outer radius is 0.032; the body is 4 mm deep), then re-run.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-kit.test.ts`
Expected: PASS, including the containment `it.each` for `band` and `screen` (a vertex deeper than 45 mm inside the flesh means the offset aimed INTO the arm — flip the offset's z sign and rebuild).

- [ ] **Step 6: Look at it**

Run: `LAB_VITE_PORT=5288 LAB_CDP_PORT=9288 npm run blob:shot -- goblin 2>&1 | tail -3` and open the newest frame it reports. The watch should sit on the back of the left forearm just above the hand, below the bracer. If it is on the palm side, negate the offsets' z in Step 3 and rebuild.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin-kit.wam public/assets/lab/goblin-kit.gltf src/lab/sdf-zombie/characters/goblin-kit.test.ts
git commit -m "goblin-kit: the smartwatch on the left wrist, matching the FPV arm (F-arm.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Status board, full suite, memory

**Files:**
- Modify: `TASKS.md` (the `**[ ] F-arm.1` entry in **Current focus**)

- [ ] **Step 1: Full verification**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests "` — expected all green.
Run: `npx tsc --noEmit -p .` — expected no output.
Run the gate once more: `LAB_VITE_PORT=5287 LAB_CDP_PORT=9287 GAME_OUT=/tmp/goblin-arms-final bash scripts/sdf-game-shorty-gate.sh 2>&1 | tail -3` — expected exit 0.

- [ ] **Step 2: TASKS.md**

Change `**[ ] F-arm.1` to `**[x] F-arm.1` and append to its paragraph:
```
**DONE (date):** goblin-arm.glb (NNNN tris) via `scripts/model_goblin_arm.py`;
`game-arms.ts` dresses it (generated albedo + normals, NO emissive, gun env
map); smartwatch on the left wrist with a drawable glowing screen
(`__sdfGame.watchScreen`); kit parity in `goblin-kit.wam`. Gate check 2b.
Evidence: [docs/dev-notes/2026-09-04-fpv-goblin-arms/](docs/dev-notes/2026-09-04-fpv-goblin-arms/notes.md).
Awaiting the owner's look. Follow-up: **F-arm.2 — the watch as a device**
(shells / health / timer drawn on the screen canvas).
```
Fill the date and tris.

- [ ] **Step 3: Memory**

```bash
source ~/.claude/hooks/dualmem-env.sh
~/go/bin/dualmem add --type architecture --salience 0.8 --files 'src/lab/sdf-zombie/webgpu/game-arms.ts,src/lab/sdf-zombie/webgpu/game-arms-math.ts,scripts/model_goblin_arm.py,public/assets/lab/goblin-arm.glb' --text 'FPV arms (F-arm.1): goblin-arm.glb authored by scripts/model_goblin_arm.py (hand at the origin, local +Y hand->elbow, dorsal +Z; Arm_L/R roots, Hand/Wrist/Elbow locators, Watch_Screen quad on the left). game-arms.ts loads + dresses: shared skin material from goblinAlbedoPixels + goblinNormalPixels with NO emissive and the gun env map; aimArm(arm, elbow) uses armBasis to point +Y at the fixed ELBOW_L/R anchor and +Z at the camera without moving the hand. The watch screen is a CanvasTexture exposed as __sdfGame.watchScreen for a later device pass. GOBLIN_SKIN.handRadius (0.046) is asserted by the model gate because loadHold depends on it.'
~/go/bin/dualmem checkpoint --task "F-arm.1 goblin forearms for the FPV view-model" --status completed --files 'src/lab/sdf-zombie/webgpu/game-arms.ts,scripts/model_goblin_arm.py,TASKS.md' --done "asset, skin maps, runtime module, game-main wiring, gate 2b, kit parity, notes" --remaining "owner look; F-arm.2 watch as a device"
```

- [ ] **Step 4: Commit**

```bash
git add TASKS.md
git commit -m "tasks: F-arm.1 done — goblin arms with a bracer and a smartwatch, awaiting the owner's look

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec

* §1 asset: Task 3 (parts table, bracer, watch, nodes, materials, budgets, UVs — the gate checks tris, size, nodes, skin UVs, hand radius, screen under Arm_L). ✔
* §2 skin: Task 1 (albedo + tests), Task 4 (`makeSkinMaterial`: map, normal 1.2, roughness, env, no emissive). ✔
* §3 watch screen: Task 4 (`makeWatchScreen`, `drawWatchFace`, emissive 1.4, `redraw`), Task 5 (`__sdfGame.watchScreen`). ✔
* §4 runtime: Task 4 + Task 5 (arm roots at the hand, `aimArm`, `handRadius` unchanged, throw on missing nodes, `__sdfGame.arms`). ✔
* §5 kit parity: Task 7. ✔
* §6 gates/evidence: Task 3 gate, Task 6 check 2b + notes + frames + turntable. ✔
* Names used consistently: `loadGoblinArms`, `aimArm`, `makeSkinMaterial`, `makeWatchScreen`, `drawWatchFace`, `WATCH_SCREEN_SIZE`, `GOBLIN_ARM_GLB`, `armBasis`, `armMaterialKind`, `ARM_NODES`, `goblinAlbedoPixels`, `goblinWartField`, `GOBLIN_SKIN.mottleColorLinear`. ✔
