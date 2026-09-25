# Level mesh key — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a level's Blender `dressing` in the game: exported as one `<id>.art.glb` (kit pieces as GPU instances, the rest joined per room and material), lit like the walls; `shell: "art"` rooms draw only their art.

**Architecture:** Two additive format keys (`art`, room `shell`) plus capability `art`. The exporter writes the GLB after the JSON, mutating the loaded scene in memory only (it never saves). The game parses the GLB with `GLTFLoader`, attaches its meshes to `levelGroup` with a `userData.room` tag, and the existing per-room light-list loop lights them. Pure decisions live in `level-art.ts`.

**Tech Stack:** TypeScript, three r186 WebGPU + GLTFLoader (EXT_mesh_gpu_instancing), Blender 5.2 glTF exporter, vitest, CDP headless gate.

**Spec:** [2026-09-24-level-mesh-key-design.md](../specs/2026-09-24-level-mesh-key-design.md)

**Facts found while planning (2026-09-24):** the Wake's `dressing` is 359 meshes over 24 flat materials, no textures, no shared mesh data; the exporter has `export_gpu_instances` and `export_yup`. Blender (x, y, z) → glTF Y-up (x, z, −y) = game space. `__sdfGame.drawStats(reset)` and `frameMs()` already exist (`game-seams-boot.ts`).

---

### Task 1: Format keys `art` and `shell`

**Files:** Modify `level-def.ts`, `level-json.ts`, `active-level.ts` (+ `active-level.test.ts`, `level-def.test.ts` literals); Create `public/assets/levels/fixtures/art-keys.level.json`; Test `level-json.art.test.ts`.

- [ ] **Step 1: Fixture**

```json
{
  "version": 1, "id": "art-keys", "art": "art-keys.art.glb",
  "rooms": [{ "id": 1, "name": "car", "min": [-1.5, -12], "max": [1.5, 0], "height": 2.6, "shell": "art" }],
  "furniture": [{ "min": [-1.4, 0, -4], "max": [-0.6, 0.9, -3] }],
  "start": { "pos": [0, 0, -1], "yaw": 0 }
}
```

- [ ] **Step 2: Failing tests** (`level-json.art.test.ts`)

```ts
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutColliders, layoutSurfaces } from './level-def';
import { parseLevelJson } from './level-json';

const raw = () => JSON.parse(readFileSync('public/assets/levels/fixtures/art-keys.level.json', 'utf8'));

describe('art and shell keys', () => {
  it('parses the art file and an art-shelled room', () => {
    const d = parseLevelJson(raw());
    expect(d.art).toBe('art-keys.art.glb');
    expect(d.rooms[0]!.shell).toBe('art');
    expect(d.requires).toEqual(['art']);
  });
  it('an art shell draws no generated planes but keeps collision; furniture still draws as a box', () => {
    const d = parseLevelJson(raw());
    expect(layoutSurfaces(d).planes).toEqual([]);
    expect(layoutColliders(d).length).toBe(5);
  });
  it('rooms default to a generated shell; no art key means no art', () => {
    const j = raw(); delete j.art; delete j.rooms[0].shell;
    const d = parseLevelJson(j);
    expect(d.rooms[0]!.shell).toBe('generated'); expect(d.art).toBeNull(); expect(d.requires).toEqual([]);
  });
  it('rejects a bad art file name, an unknown shell, and shell art with void', () => {
    const a = raw(); a.art = '../x.glb';
    expect(() => parseLevelJson(a)).toThrow(/art: must match/);
    const b = raw(); b.rooms[0].shell = 'mesh';
    expect(() => parseLevelJson(b)).toThrow(/shell: generated or art/);
    const c = raw(); c.rooms[0].void = true;
    expect(() => parseLevelJson(c)).toThrow(/art-shelled rooms are not void and have no paths/);
  });
});
```

(Furniture draws as a box: in an art-shelled room the kit art covers it, which is the author's job; the renderer does not special-case it in v1.)

- [ ] **Step 3: Run; expect FAIL.**

- [ ] **Step 4: Implement.**
  - `level-def.ts`: `Capability` adds `'art'`; `LevelRoom` gains `shell: 'generated' | 'art'`; `LevelDef` gains `art: string | null`; `layoutSurfaces` room loop: `if (r.void || r.shell === 'art') continue;` (update the comment).
  - `level-json.ts`: `KEYS.top` adds `'art'`, `KEYS.room` adds `'shell'`. Top level: `const art = j.art === undefined ? null : str(j.art, 'art'); if (art !== null && !/^[a-z0-9-]+\.art\.glb$/.test(art)) errors.push('art: must match <id>.art.glb');`. Room: `const shell = o.shell === undefined ? 'generated' : o.shell === 'generated' || o.shell === 'art' ? o.shell : (errors.push(\`${where}.shell: generated or art\`), 'generated');` and `if (shell === 'art' && (isVoid || o.paths !== undefined)) errors.push(\`${where}: art-shelled rooms are not void and have no paths\`);`. Capability: `if (art !== null || rooms.some(r => r.shell === 'art')) requires.push('art');` after `portals`. Return `art`.
  - `active-level.ts`: `ENGINE_CAPABILITIES` adds `'art'`; test expectation `['art', 'open-sky', 'portals', 'void', 'windows']`.
  - Room literals in tests gain `shell: 'generated'`; LevelDef literals gain `art: null`.

- [ ] **Step 5: Run** `npx vitest run src/lab/sdf-zombie/webgpu/level src/lab/sdf-zombie/webgpu/active-level` + `npx tsc --noEmit -p .`; PASS. **Commit** `feat(level): art file and art-shelled rooms (format keys)`.

---

### Task 2: `level-art.ts` (pure)

**Files:** Create `src/lab/sdf-zombie/webgpu/level-art.ts`, `level-art.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { artRoomOf, artUrl, checkArtBudget, glbJson } from './level-art';

describe('level art', () => {
  it('the art file resolves beside the level JSON', () => {
    expect(artUrl('the-wake', 'the-wake.art.glb')).toBe('/assets/levels/the-wake.art.glb');
    expect(artUrl('fixtures/art-shell', 'art-shell.art.glb')).toBe('/assets/levels/fixtures/art-shell.art.glb');
  });
  it('a mesh takes the room of its nearest tagged ancestor-or-self', () => {
    expect(artRoomOf([{ room: 3 }, {}])).toBe(3);
    expect(artRoomOf([{}, { room: 2 }])).toBe(2);
    expect(artRoomOf([{}, {}])).toBeNull();
  });
  it('budget: passes inside, names every overrun', () => {
    const b = { drawCalls: 50, frameMs: 2 };
    expect(checkArtBudget({ drawCalls: 100, frameMs: 10 }, { drawCalls: 140, frameMs: 11.5 }, b)).toEqual([]);
    expect(checkArtBudget({ drawCalls: 100, frameMs: 10 }, { drawCalls: 160, frameMs: 13 }, b))
      .toEqual(['draw calls +60 > +50', 'frame +3.00 ms > +2 ms']);
  });
  it('reads the JSON chunk of a GLB', () => {
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }) + '  ');
    const buf = new Uint8Array(12 + 8 + json.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, buf.length, true);
    dv.setUint32(12, json.length, true); dv.setUint32(16, 0x4e4f534a, true); buf.set(json, 20);
    expect(glbJson(buf)).toEqual({ asset: { version: '2.0' } });
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/lab/sdf-zombie/webgpu/level-art.ts
//
// LEVEL ART (the mesh key, spec 2026-09-24-level-mesh-key-design.md) as pure decisions:
// where a level's art file lives, which room lights a mesh, the draw/frame budget,
// and reading a GLB's JSON chunk (tests and the gate inspect the export with it).
// Pure: no three.js, no DOM.

/** `levelParam` is the ?level= value (may include a folder, e.g. fixtures/x). */
export function artUrl(levelParam: string, file: string): string {
  const dir = levelParam.includes('/') ? levelParam.slice(0, levelParam.lastIndexOf('/') + 1) : '';
  return `/assets/levels/${dir}${file}`;
}

/** Room id from the mesh's own userData, then its ancestors' (self first). */
export function artRoomOf(chain: readonly Record<string, unknown>[]): number | null {
  for (const u of chain) if (typeof u.room === 'number') return u.room;
  return null;
}

export interface ArtCost { drawCalls: number; frameMs: number }
/** Overruns of `after` over `before`, as messages; empty = within budget. */
export function checkArtBudget(before: ArtCost, after: ArtCost, budget: ArtCost): string[] {
  const out: string[] = [];
  const dc = after.drawCalls - before.drawCalls, ms = after.frameMs - before.frameMs;
  if (dc > budget.drawCalls) out.push(`draw calls +${dc} > +${budget.drawCalls}`);
  if (ms > budget.frameMs) out.push(`frame +${ms.toFixed(2)} ms > +${budget.frameMs} ms`);
  return out;
}

/** The JSON chunk of a binary glTF. */
export function glbJson(bytes: Uint8Array): unknown {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const len = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB: first chunk is not JSON');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}
```

- [ ] **Step 3: Run; PASS. Commit** `feat(art): level-art pure decisions`.

---

### Task 3: Exporter writes the art

**Files:** Modify `scripts/levels/export_level.py`, `docs/game/levels/blender-conventions.md`.

- [ ] **Step 1: Room + level keys.** Rooms: `if o.get("shell"): room["shell"] = str(o["shell"])`.

- [ ] **Step 2: `export_art(doc, json_path)`**, called after the JSON dict is complete and before it is written (it sets `doc["art"]`):

```python
def room_for(obj, rooms):
    if "room" in obj.keys():
        return int(obj["room"])
    gmin, gmax = world_aabb(obj)
    cx, cz = (gmin[0] + gmax[0]) / 2, (gmin[2] + gmax[2]) / 2
    for r in rooms:
        if r["min"][0] <= cx <= r["max"][0] and r["min"][1] <= cz <= r["max"][1]:
            return r["id"]
    def d2(r):
        rx, rz = (r["min"][0] + r["max"][0]) / 2, (r["min"][1] + r["max"][1]) / 2
        return (rx - cx) ** 2 + (rz - cz) ** 2
    return min(rooms, key=d2)["id"]


def export_art(doc, json_path):
    """Dressing -> <id>.art.glb. Mutates the loaded scene; the .blend is never saved."""
    dressing = bpy.data.collections.get("dressing")
    if dressing is None or not dressing.all_objects:
        return
    view = bpy.context.view_layer
    # 1. Linked kit pieces: collection-instance empties become real objects that SHARE
    #    their mesh data (linked duplicates), which the exporter writes as GPU instances.
    for inst in [o for o in dressing.all_objects if o.instance_type == "COLLECTION" and o.instance_collection]:
        for o in view.objects:
            o.select_set(False)
        inst.select_set(True)
        view.objects.active = inst
        room = room_for(inst, doc["rooms"])
        bpy.ops.object.duplicates_make_real(use_base_parent=False, use_hierarchy=False)
        for o in bpy.context.selected_objects:
            if o.type == "MESH":
                o["room"] = room
                o["kit"] = base_name(inst).split(":")[0]
        bpy.data.objects.remove(inst)
    view.update()
    meshes = [o for o in dressing.all_objects if o.type == "MESH"]
    for o in meshes:
        if "room" not in o.keys():
            o["room"] = room_for(o, doc["rooms"])
    for o in meshes:
        for slot in o.material_slots:
            img_nodes = [n for n in (slot.material.node_tree.nodes if slot.material and slot.material.use_nodes else [])
                         if n.type == "TEX_IMAGE" and n.image]
            for n in img_nodes:
                if max(n.image.size) > 1024:
                    raise SystemExit(f"texture {n.image.name} is {n.image.size[0]}x{n.image.size[1]} (max 1024)")
    shared = {o.data.name for o in meshes if o.data.users > 1}
    # 2. Kit instances: one parent empty per (room, piece), so each room's copies are
    #    siblings (the exporter instances siblings that share a mesh).
    parents = {}
    for o in [o for o in meshes if o.data.name in shared]:
        key = (int(o["room"]), o.get("kit", o.data.name))
        if key not in parents:
            p = bpy.data.objects.new(f"kit:{key[0]}:{key[1]}", None)
            p["room"] = key[0]
            dressing.objects.link(p)
            parents[key] = p
        mw = o.matrix_world.copy()
        o.parent = parents[key]
        o.matrix_world = mw
    # 3. The rest: split by material, then join per (room, material, shadow).
    groups = {}
    for o in [o for o in meshes if o.data.name not in shared]:
        for m in o.modifiers[:]:
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
        mats = [s.material for s in o.material_slots] or [None]
        mat = mats[0]
        if len(mats) > 1:
            raise SystemExit(f"{o.name}: one material per dressing object (split it in Blender)")
        shadow = bool(o.get("shadow", True))
        key = (int(o["room"]), mat.name if mat else "none", shadow)
        groups.setdefault(key, []).append(o)
    for (room, mat, shadow), objs in groups.items():
        for o in view.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        view.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        j = view.objects.active
        j.name = f"art:{room}:{mat}" + ("" if shadow else ":noshadow")
        j["room"] = room
        if not shadow:
            j["shadow"] = False
    for o in view.objects:
        o.select_set(False)
    for o in dressing.all_objects:
        o.select_set(True)
    art_name = f"{doc['id']}.art.glb"
    art_path = json_path.rsplit("/", 1)[0] + "/" + art_name if "/" in json_path else art_name
    bpy.ops.export_scene.gltf(filepath=art_path, export_format="GLB", use_selection=True, export_yup=True,
                              export_extras=True, export_gpu_instances=True, export_cameras=False,
                              export_lights=False, export_apply=True, export_materials="EXPORT")
    doc["art"] = art_name
    print(f"art: {len(groups)} joined meshes, {len(parents)} instanced pieces -> {art_path}")
```

Call site: `export_art(doc, path)` right before `with open(path, "w", ...)` (after the empty-key cleanup; `rooms` must still be present).

- [ ] **Step 3: Conventions.** `dressing` row: "Exported to `<id>.art.glb` (the mesh key): one material per object; custom props `room` (override), `shadow` (false = no shadows). Kit pieces: collection instances of collections linked from `assets-source/levels/kit.blend`." Room row: `shell` (`generated` | `art`).

- [ ] **Step 4:** verified by Tasks 4–5. **Commit** `feat(art): exporter writes <id>.art.glb (instanced kit, joined per room/material)`.

---

### Task 4: Fixture `art-shell` + test kit

**Files:** Create `scripts/levels/build_art_fixture.py` (builds `assets-source/levels/fixtures/test-kit.blend` and `assets-source/levels/fixtures/art-shell.blend`), generated `public/assets/levels/fixtures/art-shell.level.json` + `art-shell.art.glb`; Test `level-json.art-shell.test.ts`.

- [ ] **Step 1: Failing test**

```ts
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glbJson } from './level-art';
import { parseLevelJson } from './level-json';

const lvl = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/fixtures/art-shell.level.json', 'utf8')));
type Node = { name?: string; mesh?: number; children?: number[]; extras?: Record<string, unknown>; extensions?: Record<string, unknown> };
const glb = glbJson(new Uint8Array(readFileSync('public/assets/levels/fixtures/art-shell.art.glb'))) as { nodes: Node[] };

describe('art-shell fixture', () => {
  it('one art-shelled carriage with its art file', () => {
    expect(lvl.art).toBe('art-shell.art.glb');
    expect(lvl.rooms.map(r => r.shell)).toEqual(['art']);
    expect(lvl.furniture).toHaveLength(3);
  });
  it('the shell is one joined mesh tagged with its room', () => {
    const shell = glb.nodes.filter(n => n.name?.startsWith('art:1:fixture.panel'));
    expect(shell).toHaveLength(1);
    expect(shell[0]!.extras?.room).toBe(1);
  });
  it('the three linked seats are one GPU-instanced node under a room-tagged parent', () => {
    const inst = glb.nodes.filter(n => n.extensions?.EXT_mesh_gpu_instancing);
    expect(inst).toHaveLength(1);
    const parent = glb.nodes.find(n => n.children?.includes(glb.nodes.indexOf(inst[0]!)));
    expect(parent?.name).toBe('kit:1:seat');
    expect(parent?.extras?.room).toBe(1);
  });
});
```

- [ ] **Step 2: Build script.** Two phases in one Blender run: (1) factory-empty scene, collection `seat` holding a 0.8 × 0.9 × 1.0 m cube (Blender dims; material `fixture.seat`, base colour (0.9, 0.35, 0.05)), save as `test-kit.blend`; (2) factory-empty again, scene props `level_id = "art-shell"`, room `room:1:car` (game min (−1.5, 0, −12), max (1.5, 2.6, 0)) with `shell = "art"`, start (0, 0, −1) facing −z; link collection `seat` from `test-kit.blend` (`bpy.data.libraries.load(path, link=True)`); in `dressing`: the shell built with bmesh as five inward-facing quads (floor, ceiling, two long walls, the far end wall) in material `fixture.panel`, base colour (0.1, 0.55, 0.12); three collection-instance empties `seat:1..3` of `seat` at game (−1.0, 0, −3.5), (−1.0, 0, −6.5), (−1.0, 0, −9.5); three `furniture` boxes under them (game x −1.4…−0.6, y 0…0.9, z ±0.5 around each); save `art-shell.blend`. Helpers (`coll`, `gbox`, `gempty`) copied from `build_the_void.py`.

- [ ] **Step 3: Build + export**

```bash
/opt/homebrew/bin/blender --background --factory-startup --python scripts/levels/build_art_fixture.py
/opt/homebrew/bin/blender --background --factory-startup assets-source/levels/fixtures/art-shell.blend --python scripts/levels/export_level.py -- public/assets/levels/fixtures/art-shell.level.json
```

- [ ] **Step 4: Run** the test; PASS. If the exporter does not write `EXT_mesh_gpu_instancing` for the realised seats, inspect the GLB (`glbJson`) and fix the exporter (sibling rule, `export_gpu_instances`) before moving on. **Commit** `feat(art): art-shell fixture + test kit`.

---

### Task 5: The Wake's art

**Files:** generated `public/assets/levels/the-wake.art.glb`, updated `the-wake.level.json`; Modify `level-json.the-wake.test.ts`.

- [ ] **Step 1: Test additions** — `expect(wake.art).toBe('the-wake.art.glb')`; `requires` becomes `['windows', 'open-sky', 'art']`; a GLB check: every node named `art:<room>:…` or `kit:…` has `extras.room` in the level's room ids, and the joined-mesh count is ≤ 8 rooms × 24 materials.
- [ ] **Step 2: Export**

```bash
/opt/homebrew/bin/blender --background --factory-startup assets-source/levels/the-wake.blend --python scripts/levels/export_level.py -- public/assets/levels/the-wake.level.json
```

Check `git diff public/assets/levels/the-wake.level.json` changes only the `art` key (plus nothing else).

- [ ] **Step 3: Run** the Wake level tests; PASS. **Commit** `feat(wake): export the dressing as the-wake.art.glb`.

---

### Task 6: Game wiring

**Files:** Create `src/lab/sdf-zombie/webgpu/game-art-leaves.ts`; Modify `game-state-world.ts` (+ test 26 → 27), `game-main.ts`, `game-seams-world.ts`.

- [ ] **Step 1: State.** `WorldState` gains `art: { file: string; meshes: number; instanced: number; instances: number } | null` (binding `art: 'world.art'`).

- [ ] **Step 2: `game-art-leaves.ts`**

```ts
// src/lab/sdf-zombie/webgpu/game-art-leaves.ts
//
// LEVEL ART in the game (mesh key spec §5): fetch and parse <id>.art.glb, then attach
// every mesh to the level group tagged with its room, so the per-room light-list loop
// lights it like the walls. Decisions are pure (level-art.ts).

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameContext } from './game-context';
import { artRoomOf, artUrl } from './level-art';

/** Fetch + parse the level's art; null when the level has none or `?art=0`. */
export async function loadLevelArt(levelParam: string | null, file: string | null): Promise<THREE.Group | null> {
  if (!levelParam || !file) return null;
  if (new URLSearchParams(location.search).get('art') === '0') return null;
  const url = artUrl(levelParam, file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`level art ${url}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(bytes, url).catch((e: unknown) => {
    throw new Error(`level art ${url}: ${e instanceof Error ? e.message : String(e)}`);
  });
  return gltf.scene;
}

/** Attach every mesh to the level group, room-tagged, shadows per its extras. */
export function placeLevelArt(ctx: GameContext, scene: THREE.Group, file: string): void {
  scene.updateMatrixWorld(true);
  const found: THREE.Mesh[] = [];
  scene.traverse(o => { if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh); });
  let instanced = 0, instances = 0;
  for (const m of found) {
    const chain: Record<string, unknown>[] = [];
    for (let o: THREE.Object3D | null = m; o; o = o.parent) chain.push(o.userData);
    const room = artRoomOf(chain);
    const shadow = !chain.some(u => u.shadow === false);
    ctx.world.levelGroup.attach(m);
    if (room !== null) m.userData.room = room;
    m.castShadow = shadow;
    m.receiveShadow = true;
    if ((m as THREE.InstancedMesh).isInstancedMesh) { instanced++; instances += (m as THREE.InstancedMesh).count; }
  }
  ctx.world.art = { file, meshes: found.length, instanced, instances };
}
```

- [ ] **Step 3: `game-main.ts`.**
  - In the ACTIVE LEVEL block, after `ctx.world.level = authoredLevel(def);`: `artScene = await loadLevelArt(levelParam, def.art);` (declare `let artScene: THREE.Group | null = null;` before the block).
  - After the window loop and before `scene.add(ctx.world.levelGroup);`: `if (artScene && ctx.world.level.def?.art) placeLevelArt(ctx, artScene, ctx.world.level.def.art);`.
  - The light-list loop: `const list = ctx.world.levelLightLists.get(typeof mesh.userData.room === 'number' ? mesh.userData.room : roomIdAt(mesh.position.x, mesh.position.z));`.
- [ ] **Step 4: Seam** `artInfo: () => ctx.world.art` in `createWorldSeams`.
- [ ] **Step 5: Verify** tsc, world-state test, then boot `?level=fixtures/art-shell` headless (Task 7's gate). **Commit** `feat(art): load and place level art, lit per room`.

---

### Task 7: Gate, budget, regressions

**Files:** Create `scripts/sdf-game-art-gate.sh` / `.mjs` (ports 5294/9294); Modify `TASKS.md`.

- [ ] **Step 1: Gate** (plumbing and `decodePng` copied from the Void gate):
  1. **Fixture:** boot `level=fixtures/art-shell`; `artInfo()` has `instanced === 1 && instances === 3`; pose (0, −6, yaw π/2 → facing the +x wall, pitch 0); screenshot; the middle-right strip (x 0.7–0.95, y 0.35–0.55) is the panel's green (`g > 1.5 r && g > 1.5 b`), the seat's orange shows at left-centre (x 0.05–0.3, y 0.55–0.75: `r > 1.5 g`).
  2. **Wake cost:** for `art=0` then with art: boot `level=the-wake&frozen`, `freeze(true)`; at each pose (A: start `(-11.5, -1.5, 0, 0)`, B: graveyard `(-11.5, -27.5, 0.67, 0.1)`, C: facing the manor `(0, -50, 0, 0.1)`) wait 1 s, then sample 60 animation frames in the page: per frame `drawStats(true).drawCalls` and the frame delta; record the medians. Print a table; `checkArtBudget(max-over-poses before, after, BUDGET)`.
  3. `BUDGET` starts at `{ drawCalls: 50, frameMs: 2 }` and is updated to the owner-approved value after the first measurement.
- [ ] **Step 2: Run the gate; show the owner the table and a Wake screenshot with art** (pose C). Adjust the budget in the gate once approved.
- [ ] **Step 3: Regressions:** Void, Wake, shorty gates; `npx vitest run src/lab/sdf-zombie/webgpu src/game/level`.
- [ ] **Step 4: TASKS.md** (item 3a done; next: carriage kit spec). **Commit** `test(art): headless gate (fixture shell + instancing, Wake cost); TASKS`.
