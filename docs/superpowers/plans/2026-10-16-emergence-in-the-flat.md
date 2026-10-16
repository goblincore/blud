# The Egg Emerges in the Flat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `?level=flat-early&emergence=1&res=320` plays the egg-out-of-the-monitor scene in the real Flat, in the game: the kotatsu holds a CRT, the cinematic goblin (home clothes, expressions) reacts, the player takes over at the end.

**Architecture:** Extract the lab page's screen pass, set and goblin puppet into shared modules; a `flat-early` level (the Flat's Blender build minus the iMac); a `game-emergence.ts` runtime on the existing sequence system; pure modules for placement and expression cues. The lab page keeps working as the tweaking bench.

**Spec:** [`docs/superpowers/specs/2026-10-16-emergence-in-the-flat-design.md`](../specs/2026-10-16-emergence-in-the-flat-design.md) (read it first). **Branch:** `claude/emergence-in-the-flat` (stacked on `claude/screen-emergence-lab`, PR #47).

**House rules (`CLAUDE.md`):** do not run the full test suite; `npm run typecheck`, `npm run test:changed`, `npx vitest run <path>`. WGSL is only checked in a real browser (read the console). **THE OWNER'S MACHINE IS BUSY (he is doing other work): keep load LOW: one headless Chrome at a time; render at 320 x 240 (`?res=320` in the game, `?res=320x240` in the lab page); a few frames, never loops or soak runs; no `emergence:check` (the heavy 1280 x 800 lab check) unless a task says so; close what you open.** Never touch the owner's dev server on 5173; use your own vite port (e.g. `npx vite --port 5290 --strictPort`, started and stopped by you, or the lab scripts with `LAB_VITE_PORT=5290 LAB_CDP_PORT=9290 LAB_TMP=.lab-tmp`). Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` exactly. After adding a module run `npx tsx scripts/module-index.ts` and commit the index.

**Context to read once:** [`docs/dev-notes/2026-10-11-screen-emergence/NOTES.md`](../../dev-notes/2026-10-11-screen-emergence/NOTES.md) (what the lab page is, every knob), [`docs/dev-notes/2026-10-13-goblin-expressions/NOTES.md`](../../dev-notes/2026-10-13-goblin-expressions/NOTES.md) (the cinematic head, `expression.ts`, `expression-library.ts`, `characters/goblin-expressions.ts`; how `lab-main.ts` drives it: `stepExpression`, `expressionAt`, `actuate`, `exprGape`, `exprMorphs`, `sheetKey`, `refreshSheet`), `webgpu/game-egg.ts` (the precedent for a WGSL pass on a proxy box in the game's SDF layer late scene: `createEgg`, `adoptEggFx`, `stepEgg`), `webgpu/game-sequence.ts` + `ending-sequence.ts` (the sequence runtime: camera override, hidden gun/HUD, blocked input, `CameraSpec` kinds `drift`/`fixed`/`hold`, `startSequence`), `webgpu/game-spawn.ts` lines ~150-260 (how the game passes `ctx.render.sdfLayer`'s dependencies to `createCharacterView` and sets a character's skin).

---

### Task 1: a 320 x 240 resolution rung in the game

**Files:** `src/lab/sdf-zombie/webgpu/game-main.ts` (`RES_RUNGS`, near line 414), the test that pins the rungs if one exists (`grep -rn "RES_RUNGS\|resRung" src --include=*.test.ts`).

- [ ] **Step 1:** Add `'320': { mode: 'fixed', width: 320, height: 240 }` to `RES_RUNGS` and update the comment above it ("the owner picks with ?res=": add 320, the 2026-10-16 owner request: a very low-res rung for a busy machine). `SDF_SCALE` for the rung: look at how the table's other rungs set the SDF scale (the comment mentions `SDF_SCALE`): 1.0 is fine at this size.
- [ ] **Step 2:** If a test pins the rungs, extend it; otherwise add none (the boot check in Task 9 proves it). Run `npm run typecheck`.
- [ ] **Step 3:** Commit `feat(game): a 320x240 resolution rung (?res=320)`.

### Task 2: extract the screen pass into `screen-pass.ts`

**Files:** create `webgpu/screen-pass.ts`; modify `webgpu/screen-lab-main.ts`. Read first: `screen-lab-main.ts` lines ~320-475 (`ScreenPass`, `createScreenPass`, the helper constants) and the per-frame update code in `bootstrap` that sets the pass's uniforms (search for the calls that use `paramsAt`, `pictureTable`, `gooTexels(gooAt(...))`, the lip, the egg centre, `coat`, `lamp`).

- [ ] **Step 1:** Move `createScreenPass(pictureTex)` and its type and constants out of the page into `screen-pass.ts` (a pure move: no behaviour change), exported as `createScreenPass(pictureTex, opts)` where `opts` carries what the page hard-coded about the set that the pass needs (the lamp position `LAMP_BULB`, the desk/table heights `DESK_Y`-relative values, the keyboard footprint for the goo coat, `PASS_LAMP`). Also move the page's per-frame uniform update into an exported `updateScreenPass(pass, t, view)` (computing `paramsAt(t)`, the picture table, the goo texels (`gooAt(t)` cached per `t`), the lip, the egg centre, the coat, the time) so the game can call exactly the same thing; `view` carries the camera-dependent bits only if the pass needs any (keep it empty if not). The lab page now calls these; its seam (`__screenLab`) and the `?nopass`/`?nogoo`/shadow switches keep working.
- [ ] **Step 2:** `npm run typecheck`; run the pure tests that touch the pass's constants (`screen-emergence.wgsl.test.ts`, `emergence-field.test.ts`, `goo-strands.test.ts`). Verify the lab page still boots and draws: ONE headless capture at `?res=320x240&shot=crowning&t=8` through the lab scripts (own ports), no console errors, and a look at the frame (the sac and the flesh look as before). Commit `refactor(emergence): the screen pass and its per-frame update are shared (screen-pass.ts)`.

### Task 3: extract the set; the placement transform (pure)

**Files:** create `webgpu/screen-set.ts`, `webgpu/emergence-placement.ts` (+ `.test.ts`); modify `webgpu/screen-lab-main.ts`.

- [ ] **Step 1: The placement, test first.** The screen frame's origin is the glass centre; the board's top is `DESK_Y` (-0.32 m) below it, its front edge at `TABLE_FRONT_Z` (0.365) and its back `KOTATSU.d` (0.82) behind that, so the table's centre in the screen frame is `[0, DESK_Y, TABLE_FRONT_Z - KOTATSU.d / 2]` = `[0, -0.32, -0.045]`.

```ts
// src/lab/sdf-zombie/webgpu/emergence-placement.test.ts
import { describe, it, expect } from 'vitest';
import { FLAT_KOTATSU, placementFor, toWorld, fromWorld } from './emergence-placement';
import { DESK_Y, KOTATSU, TABLE_FRONT_Z } from './emergence-field';

const TABLE_CENTRE: [number, number, number] = [0, DESK_Y, TABLE_FRONT_Z - KOTATSU.d / 2];
const p = placementFor(FLAT_KOTATSU, TABLE_CENTRE, DESK_Y);

describe('emergence placement', () => {
  it('puts the table centre on the Flat kotatsu: game (0.12, board top 0.44, -2.36)', () => {
    const w = toWorld(p, TABLE_CENTRE);
    expect(w[0]).toBeCloseTo(0.12, 9);
    expect(w[1]).toBeCloseTo(0.44, 9);
    expect(w[2]).toBeCloseTo(-2.36, 9);
  });
  it('the floor he sits on is the tatami top (0.055 above the room floor): the board stands KOTATSU.top above it', () => {
    const floorW = toWorld(p, [0, DESK_Y - KOTATSU.top, 0]);
    expect(floorW[1]).toBeCloseTo(FLAT_KOTATSU.floor, 9);
  });
  it('the screen faces the room: +z in the screen frame is +z (south) in the game', () => {
    const a = toWorld(p, [0, 0, 0]), b = toWorld(p, [0, 0, 1]);
    expect(b[2] - a[2]).toBeCloseTo(1, 9);
    expect(b[0] - a[0]).toBeCloseTo(0, 9);
  });
  it('round-trips points exactly, including under a yaw', () => {
    for (const pl of [p, { ...p, yaw: 0.7 }]) for (const v of [[0, 0, 0], [0.3, -0.2, 0.5], [-1, 0.4, -0.2]] as const) {
      const b = fromWorld(pl, toWorld(pl, [...v]));
      for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(v[i]!, 9);
    }
  });
});
```

- [ ] **Step 2: The implementation.**

```ts
// src/lab/sdf-zombie/webgpu/emergence-placement.ts
//
// Where the screen frame (origin at the glass centre, +x right, +y up, +z out of the screen toward the room, metres: emergence-field.ts)
// sits in the Flat. Pure. The Flat's kotatsu is `flat_layout.py`'s KX, KY (Blender x, y) and KTOP; game coordinates are (x, z-up -> y, -y -> z).
import type { Vec3 } from './emergence-field';

export interface Placement { origin: Vec3; yaw: number }

/** The Flat's kotatsu: its centre (game x, game z), the board top (game y), and the tatami top (game y of the floor he sits on). */
export const FLAT_KOTATSU = { x: 0.12, z: -2.36, top: 0.44, floor: 0.055 } as const;

export function placementFor(k: { x: number; z: number; top: number; floor: number }, tableCentreInScreen: Vec3, deskY: number): Placement {
  // world = origin + rotate(screen); the table's centre (screen frame) lands on the kotatsu's centre at the board's top.
  return { origin: [k.x - tableCentreInScreen[0], k.top - deskY, k.z - tableCentreInScreen[2]], yaw: 0 };
}

export function toWorld(p: Placement, v: Vec3): Vec3 {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [p.origin[0] + c * v[0] + s * v[2], p.origin[1] + v[1], p.origin[2] - s * v[0] + c * v[2]];
}

export function fromWorld(p: Placement, w: Vec3): Vec3 {
  const x = w[0] - p.origin[0], z = w[2] - p.origin[2], c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [c * x - s * z, w[1] - p.origin[1], s * x + c * z];
}
```

(The signature is `placementFor(FLAT_KOTATSU, tableCentreInScreen, DESK_Y)`; `toWorld`/`fromWorld` are exact inverses, also under a yaw.) Run the test, typecheck.

- [ ] **Step 3: Extract the set.** Move the page's builders (`rrect`, `loft`, `box`, `cyl`, `std`, `buildCrt`, the keyboard, the lamp, `buildZabuton`, and the kotatsu SKIRT part of `buildKotatsuAndRoom`) into `screen-set.ts`; export `buildCrt(parent)`, `buildKeyboard(parent, ...)`, `buildLamp(parent, ...)`, `buildZabuton(parent, top)` and, separately, `buildTableAndRoom(parent, layout)` which the LAB page keeps using for its own table, floor and walls (the game uses the level's table, floor and walls). Pure move; the lab page behaves identically. Verify with one 320 x 240 headless capture of the lab page and a look; `npm run typecheck`; `module-index`. Commit `refactor(emergence): the set builders and the placement transform are shared (screen-set.ts, emergence-placement.ts)`.

### Task 4: the cinematic goblin in his home clothes, and the shared puppet

**Files:** create `characters/goblin-cinematic-home.blob` + `characters/goblin-cinematic-home.test.ts`; modify `character-registry.ts`, `pose-library.ts`, `expression-library.ts`; create `webgpu/goblin-puppet.ts`; modify `webgpu/screen-lab-main.ts`. Read first: `characters/goblin-home.blob` + `goblin-home.test.ts` (the guarded copy pattern: the marked block `# --- home clothes begin/end ---`), `characters/goblin-cinematic.blob`, `webgpu/screen-lab-main.ts` lines ~500-700 (the goblin set-up: skin from `game-spawn.ts`, the generated face, `retireEquipment`, `makeActorMotion`/`stepActorMotion`, `pinToPose`, rim/fill uniforms), `lab-main.ts` `stepExpression` (the expression driving).

- [ ] **Step 1: The variant, test first.** `goblin-cinematic-home.test.ts`: like `goblin-home.test.ts`, "the file minus its marked home-clothes block, with `model goblin-cinematic-home` renamed to `model goblin-cinematic`, equals `goblin-cinematic.blob`"; compiles and validates clean at the goblin's scale; the cloth is 2 to 5 shells; the soles stay on the floor at rest. Then create the file: `cp goblin-cinematic.blob goblin-cinematic-home.blob`, rename the model, and insert the SAME home-clothes block as `goblin-home.blob` (copy its lines, including the bare-leg and foot lines; adjust only if the cinematic body's skeleton differs: check `git diff --no-index characters/goblin.blob characters/goblin-cinematic.blob` first for differences in the torso/leg prims, because the cloth numbers were fitted to the base goblin; the cinematic differs in the head and jaw only). Run the guard test, `blob-emit.test.ts` (globs every `.blob`), and `pack-golden` (`npx vitest run -u src/lab/sdf-zombie/pack-golden.test.ts`: darwin/arm64 only; the diff must be exactly one new line).
- [ ] **Step 2: The registries.** `character-registry.ts`: a `'goblin-cinematic-home'` entry like `goblin-home` (no kit, `face: ZOMBIE_FLAT`, `profile: motionProfileFor('goblin')`: check `motion-profile.ts`'s name keys for `goblin-cinematic`, it has its own entry: follow it); `pose-library.ts` and `expression-library.ts`: the new name shares `GOBLIN_POSES` and the cinematic's `{ clips, tuning }`; update the tests that list library names (`goblin-poses.test.ts`'s `posesFor` check, an expression-library test if any).
- [ ] **Step 3: The puppet.** Extract from the lab page into `webgpu/goblin-puppet.ts` a `createGoblinPuppet(deps)` that, given the SDF layer's dependencies (`cone`, `occluder`, `shell`, `prev`, `lastFrame`, `depthPre`, `refine`: see `game-spawn.ts` ~160-190 for the exact set and how the lab page builds the same), a scene/parent, and the character name (`'goblin-cinematic-home'`), builds the view (no kit, no gun: `retireEquipment()`), applies the skin (the .blob's palette, the generated face from its `sheet` block: see the lab's face-sheet fix), and returns `{ view, step(t, dt, root, fps), setVisible(b), dispose() }` where `step` samples the pose clip and the root offset from `goblinClipAt`/`goblinRootAt` (the lab's logic), pins the rig with `pinToPose`, steps the expression (Task 5's `expressionChannelsAt`) and uploads the jaw gape, morphs and the regenerated face sheet when the key changes (the lab's `stepExpression` and `refreshSheet`), and applies the body's world position/yaw. The lab page uses it with the SDF layer it already makes; behaviour unchanged for the existing `goblin-home` (`?character=goblin-home` keeps the old body) and the new default is `goblin-cinematic-home` once Task 5 lands (keep `?character=` working).
- [ ] **Step 4: Verify and commit.** `npm run typecheck`; the tests above; one 320 x 240 headless capture of the lab page at `?shot=settle&t=13` showing the cinematic head (neutral until Task 5). Commit `feat(goblin): goblin-cinematic-home (the expression head in his home clothes) and a shared goblin puppet`.

### Task 5: expression cues (pure) and the lab page uses them

**Files:** create `webgpu/emergence-expressions.ts` (+ `.test.ts`); modify `webgpu/goblin-puppet.ts` and the lab page to call it.

- [ ] **Step 1: Test first** (`emergence-expressions.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { GOBLIN_CUES } from './screen-lab-goblin';
import { SHOTS } from './emergence-timeline';
import { GOBLIN_EXPRESSIONS } from '../characters/goblin-expressions';
import { CHANNEL_NAMES, REST_CHANNELS, expressionAt } from '../expression';
import { expressionCues, expressionChannelsAt } from './emergence-expressions';

const cues = expressionCues(GOBLIN_CUES);

describe('emergence expressions', () => {
  it('starts neutral (the rest channels)', () => {
    expect(expressionChannelsAt(0, cues)).toEqual(REST_CHANNELS);
  });
  it('the cues are in order and each names a clip of the goblin library', () => {
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.from).toBeGreaterThan(cues[i - 1]!.from);
    for (const c of cues) expect(GOBLIN_EXPRESSIONS[c.clip], c.clip).toBeDefined();
  });
  it('surprise comes after the flinch starts, the evil grin after he starts to sit up, and nothing before', () => {
    const at = (clip: string) => cues.find(c => c.clip === clip)!.from;
    expect(at('surprise')).toBeGreaterThanOrEqual(GOBLIN_CUES.flinch);
    expect(at('evil-grin')).toBeGreaterThanOrEqual(GOBLIN_CUES.sitUp);
    expect(at('shout')).toBeGreaterThanOrEqual(SHOTS.find(s => s.id === 'crowning')!.start);
  });
  it('holds the evil grin to the end', () => {
    const last = cues[cues.length - 1]!;
    const end = expressionChannelsAt(14.5, cues), want = expressionAt(GOBLIN_EXPRESSIONS[last.clip]!, 14.5 - last.from);
    for (const n of CHANNEL_NAMES) expect(end[n], n).toBeCloseTo(want[n], 6);
  });
  it('is continuous: no channel jumps more than 0.25 in 10 ms (crossfades, not cuts)', () => {
    for (let t = 0; t < 14.5; t += 0.01) {
      const a = expressionChannelsAt(t, cues), b = expressionChannelsAt(t + 0.01, cues);
      for (const n of CHANNEL_NAMES) expect(Math.abs(b[n] - a[n]), `${n} t=${t.toFixed(2)}`).toBeLessThan(0.25);
    }
  });
});
```

- [ ] **Step 2: Implementation.**

```ts
// src/lab/sdf-zombie/webgpu/emergence-expressions.ts
//
// THE GOBLIN'S FACE through the emergence (spec docs/superpowers/specs/2026-10-16-emergence-in-the-flat-design.md): which of the goblin's
// expression clips plays when, derived from the same cue times as his body (screen-lab-goblin.ts goblinCues), crossfaded. Pure.
import type { Channels } from '../expression';
import { CHANNEL_NAMES, REST_CHANNELS, expressionAt } from '../expression';
import { GOBLIN_EXPRESSIONS } from '../characters/goblin-expressions';
import { SHOTS } from './emergence-timeline';
import type { GoblinCues } from './screen-lab-goblin';

export interface ExpressionCue { from: number; clip: string; fade: number }

const smooth = (u: number) => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };

/** First-round values; the owner tunes the face in the lab page. A cue's clip plays from its own start (local time t - from). */
export function expressionCues(c: GoblinCues): ExpressionCue[] {
  const tear = SHOTS.find(s => s.id === 'crowning')!.start;
  return [
    { from: 0, clip: 'neutral', fade: 0 },
    { from: c.flinch, clip: 'surprise', fade: 0.12 },        // the flinch: eyes wide, mouth open (abrupt, like his body)
    { from: tear + 0.3, clip: 'shout', fade: 0.2 },          // the tear opens
    { from: c.land, clip: 'scowl', fade: 0.3 },              // the egg is down
    { from: c.sitUp + 0.3, clip: 'evil-grin', fade: 0.5 },   // he sits up and looks at it
  ];
}

export function expressionChannelsAt(t: number, cues: readonly ExpressionCue[]): Channels {
  const clipAt = (c: ExpressionCue): Channels => expressionAt(GOBLIN_EXPRESSIONS[c.clip]!, Math.max(0, t - c.from));
  let out: Channels = { ...REST_CHANNELS };
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    if (t < c.from) break;
    const w = i === 0 ? 1 : smooth(c.fade <= 0 ? 1 : (t - c.from) / c.fade);
    const here = clipAt(c);
    const mixed = {} as Channels;
    for (const n of CHANNEL_NAMES) mixed[n] = out[n] + (here[n] - out[n]) * w;
    out = mixed;
  }
  return out;
}
```

Check the clip names exist (`neutral` is not in the exported record if the library omits it: `GOBLIN_EXPRESSIONS` lists the clips at the bottom of `characters/goblin-expressions.ts`; use whatever the library exports for neutral). Run the test; typecheck.
- [ ] **Step 3: Wire it.** The puppet's `step` uses `expressionChannelsAt(t, expressionCues(GOBLIN_CUES))` with the blink on top (the lab's `blinkLid`/`withBlink`: a blink every ~3.2 s, deterministic from `t`); the lab page's default character becomes `goblin-cinematic-home` and shows the faces (a `?face=0` switch for the plain goblin: the lab's `?character=goblin-home` already does). One 320 x 240 headless capture each at t = 3.6 (surprise), 7.5 (shout), 12.5 (evil grin) of the lab page from a close preset or `?free=1` orbit at his head; look at them honestly (does the face change? is it readable at 320 x 240?). Commit `feat(emergence): the goblin's expressions through the sequence, derived from his cues`.

### Task 6: the `flat-early` level (the Flat without the iMac)

**Files:** `scripts/levels/build_the_flat.py`, `scripts/levels/flat_layout.py`; generated `assets-source/levels/flat-early.blend`, `public/assets/levels/flat-early.level.json`, `public/assets/levels/flat-early.art.glb`; test `src/lab/sdf-zombie/webgpu/level-json.flat-early.test.ts`; docs. Read first: `scripts/levels/build_the_flat.py` (the build entry; `imac.build(M)` at line ~83; `sc["level_id"] = "flat"` at ~74), `scripts/levels/flat_layout.py` (`LIGHTS`: `amber`, `amber2`, `screen` belong to the iMac; the others are the room's), `scripts/levels/export_level.py` (the export command in `build_the_flat.py`'s header), `webgpu/level-json.flat.test.ts` (the flat test to mirror), `docs/game/levels/blender-conventions.md`.

- [ ] **Step 1: The stage flag.** `build_the_flat.py` reads `FLAT_STAGE` (env, default `late`): with `early` it skips `imac.build(M)` (and anything that exists only for the machine: the umbilicus and hoses are inside `imac.build`; check `giger.build`/`props.build` for iMac-only pieces such as the kotatsu's cable or the wall collar by the window and leave only what the room needs), sets `level_id = "flat-early"`, drops `amber`, `amber2` and `screen` from the lights and adds `lamp` (warm, at the kotatsu's left rear: the lab's `LAMP_BULB`, converted with the placement: (x, y) = Blender (game x, -game z), z the bulb height) and `crt` (a cool blue-white glow in front of where the CRT's glass will be, low power), `fixture: "none"` like the others (the art, or the runtime lamp, is the lamp), saves to `assets-source/levels/flat-early.blend`. `flat_layout.py` gets the early lights list and a `STAGE`-aware `LIGHTS` selection; its `check()` still passes for both stages. The default stage's output must stay BYTE-IDENTICAL: rebuild the late flat with the flag unset first and confirm `git status` shows `flat.level.json`/`flat.art.glb`/`flat.blend` unchanged (if Blender embeds timestamps and the glb differs, say so and restore the committed files with `git checkout`).
- [ ] **Step 2: Build and export once** (about a minute of CPU: do it once, nothing else running):

```bash
FLAT_STAGE=early blender --background --python scripts/levels/build_the_flat.py
blender --background assets-source/levels/flat-early.blend --python scripts/levels/export_level.py -- public/assets/levels/flat-early.level.json
```

(use the exact commands in `build_the_flat.py`'s header; the second writes `flat-early.level.json` and `flat-early.art.glb`).
- [ ] **Step 3: Test first** (`level-json.flat-early.test.ts`, mirroring `level-json.flat.test.ts`): parses with `parseLevelJson`; `missingCapabilities` is empty; one art room, the same footprint as `flat`; the start is in the hall; the GLB has no `giger_shell`, `screen`, `cd`, `mucus`, `lips` materials (the iMac's), still has `kotatsu_board`; lights within the cap and including `lamp` and `crt`; primitives and triangles under the flat's caps. Run it. Commit the generated assets and the script change together: `feat(flat): the early stage of the Flat (flat-early): the same apartment without the Giger iMac`.

### Task 7: `game-emergence.ts`, the runtime in the game

**Files:** create `webgpu/game-emergence.ts` (+ a pure part `emergence-camera.ts` with a test); modify `game-context.ts` (a `ctx.world.emergence` slot), `game-main.ts` / `game-tick.ts` / `game-loop.ts` (the same three hook points `game-egg.ts` uses: create after the level loads, adopt into the SDF layer's late scene once it exists, step per sim step), `ending-sequence.ts` or a new sequence factory, `game-sequence.ts` only if a camera kind must be added. Read first: `game-egg.ts` entirely, `game-sequence.ts`, `ending-sequence.ts`, `game-spawn.ts` (~150-260), `game-main.ts` where `createEgg`/`adoptEggFx`/`stepEgg` are called (search `createEgg`), `webgpu/game-context.ts`.

- [ ] **Step 1: The cameras (pure, test first).** `emergence-camera.ts`: the lab's five shot presets (`screen-lab-main.ts` `PRESETS` and `presetAt`: eye/at/fov in the screen frame, with the push shot's second preset at `PUSH_WIDE_AT`) re-authored for the Flat as `FLAT_PRESETS` in the screen frame (the room is 2.7 m wide (game x -1.35 to 1.35), 5.6 m long; the kotatsu centre is at game (0.12, -2.36); the screen faces +z with the goblin south of the table; the lab's wide shots sat 2.4 to 3 m to the side: bring them inside the room, tighter), and `shotsFor(placement)` returning the sequence's shots (`SHOTS` durations from `emergence-timeline.ts`; each shot a `fixed` camera whose eye/look are `toWorld(placement, ...)`; the push shot as two shots, cutting at `PUSH_WIDE_AT`). Tests: every eye lies inside the room box (`ROOM_BOX` of `flat_layout.py`: x -1.35..3.1 (the room box includes the bathroom and filler: use the main room, x -1.35..1.35, y 0..5.6 game z 0..-3.6 or the whole box minus the filler: read `flat_layout.py` `ROOM_BOX`, `COLLISION`, `SOLIDS` and keep eyes in the open main room and hall), above the floor (game y 0.5 to 2.2), the durations sum to `DURATION`, the shot boundaries match `SHOTS`.
- [ ] **Step 2: The runtime.** `createEmergence(ctx)`: only when `?emergence=1` or the loaded level id is `flat-early` (so the CRT set shows in the early stage even without the sequence); builds the set at the kotatsu (`screen-set.ts` builders under a group placed with `emergence-placement` (`placementFor(FLAT_KOTATSU, ...)`)) and the pass proxy (`screen-pass.ts`, picture = `/assets/lab/screen-source.png`) added to `ctx.render.sdfLayer.lateScene` (the `adoptEggFx` pattern), with the puppet (`goblin-puppet.ts`) built from `ctx.render.sdfLayer`'s dependencies; hidden until the sequence runs. `startEmergence(ctx)`: registers/starts the `emergence` sequence on the sequence system with `shotsFor(placement)` (the sequence runtime reads `SEQUENCES[id]`: add a runtime registration, e.g. `registerSequence(seq)`, rather than editing the const), `endEvent: 'emergence.end'`. `stepEmergence(ctx, dt)` per sim step: while the sequence is active take its clock `t`, call `updateScreenPass(pass, t)` and the puppet's `step(t, dt, rootOffsetWorld, fps)`, show the puppet during the sequence only. With `?emergence=1` autostart 2 s after the level is ready.
- [ ] **Step 3: The hand-off.** At the sequence's end (the sequence runtime queues the end event): hide the puppet, keep the pass and set (the egg stays on the keyboard in its goo: `updateScreenPass` holds `t = DURATION`), place the player's camera/position at the goblin's seated eye (about 0.6 m above the floor he sat on, at the cushion's spot, looking at the egg's centre; the first-person controller state is `ctx.player.player`: set its position and yaw/pitch as the level start does; read how `startPos` is applied) and release input (the sequence system does on end). A seam: `__sdfGame.emergence()` (state: phase, `t`, puppet visible, the pass's proxy visible, the egg centre in world), `startEmergence()`, `skipEmergence()` (jump the clock to the end: the next step finishes it). Tests (pure parts): the hand-off position is inside the room and not inside the table/kotatsu collider (`flat_layout.py` `COLLISION`: kotatsu box); the sequence's total duration is `DURATION`.
- [ ] **Step 4: Verify** (light): `npm run typecheck`, the pure tests, then ONE headless boot at `?level=flat-early&emergence=1&res=320` through the lab scripts (own ports): no console errors or WebGPU validation messages; read `__sdfGame.emergence()`. Commit `feat(emergence): the egg emerges in the Flat: the runtime, the sequence cameras and the hand-off`.

### Task 8: the in-level headless check and a look

**Files:** `scripts/flat-emergence-check.sh`, `scripts/flat-emergence-check.mjs` (pattern: `scripts/screen-emergence-check.sh`/`.mjs` and `scripts/sdf-game-flat-gate.mjs`); `package.json` (`flat-emergence:check`).

- [ ] **Step 1: The script** (own ports 5290/9290 by default, `LAB_TMP=.lab-tmp`, one Chrome, stops only what it started): load `/sdf-game.html?level=flat-early&emergence=1&res=320`; wait for the game to be ready; FAIL on any console error, uncaught exception or WebGPU/WGSL validation message (ignore `favicon`); `__sdfGame.startEmergence()` if it has not autostarted; for the five key times (2.0, 5.5, 8.0, 10.0, 13.0) set the sequence clock (use the seam `skipEmergence`-style stepping: add a seam `emergenceSetT(t)` for the check) and screenshot the canvas; at the end assert the hand-off (`emergence().phase === 'done'`, the player controllable: the player's position inside the room box); one frame-cost read at the push shot with the pass on (`timeDraws` or the game's own frame stats; recorded, never gated); a sheet (320 x 240 frames upscaled 2x, labelled) via `python3 -I` with Pillow, paths as arguments. Exit non-zero on any failed assertion.
- [ ] **Step 2: Run it once** (about a minute at 320 x 240). Read the sheet yourself and describe honestly: is the CRT on the kotatsu and the iMac gone? does the goblin sit on his cushion south of the table facing it? do the cameras stay inside the room and show goblin and screen? does the sac and the flesh look as in the lab? the goo-coated keyboard? the evil grin readable at 320 x 240? Note what is wrong for the owner (lighting on the goblin in the game, the camera shots, the room's own lights on the set). Commit `feat(emergence): a 320x240 headless check for the scene in the Flat`.

### Task 9: notes, wiki, PR

- [ ] `docs/dev-notes/2026-10-16-emergence-in-the-flat/NOTES.md`: what was built, how to run it (`npm run dev`, `/sdf-game.html?level=flat-early&emergence=1&res=320`; the seams; replay), the sheet from Task 8 (JPEG under 1 MB), what moved out of the lab page (and that the lab page is still the bench), the `flat-early` rebuild command, the cost read, what is wrong (from Task 8), the open items from the spec's out-of-scope list. `TASKS.md` and `docs/tasks/levels.md`: the entry (built, owner look pending, links). Regenerate the module index. The spec's status line: built, owner look pending. `npm run typecheck && npm run test:changed`. Push, open the PR stacked on #47 (`gh pr create --base claude/screen-emergence-lab`), body: what it is, how to run it, the load notes, the owner questions (the hand-off spot; the cues; which camera shots), ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; bind/read CI with the PR tools; do not poll.
