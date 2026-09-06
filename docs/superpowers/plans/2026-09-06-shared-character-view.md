# Shared Character View + `game-main` Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the lab and the game one shared module for "a character on screen that can be shot," then break `game-main`'s 191-binding closure into owned subsystems.

**Architecture:** `character-registry.ts` (pure data) and `character-view.ts` (the body: build, view, face, kit, prop, pose, and the damage orchestration moved out of `game-actor`). The lab adopts it first because that proves the extraction; the game adopts it second, which is where the soldier arrives. Then five factory modules come out of `game-main`, with `tick()` last.

**Tech Stack:** TypeScript, Vitest, Three.js (WebGPU). No new dependencies.

**Spec:** [2026-09-06-shared-character-view-design.md](../specs/2026-09-06-shared-character-view-design.md)

---

## Orientation — read before Task 1

**This is a PURE REFACTOR.** The definition of done is that `git diff --stat`
shows lines **moved, not rewritten**. Any hunk that is not a move is a
behaviour change wearing a refactor's clothes; split it into its own commit
with its own justification, or don't make it.

There is exactly **one sanctioned exception**, Task 4, where the lab converges
onto the game's damage path and its behaviour legitimately changes. Every other
task holds the strict line.

### Practical gotchas

- **A fresh worktree has no `node_modules`.** `vitest` and `tsc` fail until you
  link the main repo's: `ln -s /Users/donny/Projects/blud/node_modules node_modules`
- Tests: `npm test` (whole suite, ~3,545 tests), `npx vitest run <path>` (one file).
- Typecheck: `npm run build`.
- The gate scripts need a vite server and a WebGPU-enabled headless Chrome.
  `scripts/lab-servers.sh` handles that lifecycle — reuses servers already
  listening, stops only the ones it started. Task 5 of the soldier plan used it
  successfully; copy that usage.
- `blob-render-check.sh` exit codes are **meaningful and must be propagated**:
  0 = the renderer agrees with the field, 1 = it shows a hole, 2 = the check
  could not run. Do not let a trap swallow them.

### House style

Comments explain **why**, especially why a value is what it is — read
`brain.ts`'s `meleeRadius` comment for the standard. When you move code, **the
comments move with it, unedited**. They record which bugs forced which
constants; summarizing them destroys the only record.

### Inherited loose end

Soldier task 5 (`13e7266`) left a documented migration shim in
`game-actor.ts`: `brain()` survives as a *view* over the live mind's debug,
because `game-main`'s `__sdfGame.brains()` capture seam reads it. Its comment
says "game-main's kind task owns brains() and its callers and deletes this."
That task was held; **Task 5 of this plan inherits it.**

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/character-registry.ts` | **create** | Pure data: name → blob, kit, face, profile. No THREE. |
| `src/lab/sdf-zombie/character-registry.test.ts` | **create** | Registry invariants. |
| `src/lab/sdf-zombie/webgpu/character-view.ts` | **create** | The body: build, view, face, kit, prop, pose, damage. |
| `src/lab/sdf-zombie/webgpu/character-view.test.ts` | **create** | What is testable without a GPU. |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | modify | Loses damage; keeps mind, motion, crowd. |
| `src/lab/sdf-zombie/webgpu/lab-main.ts` | modify | Adopts the shared module. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | modify | Adopts it; then splits (Phase B). |
| `src/lab/sdf-zombie/webgpu/game-fpv-weapon.ts` | **create** | Phase B. |
| `src/lab/sdf-zombie/webgpu/game-chunks.ts` | **create** | Phase B. |
| `src/lab/sdf-zombie/webgpu/game-bleed.ts` | **create** | Phase B. |
| `src/lab/sdf-zombie/webgpu/game-cast.ts` | **create** | Phase B. |
| `src/lab/sdf-zombie/webgpu/game-tuning.ts` | **create** | Phase B. |
| `docs/dev-notes/2026-09-06-refactor-baselines/` | **create** | Task 1's captures. |

---

# PHASE A — the shared character view

Phase A delivers working software on its own: the soldier reaches the game and
the lab tunes wounds on the same path the game ships. It can land, and the
soldier work resume, without Phase B.

---

## Task 1: Capture the baseline — DONE (2026-09-06)

Kept for the record, because what it established governs every later task.

**The plan originally had this task write a `refactor-baseline.sh` from
scratch, with an invented `--out` flag. That was wrong on both counts.**
`crowd-capture.mjs` already exists and is a pixel-identity gate built for a
refactor: it applies the deterministic freeze recipe, fires three shots,
checks they agree, and reports a SHA-256. Its own header says "the reported
hash is what the pre/post-refactor comparison uses." The real script wraps it.

### What was measured

**Determinism: CONFIRMED.** Three captures across three fresh page loads, plus
a fourth from an entirely separate vite+Chrome lifecycle, all produced
`77d1659dac5c48c321f655dc8b0e7321182ea9b11ddd1abc3a97644432f489ce`.

**So the byte-identical gate is real, not an assumption.** Every later task may
hold to it. If a future run yields two hashes for the same code, that property
has broken: STOP and report rather than loosening the comparison.

### The trap that cost two attempts

**`crowd-capture.mjs` writes its PNG, prints its JSON, and then never exits** —
a live CDP WebSocket keeps node's event loop alive. Any loop over it hangs
forever on the first iteration, looking exactly like a slow capture.

The result is complete well before the hang, so a per-run `timeout` is the
correct harness and **`rc=124` is the success path**. A capture that exits 0 is
the surprise, not the norm.

### The gate, for every later task

```bash
scripts/refactor-baseline.sh /tmp/after-task-N
diff /tmp/baseline/MANIFEST /tmp/after-task-N/MANIFEST
```

The MANIFEST is `<label> <sha256>` per capture, sorted. An empty diff is the
pass. A non-empty diff names the exact view that moved.

Five views — `solo-front`, `solo-side`, `solo-close`, `crowd6`, `crowd6-wide`
— so a regression confined to one camera cannot hide.

The script also fails a capture whose `stableWithinRun` is false: that means
the freeze recipe did not take, and the hash is meaningless as a baseline.

- [x] Determinism verified across boots
- [x] `scripts/refactor-baseline.sh` written against the real interfaces
- [x] Baseline captured and committed

---

## Task 2: `character-registry.ts` — DONE (2026-09-06)

Landed as `8318b25` + `da9216b`. Two findings, both recorded:

1. **The "kit implies a bespoke profile" invariant below was MINE and it was
   WRONG.** The dispatched agent correctly left it RED rather than weakening
   it, which is the protocol working. Replaced with the face-sheet check.
2. **`minotaur.blob:433` declares `image minotaur-face.png` and no such file
   ships** — the lab has been 404ing it silently for as long as it has existed.
   Owner's call: RECORD, do not fix. Baking the face or deleting the sheet
   block both change how the minotaur renders, which is not a thing to do
   inside a pure refactor. It sits in `KNOWN_MISSING` with a second test that
   fails if the gap is ever closed without updating the list.

Also: `node:fs` does not typecheck here — the tsconfig carries only
`["vite/client"]`, so use `import.meta.glob`, as `blob-checks.test.ts` does
for the same reason. Tests passing is not enough; `npm run build` is the check
that catches this.


**Files:**
- Create: `src/lab/sdf-zombie/character-registry.ts`
- Create: `src/lab/sdf-zombie/character-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/character-registry.test.ts`:

```ts
// src/lab/sdf-zombie/character-registry.test.ts
import { describe, it, expect } from 'vitest';
import {
  CHARACTERS, characterEntry, characterNames, hasCharacter,
} from './character-registry';
import { parseBlob } from './blob-parse';

describe('character-registry', () => {
  it('every registered name resolves to a parseable blob', () => {
    for (const name of characterNames()) {
      const e = characterEntry(name);
      expect(() => parseBlob(e.src), `${name} failed to parse`).not.toThrow();
    }
  });

  it('every face sheet a character declares actually ships', () => {
    // NOTE: the plan originally asserted "a character with a kit has a bespoke
    // motion profile" here. THAT INVARIANT IS FALSE and was removed on
    // 2026-09-06. It conflated the MOTION PROFILE (which gait drives the body)
    // with the RIG (which bones exist) -- the kit rides boneFrames() off the
    // rig regardless of gait. goblin, clown and clown-alt carry kits on the
    // zombie shamble deliberately, and motion-profile.test.ts:10 already
    // pinned motionProfileFor('clown') to ZOMBIE_PROFILE.
    //
    // This is the invariant that pays rent instead, and it caught a real
    // pre-existing bug on its first run.
    const KNOWN_MISSING = new Set(['minotaur']);   // see below
    const missing = characterNames()
      .map(n => ({ name: n, url: characterEntry(n).face.url }))
      .filter(d => !SHIPPED_FACES.has(d.url))
      .filter(d => !KNOWN_MISSING.has(d.name));
    expect(missing.map(m => `${m.name} -> ${m.url}`)).toEqual([]);
  });

  it('every profile that declares carries also declares a prop', () => {
    for (const name of characterNames()) {
      const p = characterEntry(name).profile;
      if (!p.carries) continue;
      expect(p.prop, `${name} carries but has no prop`).toBeDefined();
    }
  });

  it('an unknown name is a LOUD error, never a silent zombie', () => {
    // This is lab-main's existing bug, fixed by construction: it renders the
    // zombie for any character not hand-listed, so a typo or a new .blob that
    // was never registered looks like a rendering fault instead of a lookup
    // miss. Every recorded bug in this area has been a lookup miss.
    expect(() => characterEntry('no-such-character')).toThrow(/unknown character/i);
  });

  it('hasCharacter is the guard for untrusted input, and does not throw', () => {
    // URL params are untrusted; ?character=garbage must fall back, not crash.
    expect(hasCharacter('zombie')).toBe(true);
    expect(hasCharacter('no-such-character')).toBe(false);
  });

  it('the registry is the single list — no name appears twice', () => {
    const names = characterNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes every character the lab shipped', () => {
    for (const n of ['zombie', 'goblin', 'clown', 'soldier', 'schoolgirl', 'female']) {
      expect(hasCharacter(n), `${n} missing from the registry`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/character-registry.test.ts`

Expected: FAIL — `Failed to resolve import "./character-registry"`.

- [ ] **Step 3: Implement**

Create `src/lab/sdf-zombie/character-registry.ts`. Move the entries from
`lab-main.ts`'s `CHARACTERS` (line ~71), `KITS` (~99) and `FACE_TEXTURES`
(~227), and pair each with its `motion-profile.ts` profile.

```ts
// src/lab/sdf-zombie/character-registry.ts
//
// THE list of characters: blob source, polygon kit, face sheet, motion
// profile. Pure data — no THREE, no side effects, no I/O beyond the ?raw
// imports — so it is directly testable.
//
// WHY DATA IS SPLIT FROM RUNTIME. Every recorded bug in this area is a LOOKUP
// MISS, not a rendering fault: lab-main renders the zombie for any character
// not hand-listed in it; bench-main duplicates the face table; the soldier
// shoot-back plan was about to hand-write a fourth copy in game-main. Four
// registries, keyed by the same strings, maintained in three files. This is
// one list, and characterEntry() THROWS on a miss so the next one is loud.
//
// The URL-param guard is a different thing and stays: ?character=garbage must
// fall back gracefully, which is what hasCharacter() is for. The bug this
// fixes is a character that EXISTS as a .blob and was never registered.
import zombieBlobSrc from './characters/zombie.blob?raw';
import goblinBlobSrc from './characters/goblin.blob?raw';
// ...one import per character, copied from lab-main's existing block...
import {
  ZOMBIE_PROFILE, SOLDIER_PROFILE, motionProfileFor, type MotionProfile,
} from './motion-profile';

/** A face sheet's texture and its crop. `mean` is the level the shader
 *  divides out (`tex.rgb / faceCfg2.y`), so a wrong one shifts the whole
 *  head's brightness — it must be MEASURED off the file, never guessed. */
export interface FaceSheet {
  url: string;
  /** TOP-LEFT pixel coords: [x, y, w, h, sheetW, sheetH]. */
  rect: [number, number, number, number, number, number];
  mean: number;
}

export interface CharacterEntry {
  name: string;
  /** The .blob source text. */
  src: string;
  /** Compiled polygon kit (armour, clothing, hard props), if any. Absent
   *  means flesh only. A kit RIDES THE RIG — see character-view's pose(). */
  kit?: string;
  face: FaceSheet;
  profile: MotionProfile;
}

/** The zombie's shared flat sheet — the fallback for any character whose
 *  .blob declares no `sheet` block, which is most of them. */
const ZOMBIE_FLAT: FaceSheet = {
  url: '/assets/lab/zombie-face.png',
  rect: [0, 0, 64, 64, 64, 64],
  mean: 0.406,   // MEASURED off the file
};

export const CHARACTERS: Readonly<Record<string, CharacterEntry>> = {
  zombie: {
    name: 'zombie', src: zombieBlobSrc, face: ZOMBIE_FLAT,
    profile: ZOMBIE_PROFILE,
  },
  soldier: {
    name: 'soldier', src: soldierBlobSrc,
    kit: '/assets/lab/soldier-kit.gltf',
    face: {
      url: '/assets/lab/faces/soldier-face.png',
      rect: [0, 0, 512, 512, 512, 512],
      // MEASURE THIS off the PNG before shipping; 1 is the documented
      // pre-measurement fallback and will shift his head's brightness.
      mean: 1,
    },
    profile: SOLDIER_PROFILE,
  },
  // ...the remaining entries, moved from lab-main's three tables...
};

export function characterNames(): readonly string[] {
  return Object.keys(CHARACTERS);
}

/** True when `name` is registered. The guard for UNTRUSTED input (URL
 *  params); never throws. */
export function hasCharacter(name: string): boolean {
  return Object.hasOwn(CHARACTERS, name);
}

/** The entry for `name`. THROWS on a miss, deliberately — see the header. */
export function characterEntry(name: string): CharacterEntry {
  const e = CHARACTERS[name];
  if (!e) {
    throw new Error(
      `unknown character '${name}'. Registered: ${characterNames().join(', ')}. `
      + `A .blob that exists but is not registered here renders as the ZOMBIE, `
      + `which is the bug this throw exists to prevent.`,
    );
  }
  return e;
}
```

Fill in every character from `lab-main`'s existing tables. Use
`motionProfileFor(name)` where a character has no bespoke profile.

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/character-registry.test.ts`

Expected: PASS, 7 tests. **If the "kit implies a profile" test fails for a real
character, that is a genuine finding** — report it rather than weakening the
test.

- [ ] **Step 5: Full suite**

Run: `npm run build && npm test`

Expected: clean, 3,545+ tests. Nothing consumes the registry yet, so nothing
should change.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/character-registry.ts src/lab/sdf-zombie/character-registry.test.ts
git commit -m "character-registry: one list, and a loud miss

Merges lab-main's CHARACTERS, KITS and FACE_TEXTURES with motion-profile's
BY_NAME -- four registries keyed by the same strings, maintained in three
files. characterEntry() throws on an unknown name: every recorded bug in this
area is a lookup miss that currently renders as a silent zombie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `character-view.ts` — the presentation half, adopted by the lab

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/character-view.ts`
- Create: `src/lab/sdf-zombie/webgpu/character-view.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`

- [ ] **Step 1: Write the interface**

Create `src/lab/sdf-zombie/webgpu/character-view.ts` with the presentation
half only. Damage arrives in Task 4.

```ts
// src/lab/sdf-zombie/webgpu/character-view.ts
//
// THE BODY: how a character looks, how it animates, and (from task 4) what
// happens to it when it is hit. One module, two consumers — the lab previews
// one and puts sliders on it; the game spawns a roomful and shoots them.
//
// WHY IT EXISTS. The lab is meant to be a preview of things that then drop
// into the game, and it was not: kit overlays, held props, motion profiles and
// baked faces were all previewed in the lab, and getting the soldier into the
// game then cost three hand-porting tasks. This is that seam.
//
// WHAT IT DOES NOT OWN: behaviour, motion, wander, crowd separation, the melee
// ring. Those are game-actor's — the line is BODY versus FIGHTER. The lab
// needs a body it can shoot; it has never needed a fighter.
//
// Follows the factory-closure pattern the codebase already uses in
// createZombieActor, KitOverlay, GooLayer, HeldProp and WoundPanel. main() is
// the one place that never adopted it.
import * as THREE from 'three/webgpu';
import { characterEntry, type CharacterEntry } from '../character-registry';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { translateBody } from '../translate';
import { boneFrames } from '../rig-frames';
import { loadKit, type KitOverlay } from './kit-overlay';
import { loadHeldProp, type HeldProp } from './held-prop';
import type { BuildResult } from '../types';
import type { Vec3 } from '../types';

export interface CharacterView {
  readonly entry: CharacterEntry;
  /** The built, translated body. Severing replaces it (task 4). */
  readonly body: BuildResult;
  /** The GPU view. NAMED `gpu`, NOT `view`: callers hold this whole object in
   *  a field called `view` (ZombieActor.view), and `a.view.view` is the kind
   *  of name that produces a wrong-object bug at the first refactor. */
  readonly gpu: ZombieGpuView;
  /** Drive body, kit and prop from one rig solve. */
  pose(posed: BuildResult, bound: BoundRig, bodyYaw: number, sinceFire: number): void;
  /** World muzzle of the held prop, or null when this character carries
   *  nothing or the glTF has not loaded yet. The soldier's shot reads it. */
  muzzle(): Vec3 | null;
  /** Let the held prop go (collapse, gib). */
  releaseProp(vel: Vec3, seed: number): void;
  dispose(): void;
}

export interface CharacterViewOpts {
  name: string;
  start: Vec3;
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  /** Passed through to createZombieGpuView unchanged — the caller still owns
   *  the sdf layer, the flashlight and the lighting preset. Use the exact
   *  parameter type createZombieGpuView already declares; do not invent a
   *  new one. */
  gpu: Parameters<typeof createZombieGpuView>[1];
  /** Build errors are pushed here rather than thrown: one bad character must
   *  not take the page down, which is how the lab behaves today. */
  errors: string[];
}

export async function createCharacterView(
  opts: CharacterViewOpts,
): Promise<CharacterView> { /* see the move table below */ }
```

**`ZombieActor.view` changes type from `ZombieGpuView` to `CharacterView`** in
Task 4. Until then the lab uses `CharacterView` directly and the game is
untouched.

Fill the body by **moving** `lab-main`'s existing wiring:

| From `lab-main.ts` | Into |
| --- | --- |
| `compileZombie` / `buildZombieBody` (~293–345) | the build step |
| the `sheet` compile + throw-catch (~1027–1045) | the face step |
| `loadKit` / `loadHeldProp` calls (~1155–1165) | the load step |
| the `kit?.pose(frames)` / `heldProp.pose(...)` block (~2930–2940) | `pose()` |

**Move them verbatim, comments included.** The `compileSheet` throw-catch in
particular carries the comment about the 2026-09-04 hour lost to one bad key —
that comment is the reason the catch exists.

- [ ] **Step 2: Write the tests that don't need a GPU**

Create `src/lab/sdf-zombie/webgpu/character-view.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/character-view.test.ts
import { describe, it, expect } from 'vitest';
import { buildCharacterBody, compileCharacterSheet } from './character-view';
import { characterEntry, characterNames } from '../character-registry';

// The GPU half needs a device and is covered by the capture gate instead.
// These cover the pure half: building and sheet compilation, which is where
// the bugs have actually been.

describe('buildCharacterBody', () => {
  it('builds every registered character without errors', () => {
    for (const name of characterNames()) {
      const errs: string[] = [];
      const body = buildCharacterBody(characterEntry(name), [0, 0, 0], errs);
      expect(errs, `${name}: ${errs.join(' | ')}`).toEqual([]);
      expect(body.prims.length).toBeGreaterThan(0);
    }
  });

  it('places the body at the requested start', () => {
    const errs: string[] = [];
    const a = buildCharacterBody(characterEntry('zombie'), [0, 0, 0], errs);
    const b = buildCharacterBody(characterEntry('zombie'), [5, 0, 3], errs);
    expect(b.prims[0]!.a[0] - a.prims[0]!.a[0]).toBeCloseTo(5, 6);
    expect(b.prims[0]!.a[2] - a.prims[0]!.a[2]).toBeCloseTo(3, 6);
  });
});

describe('compileCharacterSheet', () => {
  it('returns the blob own sheet when it declares one', () => {
    // The soldier has an owner-tuned bake; the zombie has no sheet block.
    expect(compileCharacterSheet(characterEntry('soldier')).sheet).not.toBeNull();
    expect(compileCharacterSheet(characterEntry('zombie')).sheet).toBeNull();
  });

  it('a bad sheet block is REPORTED, not thrown', () => {
    // compileSheet raises BlobError on an unknown key. One bad key cost an
    // hour on 2026-09-04 and silently swapped the soldier's face for the
    // zombie's. The catch must report loudly and fall back, not crash.
    const broken = { ...characterEntry('soldier'), src: 'sheet\n  notAKey 1\n' };
    const r = compileCharacterSheet(broken);
    expect(r.sheet).toBeNull();
    expect(r.error).toMatch(/sheet/i);
  });

  it('every character with no sheet block falls back to the zombie flat', () => {
    const r = compileCharacterSheet(characterEntry('zombie'));
    expect(r.sheet).toBeNull();
    expect(r.face.url).toContain('zombie-face');
  });
});
```

- [ ] **Step 3: Run the unit tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/character-view.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 4: Adopt in `lab-main.ts`**

Replace the four moved blocks with calls into `createCharacterView`. Delete
`CHARACTERS`, `KITS` and `FACE_TEXTURES` from `lab-main` and import from
`character-registry` instead. Keep `activeCharacterName()`, but implement its
guard with `hasCharacter`:

```ts
function activeCharacterName(): string {
  const want = new URLSearchParams(location.search).get('character');
  return want && hasCharacter(want) ? want : 'zombie';
}
```

- [ ] **Step 5: Full suite and typecheck**

Run: `npm run build && npm test`

Expected: clean. **No test file may be edited.**

- [ ] **Step 6: THE GATE — captures byte-identical**

Run:

```bash
scripts/refactor-baseline.sh /tmp/after-task-3
diff docs/dev-notes/2026-09-06-refactor-baselines/MANIFEST /tmp/after-task-3/MANIFEST
```

Expected: **empty diff, and the script printing `[baseline] OK`.**

Diff the MANIFEST specifically, **not the directories** — the baseline dir also
holds a README and the per-capture JSON logs, so `diff -rq` on the dirs always
reports differences that mean nothing.

Check both: an empty diff with a FAILED script means captures did not run, and
comparing two incomplete manifests passes vacuously.

A moved hash means the extraction stopped being an extraction — find what you
rewrote instead of moved. Do not proceed with a non-empty diff.

Note `rc=124` per capture is the SUCCESS path (see Task 1's trap).

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/character-view.ts \
        src/lab/sdf-zombie/webgpu/character-view.test.ts \
        src/lab/sdf-zombie/webgpu/lab-main.ts
git commit -m "character-view: the presentation half, adopted by the lab

Build, GPU view, face sheet, kit overlay, held prop and one pose call for all
of them -- moved verbatim out of lab-main, which is the only place this wiring
existed. Captures byte-identical against the task-1 baseline.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: the damage half — the ONE task that changes behaviour

**Read this whole task before starting.** It is the sanctioned exception to the
byte-identical rule, and it will look like a failure if you expect one.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/character-view.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts`
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`

- [ ] **Step 1: Move the damage orchestration out of `game-actor`**

Move into `character-view.ts`, **verbatim, comments included**:

- `hit(hitWorld, dirWorld)` and `hitSlug(hitWorld, dirWorld)`
- `stampBlast(wounds)`
- `beginHits()` / `endHits()` and the deferred-tail logic
- the sever checks, `detach`, and the `onSever` dispatch
- the wound ring (`wounds`, `pushWound`, `MAX_WOUNDS`)
- the repack + carve upload, `woundCarveNormal`
- `wounds()` and `rebind()`

`game-actor` keeps the mind, motion, wander, crowd nudge, furniture routing and
the ring token, and delegates damage to its `CharacterView`.

Add to `CharacterView`:

```ts
  hit(hitWorld: Vec3, dirWorld: Vec3): Wound | null;
  hitSlug(hitWorld: Vec3, dirWorld: Vec3): Wound | null;
  stampBlast(wounds: readonly Wound[]): void;
  /** Between begin and end, hits stamp and shove but DEFER the expensive tail
   *  — sever checks, rig re-solve, whole-body repack and upload — to ONE
   *  flush. A double-barrel burst at point blank lands ~16 pellets in one
   *  frame; unbatched that was 16 repacks (12–18 ms CPU per landing frame,
   *  the owner's "50 ms spike when I shoot up close", hit-profile.mjs
   *  2026-09-05). Callers landing ONE projectile need not batch. */
  beginHits(): void;
  endHits(): void;
  wounds(): readonly Wound[];
  /** Bleed emitters, gut ropes and spill. OPTIONAL and default OFF: the lab
   *  has none of this today, and enabling it unconditionally would be a
   *  behaviour change, not a refactor. The game opts in. */
  attachBleed(sink: BleedSink): void;
```

`BleedSink` is the seam `game-bleed.ts` implements in Phase B Task 9. Define it
here, in `character-view.ts`, so the shared module owns its own contract rather
than importing from a game-only module:

```ts
/** What a character reports to whatever is drawing blood from it. Implemented
 *  by game-bleed.ts (Phase B); the lab passes nothing and gets no bleeding,
 *  which is exactly its behaviour today.
 *
 *  A SINK, not a callback, because three distinct events hang off one wound
 *  (an emitter registers, a rope may spill, a splat may land) and three
 *  separate callbacks on one interface is the shape that drifts. */
export interface BleedSink {
  /** A wound was just stamped on this body. `kind` picks the gout profile. */
  onWound(wound: Wound, kind: 'pellet' | 'slug' | 'stump'): void;
  /** A limb came off; `piece` is already in world space. */
  onSever(piece: DetachedPiece, stumpWound: Wound | null): void;
}
```

- [ ] **Step 2: Point `lab-main`'s eleven `pushWound` sites at the shared path**

`lab-main` has eleven direct `pushWound` calls (lines ~1727, 1753, 1773, 2228,
2256, 2273, 2293, 2517, 4357, 4377). Each becomes a `view.hit(...)` /
`view.hitSlug(...)` / `view.stampBlast(...)` call.

**This is where behaviour changes**, and it is the point of the task: the lab
gains hit batching (`beginHits`/`endHits`, which it has zero references to
today) and `woundCarveNormal` (also zero). Its wounds will look and perform
differently, because it has been tuning against an older path than the game
ships.

Do **not** enable bleed in the lab — `attachBleed` stays uncalled there.

- [ ] **Step 3: Full suite and typecheck**

Run: `npm run build && npm test`

Expected: clean. **This is the one task where a test file MAY need editing** —
if a `lab-main`-facing test asserts the old un-batched wound behaviour, update
it and say so explicitly in the commit. Anywhere else, still stop.

- [ ] **Step 4: Game gates — these must NOT move**

Run:

```bash
node scripts/sdf-game-crowd-gate.mjs
node scripts/sdf-game-bleed-gate.mjs
node scripts/sdf-game-slug-gate.mjs
node scripts/sdf-game-shorty-gate.mjs
```

Expected: the same verdicts as before this task. **The game's damage path is
the one being moved *from*, so its behaviour must be unchanged.** Only the lab
converges. A moved game verdict means the move was not a move.

- [ ] **Step 5: Capture a NEW baseline — do not diff against the old one**

Run:

```bash
scripts/refactor-baseline.sh /tmp/after-task-4
```

Then diff it against task 3's output **only to see what changed**, not to gate:

```bash
diff -rq /tmp/after-task-3 /tmp/after-task-4 | tee /tmp/task-4-changes.txt
```

Expected: differences, confined to wound-bearing captures (`wound`, `goo`,
`melt`, the turntables of shot characters). **A difference in a capture with no
wounds in it is a real regression** — investigate before continuing.

- [ ] **Step 6: OWNER GATE**

Show the owner the before/after for the wound captures and confirm the lab's
new wound behaviour is the intended one. Do not proceed without that
confirmation — no checksum can answer this question.

- [ ] **Step 7: Commit, and replace the baseline**

```bash
rm -rf docs/dev-notes/2026-09-06-refactor-baselines
mkdir -p docs/dev-notes/2026-09-06-refactor-baselines
cp -r /tmp/after-task-4/* docs/dev-notes/2026-09-06-refactor-baselines/
git add -A src/lab/sdf-zombie/webgpu docs/dev-notes/2026-09-06-refactor-baselines
git commit -m "character-view: the damage half, and the lab converges onto it

game-actor's hit/hitSlug/stampBlast, severing, the wound ring, the repack and
carve upload, and the beginHits/endHits batching move into character-view;
game-actor keeps the mind, motion and crowd. The line is BODY vs FIGHTER.

THE LAB'S WOUND BEHAVIOUR CHANGES HERE, deliberately: it had zero references
to the batching added on 2026-09-05 for the 50 ms point-blank spike, and zero
to woundCarveNormal. It has been tuning wounds against an older path than the
game ships, which defeats the reason the lab exists.

Game gates unmoved -- the game is the path being moved FROM. Baseline replaced
rather than compared; owner confirmed the new lab behaviour.

Bleed stays opt-in and OFF in the lab: it has none today, and adding it would
be a feature, not a refactor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: the game adopts it — the soldier arrives

This **replaces held soldier tasks 6 and 7**. Instead of hand-porting the lab's
block into `game-main`, the game calls the shared module.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts`

- [ ] **Step 1: Replace `spawnZombie` with a registry-driven spawn**

`game-main.ts:1048`'s `spawnZombie` closes over a single module-level `doc` and
`face` (lines 927–936) and hardcodes `ZOMBIE_FLAT` (line ~1106). Replace all of
it with `createCharacterView`, and take the character name as a parameter:

```ts
  /** ONE spawn — THE actor path, so the wound panel's rebuild cannot drift
   *  from boot. Errors are pushed into errs; the caller surfaces them. */
  async function spawnEnemy(
    name: string, room: RoomDef, start: Vec3, errs: string[],
  ): Promise<ZombieActor> {
    const enc = enclosureOf(room.name)!;
    const roomFurniture = FURNITURE
      .filter(f => f.room === room.id)
      .map(f => ({ min: [f.minX, 0, f.minZ] as Vec3, max: [f.maxX, f.height, f.maxZ] as Vec3 }));
    const cv = await createCharacterView({
      name, start, renderer, scene, errors: errs,
      gpu: { /* the existing createZombieGpuView options block, unchanged */ },
    });
    const id = nextId++;
    const actor = createZombieActor({
      id, room: room.id, view: cv, start,
      seed: 1337 + nextId * 101,
      bounds: wanderBounds(room),
      furniture: roomFurniture,
      ...(name === 'soldier' ? { mind: makeSoldierMind() } : {}),
      profile: characterEntry(name).profile,
      onSever: (piece, stumpWound) => onSeverDispatch?.(actor, piece, stumpWound),
    });
    cv.attachBleed(bleedSink);   // the game opts in; the lab does not
    return actor;
  }
```

- [ ] **Step 2: Give one room the soldier**

```ts
  /** Which room the lone soldier holds. ONE soldier, ONE room: there is no
   *  ranged arbiter yet, so two of them would shoot through each other. */
  const SOLDIER_ROOM = 2;

  async function spawnAll(errs: string[]): Promise<void> {
    for (const room of ROOMS) {
      const points = spawnPoints(room);
      for (let i = 0; i < points.length; i++) {
        const name = room.id === SOLDIER_ROOM && i === 0 ? 'soldier' : 'zombie';
        actors.push(await spawnEnemy(name, room, points[i]!, errs));
      }
    }
  }
```

**`SOLDIER_ROOM = 2` is a guess.** Check `ROOMS` in `game-level.ts` and pick a
room with floor for a 6 m standoff — a soldier in a closet is pinned against
the bounds in permanent `retreat`.

- [ ] **Step 3: Pose the kit and prop each frame**

In the per-actor frame loop, after `a.step(dt)`, one call replaces the whole
block soldier task 7 was going to hand-port:

```ts
    const p = a.pose();
    a.view.pose(a.posed(), a.boundRig(), p.yaw, a.sinceFire());
```

`a.view` is the `CharacterView` (its type changed in Task 4); the GPU view
underneath is `a.view.gpu`. Anywhere `game-main` currently reaches
`actor.view.uniforms` it becomes `actor.view.gpu.uniforms` — there are several,
so let the typechecker find them rather than grepping.

- [ ] **Step 4: Delete the `brain()` migration shim**

Soldier task 5 left `brain()` on `ZombieActor` as a view over the mind's debug,
with the comment "game-main's kind task owns brains() and its callers and
deletes this. Do not grow callers." **That task is this one.**

Migrate `__sdfGame.brains()` in `game-main` to read `a.mind().debug()`, then
delete `brain()` from the `ZombieActor` interface and its implementation.

- [ ] **Step 5: Full suite, typecheck, game gates**

Run:

```bash
npm run build && npm test
node scripts/sdf-game-crowd-gate.mjs
node scripts/sdf-game-bleed-gate.mjs
node scripts/sdf-game-slug-gate.mjs
node scripts/sdf-game-shorty-gate.mjs
```

Expected: clean, and the same gate verdicts. The soldier is a **new body in a
new room** — if a gate that measures zombie behaviour moves, the shared path
changed something for the zombie, which it must not.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts src/lab/sdf-zombie/webgpu/game-actor.ts
git commit -m "game-main: the soldier arrives through the shared character view

Replaces held soldier tasks 6 and 7, which were 'mirrors lab-main's block' --
a fourth hand-copy of the same wiring. The game now calls the same module the
lab does, so the registry, the face-sheet trap, the kit and the prop have one
home.

Also deletes the brain() migration shim task 5 left behind: __sdfGame.brains()
now reads mind().debug() directly, which was that shim's stated exit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: the soldier's shot

This is held soldier task 8, landing on clean ground. Its full content is in
[the soldier plan](2026-09-06-soldier-shootback-ai.md) under "Task 8: The
shot" — follow it verbatim, with one change: the muzzle comes from
`cv.muzzle()` on the `CharacterView` rather than a `dressing` side-table, which
no longer exists.

Verified field names, do not "fix" them: `Projectile.ageSec` (not `age`),
`spawnPellets(origin, aimDir, barrels: 1 | 2, seed)`, and `nextSeed` is a
mutable number in `game-main`, not a function.

- [ ] **Step 1–6:** as the soldier plan's Task 8, then run the full suite, the
  four game gates, and commit.

**Phase A is complete here.** The soldier fights back in the game, the lab and
the game share one character path, and Phase B can be scheduled independently.

---

# PHASE B — `game-main`'s factory split

Each task below is the same shape: move one subsystem's bindings and functions
into a factory module, leave one handle in `main()`, verify nothing moved.

**The pattern**, for every task in this phase:

```ts
export interface GameWeapon {          // ← the handle main() keeps
  step(dt: number): void;
  /* the few methods main() actually calls */
}
export function createGameWeapon(opts: {...}): GameWeapon {
  /* the moved `let`s live here as closure state */
  return { step, /* ... */ };
}
```

This is the factory-closure pattern already used by `createZombieActor`,
`KitOverlay`, `GooLayer`, `HeldProp` and `WoundPanel`. `main()` is the one
place in the codebase that never adopted it.

**Every task in Phase B has the same gate**, so it is stated once here rather
than repeated eight times:

```bash
npm run build && npm test          # clean, NO test file edited
node scripts/sdf-game-crowd-gate.mjs
node scripts/sdf-game-bleed-gate.mjs
node scripts/sdf-game-slug-gate.mjs
node scripts/sdf-game-shorty-gate.mjs
scripts/refactor-baseline.sh /tmp/after-task-N
diff -rq docs/dev-notes/2026-09-06-refactor-baselines /tmp/after-task-N
```

Expected every time: suite clean, gate verdicts unchanged, **capture diff
empty**. And `git diff --stat` should show lines moved, not rewritten.

---

## Task 7: `game-fpv-weapon.ts`

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-fpv-weapon.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

- [ ] **Step 1: Move the bindings**

`aimRig`, `hingePivot`, `muzzleNodes`, `shellNodes`, `breechNodes`,
`extractorNode`, `topLeverNode`, `extractorRestZ`, and the rest of the weapon's
`let`s become closure state in `createGameFpvWeapon`.

- [ ] **Step 2: Move the functions, verbatim**

`viewToRig` (1483), `viewDirToRig` (1490), `aimArms` (1498), `locatorInView`
(1533), `breechInRig` (1550), `boreFrameInRig` (1564), `muzzleWorld` (1824),
`aimFrustum` (1856), `aimDir` (1860), `convergedDir` (1895), `startReload`
(1930), `fire` (1942), `predictSlugHitNow` (3348), `aimAtNearestSurface` (3411).

Comments move with them.

- [ ] **Step 3: Leave one handle in `main()`**

Eight `let`s become one `weapon`.

- [ ] **Step 4: Run the Phase B gate** (above). Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-fpv-weapon.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-fpv-weapon: the player's gun owns its own state

Eight lets and fourteen functions move out of main() behind one handle, using
the factory-closure pattern the rest of the codebase already uses. Captures
byte-identical.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: `game-chunks.ts`

Same shape as Task 7.

**Bindings:** `chunkBakeEnabled`, `bakedChunkMat`, `bakedChunkSeed`,
`totalBakes`, `lastBakeMs`, `lastBakeInfo`, `chunkObjects`, and the chunk pool.

**Functions:** `freeBaked` (2015), `cancelChunkBake` (2028), `finishChunkBake`
(2038), `gibBakedPiece` (2083), `gibChunkMeat` (2087), `primsLongAxis` (2113),
`spawnChunkPiece` (2124).

**Note:** `primsLongAxis` also exists in `lab-main` under the same name. Do not
try to share it in this task — note it and move on; a shared-helpers pass is
its own change.

- [ ] **Step 1: Move the bindings** — `chunkBakeEnabled`, `bakedChunkMat`,
  `bakedChunkSeed`, `totalBakes`, `lastBakeMs`, `lastBakeInfo`, `chunkObjects`
  and the chunk pool become closure state in `createGameChunks`.

- [ ] **Step 2: Move the functions verbatim, comments included** — `freeBaked`,
  `cancelChunkBake`, `finishChunkBake`, `gibBakedPiece`, `gibChunkMeat`,
  `primsLongAxis`, `spawnChunkPiece`. The settled-chunk-bake block at
  `game-main.ts:1153` carries a long comment recording the owner's 2026-09-05
  look verdict and the `GAME_CHUNK_BAKE=0` pixel-identity requirement; it moves
  with the code.

- [ ] **Step 3: One `chunks` handle in `main()`.**

- [ ] **Step 4: Run the Phase B gate** (stated once above the Phase B tasks).
  Expected: suite clean, four gate verdicts unchanged, capture diff empty.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-chunks.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-chunks: the bake and gib pool own their own state

Captures byte-identical; GAME_CHUNK_BAKE=0 still pixel-identical to main.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: `game-bleed.ts`

**Bindings:** the bleed registry, gut-rope list, spill state, `bleedRng`.

**Functions:** `spillVerdict` (2442), `stepGutRopes` (2469), `registerBleed`
(2526).

This module is what `CharacterView.attachBleed(sink)` receives, so **it must
implement `BleedSink`** as defined in Task 4 — `onWound(wound, kind)` and
`onSever(piece, stumpWound)`.

- [ ] **Step 1: Move the bindings** — the bleed registry, the gut-rope list,
  spill state and `bleedRng` become closure state in `createGameBleed`.
  `bleedRng` is one seeded stream for EVERY bleed decision (spawns, trails,
  splats); keep it single, and keep its comment.

- [ ] **Step 2: Move the functions verbatim, comments included** —
  `spillVerdict`, `stepGutRopes`, `registerBleed`.

- [ ] **Step 3: Implement `BleedSink` and wire it** — `createGameBleed` returns
  an object satisfying `BleedSink`, and `game-cast`'s spawn passes it to
  `cv.attachBleed(...)`. The lab still passes nothing.

- [ ] **Step 4: Run the Phase B gate**, paying particular attention to
  `sdf-game-bleed-gate.mjs` — this is the subsystem it exists to measure, so a
  moved verdict here is a real regression, not a threshold to adjust.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-bleed.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-bleed: emitters, ropes and spill own their own state

Implements the BleedSink seam character-view declares, so the game opts into
bleeding and the lab keeps having none. Bleed gate verdict unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: `game-cast.ts`

**Bindings:** `actors`, `nextId`, `onSeverDispatch`, `boneRatioOverride`.

**Functions:** `spawnEnemy`, `spawnAll`, `rebuildCast` (1241).

- [ ] **Step 1: Move the bindings** — `actors`, `nextId`, `onSeverDispatch`,
  `boneRatioOverride` become closure state in `createGameCast`.

- [ ] **Step 2: Move the functions verbatim, comments included** — `spawnEnemy`,
  `spawnAll`, `rebuildCast`. `rebuildCast` carries the comment about rebuilding
  through the SAME spawn path as boot so the wound panel's bone-ratio rebuild
  cannot drift; that invariant is the reason the function exists.

- [ ] **Step 3: One `cast` handle in `main()`**, exposing at minimum the actor
  list, `spawnAll`, `rebuildCast` and the sever dispatch registration.

- [ ] **Step 4: Run the Phase B gate.** `sdf-game-crowd-gate.mjs` is the one
  that exercises this module hardest — it spawns the full roster.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-cast.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-cast: the roster owns its own state

rebuildCast still routes through the same spawn path as boot -- the invariant
that keeps the wound panel's rebuild from drifting. Crowd gate unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: `game-tuning.ts`

**Bindings:** `probeWeight`, `parked`, `adaptiveEnabled`, `adaptiveBudgetMs`,
`adaptiveState`, `normalGradientMode`, `normalGradientDebug`, `boneMesh`,
`gooEnabled`, `panelsHidden`, `woundCullRequested`, `levelShadowEnabled`,
`hullExclusionsEnabled`, `occluderDesired`, `sdfScale`.

**Functions:** `applySdfScale` (507), `tickAdaptive` (548), `median` (569),
`applyBoneMesh` (891), `applyWoundRamp` (990), `woundTuningNow` (1006),
`applyWoundTuning` (1017), `pushProbeWeight` (1270).

- [ ] **Step 1: Move the bindings** — the fifteen listed above become closure
  state in `createGameTuning`.

- [ ] **Step 2: Move the functions verbatim, comments included.**
  `applyWoundRamp` carries the comment about the panel's ramp riding ON TOP of
  the material, because `applyMaterial` writes preset defaults and a rebuild
  would otherwise silently reset the ramp — "the silent-reset class of bug this
  panel exists to kill". That comment must survive the move intact.

- [ ] **Step 3: One `tuning` handle in `main()`.** The panels (`goo-panel`,
  `wound-panel`) talk to this handle rather than reaching into `main()`'s
  closure.

- [ ] **Step 4: Run the Phase B gate.** Tuning state feeds the GPU uniforms
  directly, so the **capture diff is the sensitive check here** — a wrong
  default shows up as a shifted image, not a failed test.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-tuning.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-tuning: panel glue owns its own state

Fifteen lets and eight functions behind one handle. The wound ramp still
re-stamps on top of applyMaterial's preset defaults -- the silent-reset bug
that panel exists to kill. Captures byte-identical.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: `tick()` — last, and on its own

**The single most dangerous task in this plan.** `tick(dt)` is ~700 lines
(2650–3348) and it is where the subsystems interleave.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

- [ ] **Step 1: Transcribe the current call order, literally**

With the modules from Tasks 7–11 in place, `tick` becomes a sequence of
`weapon.step(dt)`, `chunks.step(dt)`, `bleed.step(dt)`, `cast.step(dt)`,
`tuning.step(dt)` plus the code that does not belong to any of them.

**Do not reorder anything, for any reason** — not for readability, not for
grouping, not because an order looks wrong. Transcribe it.

- [ ] **Step 2: Write the comment that says why**

At the top of the extracted `tick`:

```ts
  // THE ORDER OF THESE CALLS IS LOAD-BEARING AND UNDOCUMENTED.
  //
  // It was transcribed literally from the pre-split tick() and has never been
  // derived from first principles. Nothing in the test suite or the capture
  // gate can catch a reordering: move bleed.step() ahead of chunks.step() and
  // every test passes, every capture is a single frame and looks identical,
  // and the bug surfaces as something subtly wrong in motion a week later.
  //
  // If you need to change this order, that is a real change with a real risk:
  // make it deliberately, in its own commit, and put it in front of the owner
  // in the running game. Do not tidy it.
```

- [ ] **Step 3: Phase B gate**

Run the full gate. Expected: clean, verdicts unchanged, capture diff empty.

**But note the limitation honestly:** a passing gate does NOT prove the
ordering survived. That is what Step 4 is for.

- [ ] **Step 4: OWNER PLAYTEST — the real gate for this commit**

Run `npm run dev` and have the owner play. The question is whether anything
feels different in motion, gore or weapon response. No automated check can
answer it, which is precisely why this task is last and alone.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game-main: tick() becomes a sequence of subsystem steps

Extracted LAST and alone, because the call ordering between subsystems is
load-bearing, undocumented, and invisible to every automated gate we have.
Transcribed literally from the pre-split tick with a comment saying so.

Owner playtested: no perceptible change in motion, gore or weapon response.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **A fresh worktree has no `node_modules`.** Symlink the main repo's before
  anything else, or every test command fails confusingly.
- **Moved, not rewritten.** If `git diff` shows a hunk that is not a move, ask
  why. "I improved it while I was there" is how a refactor becomes a bug.
- **Comments move with their code, unedited.** They record which bugs forced
  which constants. Summarizing them destroys the only record.
- **Task 4 is the only place a test may be edited**, and only a `lab-main`-facing
  one asserting old wound behaviour. Anywhere else, a test that needs changing
  is a finding — stop and report it.
- **Line numbers in this plan are from `game-main.ts` at commit `82cac86`** and
  will drift as tasks land. Locate functions by name, not by line.
- If a step says STOP, stop. Do not improvise past it.
