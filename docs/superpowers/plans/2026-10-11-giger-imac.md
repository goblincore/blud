# The Giger iMac in the Engine Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Stop at the markers after Tasks 1 and 7 and show the owner the images.

**Goal:** replace the amber placeholder on the Flat's kotatsu with the look-dev's Giger iMac: an alpha-blended translucent amber shell over lit guts, the face and screen,
beetle legs, and the umbilicus and hoses into the room.

**Spec:** `docs/superpowers/specs/2026-10-11-giger-imac-design.md` — read it first. Parent: `docs/superpowers/specs/2026-10-11-flat-room-design.md` and its plan
`docs/superpowers/plans/2026-10-11-flat-room.md` (slice 1 is built; this plan stacks on it, same branch `claude/flat-room`). **Look-dev source to port:**
`docs/dev-notes/2026-10-01-flat-room-lookdev/room.py` (line numbers below are for that file).

**Architecture:** one new Blender builder, `scripts/levels/flat/imac.py`, ported from `room.py` 887–1087 and called from `build_the_flat.py` in place of the placeholder.
New glTF materials (the shell is `alphaMode: BLEND`), two new generated textures (the veined shell and the screen), light changes in `flat_layout.py`, and new gate shots.
Blender exports any Principled alpha below 1 as `alphaMode: BLEND` (checked on Blender 5.2). The engine converts level art with three's `fromMaterial`, which copies `transparent` and
`opacity`; Task 1 proves it end to end.

**Tech Stack:** Blender 5.2 (headless), Python 3 with Pillow and numpy, Vitest, headless-Chrome capture scripts.

## Rules for every task

- Same as the Flat plan: work only in this worktree (`claude/flat-room`); never `git stash`; targeted tests only (`npx vitest run <path>`, `npm run test:changed`, `npm run typecheck`);
  headless capture only, with their own port pair (`LAB_VITE_PORT=5560 LAB_CDP_PORT=9560`, `LAB_TMP=.lab-tmp`); prove visual claims with a number and look at the images.
- Rebuild and export with:
  ```bash
  python3 scripts/levels/flat/make_textures.py
  blender --background --factory-startup --python scripts/levels/build_the_flat.py
  blender --background assets-source/levels/flat.blend --python scripts/levels/export_level.py -- public/assets/levels/flat.level.json
  SHOTS=1 bash scripts/sdf-game-flat-gate.sh        # shots land in .lab-tmp/flat/
  ```
- Exporter rules: one material per dressing object, only meshes (convert curves and metaballs), textures at most 1024 px.
- A module-level materials namespace must not be called `M` in a module that has a local matrix called `M`: use `MT` (`vertebral()` has one).
- Do not edit `room.py`. The ports are mechanical: copy the range, apply the listed edits, compile, read the result.
- File size is not a constraint (owner). The triangle cap is 400 000; the primitive cap rises to 60 in Task 6.

## Files

| Path | Responsibility |
| --- | --- |
| `scripts/levels/flat/materials.py` | modify: `alpha` argument on `pbr()`; the machine's materials |
| `scripts/levels/flat/common.py` | modify: `to_mesh(ob)` (curves and metaballs to meshes), used by `tube` and the iMac |
| `scripts/levels/flat/make_textures.py` | modify: `make_shell()`, `make_screen()` |
| `scripts/capture-flat-screen.mjs`, `scripts/capture-flat-screen.sh` | create: save a Night Train frame as the screen source |
| `assets-source/levels/flat-textures/screen-source.png` | create: that frame, committed |
| `scripts/levels/flat_layout.py` | modify: the machine's constants and lights |
| `scripts/levels/flat/imac.py` | create: the port of `giger_imac()` and the cables |
| `scripts/levels/flat/props.py` | modify: remove the placeholder |
| `scripts/levels/build_the_flat.py` | modify: call `imac.build(M)` |
| `src/lab/sdf-zombie/webgpu/level-json.flat.test.ts` | modify: a blended-shell check, the primitive cap |
| `scripts/levels/flat-textures.test.ts` | modify: the new textures |
| `scripts/sdf-game-flat-gate.mjs` | modify: a `face` shot |

---

## Task 1: The alpha spike

Prove that a blended shell survives Blender's export and the engine's art loader, draws over the guts, and does not break the window plane or the batches. Throwaway geometry on the
existing placeholder: a blended amber shell over an opaque inner sphere.

**Files:** modify `scripts/levels/flat/materials.py`, `scripts/levels/flat/props.py` (both reverted or replaced in later tasks), `level-json.flat.test.ts`.

- [ ] **Step 1: Add an `alpha` argument to `pbr()`** (keep the default 1.0), in `materials.py`:

```python
def pbr(name, color=(0.5, 0.5, 0.5), rough=0.8, metal=0.0, tex=None, normal=None, normal_strength=1.0, emit=None, emit_tex=None, alpha=1.0):
```
and, after the Metallic line inside the function: `p.inputs["Alpha"].default_value = alpha`. Docstring: `alpha < 1 exports as alphaMode BLEND`.

- [ ] **Step 2: Add the spike materials** at the end of `make()` (before `return M`):

```python
    M.SHELL = pbr("giger_shell", (1.0, 0.55, 0.22), rough=0.25, alpha=0.45)
    M.GUTS = pbr("giger_guts", (0.75, 0.32, 0.26), rough=0.3, emit=(0.75, 0.25, 0.1))
```

- [ ] **Step 3: Replace the placeholder body in `props.py`'s `build_imac_placeholder()`** so the shell is blended over an opaque inner sphere:

```python
    sphere('imac_guts_spike', (KX + 0.04, KY + 0.14, KTOP + 0.2), 0.10, MT.GUTS, seg=24)
    sphere('imac_body', (KX + 0.04, KY + 0.14, KTOP + 0.2), 0.22, MT.SHELL, scale=(1.0, 1.15, 0.95), seg=32)
```
(keep the bezel box as it is).

- [ ] **Step 4: Add the failing test** in `level-json.flat.test.ts` inside the `flat.art.glb budget` describe block (extend its `Gltf` type with `materials?: { name?: string; alphaMode?: string }[]`):

```ts
  it('the iMac shell is a blended material', () => {
    const shell = glb.materials?.find(m => m.name === 'giger_shell');
    expect(shell?.alphaMode).toBe('BLEND');
  });
```
Run `npx vitest run src/lab/sdf-zombie/webgpu/level-json.flat.test.ts`. Expected: FAIL (no `giger_shell` yet, before the rebuild).

- [ ] **Step 5: Rebuild, export and run the test.** Expected: PASS (the export carries `alphaMode: BLEND`).

- [ ] **Step 6: Look.** Run the gate with shots; open `.lab-tmp/flat/imac.png` and `skull.png`. Expected: an amber, see-through dome with the reddish inner sphere visible inside it, the bezel box in front.
Also open `wide.png`: the window plane and the shelves must look as before, and the gate must still `PASS`.
Failure modes and what to do:
  - The dome is opaque: the engine dropped `transparent`. Add a temporary `console.log('[shell]', nm.name, nm.transparent, nm.opacity)` in `game-main.ts` inside the level-material loop
    (just after `const nm = library.fromMaterial(...)`, around line 3019), run the gate, read the line in the gate's console output (or a one-off evaluate), then remove the log. If `transparent` is false there,
    the loader lost it: stop and report. The spec's fallback is a small tested loader change in `game-level-art.ts` (`placeLevelArt`: for a material with `opacity < 1`, set `transparent = true` and `depthWrite = false`);
    the owner decides before any second fallback.
  - The dome draws but the inner sphere is hidden or sorts wrong: check `depthWrite` on the shell and that the art batch for the shell is drawn after the opaque ones (`transparent: true` meshes sort last).
  - The dome is white or black: the emissive cap or light list is acting on it; try `emit=None` on the shell and read the shot again.

- [ ] **Step 7: Commit the spike** (`git commit -am "spike(flat): a blended shell over an opaque inner sphere survives export and the art loader"`) and **STOP**: show the owner `imac.png` and `skull.png`. The rest of the plan assumes the spike passed.

---

## Task 2: The screen source and the shell texture

**Files:** create `scripts/capture-flat-screen.mjs`, `scripts/capture-flat-screen.sh`, `assets-source/levels/flat-textures/screen-source.png`; modify `make_textures.py`, `flat-textures.test.ts`.

- [ ] **Step 1: Write the capture script**

```bash
# scripts/capture-flat-screen.sh
#!/usr/bin/env bash
# Saves one frame of Night Train (the game's own level) as the Flat's screen source. NEVER kill a server you did not start.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5565}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9565}"
export LAB_TMP="${LAB_TMP:-.lab-tmp}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/capture-flat-screen.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
```

```js
// scripts/capture-flat-screen.mjs — saves a 4:3 Night Train frame to assets-source/levels/flat-textures/screen-source.png (the Flat's screen).
// Usage: bash scripts/capture-flat-screen.sh
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5565);
const CDP = Number(process.argv[3] ?? 9565);
const OUT = 'assets-source/levels/flat-textures/screen-source.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=night-train&frozen&nospawn` });
let ready = false;
for (let i = 0; i < 480 && !ready; i++) {
  await sleep(500);
  ready = (await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready';
  if (errors.length) break;
}
if (!ready) fail(`night-train did not boot: ${errors.join(' | ')}`);
await evaluate(`(() => {
  let n = document.querySelector('canvas');
  while (n && n !== document.body) { for (const sib of n.parentElement.children) if (sib !== n) sib.style.display = 'none'; n = n.parentElement; }
  __sdfGame.freeze(true);
  return 1;
})()`);
await sleep(1500);
writeFileSync(OUT, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
console.log(`wrote ${OUT}`);
process.exit(0);
```

- [ ] **Step 2: Capture and look.** Run `bash scripts/capture-flat-screen.sh`; open `assets-source/levels/flat-textures/screen-source.png`. Expected: a clean 1024 × 768 frame down the guard's van or the corridor of Night Train, no UI.
If it shows the weapon arm in a poor position or a blank wall, set a better pose before the screenshot with `__sdfGame.setPose(x, z, yaw, pitch)` (the level's start is the guard's van, pose in game space) and capture again.

- [ ] **Step 3: Extend the texture test first** (`scripts/levels/flat-textures.test.ts`): add `'shell_color.jpg'` and `'screen.jpg'` to `FILES`, and `'screen-source.png'` is not tested (it is a source). Run it: FAIL.

- [ ] **Step 4: Add the generators** to `make_textures.py` (before the `if __name__` block), and call them from it:

```python
def periodic_noise(px, scale, seed):
    """Band-limited noise that tiles in both axes (FFT-filtered), 0..1. `scale`: cycles across the image at the cutoff."""
    rnd = np.random.default_rng(seed)
    f = np.fft.fft2(rnd.standard_normal((px, px)))
    fy = np.fft.fftfreq(px)[:, None] * px
    fx = np.fft.fftfreq(px)[None, :] * px
    f *= np.exp(-((np.hypot(fx, fy) / scale) ** 2))
    n = np.real(np.fft.ifft2(f))
    return (n - n.min()) / (n.max() - n.min())


def make_shell(px=1024):
    """The iMac's amber shell (room.py giger_shell_material, 904-936): bile-amber glow with dark-red veins. UV u = round the body (tiles), v = along it."""
    th = periodic_noise(px, 5, 11)[..., None]
    glow = lin_mix(np.array((1.0, 0.40, 0.12), np.float32), np.array((1.0, 0.70, 0.36), np.float32), th)
    n1, n2 = periodic_noise(px, 14, 21), periodic_noise(px, 36, 22)
    vein = np.maximum(np.clip(1 - np.abs(n1 - 0.5) / 0.035, 0, 1), np.clip(1 - np.abs(n2 - 0.5) / 0.02, 0, 1) * 0.8)[..., None]
    col = glow * (1 - vein) + vein * np.array((0.28, 0.02, 0.02), np.float32)
    save(srgb(col), "shell_color.jpg")


def lin_mix(a, b, t):
    return a * (1 - t) + b * t


def make_screen(px=(1024, 768)):
    """The screen: the Night Train frame with scanlines (room.py 939-952: sin over the height, 0.55 to 1.0) and a lift, standing in for emission strength 2.6
    (the engine caps emission at 1). Needs screen-source.png (scripts/capture-flat-screen.sh)."""
    src = os.path.join(OUT, "screen-source.png")
    im = np.asarray(Image.open(src).convert("RGB").resize(px, Image.LANCZOS), np.float32) / 255.0
    v = (np.arange(px[1])[:, None] + 0.5) / px[1]
    lines = 0.55 + 0.45 * (np.sin(v * 1300.0) + 1) / 2
    save(np.clip(im * lines[..., None] * 1.35, 0, 1), "screen.jpg")
```
Add `make_shell()` and `make_screen()` to the `__main__` block. Run `python3 scripts/levels/flat/make_textures.py`, then the texture test: PASS.

- [ ] **Step 5: Look at `shell_color.jpg` and `screen.jpg`.** Expected: an amber field with a net of dark-red veins; the Night Train frame under fine horizontal lines. The shell texture must tile across its left and right edges (no visible seam when you place two copies side by side: `python3 -c "from PIL import Image; im=Image.open('assets-source/levels/flat-textures/shell_color.jpg'); s=Image.new('RGB',(2048,1024)); s.paste(im,(0,0)); s.paste(im,(1024,0)); s.save('.lab-tmp/shell-tile.png')"`).
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(flat): the iMac's screen source (a Night Train frame), the veined shell texture and the scanlined screen"`.

---

## Task 3: The machine's materials and `to_mesh`

**Files:** modify `materials.py`, `common.py`.

- [ ] **Step 1: Refactor `tube()` in `common.py`** so the curve-to-mesh step is reusable. Replace the tail of `tube` (from `bpy.context.view_layer.update()` to `return ...`) with a call to a new helper, and add the helper above `tube`:

```python
def to_mesh(ob):
    """Convert a curve or metaball object (already linked into a collection) to a mesh object; returns the mesh object."""
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="MESH")
    return bpy.context.view_layer.objects.active
```
and `tube` ends with `dressing().objects.link(ob)` then `return to_mesh(ob)`.

- [ ] **Step 2: Replace the spike materials in `materials.py`** (remove `M.GUTS`; keep one `M.SHELL`) and add the rest. Colours are `room.py` 920–937 (linear values, as the look-dev):

```python
    M.SHELL = pbr("giger_shell", (1.0, 1.0, 1.0), rough=0.25, tex="shell_color.jpg", alpha=0.45)     # alpha-blended: the guts show through
    M.FLESH = pbr("flesh", (0.75, 0.32, 0.26), rough=0.3)
    M.LIPS = pbr("lips", (0.55, 0.10, 0.13), rough=0.15)
    M.TONGUE = pbr("tongue", (0.62, 0.16, 0.2), rough=0.12)
    M.DARKGLASS = pbr("darkglass", (0.01, 0.01, 0.012), rough=0.08)
    M.BEZEL = pbr("bezel", (0.03, 0.03, 0.035), rough=0.35)
    M.CD = pbr("cd", (0.75, 0.75, 0.78), rough=0.08, metal=1.0)
    M.MUCUS = pbr("mucus", (0.9, 0.82, 0.6), rough=0.02)
    M.SCREEN = pbr("screen", emit_tex="screen.jpg")
```
(`M.AMBER` stays until Task 6 removes the placeholder.)

- [ ] **Step 3: Compile and rebuild** (`python3 -m py_compile scripts/levels/flat/common.py scripts/levels/flat/materials.py`; then the build). Expected: the build still works (the spike's `GUTS` reference in `props.py` is replaced in Task 6; for now give `props.build_imac_placeholder` its Task-1 form using `MT.FLESH` for the inner sphere). Run the level test.
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat(flat): the machine's materials; to_mesh for curves and metaballs"`.

---

## Task 4: The machine's constants and lights

**Files:** modify `scripts/levels/flat_layout.py`.

- [ ] **Step 1: Add the constants** after the `KX, KY, KTOP` line (the look-dev's numbers, room.py 881–885, 972+):

```python
# The Giger iMac (machine stage 3), on the kotatsu. Its face looks south (toward the player), the cranium sweeps north and up.
IM_FRONT = KY - 0.06                 # the face's plane (y)
IM_Z = KTOP + 0.235                  # the face's centre height
IM_LEN = 0.56                        # front face to the tip of the cranium
IM_W, IM_H = 0.185, 0.18             # half width, half height at the face
```

- [ ] **Step 2: Replace the `amber` light and add two** in `LIGHTS` (all `fixture: "none"`; the look-dev's `imac_guts`, `imac_guts2` and `imac_screen_light`, room.py 1093–1096; powers are starting values):

```python
    ("amber", (KX + 0.03, IM_FRONT + 0.36, IM_Z - 0.06), (1.0, 0.50, 0.20), 1.6, {"fixture": "none"}),     # in the guts, behind the creature
    ("amber2", (KX - 0.04, IM_FRONT + 0.14, IM_Z - 0.10), (1.0, 0.45, 0.20), 0.7, {"fixture": "none"}),    # in the guts, nearer the face
    ("screen", (KX, IM_FRONT - 0.05, IM_Z + 0.05), (0.75, 0.80, 1.0), 1.0, {"fixture": "none"}),           # the screen's light into the room
```
(`LIGHTS` is a list: the old `amber` line is replaced by these three.) The three constants must be defined above `LIGHTS`; move them next to `KX, KY, KTOP` as written.

- [ ] **Step 3: Run** `python3 scripts/levels/flat_layout.py` (expect `flat_layout: ok`; `check()` asserts every light is inside the room) and commit `git commit -am "feat(flat): the iMac's constants and lights (guts lamps inside the shell, a cool screen light)"`.

---

## Task 5: Port the machine

**Files:** create `scripts/levels/flat/imac.py`.

The port is mechanical. Use a generator in the scratchpad (as the slice-1 ports did); the module's header and `build()` are below, the ranges and the edit table follow.

- [ ] **Step 1: Module header and `build()`**

```python
# scripts/levels/flat/imac.py
"""The Giger iMac (machine stage 3), ported from docs/dev-notes/2026-10-01-flat-room-lookdev/room.py (887-1087: the profile, the shell, the face, the screen,
the mouth, the guts, the handle, the crest, the legs, the umbilicus and the hoses; the stickers and the lights are not ported: lights live in flat_layout.py).
The shell is alpha-blended (flat/materials.py); the guts inside are real meshes. Run inside Blender."""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise  # noqa: F401

import flat_layout as LAY
from flat import common as C
from flat.common import box, cyl, obj_from_bm, sphere, torus, tube  # noqa: F401
from flat.giger import vertebral

KX, KY, KTOP, FLOOR, Y1 = LAY.KX, LAY.KY, LAY.KTOP, LAY.FLOOR, LAY.Y1
IM_FRONT, IM_Z, IM_LEN, IM_W, IM_H = LAY.IM_FRONT, LAY.IM_Z, LAY.IM_LEN, LAY.IM_W, LAY.IM_H
MT = None           # the materials namespace, set by build()

# ... the ported functions go here: im_profile, im_point, rounded_rect, plate, giger_imac, gloop_strand ...


def build(m):
    global MT
    MT = m
    random.seed(11)
    giger_imac()
```

- [ ] **Step 2: Ranges to copy**, in this order, between the header and `build()`: `im_profile` and `im_point` (887–903), `rounded_rect` (954–960), `plate` (961–971), `giger_imac` (972–1083), `gloop_strand` (1084–1087).
  Do NOT copy `giger_shell_material`, `screen_material` or the `M_*` definitions (904–952): their looks come from Task 2–3.

- [ ] **Step 3: Apply these edits** (every `M_NAME` becomes `MT.NAME`; names used: `SHELL, BONE, GUN, FLESH, LIPS, TONGUE, DARKGLASS, BEZEL, CD, MUCUS, SCREEN`):
  1. `plate()`: the line `o = bpy.data.objects.new(name, cu); sc.collection.objects.link(o); o.data.materials.append(m)` becomes `o = bpy.data.objects.new(name, cu); C.dressing().objects.link(o); o.data.materials.append(m)`;
     and its last line `return o` becomes `return C.to_mesh(o)` (a curve must be a mesh to export; the rotation and location are set before it).
  2. The shell's UVs: before the ring loops add `uvl = bm.loops.layers.uv.new('UVMap')`, and replace
     `bm.faces.new((rings[i][j], rings[i][(j + 1) % NA], rings[i + 1][(j + 1) % NA], rings[i + 1][j]))` with
     ```python
            f = bm.faces.new((rings[i][j], rings[i][(j + 1) % NA], rings[i + 1][(j + 1) % NA], rings[i + 1][j]))
            for l, (jj, ii) in zip(f.loops, ((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                l[uvl].uv = (jj / NA, ii / NS)
     ```
     and `obj_from_bm('imac_shell', bm, M_SHELL, smooth=True)` becomes `obj_from_bm('imac_shell', bm, MT.SHELL, smooth=True, uv_size=0)`.
  3. Delete the stickers: the `for k, (x, z, r, ang) in enumerate(((-0.128, 0.13, 0.026, -8), ...` loop and its three body lines (`bpy.ops.mesh.primitive_plane_add ... M_STICKER`).
  4. The creature: `cr = bpy.data.objects.new('creature', mb); sc.collection.objects.link(cr); cr.data.materials.append(M_FLESH)` becomes
     `cr = bpy.data.objects.new('creature', mb); C.dressing().objects.link(cr); cr.data.materials.append(MT.FLESH)`; after the last `vb(...)` line (the `for sx in (-1, 1): vb(head + ...` line) add `C.to_mesh(cr)`.
  5. Delete the `# Light:` block at the end of `giger_imac` (the `area_light(...)` and the two `point_light(...)` lines): the lights are in `flat_layout.py`.
  6. `vertebral` is imported from `flat.giger` (it picks its own default materials from the Giger layer's namespace: `giger.build(M)` has already run, so its `MT` is set).
  7. Object names: keep as is (`imac_hoop{k}`, `imac_leg{sx}{k}a`, ... contain only ints); the look-dev's other names are fine.

- [ ] **Step 4: Compile and read.** `python3 -m py_compile scripts/levels/flat/imac.py`; `grep -n "M_[A-Z]\|sc\.\|point_light\|area_light\|STICKER" scripts/levels/flat/imac.py` must print nothing.

- [ ] **Step 5: Commit** `git add scripts/levels/flat/imac.py && git commit -m "feat(flat): the Giger iMac ported from the look-dev (not yet called)"`.

---

## Task 6: Wire it in

**Files:** modify `scripts/levels/flat/props.py`, `scripts/levels/build_the_flat.py`, `level-json.flat.test.ts`, `flat/materials.py`.

- [ ] **Step 1:** in `props.py` delete `build_imac_placeholder()` and its call in `build()`. In `materials.py` delete `M.AMBER`. In `build_the_flat.py`: `from flat import giger, imac, props, shell` and, after `props.build(M)`, `imac.build(M)`.
- [ ] **Step 2: Raise the primitive cap** in `level-json.flat.test.ts` from 40 to 60, with the comment `// Raised from 40: the iMac adds about nine materials (owner, 2026-10-11: look first, optimise later).` (the test title too: `at most 60 draw-call primitives`).
  Keep the blended-shell test from Task 1.
- [ ] **Step 3: Build, export, test, typecheck.** `npx vitest run src/lab/sdf-zombie/webgpu/level-json.flat.test.ts scripts/levels/flat-textures.test.ts && npm run typecheck`. Expected: pass. Print the glb's triangle count and primitive count (the `python3` snippet used in slice 1); expect under 400 000 triangles.
  If the metaball conversion made too many triangles (the creature alone over 40 000), set `mb.resolution = 0.012` in the port and rebuild.
- [ ] **Step 4: Run the gate with shots** and read the new frame times and the collision lines; all must still pass (the machine's footprint is inside the kotatsu's collider).
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(flat): the Giger iMac replaces the placeholder"`.

---

## Task 7: Look, tune, compare

**Files:** modify `scripts/sdf-game-flat-gate.mjs`, `flat_layout.py` (light powers), notes.

- [ ] **Step 1: Add a `face` shot** to the gate's `CAMS` (a close-up of the machine's face from the player's side): `face: [[0.12, 1.55], [0.12, 2.3, 0.72]]`. Run with shots; open `imac.png`, `skull.png`, `face.png`.
- [ ] **Step 2: Compare** with the look-dev's `imac.png` and `skull.png` (`docs/dev-notes/2026-10-01-flat-room-lookdev/`). Check: the shell reads as frosted amber plastic with veins; the guts (hoops, keel, vessels, creature) show through; the face (bezel, screen with the Night Train frame, studs, lips, CD tongue) reads;
  the legs stand on the kotatsu; the umbilicus runs off the table into the wall by the window; the room's lights still read (the amber is the room's only amber).
- [ ] **Step 3: Tune** only these knobs, one at a time, re-shooting each: the shell's alpha (`alpha=0.45` in `materials.py`; try 0.35 to 0.6), the amber and `amber2` powers, the `screen` power. Note the final values in the commit message.
- [ ] **Step 4: Frame cost.** Run the gate three times; the frame must stay under 33.3 ms (it was 5 to 7 ms).
- [ ] **Step 5: The comparison sheet and notes.** Compose `docs/dev-notes/2026-10-11-flat-room/imac-vs-lookdev.jpg`: the look-dev's `imac.png` and `skull.png` beside the engine's `imac.png`, `skull.png`, `face.png`. Append to `docs/dev-notes/2026-10-11-flat-room/NOTES.md`
  an "## Update: the Giger iMac" section: what is in it, the numbers (primitives, triangles, frame), what differs from the look-dev (blended, not frosted-and-blurred; static screen; no keyboard, mouse or stickers), and the WGSL-shell follow-up.
  Update `TASKS.md`, `docs/tasks/levels.md` (4o) and the iMac spec's Status line; check `wc -l` before and after each edit.
- [ ] **Step 6: Verify and commit.** `python3 scripts/levels/flat_layout.py && npm run typecheck && npm run test:changed`; then `git add -A && git commit -m "feat(flat): the Giger iMac: tuned, with the comparison sheet and notes"`.
- [ ] **Step 7: STOP.** Show the owner the comparison sheet and the numbers. Then ask about pushing the branch and opening the PR (slice 1 and the iMac together).

---

## Self-review (the plan's author, 2026-10-11)

- **Spec coverage:** §2 scope (shell, face, guts, outside parts, connection, screen, lights): Tasks 2–5; §3 units: Tasks 2–6 (every file in the spec's table has a task); §4 the shell and the spike: Task 1; §5 the screen: Task 2; §6 lights: Task 4; §7 budget: Task 6 (the primitive cap) and Task 7 (frame); §8 verification: Tasks 1, 6, 7; §9 follow-ups: noted in Task 7's notes (the WGSL spike is the spec's item 1).
- **Known soft spots:** the keyboard, mouse and stickers are not ported (spec §2); the shell's alpha is constant (not vein-driven); `make_screen` needs `screen-source.png` from Task 2; the metaball's triangle count is unmeasured until Task 6.
- **Placeholders:** none; the port steps cite exact ranges and the edit table.
