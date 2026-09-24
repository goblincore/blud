# Bride (sword melee enemy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 1–5 are CHARACTER AUTHORING: invoke the `authoring-sdf-characters` skill before starting them.

**Goal:** Add `bride`, a pale, fleshy, lace-dressed swordswoman (Blud's Quake death knight): an SDF body in shell cloth, WAM plate arms and a Blender longsword. She stalks the player and cleaves, sweeps or lunges in `?spawn=bride`.

**Spec:** `docs/superpowers/specs/2026-09-24-bride-sword-enemy-design.md`. Read it first. It holds the look, the four horror hooks, and the out-of-scope list.

**Architecture:** The swing logic lives in pure, renderer-free modules:
- `sword-swing.ts` (new): the phase-keyed carry tracks, the lunge advance, the contact test, `SWORD_TUNING`.
- `brain.ts`: a widened tuning with variant picking and a lunge band.
- `carry.ts` / `motion-profile.ts` / `gait.ts`: the new carries, the profile and the gait.

The seams that consume that output:
- `motion.ts` replaces the carry pose with the track while a sword swing is live.
- `enemy-mind.ts` gains `makeSwordMind`.
- `game-actor.ts` applies the lunge's `advance`.
- `game-main.ts` picks the mind and turns `onMeleeContact` into player feedback.

Art comes from the existing pipelines: `.blob`, `.wam` → `build-wam-kit.sh`, a Blender prop script, and a PIL face-painter script.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest, Blender 4 (headless Python), WAM (`~/Projects/2026/wam`), PIL, headless-Chrome capture scripts (`scripts/*.mjs`, `npm run blob:shot`).

---

## Rules for every task

- **Port-ready by construction** (release is a Rust + wgpu port — production scope §4.6):
  - Game logic goes in a **pure, renderer-free module with its own tests**: no `three` import, plain data in and plain data out. The renderer-facing module only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string modules). This plan adds no WGSL. If you find you need some, stop and report.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module, never as new `main()` bindings (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic: seeded RNG, sim-time clocks, no wall-clock in logic. Keep console/capture seams in plain data.
- Work ONLY in this worktree. Never use bare `git stash`. `node_modules` is symlinked, so do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`. Never run the bare full suite.
- **Headless capture only.** The in-app browser pane loses the WebGPU device. Capture scripts require `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors.
- **Prove visual claims with a number** (crop luminance, a distance in metres), and look at the images yourself.
- **Visuals first, perf later** (owner, 2026-09-24). No perf bench in this plan. The prim count is a soft budget: build the best look that fits `MAX_PRIMS` and prefer paint over geometry for cheap detail.
- WebGPU: alpha goes in `colorNode.w`, never `alphaHash`/`alphaTest`. Never toggle a light's `.visible`.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders. Never commit them. The owner's reference photo is **not** committed either.

**Traps this plan already knows about. Read before starting:**
1. `blob:shot` can silently render the ZOMBIE: another worktree's dev server on the default port (5233) answers instead of yours. Use your own ports (Task 1 used 5271/9271) and always sanity-shot a known character (cultist) first. (`lab-main.ts` no longer has a `CHARACTERS` list — it reads `character-registry.ts`, so registration is the registry entry alone.)
2. The kit skeleton (`.wam`) is a hand transcription of the `.blob` skeleton. Units are height fractions, not metres, and **pitch negates on every "down" bone**. Nothing checks it except the kit test in Task 4.
3. Lab-only verification cannot catch placement bugs (`translateBody`). Garment and swing checks must also run in `sdf-game.html` (`?spawn=bride`, `__sdfGame.teleport(2)` + `placePlayer`).
4. The zombie path must be a **no-op**. `brain.test.ts` and `scripts/sdf-game-crowd-gate.mjs` must pass UNCHANGED after Tasks 6–10.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/characters/bride.blob` | create | SDF body, shells, strand hair, face prims, sheet, palette |
| `src/lab/sdf-zombie/characters/bride-blob.test.ts` | create | structural pins: budget, proportions, shells, registration |
| `scripts/make-bride-face.py` | create | paints `public/assets/lab/faces/bride-face.png` (corpse makeup, sutures) |
| `src/lab/sdf-zombie/characters/bride-kit.wam` | create | plate arms, pauldron, boots, chain belt, crosses |
| `public/assets/lab/bride-kit.gltf` | generated, commit | compiled kit |
| `src/lab/sdf-zombie/characters/bride-kit.test.ts` | create | kit/blob skeleton parity, no clipping, boots on floor |
| `scripts/model-bride-sword.py` | create | Blender longsword → `public/assets/lab/bride-sword.glb` |
| `src/lab/sdf-zombie/character-registry.ts` | modify | `bride` entry; `armoured` flag |
| `src/lab/sdf-zombie/webgpu/character-view.ts` | modify | sparks and breakable kit keyed on `entry.armoured` |
| `src/lab/sdf-zombie/brain.ts` | modify | `BrainTuning` widened: `pickVariant`, `lungeBand`, `swingSecFor` |
| `src/lab/sdf-zombie/attack.ts` | modify | `SwingVariant` gains `cleave`, `sweep` and `lunge` |
| `src/lab/sdf-zombie/sword-swing.ts` | create | tracks, `swordCarryAt`, `lungeAdvance`, `swordContact`, `SWORD_TUNING` |
| `src/lab/sdf-zombie/sword-swing.test.ts` | create | pure tests |
| `src/lab/sdf-zombie/carry.ts` | modify | `swordGuard`, `swordTrail` carries |
| `src/lab/sdf-zombie/gait.ts` | modify | `STALK` gait |
| `src/lab/sdf-zombie/motion-profile.ts` | modify | `melee` field, `BRIDE_PROFILE` |
| `src/lab/sdf-zombie/motion.ts` | modify | the carry block uses the sword track while a sword swing is live |
| `src/lab/sdf-zombie/webgpu/enemy-mind.ts` | modify | `advance` output, `makeSwordMind` |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | modify | apply `think.advance` |
| `src/lab/sdf-zombie/player-hit-feedback.ts` | create | pure flash/shake envelope |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | modify | mind selection, `onMeleeContact` → feedback, `__sdfGame.playerHits()` |
| `docs/dev-notes/2026-09-24-bride/NOTES.md` | create | frames, numbers, decisions |
| `TASKS.md` | modify | status row |

---

### Task 1: The body (`bride.blob`) + registration

**Files:**
- Create: `src/lab/sdf-zombie/characters/bride.blob`, `src/lab/sdf-zombie/characters/bride-blob.test.ts`
- Modify: `src/lab/sdf-zombie/character-registry.ts` (imports ~l.42, entries ~l.297)

This task is FLESH ONLY: no shells, no hair, no sheet (`sheet` → `enabled 0` for now). Start from `characters/cultist.blob` for block order and syntax (`model` / `skeleton` / `body` / `bones` / `face` / `sheet` / `palette`). Take the header style from `characters/schoolgirl-described.blob` and the attractive/wrong discipline from `characters/broodmother.blob` (read their headers). Write the header as a design brief. It must name the four hooks and say which prims carry each.

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/characters/bride-blob.test.ts
//
// Pins the bride's DESIGN INTENT (spec 2026-09-24-bride-sword-enemy-design.md).
// Prose + one inspiration photo (not committed), so these are STRUCTURAL pins,
// each naming a decision from the .blob header. Whether she reads as
// beautiful-then-wrong is the owner's call on frames, not this file's.
import { describe, it, expect } from 'vitest';
import src from './bride.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { MAX_PRIMS } from '../validate';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const bone = (n: string) => {
  const b = body.bones.get(n);
  if (!b) throw new Error(`no bone ${n}`);
  return b;
};
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('bride — build', () => {
  it('compiles clean and is registered', () => {
    expect(body.errors).toEqual([]);
    expect(characterEntry('bride').name).toBe('bride');
  });

  it('fits the 128 flesh+bone prim budget with room for cloth and hair', () => {
    // Task 1 is flesh only; shells + strands (Task 3) need ~20 more.
    expect(body.prims.length).toBeLessThanOrEqual(MAX_PRIMS - 20);
  });
});

describe('bride — wrong anatomy (the cheap version)', () => {
  const height = Math.max(...body.prims.map(p => p.center[1] + p.radius));

  it('is tall: ~1.85 m', () => {
    expect(height).toBeGreaterThan(1.80);
    expect(height).toBeLessThan(1.92);
  });

  it('has legs ~10% too long: hip-to-floor over total height >= 0.54', () => {
    // A typical adult woman is ~0.49-0.50.
    const hipY = bone('thigh.l').head[1];
    expect(hipY / height).toBeGreaterThanOrEqual(0.54);
  });

  it('has a long neck: neck bone >= 0.13 m', () => {
    expect(dist(bone('neck').head, bone('neck').tail)).toBeGreaterThanOrEqual(0.13);
  });

  it('has the sword forearm longer than the off forearm (hidden by the vambrace)', () => {
    const r = dist(bone('forearm.r').head, bone('forearm.r').tail);
    const l = dist(bone('forearm.l').head, bone('forearm.l').tail);
    expect(r - l).toBeGreaterThan(0.03);
  });
});
```

Adjust the bone names to what you author, but keep the `.l`/`.r` suffixes and names that `gait.ts` `JOINT_AT` maps (`pelvis`, `spine1`/`chest`/`spine2` or `spine`, `neck`, `skull`, `clavicle`, `upperarm`, `forearm`, `hand`, `thigh`, `shin`, `foot`). The mirrored `mirror … end` block gives equal forearms, so author `forearm` OUTSIDE the mirror block as two bones: `forearm.l` and `forearm.r`. Check how the parser names mirrored bones (`grep -n "mirror" src/lab/sdf-zombie/blob-parse.ts`) and match that exactly. If the check (`MAX_PRIMS` import) fails because the constant isn't exported, export it from `validate.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- bride-blob`
Expected: FAIL. Cannot resolve `./bride.blob?raw`.

- [ ] **Step 3: Author `bride.blob` (flesh)**

Targets, all from the spec:
- `model bride`, `height 1.85`. The pelvis sits high (legs ≥ 54% of height). Thighs are stick-thin (thigh semi ≤ 0.055), the waist is a wasp waist (≤ 0.095 half-width), and the hips flare (~0.16). The chest is small and high. The neck bone is ≥ 0.13 m.
- **Rib window.** Flesh ridges or thin bone prims for 4–5 ribs on each side of a sternum gap, visible from the front between y ≈ 1.25 and 1.40. Task 3 clips the bodice open over exactly this band. (The look pass moved it to y 1.17–1.31, below and between the bust.)
- **Stigmata.** Paint only: a darker, wetter `color=` on small prims at the throat and inner thighs (or a painted cross made of two thin prims). Keep them subtle.
- **Fused seams.** Flesh bulge prims at both elbow creases and under where the pauldron will sit (the right shoulder), painted raw red (`color=` ~ `8a2a2a`). Add a flesh cuff prim on the right hand that extends past the fist along the grip axis.
- **Face structure.** Large sockets, high cheekbones, a fine nose, pale lips, a pointed chin. No sheet yet. Two eye prims, not glowing (she is not a demon).
- **Palette.** Blue-porcelain `baseColor` (start at linear `0.62 0.64 0.70`), bruise-violet mottle, `translucency` ~0.25, `wetness` ~0.2.

Then register her:

```ts
// character-registry.ts — import next to the cultist's
import brideBlobSrc from './characters/bride.blob?raw';
// …entry, next to cultist:
  // The bride — Blud's death knight: a pale, lace-dressed swordswoman.
  // docs/superpowers/specs/2026-09-24-bride-sword-enemy-design.md.
  bride: {
    name: 'bride', src: brideBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('bride'),
  },
```


- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- bride-blob && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Look at her**

Run `npm run blob:shot -- cultist` first (sanity: it must show the cultist, not the zombie), then `npm run blob:shot -- bride`. Also shoot the front, 3/4 and side views, plus a face close-up. The broodmother notes (`docs/dev-notes/2026-09-22-broodmother/NOTES.md`) have the lighting probe (`BLOB_PROBE=…lightDir…`). Copy the frames into `docs/dev-notes/2026-09-24-bride/` and read them. Iterate on the blob until the silhouette reads as tall, graceful and slightly too long.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/characters/bride.blob src/lab/sdf-zombie/characters/bride-blob.test.ts src/lab/sdf-zombie/character-registry.ts docs/dev-notes/2026-09-24-bride/
git commit -m "bride: SDF body — long-limbed, rib window, fused seams, stigmata"
```

---

### Task 2: Corpse-makeup face sheet

**Files:**
- Create: `scripts/make-bride-face.py`, `public/assets/lab/faces/bride-face.png` (generated, commit)
- Modify: `src/lab/sdf-zombie/characters/bride.blob` (`sheet` block), `src/lab/sdf-zombie/character-registry.ts` (`face: bakedFace('bride-face.png')`)

Read `scripts/make-ogre-face.py` in full first. Your script has the same shape: PIL, `SIZE = 512`, `SS = 4` supersample, the drawing centred at uv (0.5, 0.5), everything unpainted at alpha 0.

- [ ] **Step 1: Write the painter**

The header must say why a generator (no reference mesh, so `blob:face-bake` cannot run) and what it draws. Draw in this order, each as its own function:
1. `sockets()`: two soft radial gradients, near-black at the centre and fading out over ~70 px, set slightly above centre and spaced to match the eye prims.
2. `lids()`: thin bruised-red (`#7a1e22`) crescents along each socket's lower and upper rim, alpha ~0.6.
3. `hollows()`: SUNKEN CHEEKS (owner ask, 2026-09-24: done as texture, not geometry). A deep grey-violet (`#4a3c55`) hollow under each cheekbone, running from below the outer eye corner down toward the jaw corner. Alpha ~0.55 at the core, heavily blurred, with a thin lighter band (`#e8e4ee`, alpha ~0.2) along its top edge as the cheekbone highlight, so the hollow reads as depth under front light.
4. `lips()`: a grey-lilac (`#8a7a8e`) lip shape, alpha ~0.7.
5. `sutures()`: from each mouth corner, a fine dark line (2 px at 512) arcing back and up toward the ear (~110 px long), with ~9 short cross-stitches perpendicular to it. Colour `#2a1216`.
6. `veins()`: 2–3 faint blue (`#3d4f73`) branching polylines at each temple, alpha ~0.25.
7. `liner()` (owner ask, 2026-09-24: "eyelashes … or some kind of mascara look"): a thick black (`#0a0808`) line along each upper lid edge, thickening toward the outer corner and ending in a short upswept wing. Alpha ~0.9.
8. `lashes()`: about 14 fine tapered strokes (2 px at the root to 0 at the tip) fanning up and out from each upper lid edge, longest and most curled at the outer corner, plus about 6 short ones on each lower lid. Colour `#0a0808`. They are painted, not geometry: prim lashes would be subpixel at game distance.
9. `runs()`: running mascara. One or two thin (2–3 px) dark streaks per eye, from the lower lid down the cheek, wavering and fading out over about 60–90 px, with slightly uneven lengths left to right. This ties the mascara to the corpse makeup.

Seed with `random.Random(24)`, so it is deterministic.

- [ ] **Step 2: Generate and check**

Run: `python3 scripts/make-bride-face.py && python3 -c "from PIL import Image; im=Image.open('public/assets/lab/faces/bride-face.png'); print(im.size, im.mode, im.getextrema())"`
Expected: `(512, 512) RGBA`, with alpha extrema starting at 0.

- [ ] **Step 3: Wear it**

In `bride.blob`, replace `sheet / enabled 0` with an `image bride-face.png` sheet block. Copy the key set from `schoolgirl-described.blob` l.296–309 (`decal`, `projScaleX/Y`, `projCentreX/Y`, `eyeGlowCut 0.99`, `eyeGlowAmp 0`, since her eyes don't glow). Solve `projCentreY` from the mouth height the way the comment in `ogre.blob` l.251–262 shows. Use whichever blend mode is the current house default for painted sheets (check the `decal` handling in `face.ts` / `character-registry.ts`). The owner prefers overlay over multiply for faces. In the registry, set `face: bakedFace('bride-face.png')`.

- [ ] **Step 4: Verify on frames**

Shoot a face close-up and a 3 m 3/4 view. Measure: the mean luma of an eye-socket crop must be at least 0.15 darker than a cheek crop. Look at both images. The sutures and the lashes/liner must be visible in the close-up, and the makeup (dark eyes, mascara runs) must still read at 3 m.

- [ ] **Step 5: Test, commit**

Run: `npm test -- bride-blob && npx tsc --noEmit`, expecting PASS.

```bash
git add scripts/make-bride-face.py public/assets/lab/faces/bride-face.png src/lab/sdf-zombie/characters/bride.blob src/lab/sdf-zombie/character-registry.ts docs/dev-notes/2026-09-24-bride/
git commit -m "bride: corpse-makeup face sheet — sockets, bruised lids, sutures"
```

---

### Task 3: Cloth shells + strand hair

**Files:**
- Modify: `src/lab/sdf-zombie/characters/bride.blob`, `src/lab/sdf-zombie/characters/bride-blob.test.ts`

Read `cultist.blob` l.44–139 (the `hem` bone and the shells) and `schoolgirl-described.blob` l.100–230 (bodice, skirt, strand hair). Also read `cultist-blob.test.ts` for the shell and pendulum tests you'll mirror.

- [ ] **Step 1: Write the failing tests** (append to `bride-blob.test.ts`)

```ts
describe('bride — cloth and hair', () => {
  const shells = body.prims.filter(p => p.shell);

  it('is dressed in exactly three SHELLS: bodice, skirt on the hem, veil on the skull', () => {
    const s = shells.map(p => `${p.limb}:${p.bone}`).sort();
    expect(s).toEqual(['head:skull', 'torso:chest', 'torso:hem']);
  });

  it('opens the bodice down the sternum over the rib window', () => {
    // A ray straight at the sternum at rib height hits FLESH (a rib/ridge
    // prim), not the bodice shell: the clip leaves the front open.
    const bodice = body.prims.find(p => p.shell && p.bone === 'chest')!;
    expect(bodice.shell!.clip).toBeDefined();
  });

  it('has long black strand hair', () => {
    const strands = body.prims.filter(p => p.strand);
    expect(strands.length).toBeGreaterThanOrEqual(1);
  });

  it('stays inside the prim budget with everything on', () => {
    expect(body.prims.length).toBeLessThanOrEqual(MAX_PRIMS);
  });
});
```

Before relying on `p.shell!.clip` and `p.strand`, check the field names: `grep -n "shell?:\|strand" src/lab/sdf-zombie/types.ts`. Use the real names.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- bride-blob`
Expected: FAIL (no shells).

- [ ] **Step 3: Author the cloth and hair**

- `bone hem parent=pelvis dir=down len=0.40` (a short skirt: the hem stops at upper thigh, around y 0.80 on her long legs).
- **Bodice:** one shell on `chest`, ivory `f1ece0`. A `clip` plane removes a narrow vertical strip at the front sternum between the rib-window heights (clip normal toward +z, with `clipd` chosen so the gap is ~6 cm wide). **The rib window is at y 1.17–1.31** (moved below and between the bust by the Task 1 look pass), and the bodice must cover the bust. Paint the laces as 4–5 thin dark prims crossing the gap. Those are flesh-list prims coloured `3a2a22`, so they count toward the budget. Use `warp` for a faint boning ripple.
- **Skirt:** one flared shell on `hem`, `rigid`, white `f4f1ea`. Give it a strong `warp` with a high `warpFreq` so the hem scallops like ruffles. Lace is paint only. `clip=(0,-1,0)` at the hem height.
- **Veil:** one shell on `skull` over the crown, falling to the shoulder blades. Clip it at the face so the face stays open (cultist hood technique), colour `eeeae4`.
- **Hair:** a scalp mass plus `strand=` locks (black `141216`), centre-parted, falling to mid-back under the veil, with two front locks framing the face, as on `schoolgirl-described`.
- **Stockings:** paint only. The leg prims below mid-thigh go ivory `e8e0d0`, with a darker band at the top edge.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- bride-blob && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Frames in lab AND game**

Take lab `blob:shot` frames: front, 3/4, back, and a walking frame. Game: `npm run dev`, open `/sdf-game.html?spawn=bride` headless through a capture script, and in the page run `__sdfGame.teleport(2)` + `placePlayer` to frame her. The veil and skirt must render UNCUT in the game (the translateBody clip-plane trap). Save the frames to the notes dir.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/characters/bride.blob src/lab/sdf-zombie/characters/bride-blob.test.ts docs/dev-notes/2026-09-24-bride/
git commit -m "bride: shell bodice (open over the ribs), ruffle skirt on hem, veil, strand hair"
```

---

### Task 4: The WAM kit (armour, boots, jewellery) + armoured flag

**Files:**
- Create: `src/lab/sdf-zombie/characters/bride-kit.wam`, `src/lab/sdf-zombie/characters/bride-kit.test.ts`, `public/assets/lab/bride-kit.gltf` (generated)
- Modify: `src/lab/sdf-zombie/character-registry.ts`, `src/lab/sdf-zombie/webgpu/character-view.ts:569,578`

Read `characters/ogre-kit.wam` and `characters/soldier-kit.wam` first. The soldier's kit shows the `plate` material, which `kit-damage.ts` l.62 treats as breakable armour.

- [ ] **Step 1: Write the failing kit test**

Copy `characters/ogre-kit.test.ts` to `bride-kit.test.ts` and change:
- the imports to `./bride.blob?raw` and `../../../../public/assets/lab/bride-kit.gltf?raw`;
- the `describe` title to `'bride-kit.gltf fits bride.blob'`;
- the material set to `['boot', 'chain', 'iron', 'plate']`;
- the skeleton test title to `(height fractions x 1.85)`;
- keep `TUCK_MAX = 0.045` and the boots-on-floor test unchanged.

Add one test:

```ts
  it('armours both arms in PLATE (breakable, sparks)', () => {
    const plate = groups.get('plate')!;
    const leftArm = plate.filter(v => v[0] > 0.15);  // +x is her LEFT (check sign on the frames)
    const rightArm = plate.filter(v => v[0] < -0.15);
    expect(leftArm.length).toBeGreaterThan(20);
    expect(rightArm.length).toBeGreaterThan(20);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- bride-kit`
Expected: FAIL. `bride-kit.gltf` does not resolve.

- [ ] **Step 3: Author `bride-kit.wam`**

Transcribe the skeleton from `bride.blob`. Units are **height fractions (metres / 1.85)**, and **pitch negates on down bones**.

**The uneven forearm.** `bride.blob` gives the right forearm its own length with `lenR=` (added in Task 1; `forearm` is `len=0.26 lenR=0.30`). WAM has no `lenR`: in `~/Projects/2026/wam/wam/skeleton.py` (~l.193) a mirror block always gives `.l`/`.r` the same length. So in the kit, author `forearm` and `hand` OUTSIDE the mirror block, as explicit `.l` and `.r` bones with their own lengths. First check that WAM accepts sided bones outside a mirror block that parent to a mirrored bone (`upperarm.r`): write a 10-line test `.wam` and compile it. If WAM refuses, STOP and report BLOCKED. Don't edit WAM, which is an external repo; the controller will decide. Pieces:
- `plate` (dull steel): vambraces on both forearms, couters at the elbows, fingered gauntlets on both hands, and a pauldron on the right shoulder. Leave the elbow crease and the pauldron underside OPEN. The flesh bulges from Task 1 must show through.
- `boot`: cream suede thigh-highs to just above the knee.
- `chain`: the belt chain at the hips and two necklace chains.
- `iron`: crosses on the chains (two at the belt, one or two on the necklaces).

Then build it:

Run: `scripts/build-wam-kit.sh bride`
Expected: writes `public/assets/lab/bride-kit.gltf`.

- [ ] **Step 4: Register the kit, key sparks on a flag**

```ts
// character-registry.ts — CharacterEntry gains:
  /** The kit's `plate` pieces are ARMOUR: hits on them spark, and enough hits
   *  shed the piece (webgpu/kit-damage.ts). Was hard-coded to the soldier. */
  armoured?: boolean;
// soldier entry: add `armoured: true,`
// bride entry: add `kit: '/assets/lab/bride-kit.gltf', armoured: true,`
```

Match the `kit:` URL form the ogre entry uses. In `webgpu/character-view.ts`, replace both `entry.name === 'soldier'` checks (l.569 sparks, l.578 `loadKit` breakable) with `entry.armoured === true`.

The spec said armour hits leave no wound. The existing soldier mechanism sparks and SHEDS plate after two or three hits, and the flesh under it takes the wound. That exposes the fused raw seam, which suits the brief better. Use the existing mechanism and record the deviation in NOTES.md.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- bride-kit bride-blob soldier-kit && npx tsc --noEmit`
Expected: PASS. Iterate on the `.wam` until the skeleton-drift (<10 mm) and tuck tests pass.

- [ ] **Step 6: Frames, commit**

Lab frames: front and 3/4 with the kit. Check that the flesh bulges show at the elbow and under the pauldron.

```bash
git add src/lab/sdf-zombie/characters/bride-kit.wam src/lab/sdf-zombie/characters/bride-kit.test.ts public/assets/lab/bride-kit.gltf src/lab/sdf-zombie/character-registry.ts src/lab/sdf-zombie/webgpu/character-view.ts docs/dev-notes/2026-09-24-bride/
git commit -m "bride: WAM kit — plate arms and pauldron (breakable), thigh boots, chains and crosses"
```

---

### Task 5: The longsword prop

**Files:**
- Create: `scripts/model-bride-sword.py`, `public/assets/lab/bride-sword.glb` (generated)

Read `scripts/model-cultist-smg.py` in full. Keep its helpers, its `coord()` Y-up conversion and its `LOCATORS` export.

- [ ] **Step 1: Write the script**

Frame: X right, Y up, Z forward, which is the blade direction. The locators are the shared `GUN_GRIP` contract (`carry.ts` l.106), unchanged:

```python
LOCATORS = {"Grip_Hand": (0, -.074, -.074),
            "Fore_Hand": (0, -.045, .155), "Muzzle": (0, .062, 1.30)}
```

The hands sit on the GRIP. The grip axis is the line through `Grip_Hand` → `Fore_Hand`, direction `(0, .029, .229)` normalised (about 7° up). Build every part along that axis, starting at `Grip_Hand` and measuring distance `s` along the axis:
- pommel: a disc or wheel at s = −0.06, radius 0.03;
- grip: s −0.03 → 0.26, an octagonal prism with radius 0.016, dark leather;
- cross-guard: at s = 0.27, a bar 0.26 m wide along X, 0.02 thick, with slightly drooped ends;
- blade: s 0.28 → 1.32, a lenticular cross-section 0.05 wide at the base tapering to 0.03, with a fuller. It ends in a point at s ≈ 1.33. Set `Muzzle` to that point (recompute it from the axis; the value above is approximate).

Write a preview PNG to `docs/dev-notes/2026-09-24-bride/sword-model.png`.

- [ ] **Step 2: Build it**

Run: `/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 -P scripts/model-bride-sword.py`
Expected: writes `public/assets/lab/bride-sword.glb` and the preview. Read the preview.

- [ ] **Step 3: Commit**

```bash
git add scripts/model-bride-sword.py public/assets/lab/bride-sword.glb docs/dev-notes/2026-09-24-bride/sword-model.png
git commit -m "bride: Blender longsword prop on the GUN_GRIP locators"
```

---

### Task 6: Widen `BrainTuning`; add sword swing variants (zombie no-op)

**Files:**
- Modify: `src/lab/sdf-zombie/brain.ts:94-127, 218-285`, `src/lab/sdf-zombie/attack.ts:273,295-304`
- Test: `src/lab/sdf-zombie/brain.test.ts` (must pass UNCHANGED), `src/lab/sdf-zombie/sword-swing.test.ts` (new; the brain parts)

Today `BrainTuning = typeof BRAIN_TUNING` is an `as const` literal type, so no other tuning object can typecheck against it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/sword-swing.test.ts
import { describe, it, expect } from 'vitest';
import { makeBrain, stepBrain, BRAIN_TUNING, type BrainTuning } from './brain';

const TEST_TUNING: BrainTuning = {
  ...BRAIN_TUNING,
  meleeRadius: 1.8,
  engageRange: 3.2,
  releaseRange: 3.8,
  lungeBand: { min: 2.2, max: 3.1 },
  pickVariant: (roll) => (roll < 0.5 ? 'cleave' : 'sweep'),
  swingSecFor: { cleave: 1.25, sweep: 0.9, lunge: 1.0 },
};

/** Step an alert brain holding a token, player at `dist` m straight ahead. */
function swingAt(dist: number, roll: number) {
  let brain = { ...makeBrain(), alert: true, state: 'engage' as const };
  const out = stepBrain(brain, {
    dt: 1 / 60, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: dist, room: 1 },
    alerted: false, hasToken: true, drift: 0, roll,
  }, TEST_TUNING);
  brain = out.brain;
  return out;
}

describe('BrainTuning — sword extensions', () => {
  it('picks the variant through pickVariant inside reach', () => {
    expect(swingAt(1.5, 0.2).attack?.variant).toBe('cleave');
    expect(swingAt(1.5, 0.8).attack?.variant).toBe('sweep');
  });

  it('lunges inside the lunge band, beyond reach', () => {
    expect(swingAt(2.6, 0.2).attack?.variant).toBe('lunge');
  });

  it('does not swing outside both', () => {
    expect(swingAt(3.15, 0.2).attack).toBeNull();
  });

  it('times the swing by swingSecFor', () => {
    let out = swingAt(1.5, 0.2);        // cleave starts, phase 0
    out = stepBrain(out.brain, {
      dt: 0.625, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: 1.5, room: 1 },
      alerted: false, hasToken: true, drift: 0, roll: 0.2,
    }, TEST_TUNING);
    expect(out.attack?.phase).toBeCloseTo(0.5, 5); // 0.625 / 1.25
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- sword-swing`
Expected: FAIL. Type errors on `lungeBand`/`pickVariant`, or `'cleave'` is not a `SwingVariant`.

- [ ] **Step 3: Implement**

`attack.ts`:

```ts
export type SwingVariant = 'hook' | 'overhead' | 'shove' | 'cleave' | 'sweep' | 'lunge';
// SWING_ARCS gains (the REACH-arm fallback only — a carry character's arms
// are driven by sword-swing.ts's tracks, not these):
  cleave: { windupPitch: 1.35, strikePitch: -0.75, windupYaw: -0.15, strikeYaw: 0.10 },
  sweep: { windupPitch: 0.35, strikePitch: 0.95, windupYaw: -0.85, strikeYaw: 0.90 },
  lunge: { windupPitch: 0.4, strikePitch: 1.3, windupYaw: 0, strikeYaw: 0 },
```

`brain.ts`: replace `export type BrainTuning = typeof BRAIN_TUNING;` with

```ts
/** Every numeric knob of BRAIN_TUNING, widened from its literal types, plus
 *  the OPTIONAL sword extensions. Absent extensions = the zombie exactly
 *  (brain.test.ts passes unchanged — that is the no-op evidence). */
export type BrainTuning = { readonly [K in keyof typeof BRAIN_TUNING]: number } & {
  /** Variant for a swing started inside meleeRadius. Absent = hook/overhead 50/50. */
  readonly pickVariant?: (roll: number, dist: number) => SwingVariant;
  /** A swing may also start at min <= dist <= max, as a 'lunge'. */
  readonly lungeBand?: { readonly min: number; readonly max: number };
  /** Per-variant swing duration (s). Absent entries use swingSec. */
  readonly swingSecFor?: Partial<Record<SwingVariant, number>>;
};

function swingSecOf(tuning: BrainTuning, variant: SwingVariant): number {
  return tuning.swingSecFor?.[variant] ?? tuning.swingSec;
}
```

In `stepBrain`'s attack branch, replace `tuning.swingSec` (both uses on the `swingT = …` line) with `swingSecOf(tuning, swing.variant)`. Replace the swing-start block (`if (dist <= tuning.meleeRadius && cooldown <= 0) {` … variant roll) with:

```ts
  const inReach = dist <= tuning.meleeRadius;
  const band = tuning.lungeBand;
  const inLunge = band !== undefined && dist >= band.min && dist <= band.max;
  if ((inReach || inLunge) && cooldown <= 0) {
    // Roll the variant HERE, at the one frame the swing begins, and store it
    // so the rest of the swing reads a fixed value — the caller's roll keeps
    // changing every frame and must not re-decide mid-swing.
    const variant: SwingVariant = !inReach
      ? 'lunge'
      : tuning.pickVariant
        ? tuning.pickVariant(input.roll, dist)
        : (input.roll < 0.5 ? 'hook' : 'overhead');
    const started = { side: swing.side, variant };
```

Leave the rest of that block as it is. Run `npx tsc --noEmit`. If a `switch` over `SwingVariant` elsewhere is now non-exhaustive, add the three new cases so they behave like `overhead`. Say so in the commit message.

- [ ] **Step 4: Run the tests to verify they pass, zombie unchanged**

Run: `npm test -- sword-swing brain attack enemy-mind game-actor && npx tsc --noEmit`
Expected: PASS, with `brain.test.ts` unmodified (`git diff --stat src/lab/sdf-zombie/brain.test.ts` is empty).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/brain.ts src/lab/sdf-zombie/attack.ts src/lab/sdf-zombie/sword-swing.test.ts
git commit -m "brain: widen BrainTuning — pickVariant, lungeBand, swingSecFor; cleave/sweep/lunge variants (zombie no-op)"
```

---

### Task 7: `sword-swing.ts` — tracks, lunge advance, contact, tuning

**Files:**
- Create: `src/lab/sdf-zombie/sword-swing.ts`
- Test: `src/lab/sdf-zombie/sword-swing.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append)

```ts
import {
  SWORD_TUNING, SWORD_KEYS, swordCarryAt, lungeAdvance, swordContact, isSwordVariant, SWORD_CONTACT,
} from './sword-swing';
import { ATTACK_TUNING } from './attack';
import type { CarrySpec } from './carry';

const GUARD: CarrySpec = { right: { pitch: 1.9, yaw: 0.3, fold: 1.6 }, gunPitch: 0.6, leftPole: [0.5, -0.3, 0.2] };

describe('swordCarryAt — the phase-keyed carry track', () => {
  it('starts and ends EXACTLY on the guard (no step into or out of the gait)', () => {
    for (const v of ['cleave', 'sweep', 'lunge'] as const) {
      expect(swordCarryAt(0, v, GUARD)).toEqual(GUARD);
      expect(swordCarryAt(1, v, GUARD)).toEqual(GUARD);
    }
  });

  it('hits the wind-up key at windupEnd and the strike key through the hold', () => {
    const w = swordCarryAt(ATTACK_TUNING.windupEnd, 'cleave', GUARD);
    expect(w.right).toEqual(SWORD_KEYS.cleave.windup.arm);
    const s = swordCarryAt((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2, 'cleave', GUARD);
    expect(s.right).toEqual(SWORD_KEYS.cleave.strike.arm);
    expect(s.gunPitch).toBe(SWORD_KEYS.cleave.strike.gunPitch);
  });

  it('is continuous: no angle jumps more than 0.35 rad between 1% phase steps', () => {
    for (const v of ['cleave', 'sweep', 'lunge'] as const) {
      let prev = swordCarryAt(0, v, GUARD);
      for (let i = 1; i <= 100; i++) {
        const cur = swordCarryAt(i / 100, v, GUARD);
        for (const k of ['pitch', 'yaw', 'fold'] as const)
          expect(Math.abs(cur.right[k] - prev.right[k]), `${v} ${k} @${i}`).toBeLessThan(0.35);
        prev = cur;
      }
    }
  });

  it('keeps the sword two-handed (never oneHanded) and the guard pole', () => {
    const s = swordCarryAt(0.4, 'sweep', GUARD);
    expect(s.oneHanded).toBeUndefined();
    expect(s.leftPole).toEqual(GUARD.leftPole);
  });

  it('cleave strikes DOWN: strike pitch below wind-up pitch', () => {
    expect(SWORD_KEYS.cleave.strike.arm.pitch).toBeLessThan(SWORD_KEYS.cleave.windup.arm.pitch);
  });

  it('sweep crosses the body: yaw changes sign from wind-up to strike', () => {
    expect(Math.sign(SWORD_KEYS.sweep.windup.arm.yaw)).not.toBe(Math.sign(SWORD_KEYS.sweep.strike.arm.yaw));
  });
});

describe('lungeAdvance', () => {
  it('sums to the full lunge distance over a swing when the player is far', () => {
    let total = 0, prev = 0;
    for (let i = 1; i <= 120; i++) { const p = i / 120; total += lungeAdvance(prev, p, 10); prev = p; }
    expect(total).toBeCloseTo(SWORD_TUNING.lungeDistance, 3);
  });

  it('moves only between windupEnd and strikeEnd', () => {
    expect(lungeAdvance(0, ATTACK_TUNING.windupEnd, 10)).toBe(0);
    expect(lungeAdvance(ATTACK_TUNING.strikeEnd, 1, 10)).toBe(0);
  });

  it('stops short of the player', () => {
    expect(lungeAdvance(ATTACK_TUNING.windupEnd, ATTACK_TUNING.strikeEnd, 1.2))
      .toBeCloseTo(1.2 - SWORD_TUNING.lungeStopShort, 6);
    expect(lungeAdvance(ATTACK_TUNING.windupEnd, ATTACK_TUNING.strikeEnd, 0.5)).toBe(0);
  });
});

describe('swordContact', () => {
  const self = { x: 0, z: 0, yaw: 0 };
  const hitPhase = SWORD_CONTACT.phase;

  it('fires exactly once, on the frame the phase crosses the hit instant', () => {
    let fired = 0, prev = 0;
    for (let i = 1; i <= 100; i++) {
      const p = i / 100;
      if (swordContact({ prevPhase: prev, phase: p, variant: 'cleave', self, player: { x: 0, z: 1.5 } })) fired++;
      prev = p;
    }
    expect(fired).toBe(1);
    expect(swordContact({ prevPhase: hitPhase - 0.01, phase: hitPhase, variant: 'cleave', self, player: { x: 0, z: 1.5 } })).toBe(true);
  });

  it('misses out of reach and outside the cone; sweep has the wider cone', () => {
    const at = (variant: 'cleave' | 'sweep', x: number, z: number) =>
      swordContact({ prevPhase: hitPhase - 0.01, phase: hitPhase, variant, self, player: { x, z } });
    expect(at('cleave', 0, 2.6)).toBe(false);          // too far
    expect(at('cleave', 1.2, 0.9)).toBe(false);        // ~53 deg off — outside the cleave cone
    expect(at('sweep', 1.2, 0.9)).toBe(true);          // inside the sweep cone
  });

  it('isSwordVariant', () => {
    expect(isSwordVariant('lunge')).toBe(true);
    expect(isSwordVariant('hook')).toBe(false);
  });
});

describe('SWORD_TUNING', () => {
  it('lunges from beyond reach, inside the ring', () => {
    expect(SWORD_TUNING.brain.lungeBand!.min).toBeGreaterThan(SWORD_TUNING.brain.meleeRadius);
    expect(SWORD_TUNING.brain.lungeBand!.max).toBeLessThan(SWORD_TUNING.brain.engageRange);
  });

  it('winds the cleave up slower than the sweep (the readable one hits hardest)', () => {
    expect(SWORD_TUNING.brain.swingSecFor!.cleave!).toBeGreaterThan(SWORD_TUNING.brain.swingSecFor!.sweep!);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- sword-swing`
Expected: FAIL. Cannot resolve `./sword-swing`.

- [ ] **Step 3: Implement `sword-swing.ts`**

```ts
// src/lab/sdf-zombie/sword-swing.ts
//
// THE SWORD SWING — the bride's melee, as pure data.
//
// A carry character's right arm is authored by the CARRY table (carry.ts),
// and motion.ts's carry block overwrites whatever the swing's reach arc did,
// so until now a held prop never swung. The fix is a TRACK: per variant, a
// wind-up key and a strike key in the carry vocabulary (shoulder pitch/yaw,
// elbow fold, blade pitch), interpolated on attack.ts's phase clock
// guard -> wind-up -> strike (held) -> guard. motion.ts uses the track in
// place of the smoothed carry while a sword swing is live; the left hand
// stays IK'd to Fore_Hand, so both hands stay on the grip by construction.
//
// Phase 0 and 1 return the guard EXACTLY, so the swing enters and leaves the
// walking carry without a step.
//
// Also here: the lunge's root advance (the brain halts locomotion during an
// attack, so the actor moves her by this), the strike's contact test, and
// SWORD_TUNING (the brain knobs). Pure; no three. Body-local conventions as
// carry.ts: +x right, +y up, +z forward; the key angles are carry.ts's.
import { ATTACK_TUNING, type AttackTuning, type SwingVariant } from './attack';
import { BRAIN_TUNING, type BrainTuning } from './brain';
import type { CarryArm, CarrySpec } from './carry';
import { wrapPi } from './wander';

export type SwordVariant = 'cleave' | 'sweep' | 'lunge';
const SWORD_VARIANTS: readonly SwingVariant[] = ['cleave', 'sweep', 'lunge'];
export function isSwordVariant(v: SwingVariant): v is SwordVariant {
  return SWORD_VARIANTS.includes(v);
}

interface SwordKey { arm: CarryArm; gunPitch: number }

/** STARTING angles. Task 9 re-solves them against the bride rig (the carry
 *  table's own lesson: angles are relative to the AUTHORED hang, never
 *  copied between bodies) — the tests pin the SHAPE (cleave strikes down,
 *  sweep crosses the body), not these numbers. */
export const SWORD_KEYS: Record<SwordVariant, { windup: SwordKey; strike: SwordKey }> = {
  // Overhead, two-handed: blade raised behind the head, then driven down
  // through the player to about hip height.
  cleave: {
    windup: { arm: { pitch: 2.4, yaw: 0.35, fold: 1.2 }, gunPitch: 0.9 },
    strike: { arm: { pitch: 0.55, yaw: 0.25, fold: 0.15 }, gunPitch: -0.55 },
  },
  // Flat: cocked OUT to her right, swept ACROSS the body to her left.
  sweep: {
    windup: { arm: { pitch: 1.1, yaw: -0.9, fold: 1.0 }, gunPitch: 0.1 },
    strike: { arm: { pitch: 1.0, yaw: 1.1, fold: 0.4 }, gunPitch: -0.1 },
  },
  // Drawn back at the hip, then the arm straightens into a thrust.
  lunge: {
    windup: { arm: { pitch: 0.6, yaw: 0.3, fold: 2.2 }, gunPitch: -0.2 },
    strike: { arm: { pitch: 1.45, yaw: 0.2, fold: 0.05 }, gunPitch: -0.05 },
  },
};

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mixKey(a: SwordKey, b: SwordKey, t: number): SwordKey {
  return {
    arm: { pitch: lerp(a.arm.pitch, b.arm.pitch, t), yaw: lerp(a.arm.yaw, b.arm.yaw, t), fold: lerp(a.arm.fold, b.arm.fold, t) },
    gunPitch: lerp(a.gunPitch, b.gunPitch, t),
  };
}

/** The carry at `phase` of a `variant` swing thrown from `guard`. */
export function swordCarryAt(
  phase: number, variant: SwordVariant, guard: CarrySpec, tuning: AttackTuning = ATTACK_TUNING,
): CarrySpec {
  if (!(phase > 0) || phase >= 1) return guard;
  const T = tuning, K = SWORD_KEYS[variant];
  const g: SwordKey = { arm: guard.right, gunPitch: guard.gunPitch };
  let k: SwordKey;
  if (phase < T.windupEnd) k = mixKey(g, K.windup, smooth(phase / T.windupEnd));
  else if (phase < T.strikeEnd) k = mixKey(K.windup, K.strike, smooth((phase - T.windupEnd) / (T.strikeEnd - T.windupEnd)));
  else if (phase < T.holdEnd) k = K.strike;
  else k = mixKey(K.strike, g, smooth((phase - T.holdEnd) / (1 - T.holdEnd)));
  return {
    right: { ...k.arm },
    gunPitch: k.gunPitch,
    leftPole: guard.leftPole,
    ...(guard.rightPole ? { rightPole: guard.rightPole } : {}),
  };
}

export const SWORD_TUNING = {
  /** Root travel over one lunge (m). */
  lungeDistance: 1.2,
  /** The lunge never carries her closer than this to the player (m). */
  lungeStopShort: 0.9,
  brain: {
    ...BRAIN_TUNING,
    // Reach ~2 m of blade + arm; holders stand inside it.
    meleeRadius: 1.8,
    outerRadius: 2.6,
    engageRange: 3.4,
    releaseRange: 4.0,
    lungeBand: { min: 2.2, max: 3.1 },
    pickVariant: (roll: number) => (roll < 0.5 ? 'cleave' : 'sweep'),
    swingSec: 1.0,
    swingSecFor: { cleave: 1.25, sweep: 0.9, lunge: 1.0 },
    cooldownSec: 1.4,
  } satisfies BrainTuning as BrainTuning,
} as const;

/** Root advance (m) this frame for a lunge going prevPhase -> phase, with the
 *  player `dist` m away. Distributed on the strike window's smoothstep, so
 *  the body surges with the arm. */
export function lungeAdvance(
  prevPhase: number, phase: number, dist: number, tuning: AttackTuning = ATTACK_TUNING,
): number {
  const w = (p: number) => smooth((p - tuning.windupEnd) / (tuning.strikeEnd - tuning.windupEnd));
  const step = SWORD_TUNING.lungeDistance * (w(phase) - w(prevPhase));
  const room = Math.max(0, dist - SWORD_TUNING.lungeStopShort);
  return Math.max(0, Math.min(step, room));
}

/** When in the swing the blade connects, and what it can reach. */
export const SWORD_CONTACT = {
  /** Mid-strike. */
  phase: (ATTACK_TUNING.windupEnd + ATTACK_TUNING.strikeEnd) / 2,
  reach: { cleave: 2.1, sweep: 2.0, lunge: 2.0 } as Record<SwordVariant, number>,
  /** Half-angle of the hit cone about her facing (rad). */
  cone: { cleave: 0.45, sweep: 1.2, lunge: 0.35 } as Record<SwordVariant, number>,
} as const;

/** True on exactly the frame the phase crosses the hit instant with the
 *  player inside this variant's reach and cone. 2-D, like the brain. */
export function swordContact(a: {
  prevPhase: number; phase: number; variant: SwordVariant;
  self: { x: number; z: number; yaw: number }; player: { x: number; z: number };
}): boolean {
  const at = SWORD_CONTACT.phase;
  if (!(a.prevPhase < at && a.phase >= at)) return false;
  const dx = a.player.x - a.self.x, dz = a.player.z - a.self.z;
  if (Math.hypot(dx, dz) > SWORD_CONTACT.reach[a.variant]) return false;
  return Math.abs(wrapPi(Math.atan2(dx, dz) - a.self.yaw)) <= SWORD_CONTACT.cone[a.variant];
}
```

Note: `brain.ts` must not import `sword-swing.ts`. The dependency only runs the other way.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- sword-swing brain && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/sword-swing.ts src/lab/sdf-zombie/sword-swing.test.ts
git commit -m "sword-swing: phase-keyed carry tracks, lunge advance, strike contact, SWORD_TUNING"
```

---

### Task 8: Sword carries, `STALK` gait, `BRIDE_PROFILE`

**Files:**
- Modify: `src/lab/sdf-zombie/carry.ts:26,57-101`, `src/lab/sdf-zombie/gait.ts` (after `GLIDE_CARRY`, l.311), `src/lab/sdf-zombie/motion-profile.ts`
- Test: `src/lab/sdf-zombie/characters/bride-blob.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append; the harness is the ogre's `drag` pin, `ogre-blob.test.ts` l.284–330, through the real motion pipeline)

```ts
import { motionProfileFor, BRIDE_PROFILE } from '../motion-profile';
import { GUN_GRIP, gunPoint, type GunPose } from '../carry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import type { MotionFrame } from '../motion';
import type { SwingVariant } from '../attack';
import type { Vec3 } from '../types';

/** The blade's point, prop-local (Task 5's Muzzle locator, read back from
 *  bride-sword.glb). NOT `held.muzzle()`: held-prop.ts uses carry.ts's fixed
 *  GUN_GRIP muzzle (z 0.41) for every prop and ignores the glb's locator. */
const SWORD_TIP: Vec3 = [0, 0.093093, 1.245462];

type Pts = { pos: Vec3 }[];
/** Drive the bride through the real motion pipeline for `frames` 60 Hz steps.
 *  `attack(i)` optionally feeds a swing phase on frame i (Task 9). */
function drive(opts: {
  frames: number; speed: number;
  attack?: (i: number) => { phase: number; side: 'R'; variant: SwingVariant } | undefined;
  onFrame: (f: MotionFrame, pts: Pts, J: Record<string, number | undefined>, i: number) => void;
}): void {
  const b = buildBody(compileBlob(doc, compileFace(doc)));
  const m = makeActorMotion(b, { seed: 7 });
  const rng = makeRng(7);
  const J = m.motionJoints!.index as Record<string, number | undefined>;
  for (let i = 0; i < opts.frames; i++) {
    const atk = opts.attack?.(i);
    const f = stepActorMotion(m, {
      current: b, dt: 1 / 60, wander: true, armStyle: undefined,
      headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
      rng, signals: emptyActorSignals(), profile: BRIDE_PROFILE, forceSpeed: opts.speed,
      ...(atk ? { attack: atk } : {}),
    })!;
    opts.onFrame(f, m.bound.rig.points as unknown as Pts, J, i);
  }
}
/** The fist: mid hand bone, where the fist prim is (the ogre lesson). */
const fistOf = (pts: Pts, J: Record<string, number | undefined>): Vec3 => {
  const w = pts[J.handR!]!.pos, t = pts[J.handTipR!]!.pos;
  return [(w[0] + t[0]) / 2, (w[1] + t[1]) / 2, (w[2] + t[2]) / 2];
};
const tipOf = (g: GunPose) => gunPoint(g, SWORD_TIP);

describe('bride — profile and sword carry', () => {
  it('uses BRIDE_PROFILE: stalk gait, sword carries, the sword prop, sword melee', () => {
    const p = motionProfileFor('bride');
    expect(p).toBe(BRIDE_PROFILE);
    expect(p.gait.walk.name).toBe('stalk');
    expect(p.carries).toEqual({ walk: 'swordGuard', run: 'swordTrail', fire: 'swordGuard' });
    expect(p.prop?.url).toBe('/assets/lab/bride-sword.glb');
    expect(p.melee).toEqual({ kind: 'sword' });
    expect(p.gunner).toBeUndefined();
  });

  it('holds the guard HIGH: blade tip above the head, both hands on the grip', () => {
    let grip = 0, fore = 0, n = 0, tipMinOverHead = Infinity;
    drive({ frames: 180, speed: BRIDE_PROFILE.cruise * 0.5, onFrame: (f, pts, J, i) => {
      expect(f.carry).toBe('swordGuard');
      if (i < 60) return; // let the verlet settle into the carry
      grip += dist(fistOf(pts, J), gunPoint(f.gun!, GUN_GRIP.gripHand));
      fore += dist(pts[J.handL!]!.pos, gunPoint(f.gun!, GUN_GRIP.foreHand));
      tipMinOverHead = Math.min(tipMinOverHead, tipOf(f.gun!)[1] - pts[J.head!]!.pos[1]);
      n++;
    } });
    expect(grip / n).toBeLessThan(0.03);
    expect(fore / n).toBeLessThan(0.05);
    expect(tipMinOverHead).toBeGreaterThan(0);
  });

  it('trails the point low on the run', () => {
    let tipHigh = -Infinity, sawTrail = false;
    drive({ frames: 240, speed: BRIDE_PROFILE.runBand.to + 0.2, onFrame: (f, _pts, _J, i) => {
      if (i < 90) return;
      if (f.carry === 'swordTrail') sawTrail = true;
      tipHigh = Math.max(tipHigh, tipOf(f.gun!)[1]);
    } });
    expect(sawTrail).toBe(true);
    expect(tipHigh).toBeLessThan(0.35);
  });
});
```

`dist` and `doc` are already defined at the top of this file (Task 1). If `MotionFrame`'s `carry`/`gun` fields or the `motionJoints.index` type differ from what the ogre test reads, follow the ogre test. It is the working reference.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- bride-blob`
Expected: FAIL. `BRIDE_PROFILE` is not exported.

- [ ] **Step 3: Implement**

`carry.ts`:

```ts
export type CarryName = 'low' | 'chest' | 'hip' | 'aim' | 'saw' | 'drag' | 'swordGuard' | 'swordTrail';
// in CARRIES, after drag — STARTING values; grid-solve in Step 5:
  // The bride's HIGH GUARD (the ref's pose, vom Tag): both hands on the grip
  // at the right shoulder, blade up and back over it. Two-handed: the left
  // hand IKs onto Fore_Hand, the elbow poled out and down.
  swordGuard: { right: { pitch: 1.9, yaw: 0.30, fold: 1.60 }, gunPitch: 0.60, leftPole: [0.6, -0.5, 0.2] },
  // Running: the point trails low behind her right hip, one hand.
  swordTrail: { right: { pitch: -0.55, yaw: 0.10, fold: 0.30 }, gunPitch: -0.90, leftPole: [0.6, -0.4, 0.1], oneHanded: { leftSwing: 0.40 }, rightPole: [0.2, 0, -1] },
```

`gait.ts`:

```ts
/** The bride's STALK: the soldier's march clip slowed and lengthened for her
 *  long legs, with a hip sway the `hem` pendulum picks up and a slight
 *  forward lean. Carry-style arms (the sword owns them). */
export const STALK: GaitProfile = {
  ...MARCH,
  name: 'stalk',
  strideFreq: MARCH.strideFreq * 0.8,
  strideLen: 0.42,
  swayAmp: 0.06,
  shoulderSway: 0.2,
  bobAmp: 0.015,
  torsoLean: 0.04,
  armSwing: 0.02,
};
```

`motion-profile.ts`: import `STALK` and add

```ts
  /** A MELEE-WEAPON enemy: the game gives it that weapon's mind
   *  (enemy-mind.ts makeSwordMind) and motion.ts drives the held prop through
   *  the swing (sword-swing.ts). Absent = the zombie's unarmed swing. */
  melee?: { kind: 'sword' };
```

to `MotionProfile`, then:

```ts
/** The bride: a slow STALK in a high sword guard; the point trails on the
 *  run. Melee only — the sword mind (enemy-mind.ts) swings it. */
export const BRIDE_PROFILE: MotionProfile = {
  name: 'bride',
  gait: { walk: STALK, run: RUN },
  // She breaks into a run only to close a long gap.
  runBand: { from: 1.6, to: 3.0 },
  cruise: 1.1,
  turnRate: 3.5,
  armStyle: 'carry',
  carries: { walk: 'swordGuard', run: 'swordTrail', fire: 'swordGuard' },
  prop: { url: '/assets/lab/bride-sword.glb', scale: 1, gripReach: 0.03 },
  melee: { kind: 'sword' },
};
```

Register it in `BY_NAME`: `bride: BRIDE_PROFILE,`.

- [ ] **Step 4: Run the tests**

Run: `npm test -- bride-blob motion-profile carry gait && npx tsc --noEmit`

- [ ] **Step 5: Grid-solve the carries on the bride rig until the pins pass**

Write a throwaway script in the scratchpad that sweeps `pitch`/`yaw`/`fold`/`gunPitch` around the starting values and scores each pose. Use the same `makeActorMotion` harness as the tests. The score is: tip above the head (guard) or tip y < 0.35 (trail), fist-to-grip < 2 cm, left hand to Fore_Hand < 5 cm, and neither elbow inside the torso (`sdBody(elbow) > 0`). Put the winners in `CARRIES` with a comment block like `drag`'s explaining what was solved. Re-run Step 4 until it passes. Take lab frames (standing guard, walking, running) and read them.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/carry.ts src/lab/sdf-zombie/gait.ts src/lab/sdf-zombie/motion-profile.ts src/lab/sdf-zombie/characters/bride-blob.test.ts docs/dev-notes/2026-09-24-bride/
git commit -m "bride: swordGuard/swordTrail carries, STALK gait, BRIDE_PROFILE"
```

---

### Task 9: `motion.ts` — the sword follows the swing

**Files:**
- Modify: `src/lab/sdf-zombie/motion.ts:940-960` (the carry block's `wanted`/`carryTargetPose`), `src/lab/sdf-zombie/actor.ts:122-165` (`attack` pass-through), `src/lab/sdf-zombie/sword-swing.ts` (re-solved keys)
- Test: `src/lab/sdf-zombie/characters/bride-blob.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
import { ATTACK_TUNING } from '../attack';

/** Stand 60 frames in the guard, then swing `variant` over 60 frames
 *  (phase i/60). Records the fist-grip gap and the tip in body-local x/y. */
function recordSwing(variant: 'cleave' | 'sweep' | 'lunge') {
  const out: { phase: number; gap: number; tip: Vec3; tipX: number }[] = [];
  drive({
    frames: 121, speed: 0,
    attack: i => (i >= 60 ? { phase: Math.min(1, (i - 60) / 60), side: 'R', variant } : undefined),
    onFrame: (f, pts, J, i) => {
      if (i < 60) return;
      const tip = tipOf(f.gun!), pel = pts[J.pelvis!]!.pos;
      const right: Vec3 = [Math.cos(f.bodyYaw), 0, -Math.sin(f.bodyYaw)];
      out.push({
        phase: Math.min(1, (i - 60) / 60),
        gap: dist(fistOf(pts, J), gunPoint(f.gun!, GUN_GRIP.gripHand)),
        tip,
        tipX: (tip[0] - pel[0]) * right[0] + (tip[2] - pel[2]) * right[2],
      });
    },
  });
  return out;
}
const at = (rec: ReturnType<typeof recordSwing>, phase: number) =>
  rec.reduce((a, b) => (Math.abs(b.phase - phase) < Math.abs(a.phase - phase) ? b : a));

describe('bride — the sword swings with the arm', () => {
  it.each(['cleave', 'sweep', 'lunge'] as const)('%s: the fist stays on the grip through the whole swing', variant => {
    for (const s of recordSwing(variant)) expect(s.gap, `phase ${s.phase.toFixed(2)}`).toBeLessThan(0.03);
  });

  it('cleave: the tip travels > 1.2 m and drops > 0.8 m from wind-up to strike', () => {
    const rec = recordSwing('cleave');
    let path = 0;
    for (let k = 1; k < rec.length; k++) path += dist(rec[k]!.tip, rec[k - 1]!.tip);
    expect(path).toBeGreaterThan(1.2);
    const w = at(rec, ATTACK_TUNING.windupEnd).tip[1];
    const s = at(rec, (ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2).tip[1];
    expect(w - s).toBeGreaterThan(0.8);
  });

  it('sweep: the tip crosses her centreline (body-local x changes sign)', () => {
    const rec = recordSwing('sweep');
    const w = at(rec, ATTACK_TUNING.windupEnd).tipX;
    const s = at(rec, (ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2).tipX;
    expect(Math.sign(w)).not.toBe(Math.sign(s));
  });
});
```

The body-right vector assumes the body faces +z at yaw 0 with +x its right (see `attack.ts`'s header). If the sign is flipped on this rig, the sweep test still holds, because it only checks that the sign changes.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- bride-blob`
Expected: the tip-travel tests FAIL. The carry block ignores `cfg.attack`, so the sword stays in the guard.

- [ ] **Step 3: Implement**

First, let the test harness feed a swing. `actor.ts`'s `ActorStepInput` (l.122) has no `attack`. Add `attack?: { phase: number; side: 'L' | 'R'; variant: SwingVariant };` to it, and pass `attack: input.attack,` in the `stepMotion` cfg object (l.160–165, next to `carryOverride`). Pass it only when it is defined (`...(input.attack ? { attack: input.attack } : {})`) so existing callers' frames stay bit-identical.

In `motion.ts`, import `isSwordVariant` and `swordCarryAt` from `./sword-swing`. In the carry block, directly after `const wanted = CARRIES[carryName];`:

```ts
    // A SWORD SWING owns the carry (sword-swing.ts): the track pose, UNSMOOTHED
    // — the swing is authored motion, and the exp(-9 dt) chase below would lag
    // a 0.9 s sweep by a third of its arc. Its phase-0 and phase-1 poses are
    // the walk guard exactly, so entering and leaving needs no blend.
    const swordSwing = attack && cfg.attack && profile.melee?.kind === 'sword'
      && isSwordVariant(cfg.attack.variant)
      ? swordCarryAt(cfg.attack.phase, cfg.attack.variant, CARRIES[carries.walk])
      : null;
```

Change the `carryTargetPose = { right: …mix… }` assignment to `carryTargetPose = swordSwing ?? { …existing object… };`. Everything downstream (`armPivot`, `gunPoseFromArm`, the left-hand FABRIK onto Fore_Hand) is unchanged.

- [ ] **Step 4: Run the tests; re-solve the keys**

Run: `npm test -- bride-blob sword-swing motion ogre-blob cultist-blob soldier && npx tsc --noEmit`

If the fist-on-grip test passes but a shape test fails, or the frames look wrong, re-solve `SWORD_KEYS` with the Task 8 grid script. Add these scores for each key pose: elbow outside the torso, blade not through her own head (`sdBody(tip) > 0` for points along the blade), and the strike tip at player chest height (1.2–1.5 m) 1.5 m in front for cleave and sweep. The `sword-swing.test.ts` shape pins must still pass.

- [ ] **Step 5: Look at it**

Capture a lab strip of each variant at phases 0, 0.15, 0.25, 0.4, 0.5, 0.7 and 1.0 (the lab's pose captures drive `cfg.attack`; see how `carryOverride` pose captures are driven in `lab-main.ts`). Save it and read it. The cleave must read as overhead, the sweep as flat, the lunge as a thrust.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/actor.ts src/lab/sdf-zombie/sword-swing.ts src/lab/sdf-zombie/characters/bride-blob.test.ts docs/dev-notes/2026-09-24-bride/
git commit -m "motion: a sword swing drives the carry track — the blade follows the arm"
```

---

### Task 10: `makeSwordMind` + lunge advance in the actor

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/enemy-mind.ts`, `src/lab/sdf-zombie/webgpu/game-actor.ts` (where `think` feeds the motion step, ~l.1100–1135)
- Test: `src/lab/sdf-zombie/webgpu/enemy-mind.test.ts` (append; create it if absent, and check with `ls src/lab/sdf-zombie/webgpu/enemy-mind*.test.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeSwordMind, type MindInput } from './enemy-mind';
import { SWORD_TUNING, lungeAdvance } from '../sword-swing';

const input = (dist: number, over: Partial<MindInput> = {}): MindInput => ({
  dt: 1 / 60, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: dist, room: 1 },
  alerted: true, hasToken: true, drift: 0, roll: 0.2, rollDrift: 0.5, ...over,
});

describe('makeSwordMind', () => {
  it('is a melee mind', () => {
    expect(makeSwordMind().meleeCapable).toBe(true);
  });

  it('cleaves inside reach and reports contact exactly once per swing', () => {
    const mind = makeSwordMind();
    let contacts = 0, swung = false;
    for (let i = 0; i < 180; i++) {
      const out = mind.step(input(1.5));
      if (out.attack) { swung = true; expect(out.attack.variant).toBe('cleave'); }
      if (out.contact) contacts++;
      if (swung && !out.attack) break;
    }
    expect(swung).toBe(true);
    expect(contacts).toBe(1);
  });

  it('lunges from 2.6 m and emits an advance toward the player that sums to the lunge', () => {
    const mind = makeSwordMind();
    let total = 0, variant = '';
    for (let i = 0; i < 180; i++) {
      const out = mind.step(input(2.6 - total));
      if (out.attack) variant = out.attack.variant;
      if (out.advance) {
        expect(out.advance[0]).toBeCloseTo(0, 6);
        expect(out.advance[2]).toBeGreaterThan(0);   // toward +z, the player
        total += out.advance[2];
      }
      if (variant && !out.attack) break;
    }
    expect(variant).toBe('lunge');
    expect(total).toBeCloseTo(Math.min(SWORD_TUNING.lungeDistance, 2.6 - SWORD_TUNING.lungeStopShort), 2);
  });

  it('the zombie mind never advances', async () => {
    const { makeZombieMind } = await import('./enemy-mind');
    const z = makeZombieMind();
    for (let i = 0; i < 120; i++) expect(z.step(input(1.0)).advance ?? null).toBeNull();
  });
});
```

(The test holds `self` fixed at the origin and shrinks the distance itself, which stands in for the actor applying the advance. The `lungeAdvance` import is for reference only; remove it if lint complains.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- enemy-mind`
Expected: FAIL. `makeSwordMind` is not exported.

- [ ] **Step 3: Implement**

`enemy-mind.ts`, `MindOutput` gains:

```ts
  /** World XZ root delta to apply THIS frame (the sword lunge), or null.
   *  The actor applies it only where canMoveTo allows. */
  advance?: Vec3 | null;
```

Add the imports `import { SWORD_TUNING, isSwordVariant, lungeAdvance, swordContact } from '../sword-swing';` and `import type { BrainTuning } from '../brain';`, then:

```ts
/** The bride's sword: the zombie's ring brain (brain.ts) on SWORD_TUNING —
 *  wider reach, cleave/sweep inside it, a lunge from the band beyond — plus
 *  the two things the zombie mind never produced: a real contact on the
 *  strike frame, and the lunge's root advance. */
export function makeSwordMind(tuning: BrainTuning = SWORD_TUNING.brain): EnemyMind {
  let brain: Brain = makeBrain();
  let lastToken = false;
  let prevPhase = 0;
  return {
    kind: 'zombie',
    meleeCapable: true,
    step(input) {
      lastToken = input.hasToken;
      const out = stepBrain(brain, {
        dt: input.dt, self: input.self, player: input.player, alerted: input.alerted,
        hasToken: input.hasToken, drift: input.drift, roll: input.roll, lineOfSight: input.lineOfSight,
      }, tuning);
      brain = out.brain;
      let contact = false;
      let advance: Vec3 | null = null;
      const a = out.attack;
      if (a && input.player && isSwordVariant(a.variant)) {
        const dx = input.player.x - input.self.x, dz = input.player.z - input.self.z;
        const dist = Math.hypot(dx, dz);
        contact = swordContact({ prevPhase, phase: a.phase, variant: a.variant, self: input.self, player: input.player });
        if (a.variant === 'lunge' && dist > 1e-6) {
          const d = lungeAdvance(prevPhase, a.phase, dist);
          if (d > 0) advance = [(dx / dist) * d, 0, (dz / dist) * d];
        }
        prevPhase = a.phase;
      } else {
        prevPhase = 0;
      }
      return {
        target: out.target, halt: out.halt, attack: out.attack,
        fire: false, weaponUp: false, faceHeading: null,
        engaged: out.engaged, committed: out.committed,
        contact, aimError: 0, advance,
      };
    },
    stagger() { brain = staggerNow(brain, tuning); prevPhase = 0; },
    debug: () => ({
      state: brain.state, alert: brain.alert, side: brain.swing.side, variant: brain.swing.variant,
      swingT: brain.swingT, holdSecs: brain.holdSecs, hasToken: lastToken, aimT: 0, cooldown: brain.cooldown,
    }),
  };
}
```

`game-actor.ts`: find where `think` is computed and consumed before the motion step (`grep -n "const think" src/lab/sdf-zombie/webgpu/game-actor.ts`). Straight after `think` is known and before the motion step call, add:

```ts
      // The sword LUNGE (enemy-mind.ts makeSwordMind): the brain halts
      // locomotion during a swing, so the surge is applied to the root here,
      // and only where the level allows it.
      if (think.advance) {
        const p = state.wander.pos;
        const next: Vec3 = [p[0] + think.advance[0], p[1], p[2] + think.advance[2]];
        if (opts.canMoveTo?.(next) ?? true) state = { ...state, wander: { ...state.wander, pos: next } };
      }
```

If the actor's option is named differently from `canMoveTo`, use the name it passes into `MindInput.canMoveTo`. The early `mind`-less branch (l.968) that returns `contact: false` needs `advance: null` only if TypeScript asks for it. The field is optional.

- [ ] **Step 4: Run the tests to verify they pass, zombie unchanged**

Run: `npm test -- enemy-mind game-actor brain sword-swing && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/enemy-mind.ts src/lab/sdf-zombie/webgpu/enemy-mind.test.ts src/lab/sdf-zombie/webgpu/game-actor.ts
git commit -m "enemy-mind: makeSwordMind — strike contact and lunge advance; actor applies the advance"
```

---

### Task 11: Game wiring — mind selection, hit feedback, in-game verification

**Files:**
- Create: `src/lab/sdf-zombie/player-hit-feedback.ts`, `src/lab/sdf-zombie/player-hit-feedback.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (~l.3163 mind selection; the `__sdfGame` object; the camera update)

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/player-hit-feedback.test.ts
import { describe, it, expect } from 'vitest';
import { makeHitFeedback, hitFeedback, stepHitFeedback, HIT_FEEDBACK } from './player-hit-feedback';

describe('player hit feedback', () => {
  it('rests at zero', () => {
    const s = makeHitFeedback();
    expect(s.flash).toBe(0);
    expect(s.hits).toBe(0);
  });

  it('a hit flashes full and counts', () => {
    const s = hitFeedback(makeHitFeedback(), 'cleave');
    expect(s.flash).toBe(1);
    expect(s.shake).toBe(HIT_FEEDBACK.shake.cleave);
    expect(s.hits).toBe(1);
  });

  it('decays to zero within the fade time and never below', () => {
    let s = hitFeedback(makeHitFeedback(), 'sweep');
    for (let i = 0; i < 60; i++) s = stepHitFeedback(s, HIT_FEEDBACK.fadeSec / 30);
    expect(s.flash).toBe(0);
    expect(s.shake).toBe(0);
    expect(s.hits).toBe(1);
  });

  it('shake offset is deterministic in time', () => {
    const s = hitFeedback(makeHitFeedback(), 'cleave');
    expect(stepHitFeedback(s, 0.01).offset).toEqual(stepHitFeedback(s, 0.01).offset);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- player-hit-feedback`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Implement the pure module**

```ts
// src/lab/sdf-zombie/player-hit-feedback.ts
//
// What an enemy melee hit DOES to the player while the game has no player
// health (game-actor.ts: "the game intentionally has no health"): a red
// flash, a camera shake, and a counter. Pure; the game reads `flash` into an
// overlay and `offset` into the camera. Real damage plugs into the same
// onMeleeContact event later.
import type { SwingVariant } from './attack';
import type { Vec3 } from './types';

export const HIT_FEEDBACK = {
  fadeSec: 0.45,
  shake: { cleave: 0.06, sweep: 0.04, lunge: 0.05, hook: 0.03, overhead: 0.03, shove: 0.02 } as Record<SwingVariant, number>,
  shakeHz: 23,
} as const;

export interface HitFeedback { flash: number; shake: number; t: number; hits: number; offset: Vec3 }

export const makeHitFeedback = (): HitFeedback => ({ flash: 0, shake: 0, t: 0, hits: 0, offset: [0, 0, 0] });

export function hitFeedback(s: HitFeedback, variant: SwingVariant): HitFeedback {
  return { ...s, flash: 1, shake: HIT_FEEDBACK.shake[variant], t: 0, hits: s.hits + 1 };
}

export function stepHitFeedback(s: HitFeedback, dt: number): HitFeedback {
  if (s.flash <= 0 && s.shake <= 0) return { ...s, offset: [0, 0, 0] };
  const t = s.t + Math.max(0, dt);
  const k = Math.max(0, 1 - t / HIT_FEEDBACK.fadeSec);
  const flash = k === 0 ? 0 : s.flash > 0 ? k : 0;
  const amp = k === 0 ? 0 : s.shake * k;
  const w = 2 * Math.PI * HIT_FEEDBACK.shakeHz * t;
  return {
    ...s, t, flash, shake: k === 0 ? 0 : s.shake,
    offset: [Math.sin(w) * amp, Math.sin(w * 1.37 + 1) * amp * 0.6, 0],
  };
}
```

Adjust the arithmetic if a test disagrees. The tests are the contract: after `fadeSec` both `flash` and `shake` are exactly 0, and `hits` persists.

- [ ] **Step 4: Run the tests**

Run: `npm test -- player-hit-feedback && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Wire `game-main.ts`**

1. **Mind selection** (~l.3163): the spread currently picks `makeSoldierMind` for `profile.gunner`. Add a sibling branch before it:

```ts
      ...(characterEntry(name).profile.melee?.kind === 'sword' ? {
        mind: makeSwordMind(),
      } : {}),
```

Import `makeSwordMind` alongside `makeSoldierMind`. Pass `onMeleeContact` to `createZombieActor` for EVERY actor. The zombie never emits contact, so this is a no-op for it:

```ts
      onMeleeContact: ({ variant }) => {
        ctx.player.hitFeedback = hitFeedback(ctx.player.hitFeedback, variant);
        // One reused sample, no new asset: find the player/impact sound the
        // game already loads (grep -n "Audio\|playSfx\|sound" game-main.ts)
        // and play it here.
      },
```

2. **State:** `hitFeedback` lives on the player `ctx` slice (per the rules, never a `main()` binding). Find the player slice type (`grep -n "player:" src/lab/sdf-zombie/webgpu/game-context*.ts`), add `hitFeedback: HitFeedback` initialised with `makeHitFeedback()`, and run `npm test -- game-context-coverage`.
3. **Per frame:** where the camera is placed from the player each frame (`grep -n "camera.position" src/lab/sdf-zombie/webgpu/game-main.ts`), step it and apply it:

```ts
      ctx.player.hitFeedback = stepHitFeedback(ctx.player.hitFeedback, dt);
      const [ox, oy] = ctx.player.hitFeedback.offset;
      camera.position.x += ox; camera.position.y += oy;
```

4. **Flash:** a fixed full-screen `div` (`pointer-events:none; background:#8a0000; mix-blend-mode:multiply`) created once at boot. Each frame set `style.opacity = String(ctx.player.hitFeedback.flash * 0.55)`.
5. **Seam:** `__sdfGame.playerHits = () => ctx.player.hitFeedback.hits`.

Run: `npx tsc --noEmit && npm test -- game-context-coverage game-actor`

- [ ] **Step 6: Verify in the game (headless)**

Write `scripts/bride-melee-gate.mjs` modelled on `scripts/sdf-game-crowd-gate.mjs` (same boot, same `__warmGate` wait). It should:
1. Open `/sdf-game.html?spawn=bride`, wait for `ready`, `__sdfGame.teleport(2)`, and `placePlayer` about 5 m from a bride, facing her. Unfreeze.
2. Let 20 s of sim run with the player standing still. Sample `__sdfGame.brains()` (or the actor debug seam it exposes) every 100 ms: record states, variants, and the bride–player distance.
3. Assert all of: at least one `lunge` started beyond 2.2 m; after it, the distance dropped by at least 0.8 m within 1.2 s; at least one `cleave` or `sweep`; `__sdfGame.playerHits() >= 1`; zero pipeline errors.
4. Take screenshots at a cleave's wind-up and at its strike, plus one standing guard. Look at them: the sword is in both hands, the veil and skirt are uncut, and the flash is visible on the hit frame.

Run: `node scripts/bride-melee-gate.mjs`, expecting the `PASS` lines above. Then run `node scripts/sdf-game-crowd-gate.mjs` to confirm the zombie crowd is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/player-hit-feedback.ts src/lab/sdf-zombie/player-hit-feedback.test.ts src/lab/sdf-zombie/webgpu/game-main.ts src/lab/sdf-zombie/webgpu/game-context*.ts scripts/bride-melee-gate.mjs docs/dev-notes/2026-09-24-bride/
git commit -m "game: bride spawns on the sword mind; melee contact flashes, shakes and counts (no player health yet)"
```

---

### Task 12: Jaw gape on the wind-up (time-boxed; cut if it resists)

**Files:**
- Modify: `src/lab/sdf-zombie/gait.ts` (`GaitJointName`, `GAIT_JOINTS`, `JOINT_AT`), `src/lab/sdf-zombie/motion.ts`, `src/lab/sdf-zombie/characters/bride.blob`
- Test: `src/lab/sdf-zombie/characters/bride-blob.test.ts`

The spec allows cutting this. **Time-box: if Step 3 has not made the jaw rotate on a lab frame after about 90 minutes, revert the task's changes, record why in NOTES.md, and skip to Task 13.** The painted sutures carry the idea alone.

- [ ] **Step 1: Write the failing test**

```ts
import { characterNames } from '../character-registry';

describe('bride — the jaw gapes on the wind-up', () => {
  it('the chin drops >= 3 cm (head-relative) at the cleave wind-up peak and is back by phase 1', () => {
    const chin: { phase: number; y: number }[] = [];
    drive({
      frames: 121, speed: 0,
      attack: i => (i >= 60 ? { phase: Math.min(1, (i - 60) / 60), side: 'R', variant: 'cleave' } : undefined),
      onFrame: (_f, pts, J, i) => {
        if (i < 59) return;
        expect(J.jaw, 'no jaw joint').toBeDefined();
        chin.push({ phase: Math.max(0, Math.min(1, (i - 60) / 60)), y: pts[J.jaw!]!.pos[1] - pts[J.head!]!.pos[1] });
      },
    });
    const near = (p: number) => chin.reduce((a, b) => (Math.abs(b.phase - p) < Math.abs(a.phase - p) ? b : a)).y;
    expect(near(0) - near(ATTACK_TUNING.windupEnd)).toBeGreaterThanOrEqual(0.03);
    expect(Math.abs(near(1) - near(0))).toBeLessThan(0.005);
  });

  // A new optional joint must not break the bodies that map today. These are
  // the ones known NOT to build motion joints before this change (memory:
  // spawnDebugCharacter throws for them) — excluded, not fixed here.
  const KNOWN_NULL = new Set(['mouse', 'cyclops', 'schoolgirl-alt', 'dragon', 'gargoyle', 'bloatmaw', 'strand-fixture', 'box-fixture']);
  it.each(characterNames().filter(n => !KNOWN_NULL.has(n)))('%s still builds motion joints', name => {
    const e = characterEntry(name);
    const d = parseBlob(e.src);
    const b = buildBody(compileBlob(d, compileFace(d)));
    expect(makeActorMotion(b, { seed: 1 }).motionJoints).not.toBeNull();
  });
});
```

Run the second test on the base commit first (`git stash`-free: just run it before editing `gait.ts`). If a character outside `KNOWN_NULL` already fails there, add it to the set with a comment. The test guards against regressions; it does not fix bodies that were already broken.

- [ ] **Step 2: Run to verify it fails.** Run: `npm test -- bride-blob`. Expected: FAIL.

- [ ] **Step 3: Implement, following the `hem` precedent**

`hem` is the one optional joint that already exists. Read every place it appears (`grep -n "hem" src/lab/sdf-zombie/gait.ts src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/rig-bind.ts`) and mirror them:
- `bride.blob`: add `bone jaw parent=skull …` pointing forward and down from the hinge, and move the jaw and chin prims (lower lip, chin) onto `bone=jaw`.
- `gait.ts`: add `'jaw'` to `GaitJointName` and `GAIT_JOINTS`, and `jaw: { head: <the skull joint the jaw hangs from>, tail: 'jaw' }` to `JOINT_AT`. Keep it optional in the same way `hem` is, so a body without the bone still maps.
- `motion.ts`: when the jaw joint exists and `cfg.attack` is live, rotate its rest target about the head's right axis by `gape = 0.45 * armArc(phase, variant).active` rad, but only during the wind-up and strike (`phase < ATTACK_TUNING.strikeEnd`). Otherwise hold it at rest.
- If the rig (`rig-bind.ts`) treats the new point as a free verlet point, pin it to its target the way the head's rigid points are held. Find that with `grep -n "rigid\|headQuat" src/lab/sdf-zombie/rig-bind.ts`.

- [ ] **Step 4: Run the tests.** Run: `npm test -- bride-blob motion gait rig-bind cultist-blob ogre-blob zombie-blob && npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 5: Frame and commit.** Take a face close-up at the cleave wind-up peak. The mouth must open past where the sutures begin.

```bash
git add src/lab/sdf-zombie/gait.ts src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/characters/bride.blob src/lab/sdf-zombie/characters/bride-blob.test.ts docs/dev-notes/2026-09-24-bride/
git commit -m "bride: jaw gapes on the sword wind-up (optional jaw joint, hem precedent)"
```

---

### Task 13: Notes, TASKS.md, final verification

**Files:**
- Create/complete: `docs/dev-notes/2026-09-24-bride/NOTES.md`
- Modify: `TASKS.md` (new section at the top, in the style of the cultist/ogre sections)

- [ ] **Step 1: Write NOTES.md** in the broodmother/ogre style:
  - the brief;
  - a "what exists" table (pieces → sources → built into);
  - how to look at her (`/sdf-lab-webgpu.html?character=bride`, `?spawn=bride`, the gate script);
  - the design, one numbered beat per horror hook;
  - deviations (armour sheds rather than blocks; the jaw, if it was cut);
  - things found along the way;
  - the frames.
- [ ] **Step 2: Update TASKS.md.** Add a `## Bride (sword melee enemy) — first pass 2026-09-24` section. Include one `[x]` row per shipped piece with a link to the notes, and `[ ]` rows for polish and the out-of-scope items: second elbow, veil collapse on a head hit, ranged special, real player damage, sounds.
- [ ] **Step 3: Final verification**

Run: `npx tsc --noEmit && npm test -- bride-blob bride-kit sword-swing enemy-mind player-hit-feedback brain attack motion-profile carry gait game-actor game-context-coverage cultist-blob ogre-blob soldier-kit zombie-blob`
Then run: `node scripts/bride-melee-gate.mjs && node scripts/sdf-game-crowd-gate.mjs`
Expected: all PASS. Paste the summary lines into NOTES.md.

- [ ] **Step 4: Commit**

```bash
git add docs/dev-notes/2026-09-24-bride/ TASKS.md
git commit -m "docs(bride): notes, frames; TASKS.md row"
```
