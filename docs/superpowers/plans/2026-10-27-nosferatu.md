# Nosferatu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A new arena enemy, the nosferatu: the cultist's body made bald, eared, clawed and coated, who casts a
swarm of eight shootable bats from his right palm at a player 4-14 m away and claws up close.

**Spec:** `docs/superpowers/specs/2026-10-27-nosferatu-design.md`. Read it first.

**Architecture:**
- **Pure modules hold the logic.** `bats.ts` steps the swarm; `caster-attack.ts` holds the cast's tuning, its fire
  edge, its pose and its glow envelope. `makeNosferatuMind` in `webgpu/enemy-mind.ts` is the gibbet's squirt mind
  laid over the zombie mind instead of the hound's.
- **The game wiring copies the gibbet's bile path exactly.** The profile's `spit` launches from the body. game-spawn's
  `onFire` pushes a swarm onto `ctx.weapon.bats`. game-tick steps it with the world's segment test, after the player's
  pellets have killed bats. `detonateAt` kills bats in a blast.
- **One instanced mesh draws the bats.** The wing flap is a hand-written WGSL vertex function, so the bats add no
  march cost. The palm glow borrows a slot of the explosion light pool and adds no new light.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest, headless-Chrome capture scripts
(`scripts/*.mjs`).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests**: no `three` import, plain data in, plain
    data out (the `burn-state`, `burn-behaviour`, `burn-room-light` pattern). The renderer-facing module only reads
    that logic's output and writes uniforms or objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string modules). TSL node graphs are for thin
    glue (binding, blending), not for the effect itself.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module, never as new `main()` bindings
    (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (seeded RNG, sim-time clocks, no wall-clock in logic) and keep console and
    capture seams in plain data.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is symlinked; do not reinstall.
- **Targeted tests only** (`npx vitest run <paths>`, or `npm run test:changed`) plus `npm run typecheck`. Never the
  full suite locally: CI runs it on every push (`gh run list --branch <branch>`).
- **Headless capture only.** The in-app browser pane loses the WebGPU device. Capture scripts require
  `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors.
- **Prove visual and performance claims with a number** (crop luminance, frame-to-frame change, GPU ms, boot time),
  and look at the images yourself.
- **Boot time is a gate.** A change that touches shaders or materials (Task 7) reports cold-boot `drawOnce` against
  the base branch, with a fresh profile each run.
- WebGPU:
  - Alpha goes in `colorNode.w`, never `alphaHash` or `alphaTest`.
  - Never toggle a light's `.visible`.
  - Never sample the render target you are writing.
  - In `march.wgsl.ts`'s positional uniform lists, never put a `:` inside a comment.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders; never commit them.
- Characters: follow the `authoring-sdf-characters` skill
  (`.claude/skills/authoring-sdf-characters/SKILL.md`) for every `.blob` edit and its look checks.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/characters/nosferatu.blob` | create | The body: the cultist's, bald, eared, clawed, coated |
| `src/lab/sdf-zombie/characters/nosferatu-blob.test.ts` | create | Structural pins: compiles, fused, head ≤ 20 prims, ears, incisors |
| `src/lab/sdf-zombie/character-registry.ts` | modify | The `nosferatu` entry |
| `src/lab/sdf-zombie/motion-profile.ts` | modify | `NOSFERATU_PROFILE`, the `caster` field |
| `src/lab/sdf-zombie/attack.ts` | modify | The `rake` and `cast` swing variants |
| `src/lab/sdf-zombie/caster-attack.ts` (+ `.test.ts`) | create | `NOSFERATU_TUNING`, `castFires`, `castPose`, `castGlow` |
| `src/lab/sdf-zombie/motion.ts` | modify | Route `cast` to `castPose` |
| `src/lab/sdf-zombie/bats.ts` (+ `.test.ts`) | create | The swarm: spawn, steer, nip, expire, shoot, blast, cap |
| `src/lab/sdf-zombie/webgpu/enemy-mind.ts` | modify | `makeNosferatuMind` |
| `src/lab/sdf-zombie/webgpu/enemy-mind-nosferatu.test.ts` | create | The mind's tests |
| `src/lab/sdf-zombie/webgpu/rng.ts` | modify | A fifth named stream, `bats` |
| `src/lab/sdf-zombie/webgpu/game-state-weapon.ts` | modify | `ctx.weapon.bats`, `ctx.weapon.batSwarms` |
| `src/lab/sdf-zombie/webgpu/game-spawn.ts` | modify | The caster's mind and `onFire` |
| `src/lab/sdf-zombie/webgpu/game-tick.ts` | modify | Pellets kill bats; step the swarm; nips; telemetry; draw |
| `src/lab/sdf-zombie/webgpu/game-dynamite-step.ts` | modify | A blast kills bats; the palm glow in the light pool |
| `src/lab/sdf-zombie/webgpu/game-seams-weapon-player.ts` | modify | A `bats` debug seam |
| `src/lab/sdf-zombie/bat-mesh.ts` (+ `.test.ts`) | create | The low-poly bat geometry as plain arrays |
| `src/lab/sdf-zombie/webgpu/bat-flap.wgsl.ts` | create | The wing flap vertex function |
| `src/lab/sdf-zombie/webgpu/bat-view.ts` | create | The one InstancedMesh |
| `scripts/nosferatu-detail-gen.ts` | create | The head's baked detail |
| `scripts/nosferatu-cast-capture.mjs` | create | Arena captures and the GIF frames |
| `docs/dev-notes/2026-10-27-nosferatu/NOTES.md` | create | Frames, numbers, cost table |

## Parallel lanes

Task 1, Task 3 and Task 6 touch disjoint files and can run at once. Task 2 needs nothing. Task 4 needs Task 2.
Task 5 needs Tasks 1-4. Task 7 needs Task 5. Task 8 needs Task 1's approved face. Task 9 needs all the rest.

Off-limits while lanes run in parallel:
- Task 1 must not touch `attack.ts`, `motion.ts` or anything under `webgpu/`.
- Task 3 must not touch anything but `bats.ts` and `bats.test.ts`.
- Task 6 must not touch anything but `bat-mesh.ts`, `bat-mesh.test.ts`, `webgpu/bat-flap.wgsl.ts` and
  `webgpu/bat-view.ts`.

---

## Task 1: The body

**Files:**
- Create: `src/lab/sdf-zombie/characters/nosferatu.blob` (copied from `cultist.blob`)
- Create: `src/lab/sdf-zombie/characters/nosferatu-blob.test.ts`
- Modify: `src/lab/sdf-zombie/motion-profile.ts` (a `NOSFERATU_PROFILE` and its `BY_NAME` row)
- Modify: `src/lab/sdf-zombie/character-registry.ts` (an import and an entry)
- Notes: `docs/dev-notes/2026-10-27-nosferatu/NOTES.md`

The cultist's head cluster is 24 prims, counted with `blob:inspect`. Deleting the hood shell (one prim), the peak
(one) and six of the eight teeth, then adding two ears, gives 24 - 1 - 1 - 6 + 2 = **18**.

- [ ] **Step 1: Write the failing blob test**

```ts
// src/lab/sdf-zombie/characters/nosferatu-blob.test.ts
//
// Pins the nosferatu's DESIGN INTENT (docs/superpowers/specs/2026-10-27-nosferatu-design.md §1): the cultist's body
// made bald, eared and clawed. Structural pins only; the read of the face took frames
// (docs/dev-notes/2026-10-27-nosferatu/).
import { describe, it, expect } from 'vitest';
import src from './nosferatu.blob?raw';
import cultistSrc from './cultist.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { fusedOf } from '../blob-checks';
import { characterEntry } from '../character-registry';
import { motionProfileFor } from '../motion-profile';

const build = (s: string) => { const d = parseBlob(s); return buildBody(compileBlob(d, compileFace(d))); };
const body = build(src);
const cultist = build(cultistSrc);
const head = (b: typeof body) => b.clusters.find(c => c.limb === 'head')!;
const headPrims = (b: typeof body) => { const c = head(b); return b.prims.slice(c.start, c.start + c.count); };
const crownY = Math.max(...body.prims.filter(p => p.bone === 'skull' && p.limb === 'head' && !p.shell)
  .map(p => Math.max(p.a[1], p.b[1])));

describe('nosferatu — build', () => {
  it('compiles clean and is registered', () => {
    expect(body.errors).toEqual([]);
    expect(characterEntry('nosferatu').name).toBe('nosferatu');
    expect(motionProfileFor('nosferatu').name).toBe('nosferatu');
  });

  it('is one body: arms, legs and head fuse to the torso', () => {
    const limb = (l: string) => body.clusters.find(c => c.limb === l)!;
    for (const l of ['armL', 'armR', 'legL', 'legR', 'head'])
      expect(fusedOf(body, limb(l), limb('torso')), l).toBeLessThan(0);
  });

  it('keeps his head at or under 20 prims (the cultist is 24: the cost note)', () => {
    expect(head(body).count).toBeLessThanOrEqual(20);
    expect(head(body).count).toBeLessThan(head(cultist).count);
  });

  it('is bald: no shell on the head, alive or dead', () => {
    expect(headPrims(body).filter(p => p.shell)).toEqual([]);
    expect(body.prims.filter(p => p.when === 'dead')).toEqual([]);
  });

  it('keeps the coat: skirt, capelet and two cuffs are shells', () => {
    const s = body.prims.filter(p => p.shell).map(p => `${p.limb}:${p.bone}`).sort();
    expect(s).toEqual(['armL:foreArm.l', 'armR:foreArm.r', 'torso:hem', 'torso:spine']);
  });

  it('has two pointed ears whose tips clear the crown', () => {
    const ears = headPrims(body).filter(p => p.chamfer && Math.abs(p.b[0]) > 0.07);
    expect(ears).toHaveLength(2);
    for (const e of ears) expect(Math.max(e.a[1], e.b[1])).toBeGreaterThan(crownY - 0.02);
  });

  it('has exactly two incisors, standing proud of the jaw', () => {
    const teeth = headPrims(body).filter(p => p.gloss !== undefined && p.gloss > 0);
    expect(teeth).toHaveLength(2);
    // The mouth is the dark bar across the jaw front (color 1a0605): the incisors hang IN FRONT of it and BELOW its
    // top edge, so they read over the lip.
    const mouth = headPrims(body).find(p => p.color === '1a0605')!;
    for (const t of teeth) {
      expect(Math.max(t.a[2], t.b[2])).toBeGreaterThan(Math.max(mouth.a[2], mouth.b[2]));
      expect(Math.min(t.a[1], t.b[1])).toBeLessThan(mouth.a[1]);
    }
  });

  it('has long claws: fingers about 1.3x the cultist\'s', () => {
    const fingerLen = (b: typeof body) => {
      const f = b.prims.filter(p => p.bone === 'foreArm.r' && p.r < 0.01 && p.r2 !== undefined);
      return Math.max(...f.map(p => Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2])));
    };
    expect(fingerLen(body) / fingerLen(cultist)).toBeGreaterThan(1.2);
  });
});
```

Before relying on the field names `p.chamfer`, `p.gloss`, `p.color`, `p.when`, `p.r2`, `p.a` and `p.b`, open
`build-body.ts`'s prim type and correct them to the real names in the same step. The pins stay the same.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/characters/nosferatu-blob.test.ts`
Expected: FAIL, because `./nosferatu.blob?raw` cannot be resolved.

- [ ] **Step 3: Copy the cultist and make the changes**

`cp src/lab/sdf-zombie/characters/cultist.blob src/lab/sdf-zombie/characters/nosferatu.blob`, then edit the copy:

1. **The header.** Replace lines 1-40 with a short header that names the spec, says he is the cultist's body as of
   `3eea8641`, and lists what changed. The line `model cultist` becomes `model nosferatu`.
2. **More hunched.** In the skeleton, `spine pitch=4` becomes `pitch=12` and `neck pitch=16` becomes `pitch=26`, so
   the head leads. Keep `hem`.
3. **Delete the hood.** Delete the hood shell (line 171, `shell head on skull ... shroud=0.85 ... when=alive`), the
   drape (line 179, `shell torso on neck ... when=alive`), the peak (line 196), the two `when=dead` hood-down blobs
   (lines 204-205), and their comment blocks.
4. **The dome.** In the `face` block, `headHeight 1.02` becomes `1.22` and `headWidth 0.72` becomes `0.64`, giving a
   tall, narrow skull. Keep the jaw values.
5. **A heavier, lower brow.** In the brow `bar`, `r=0.015` becomes `r=0.019` and `offset=(0.006,-0.008,0.093)`
   becomes `offset=(0.006,-0.014,0.096)`.
6. **The ears.** Add, after the cheekbones:
   ```
   # EARS — swept up and back past the crown: a tapered chamfered cone each side (r 0.020 -> 0.002), rooted in the
   # side of the skull at eye height and reaching 9 cm up and 6 cm back. Thin (deep=0.45) so they read as a flap.
   blob head on skull at=0.50 r=0.020 r2=0.002 deep=0.45 blend=0.006 chamfer offset=(0.074,0.000,0.010) tip=(0.030,0.090,-0.060) bend=(0.010,0,0) both
   ```
7. **The teeth.** Delete the four `both` tooth lines (eight prims) and add one `both` pair of incisors:
   ```
   # INCISORS — two long rat teeth side by side at the centre of the upper jaw, hanging over the lip: 2.6 cm long,
   # 7 mm apart. Dirty ivory, low gloss (the cultist's tooth colour).
   blob head on skull at=0.50 r=0.0065 r2=0.0030 wide=1.30 deep=0.70 blend=0.002 chamfer offset=(0.0035,-0.090,0.124) tip=(0,-0.026,0.004) both color=8f8266 gloss=0.15
   ```
8. **The claws.** Each of the four finger `bar`s on `foreArm` gets its `tip=` scaled by 1.3. For example, the first
   becomes `tip=(0.005,-0.110,0.039)`. Add a nail after each finger line: a `blob` at the scaled tip, `r=0.006 r2=0.001`,
   `chamfer`, pointing on along the finger by 2 cm, `color=2a2018`, `mirror`.
9. **The coat colour.** Every `color=6e5c40` (the robe) becomes `color=24221f` (charcoal). The flesh is untouched.
10. **The skin.** In `palette`, `baseColor 0.20 0.21 0.17` becomes `0.62 0.62 0.64` (grey-white), `mottleColor` becomes
    `0.36 0.24 0.42` (violet bruising), and `mottleAmp` becomes `0.55`. Add two painted socket bruises: the socket
    blob's `color=140a08` becomes `color=3a2440`, and its `r=0.018` becomes `r=0.022`.

- [ ] **Step 4: The profile**

In `motion-profile.ts`, after `CULTIST_PROFILE`, add the following. Also add `GLIDE` to the `./gait` import, and add
`nosferatu: NOSFERATU_PROFILE,` to `BY_NAME`.

```ts
/** The nosferatu (characters/nosferatu.blob, spec 2026-10-27-nosferatu-design.md): the cultist's body, bald and
 *  coated, on the GLIDE with the zombie's reaching arms (no gun). Not soft: a gore body that bleeds, so his coat
 *  tears (damage.ts clothifyWound) instead of taking decals. Casts a bat swarm from his right palm (`caster`, `spit`). */
export const NOSFERATU_PROFILE: MotionProfile = {
  ...ZOMBIE_PROFILE,
  name: 'nosferatu',
  gait: { walk: GLIDE, run: GLIDE },
};
```

The `caster` and `spit` fields arrive in Task 5. They are not added here.

- [ ] **Step 5: The registry entry**

In `character-registry.ts`, add `import nosferatuBlobSrc from './characters/nosferatu.blob?raw';` beside the cultist
imports. Then add after the `'cultist-cowled'` entry:

```ts
  // The nosferatu (docs/superpowers/specs/2026-10-27-nosferatu-design.md): the cultist's body, bald with pointed
  // ears, two rat incisors and long claws, in a charcoal coat. Flesh + shell cloth, no kit. Casts a bat swarm.
  nosferatu: {
    name: 'nosferatu', src: nosferatuBlobSrc,
    face: ZOMBIE_FLAT,
    profile: motionProfileFor('nosferatu'),
  },
```

- [ ] **Step 6: Run the test, then tune until it passes**

Run: `npx vitest run src/lab/sdf-zombie/characters/nosferatu-blob.test.ts src/lab/sdf-zombie/character-registry.test.ts`
Expected: PASS.
- If the ear pin fails, raise the ear `tip` y.
- If the fuse pin fails on the head, check that `bar head on neck` survived the hood deletion.
- Report the head count you got (18 is expected).

- [ ] **Step 7: Look at him**

Run:
```bash
npm run blob:shot -- nosferatu docs/dev-notes/2026-10-27-nosferatu/turntable 8
```
Look at all eight frames. Check four things: the ears clear the dome in profile, the incisors read at the front, the
claws read as longer than fingers, and the coat reads as charcoal and not black. Also run the arena:
`npx vite`, then capture `sdf-game.html?level=arena&spawn=nosferatu&seed=1&loader=0&frozen=1` front and side with the
capture pattern of `docs/dev-notes/2026-10-27-skeleton-cloak-cost/arena-cost.mjs` (take it from PR #87's branch,
`git show origin/claude/skeleton-cloak-cost:docs/dev-notes/2026-10-27-skeleton-cloak-cost/arena-cost.mjs`). Kill vite.

- [ ] **Step 8: Notes and commit**

Write `docs/dev-notes/2026-10-27-nosferatu/NOTES.md` covering the prim count, what changed from the cultist, and the
frames. Then:
```bash
git add src/lab/sdf-zombie/characters/nosferatu.blob src/lab/sdf-zombie/characters/nosferatu-blob.test.ts \
  src/lab/sdf-zombie/motion-profile.ts src/lab/sdf-zombie/character-registry.ts docs/dev-notes/2026-10-27-nosferatu
git commit -m "feat(nosferatu): the cultist's body, bald and eared, clawed, in a charcoal coat"
```

- [ ] **Step 9: The owner's verdict on the face (gate)**

Show the owner the turntable and the arena frames. Task 8 (the detail map) waits on a yes. The spell tasks do not:
they are judged after the face, but they can be built meanwhile.

---

## Task 2: The cast and the rake, as poses

**Files:**
- Create: `src/lab/sdf-zombie/caster-attack.ts`
- Create: `src/lab/sdf-zombie/caster-attack.test.ts`
- Modify: `src/lab/sdf-zombie/attack.ts` (the `SwingVariant` union and `SWING_ARCS`)
- Modify: `src/lab/sdf-zombie/motion.ts:785-790` (route `cast`)

The spec asks for a two-handed rake. The zombie's swing is one arm at a time with the other held in a guard
(`attack.ts`), and the brain alternates arms between swings. So the rake here is a raised one-arm claw swipe that
alternates hands, and two swings in a row use both claws. A true two-arm pose would be a separate pose function, like
`houndPose`. Don't build one unless the owner asks for it after seeing the GIF.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/caster-attack.test.ts
import { describe, it, expect } from 'vitest';
import { NOSFERATU_TUNING, castFires, castGlow, castPose } from './caster-attack';
import { SWING_ARCS, attackPose } from './attack';

describe('the cast', () => {
  it('fires exactly once, on the frame the phase crosses fireAt', () => {
    let n = 0, prev = 0;
    for (let p = 0; p <= 1.0001; p += 1 / 54) { if (castFires(prev, p)) n++; prev = p; }
    expect(n).toBe(1);
    expect(castFires(0.69, 0.71)).toBe(true);
    expect(castFires(0.71, 0.75)).toBe(false);
  });

  it('leaves about 0.6 s of tell', () => {
    expect(NOSFERATU_TUNING.castSec * NOSFERATU_TUNING.fireAt).toBeGreaterThan(0.55);
    expect(NOSFERATU_TUNING.castSec * NOSFERATU_TUNING.fireAt).toBeLessThan(0.7);
  });

  it('the pose is exactly zero at phase 0 and 1', () => {
    for (const p of [0, 1]) {
      const pose = castPose(p);
      expect(pose.rootOffset).toEqual([0, 0, 0]);
      expect(pose.reach).toEqual({ pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 });
      for (const v of Object.values(pose.offsets)) expect(v).toEqual([0, 0, 0]);
    }
  });

  it('raises the right arm forward and tips the head back at the fire frame', () => {
    const pose = castPose(NOSFERATU_TUNING.fireAt);
    expect(pose.reach.pitchR).toBeGreaterThan(1.3);
    expect(pose.reach.pitchL).toBeLessThan(0.5);
    expect(pose.offsets.head![2]).toBeLessThan(-0.02);
    expect(pose.rootOffset).toEqual([0, 0, 0]);
  });

  it('the glow builds over the tell, peaks at the fire frame and is gone soon after', () => {
    expect(castGlow(0)).toBe(0);
    expect(castGlow(0.35)).toBeGreaterThan(0.2);
    expect(castGlow(0.35)).toBeLessThan(castGlow(0.65));
    expect(castGlow(NOSFERATU_TUNING.fireAt)).toBeCloseTo(1, 6);
    expect(castGlow(0.9)).toBe(0);
  });
});

describe('the rake', () => {
  it('is raised higher than the hook and the overhead at the wind-up', () => {
    expect(SWING_ARCS.rake.windupPitch).toBeGreaterThan(SWING_ARCS.overhead.windupPitch);
  });

  it('comes down and across through the strike', () => {
    expect(SWING_ARCS.rake.strikePitch).toBeLessThan(SWING_ARCS.rake.windupPitch - 1);
    expect(SWING_ARCS.rake.strikeYaw).toBeGreaterThan(0);
    expect(attackPose(0.4, 'R', 'rake').reach.pitchR).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lab/sdf-zombie/caster-attack.test.ts`
Expected: FAIL, because `./caster-attack` cannot be resolved.

- [ ] **Step 3: Add the variants to attack.ts**

In `attack.ts`, extend the union:

```ts
export type SwingVariant = 'hook' | 'overhead' | 'shove' | 'cleave' | 'sweep' | 'lunge'
  // The quadrupeds' (hound-attack.ts: the gorehound's, the gibbet's): motion.ts routes these to houndPose.
  | 'bite' | 'pounce' | 'stab' | 'squirt'
  // The gutcrawler's rear-and-slam (hound-attack.ts 'slam').
  | 'slam'
  // The nosferatu's (caster-attack.ts): a raised claw swipe, and the cast, which motion.ts routes to castPose.
  | 'rake' | 'cast';
```

In `SWING_ARCS`, after `slam`, add:

```ts
  // The nosferatu's claw rake: wound up HIGH (above the overhead's 1.35), the claws coming down and across the body.
  rake: { windupPitch: 1.65, strikePitch: 0.15, windupYaw: -0.45, strikeYaw: 0.55 },
  // The cast is not a swing: caster-attack.ts castPose owns it.
  cast: { windupPitch: 0, strikePitch: 0, windupYaw: 0, strikeYaw: 0 },
```

- [ ] **Step 4: Write caster-attack.ts**

```ts
// src/lab/sdf-zombie/caster-attack.ts
//
// The NOSFERATU's cast (characters/nosferatu.blob, spec 2026-10-27-nosferatu-design.md §2): he halts, raises his
// right palm at the player with the claws spread, the head tipping back, and a dark-red glow builds in the palm for
// ~0.6 s before the swarm leaves (bats.ts). Pure: the tuning, the fire edge, the pose and the glow envelope.
// webgpu/enemy-mind.ts makeNosferatuMind drives the phase; motion.ts composes castPose where it composes a swing.
import type { AttackPose } from './attack';
import type { Vec3 } from './types';

export const NOSFERATU_TUNING = {
  /** He casts at a player he can see between these distances (m); inside `min` he walks in and claws. */
  castBand: { min: 4, max: 14 },
  /** The whole cast, s. */
  castSec: 0.9,
  /** The swarm leaves at this phase: 0.63 s of tell. */
  fireAt: 0.7,
  /** Seconds between casts, and before the first once he is alert. */
  castCooldown: 5.0,
  castFirst: 1.5,
  /** The pose at full: the right arm's reach pitch (rad), its yaw toward the centre line, the left arm's low guard,
   *  the head tipped back (m, body-local -z), the chest leaning back with it. */
  armPitch: 1.45,
  armYaw: 0.25,
  offPitch: 0.25,
  headBack: 0.035,
  chestBack: 0.02,
} as const;

/** The swarm leaves this frame (prevPhase -> phase crosses fireAt). */
export function castFires(prevPhase: number, phase: number): boolean {
  const at = NOSFERATU_TUNING.fireAt;
  return prevPhase < at && phase >= at;
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** The pose's envelope: up over the first 30 %, held, down over the last 20 %. Exactly 0 at 0 and 1. */
function envelope(phase: number): number {
  if (phase <= 0 || phase >= 1) return 0;
  return smooth(phase / 0.3) * (1 - smooth((phase - 0.8) / 0.2));
}

const ZERO: Vec3 = [0, 0, 0];

/** The cast pose at `phase`, in attack.ts's contract (body-local offsets ADDED to the gait's; +z forward). */
export function castPose(phase: number): AttackPose {
  const T = NOSFERATU_TUNING;
  const e = envelope(phase);
  if (e === 0) {
    return {
      offsets: { chest: ZERO, neck: ZERO, head: ZERO },
      rootOffset: ZERO,
      reach: { pitchL: 0, pitchR: 0, yawL: 0, yawR: 0 },
    };
  }
  return {
    offsets: {
      chest: [0, 0, -T.chestBack * e],
      // The head tips BACK (body-local -z) and a little up; the neck carries half of it.
      neck: [0, 0.2 * T.headBack * e, -0.5 * T.headBack * e],
      head: [0, 0.4 * T.headBack * e, -T.headBack * e],
    },
    rootOffset: ZERO,
    reach: { pitchL: T.offPitch * e, pitchR: T.armPitch * e, yawL: 0, yawR: T.armYaw * e },
  };
}

/** The palm glow, 0..1: builds as phase^1.5 over the tell to 1 at the fire frame, then drops out over 0.1 of a
 *  phase as the swarm leaves. */
export function castGlow(phase: number): number {
  const at = NOSFERATU_TUNING.fireAt;
  if (phase <= 0) return 0;
  if (phase <= at) return Math.pow(phase / at, 1.5);
  return Math.max(0, 1 - (phase - at) / 0.1);
}
```

- [ ] **Step 5: Route `cast` in motion.ts**

Add `import { castPose } from './caster-attack';` beside the hound import, and change the attack composition
(around line 786) to:

```ts
  const attack: AttackPose | null =
    cfg.attack !== undefined && !collapsed
      ? isHoundVariant(cfg.attack.variant)
        ? houndPose(cfg.attack.phase, cfg.attack.variant, cfg.attack.side)
        : cfg.attack.variant === 'cast'
          ? castPose(cfg.attack.phase)
          : attackPose(cfg.attack.phase, cfg.attack.side, cfg.attack.variant)
      : null;
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/caster-attack.test.ts src/lab/sdf-zombie/attack.test.ts src/lab/sdf-zombie/hound-attack.test.ts && npm run typecheck`
Expected: PASS. `attack.test.ts` may iterate every variant in `SWING_ARCS` (for example, the flat-arc ratio). If it
fails on `cast`, which has no travel, exclude `cast` beside the quadruped variants it already excludes. Do not loosen
the ratio.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/caster-attack.ts src/lab/sdf-zombie/caster-attack.test.ts src/lab/sdf-zombie/attack.ts src/lab/sdf-zombie/motion.ts
git commit -m "feat(nosferatu): the cast pose, its fire edge and glow, and the claw rake"
```

---

## Task 3: The bat swarm (pure)

**Files:**
- Create: `src/lab/sdf-zombie/bats.ts`
- Create: `src/lab/sdf-zombie/bats.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/bats.test.ts
import { describe, it, expect } from 'vitest';
import { BATS, addSwarm, blastBats, castSwarm, hitBat, killBat, stepBats, type Bat, type BatWorld } from './bats';
import { mulberry32 } from './melt-bones';
import type { Vec3 } from './types';

const open: BatWorld = { blocked: () => false };
const floorAt0: BatWorld = { blocked: (_f, t) => t[1] <= 0.02 };
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const run = (bats: Bat[], secs: number, target: Vec3, world = open, seed = 7) => {
  const rng = mulberry32(seed);
  const nips: number[] = [];
  let live = bats;
  for (let i = 0; i < secs * 60; i++) {
    const s = stepBats(live, 1 / 60, target, world, rng);
    live = s.live; nips.push(s.nips.length);
  }
  return { live, nips: nips.reduce((a, b) => a + b, 0) };
};

describe('bats — spawn', () => {
  it('a cast releases eight live seeking bats at the palm', () => {
    const b = castSwarm([0, 1.5, 0], [0, 1.6, 8], 3, 1, mulberry32(1));
    expect(b).toHaveLength(BATS.perCast);
    for (const x of b) {
      expect(x.state).toBe('seek');
      expect(dist(x.pos, [0, 1.5, 0])).toBeLessThan(BATS.spawnSpread * 2);
      expect(x.owner).toBe(3);
    }
  });
});

describe('bats — flight', () => {
  it('converges on a still target', () => {
    const target: Vec3 = [0, 1.6, 6];
    const b = castSwarm([0, 1.5, 0], target, 1, 1, mulberry32(2));
    const before = Math.min(...b.map(x => dist(x.pos, target)));
    // Short of the first nip: 0.6 s at most 6 m/s.
    const { live } = run(b, 0.6, target);
    expect(Math.min(...live.map(x => dist(x.pos, target)))).toBeLessThan(before - 1.5);
  });

  it('never flies faster than the clamp', () => {
    const { live } = run(castSwarm([0, 1.5, 0], [0, 1.6, 10], 1, 1, mulberry32(3)), 1, [0, 1.6, 10]);
    for (const x of live) expect(Math.hypot(...x.vel)).toBeLessThanOrEqual(BATS.speed + 1e-6);
  });

  it('separation keeps the swarm apart', () => {
    const { live } = run(castSwarm([0, 1.5, 0], [0, 1.6, 10], 1, 1, mulberry32(4)), 1, [0, 1.6, 10]);
    let close = 0;
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++)
      if (dist(live[i]!.pos, live[j]!.pos) < BATS.separation * 0.4) close++;
    expect(close).toBe(0);
  });

  it('never passes through a wall: it slides along it', () => {
    const wall: BatWorld = { blocked: (f, t) => (f[2] < 3) !== (t[2] < 3) };
    const { live } = run(castSwarm([0, 1.5, 0], [0, 1.6, 6], 1, 1, mulberry32(5)), 2, [0, 1.6, 6], wall);
    for (const x of live) expect(x.pos[2]).toBeLessThan(3);
  });
});

describe('bats — contact and lifetime', () => {
  it('a bat in reach nips once, then retreats and comes back', () => {
    const target: Vec3 = [0, 1.6, 0.2];
    const b: Bat[] = [{ ...castSwarm([0, 1.6, 0], target, 1, 1, mulberry32(6))[0]!, pos: [0, 1.6, 0], vel: [0, 0, 0] }];
    const s = stepBats(b, 1 / 60, target, open, mulberry32(6));
    expect(s.nips).toHaveLength(1);
    expect(s.live[0]!.state).toBe('retreat');
    const back = run(s.live, BATS.retreatSec + 0.05, target);
    expect(back.live[0]!.state === 'seek' || back.nips > 0).toBe(true);
  });

  it('a whole swarm landing is about 32 damage', () => {
    expect(BATS.perCast * BATS.nipDamage).toBe(32);
  });

  it('after lifeSec a bat disperses, does no damage, and is gone', () => {
    const target: Vec3 = [0, 1.6, 30];
    const { live } = run(castSwarm([0, 1.5, 0], target, 1, 1, mulberry32(8)), BATS.lifeSec + 0.1, target);
    for (const x of live) expect(x.state).toBe('disperse');
    const after = run(live, BATS.disperseSec + 0.1, [0, 1.6, 0]);
    expect(after.live).toEqual([]);
    expect(after.nips).toBe(0);
  });
});

describe('bats — shooting', () => {
  it('a segment through a bat finds it (nearest first); the round stops there', () => {
    const b = castSwarm([0, 1.5, 0], [0, 1.6, 8], 1, 1, mulberry32(9)).map((x, i) => ({ ...x, pos: [0, 1.5, 2 + i] as Vec3 }));
    expect(hitBat(b, [0, 1.5, -1], [0, 1.5, 20])).toBe(0);
    expect(hitBat(b, [1, 1.5, -1], [1, 1.5, 20])).toBe(-1);
    expect(hitBat(b, [0, 1.5 + BATS.hitRadius * 0.9, 1], [0, 1.5 + BATS.hitRadius * 0.9, 2.5])).toBe(0);
  });

  it('a killed bat falls, bounces once and is removed after deadSec', () => {
    const b = [killBat({ ...castSwarm([0, 1.5, 0], [0, 1.6, 8], 1, 1, mulberry32(10))[0]!, pos: [0, 1.0, 2] })];
    expect(hitBat(b, [0, 1.0, 0], [0, 1.0, 5])).toBe(-1);
    const mid = run(b, 1, [0, 1.6, 8], floorAt0);
    expect(mid.live[0]!.pos[1]).toBeLessThan(0.1);
    expect(mid.live[0]!.bounced).toBe(true);
    expect(run(b, BATS.deadSec + 0.1, [0, 1.6, 8], floorAt0).live).toEqual([]);
  });

  it('a blast kills every live bat within its radius and no other', () => {
    const b = castSwarm([0, 1.5, 0], [0, 1.6, 8], 1, 1, mulberry32(11)).map((x, i) => ({ ...x, pos: [i, 1.5, 0] as Vec3 }));
    const { bats, killed } = blastBats(b, [0, 1.5, 0], 3.5);
    expect(killed).toBe(4);
    expect(bats.filter(x => x.state === 'dead')).toHaveLength(4);
  });
});

describe('bats — the cap and determinism', () => {
  it('never holds more than maxLive; the oldest go first', () => {
    let all: Bat[] = [];
    for (let k = 0; k < 8; k++) all = addSwarm(all, castSwarm([0, 1.5, 0], [0, 1.6, 8], 1, k, mulberry32(k)));
    expect(all).toHaveLength(BATS.maxLive);
    expect(Math.min(...all.map(x => x.swarm))).toBe(2);
  });

  it('a seeded run replays exactly', () => {
    const go = () => run(castSwarm([0, 1.5, 0], [0, 1.6, 8], 1, 1, mulberry32(12)), 3, [0.5, 1.6, 6], open, 99).live;
    expect(go()).toEqual(go());
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lab/sdf-zombie/bats.test.ts`
Expected: FAIL, because `./bats` cannot be resolved.

- [ ] **Step 3: Write bats.ts**

```ts
// src/lab/sdf-zombie/bats.ts
//
// The NOSFERATU's BAT SWARM (spec 2026-10-27-nosferatu-design.md §3): eight bats released from his palm
// (caster-attack.ts) that flock at the player's head, nip and retreat, and scatter after six seconds. Every bat dies
// to one hit: a pellet, slug or SMG round stops on the first bat it meets (hitBat), a blast kills every bat in its
// radius (blastBats). Plain data like bile.ts: no three, no clock of its own, no world of its own; game-tick steps it
// with the world's segment test and webgpu/bat-view.ts draws it. Every random draw comes from the `rng` passed in, in
// a fixed order, so a seeded run replays the same swarm.
import type { Vec3 } from './types';

export const BATS = {
  /** Bats per cast. */
  perCast: 8,
  /** The most alive in the level at once (six casts): bat-view's instance count. */
  maxLive: 48,
  /** Top speed, m/s: a running player outpaces them for a while. */
  speed: 6,
  /** Launch speed out of the palm, m/s, and the spread of the launch points, m. */
  launchSpeed: 3,
  spawnSpread: 0.15,
  /** Steering gains, 1/s^2-ish: seek toward the head, cohesion toward the swarm's centre. */
  seekGain: 6,
  cohesionGain: 1.5,
  /** Separation: bats closer than this push apart with this gain. */
  separation: 0.25,
  separationGain: 40,
  /** Seeded flutter, m/s^2 per axis. */
  jitter: 9,
  /** A seeking bat this close to the player's head nips. */
  nipReach: 0.35,
  /** Damage per nip (player-vitals.ts scale: a zombie bite is 10). */
  nipDamage: 4,
  /** After a nip: fly off and up for this long, at this speed. */
  retreatSec: 0.6,
  retreatSpeed: 4,
  /** A bat's life before it disperses, s; dispersing (up and away, shrinking out), s. */
  lifeSec: 6,
  disperseSec: 1.0,
  /** Shot radius, m: generous for a small target. */
  hitRadius: 0.12,
  /** A dead bat: gravity, the one bounce's restitution, removed after this long. */
  gravity: 9.8,
  bounce: 0.3,
  deadSec: 3,
  /** Wingbeats per second (bat-view's flap phase). */
  flapHz: 9,
} as const;

export type BatState = 'seek' | 'retreat' | 'disperse' | 'dead';

export interface Bat {
  pos: Vec3;
  vel: Vec3;
  /** Wing phase, 0..1, advanced at flapHz (frozen when dead: wings folded). */
  flap: number;
  /** Seconds since the cast. */
  age: number;
  state: BatState;
  /** Seconds in the current state. */
  stateSec: number;
  /** Which cast it came from: cohesion pulls toward its own swarm's centre; the cap drops the oldest swarm first. */
  swarm: number;
  /** Actor id of the caster. */
  owner: number;
  /** A dead bat has bounced off the floor once. */
  bounced: boolean;
}

export interface BatWorld {
  /** True when the segment crosses solid level geometry (walls, floor, ceiling, furniture). */
  blocked(from: Vec3, to: Vec3): boolean;
}

export interface Nip { at: Vec3; owner: number }

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 0]; };
const clampLen = (a: Vec3, max: number): Vec3 => { const l = len(a); return l > max ? mul(a, max / l) : a; };

/** One cast's bats at `origin`, launched toward `toward`. */
export function castSwarm(origin: Vec3, toward: Vec3, owner: number, swarm: number, rng: () => number): Bat[] {
  const dir = norm(sub(toward, origin));
  const out: Bat[] = [];
  for (let i = 0; i < BATS.perCast; i++) {
    const o: Vec3 = [(rng() - 0.5) * 2 * BATS.spawnSpread, (rng() - 0.5) * 2 * BATS.spawnSpread, (rng() - 0.5) * 2 * BATS.spawnSpread];
    const fan: Vec3 = [(rng() - 0.5), (rng() - 0.5) * 0.6, (rng() - 0.5)];
    out.push({
      pos: add(origin, o), vel: mul(norm(add(dir, fan)), BATS.launchSpeed), flap: rng(),
      age: 0, state: 'seek', stateSec: 0, swarm, owner, bounced: false,
    });
  }
  return out;
}

/** Merge a fresh swarm in under the cap: past maxLive, the oldest dispersing or dead bats go first, then the oldest
 *  of any state. */
export function addSwarm(bats: readonly Bat[], fresh: readonly Bat[]): Bat[] {
  const all = [...bats, ...fresh];
  const over = all.length - BATS.maxLive;
  if (over <= 0) return all;
  const rank = (b: Bat) => (b.state === 'dead' || b.state === 'disperse' ? 1e6 : 0) + b.age;
  const drop = new Set([...all.keys()].filter(i => i < bats.length).sort((a, b) => rank(all[b]!) - rank(all[a]!)).slice(0, over));
  return all.filter((_, i) => !drop.has(i));
}

/** Move `b` by `vel * dt`, sliding along whatever blocks it: a blocked axis loses its share of the move and of the
 *  velocity. */
function slide(b: Bat, vel: Vec3, dt: number, world: BatWorld): { pos: Vec3; vel: Vec3; hitFloor: boolean } {
  const to = add(b.pos, mul(vel, dt));
  if (!world.blocked(b.pos, to)) return { pos: to, vel, hitFloor: false };
  const pos: Vec3 = [...b.pos] as Vec3;
  const v: Vec3 = [...vel] as Vec3;
  let hitFloor = false;
  for (const axis of [1, 0, 2] as const) {
    const next: Vec3 = [...pos] as Vec3;
    next[axis] += vel[axis] * dt;
    if (world.blocked(pos, next)) { if (axis === 1 && vel[1] < 0) hitFloor = true; v[axis] = 0; } else pos[axis] = next[axis];
  }
  return { pos, vel: v, hitFloor };
}

/** Advance every bat one step toward `target` (the player's head). Returns the survivors and this step's nips. */
export function stepBats(bats: readonly Bat[], dt: number, target: Vec3, world: BatWorld, rng: () => number): { live: Bat[]; nips: Nip[] } {
  const live: Bat[] = [];
  const nips: Nip[] = [];
  const centre = new Map<number, { sum: Vec3; n: number }>();
  for (const b of bats) {
    if (b.state !== 'seek' && b.state !== 'retreat') continue;
    const c = centre.get(b.swarm) ?? { sum: [0, 0, 0] as Vec3, n: 0 };
    c.sum = add(c.sum, b.pos); c.n++;
    centre.set(b.swarm, c);
  }
  for (let i = 0; i < bats.length; i++) {
    const b = bats[i]!;
    const age = b.age + dt;
    let stateSec = b.stateSec + dt;
    if (b.state === 'dead') {
      if (stateSec >= BATS.deadSec) continue;
      let vel: Vec3 = [b.vel[0], b.vel[1] - BATS.gravity * dt, b.vel[2]];
      const m = slide(b, vel, dt, world);
      let bounced = b.bounced;
      vel = m.vel;
      if (m.hitFloor && !bounced) { vel = [b.vel[0] * 0.5, -b.vel[1] * BATS.bounce, b.vel[2] * 0.5]; bounced = true; }
      else if (m.hitFloor) vel = [0, 0, 0];
      live.push({ ...b, pos: m.pos, vel, age, stateSec, bounced });
      continue;
    }
    if (b.state === 'disperse') {
      if (stateSec >= BATS.disperseSec) continue;
      const away = norm([b.pos[0] - target[0], 0, b.pos[2] - target[2]]);
      const vel = clampLen(add(b.vel, mul(add(mul(away, 6), [0, 8, 0]), dt)), BATS.speed);
      const m = slide(b, vel, dt, world);
      live.push({ ...b, pos: m.pos, vel: m.vel, age, stateSec, flap: (b.flap + BATS.flapHz * dt) % 1 });
      continue;
    }
    // seek / retreat: three jitter draws per bat per step, always, in this order.
    const jitter: Vec3 = [(rng() - 0.5) * 2 * BATS.jitter, (rng() - 0.5) * 2 * BATS.jitter, (rng() - 0.5) * 2 * BATS.jitter];
    let state: BatState = b.state;
    if (age >= BATS.lifeSec) { state = 'disperse'; stateSec = 0; }
    else if (state === 'retreat' && stateSec >= BATS.retreatSec) { state = 'seek'; stateSec = 0; }
    let accel: Vec3 = jitter;
    if (state === 'seek') {
      accel = add(accel, mul(sub(mul(norm(sub(target, b.pos)), BATS.speed), b.vel), BATS.seekGain));
      const c = centre.get(b.swarm);
      if (c && c.n > 1) accel = add(accel, mul(sub(mul(c.sum, 1 / c.n), b.pos), BATS.cohesionGain));
    } else if (state === 'retreat') {
      const away = norm([b.pos[0] - target[0], 0, b.pos[2] - target[2]]);
      accel = add(accel, mul(sub(mul(norm(add(away, [0, 0.8, 0])), BATS.retreatSpeed), b.vel), BATS.seekGain));
    }
    for (let j = 0; j < bats.length; j++) {
      if (j === i) continue;
      const o = bats[j]!;
      if (o.state === 'dead') continue;
      const d = sub(b.pos, o.pos);
      const l = len(d);
      if (l < BATS.separation && l > 1e-6) accel = add(accel, mul(d, ((BATS.separation - l) / BATS.separation) * BATS.separationGain / l));
    }
    const vel = clampLen(add(b.vel, mul(accel, dt)), BATS.speed);
    const m = slide(b, vel, dt, world);
    const flap = (b.flap + BATS.flapHz * dt) % 1;
    if (state === 'seek' && len(sub(m.pos, target)) <= BATS.nipReach) {
      nips.push({ at: m.pos, owner: b.owner });
      live.push({ ...b, pos: m.pos, vel: m.vel, flap, age, state: 'retreat', stateSec: 0 });
      continue;
    }
    live.push({ ...b, pos: m.pos, vel: m.vel, flap, age, state, stateSec });
  }
  return { live, nips };
}

/** The first live bat along the segment from -> to within hitRadius (nearest to `from`), or -1. */
export function hitBat(bats: readonly Bat[], from: Vec3, to: Vec3): number {
  const d = sub(to, from);
  const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  let best = -1, bestT = Infinity;
  for (let i = 0; i < bats.length; i++) {
    const b = bats[i]!;
    if (b.state === 'dead') continue;
    const t = Math.max(0, Math.min(1, ((b.pos[0] - from[0]) * d[0] + (b.pos[1] - from[1]) * d[1] + (b.pos[2] - from[2]) * d[2]) / l2));
    const q = sub(add(from, mul(d, t)), b.pos);
    if (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] <= BATS.hitRadius * BATS.hitRadius && t < bestT) { best = i; bestT = t; }
  }
  return best;
}

/** The bat, dead: it drops (keeping a little of its momentum) with its wings folded. */
export function killBat(b: Bat): Bat {
  return { ...b, state: 'dead', stateSec: 0, vel: mul(b.vel, 0.3), bounced: false };
}

/** Every live bat within `radius` of `at`, killed. */
export function blastBats(bats: readonly Bat[], at: Vec3, radius: number): { bats: Bat[]; killed: number } {
  let killed = 0;
  const out = bats.map(b => {
    if (b.state === 'dead' || len(sub(b.pos, at)) > radius) return b;
    killed++;
    return killBat(b);
  });
  return { bats: out, killed };
}
```

- [ ] **Step 4: Run the tests and tune**

Run: `npx vitest run src/lab/sdf-zombie/bats.test.ts`
Expected: PASS. If a flight test fails, tune `seekGain`, `separationGain` or `jitter`, never the test's thresholds, and
note which knob moved. In the cap test, eight swarms of eight under a cap of 48 keep swarms 2-7.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/bats.ts src/lab/sdf-zombie/bats.test.ts
git commit -m "feat(bats): the nosferatu's swarm: flock, nip, retreat, disperse, one hit kills"
```

---

## Task 4: The caster mind

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/enemy-mind.ts` (after `makeGibbetMind`)
- Create: `src/lab/sdf-zombie/webgpu/enemy-mind-nosferatu.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/enemy-mind-nosferatu.test.ts
import { describe, it, expect } from 'vitest';
import { makeNosferatuMind, type MindInput } from './enemy-mind';
import { NOSFERATU_TUNING } from '../caster-attack';

const input = (dist: number, over: Partial<MindInput> = {}): MindInput => ({
  dt: 1 / 60, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: dist, room: 1 },
  alerted: true, hasToken: true, drift: 0, roll: 0.2, rollDrift: 0.5, ...over,
});

const castsIn = (secs: number, dist: number, over: Partial<MindInput> = {}) => {
  const mind = makeNosferatuMind();
  let casts = 0, fired = 0, was = false;
  for (let i = 0; i < secs * 60; i++) {
    const out = mind.step(input(dist, over));
    const casting = out.attack?.variant === 'cast';
    if (casting) { expect(out.halt).toBe(true); expect(out.faceHeading).toBeCloseTo(0, 6); }
    if (casting && !was) casts++;
    was = casting;
    if (out.fire) fired++;
  }
  return { casts, fired };
};

describe('makeNosferatuMind', () => {
  const T = NOSFERATU_TUNING;
  const two = T.castFirst + 2 * T.castSec + T.castCooldown + 0.5;

  it('casts at a seen player in the band: halts, faces, one swarm per cast, then cools down', () => {
    expect(castsIn(two, 8)).toEqual({ casts: 2, fired: 2 });
  });

  it('does not cast inside the band\'s min or past its max', () => {
    expect(castsIn(two, T.castBand.min - 0.5).fired).toBe(0);
    expect(castsIn(two, T.castBand.max + 1).fired).toBe(0);
  });

  it('does not cast at a player it cannot see', () => {
    expect(castsIn(two, 8, { lineOfSight: false }).fired).toBe(0);
  });

  it('claws a player in reach with the rake, never casting', () => {
    const mind = makeNosferatuMind();
    let raked = false, fired = 0;
    for (let i = 0; i < 240; i++) {
      const out = mind.step(input(1.0));
      if (out.attack) { expect(out.attack.variant).toBe('rake'); raked = true; }
      if (out.fire) fired++;
    }
    expect(raked).toBe(true);
    expect(fired).toBe(0);
  });

  it('a stagger cancels a cast before the swarm leaves', () => {
    const mind = makeNosferatuMind();
    let fired = 0, staggered = false;
    for (let i = 0; i < (T.castFirst + T.castSec + 0.3) * 60; i++) {
      const out = mind.step(input(8));
      if (out.attack?.variant === 'cast' && !staggered && out.attack.phase > 0.3) { mind.stagger(); staggered = true; }
      if (out.fire) fired++;
    }
    expect(staggered).toBe(true);
    expect(fired).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/enemy-mind-nosferatu.test.ts`
Expected: FAIL, because `makeNosferatuMind` is not exported.

- [ ] **Step 3: Write the mind**

In `enemy-mind.ts`, add `import { NOSFERATU_TUNING, castFires } from '../caster-attack';` to the imports, and add
after `makeGibbetMind`:

```ts
/** The NOSFERATU (characters/nosferatu.blob, caster-attack.ts): the zombie mind clawing with the RAKE up close and,
 *  at range, CASTING. A seen player he is alert to between castBand.min and .max, with the cast off cooldown and no
 *  swing running, starts one: he halts and turns to face, raises his palm (the `cast` pose, caster-attack.ts
 *  castPose), and `fire` goes up for the one frame the swarm leaves (castFires). game-actor fires it from his right
 *  hand (MotionProfile.spit) and game-spawn releases bats.ts's swarm at the player. A stagger cancels a cast. The
 *  gibbet's squirt mind (above) on the zombie's brain instead of the hound's. */
export function makeNosferatuMind(): EnemyMind {
  const T = NOSFERATU_TUNING;
  const melee = makeZombieMind({ ...BRAIN_TUNING, pickVariant: () => 'rake' });
  let castT = -1;            // seconds into a running cast; -1 = none
  let cooldown: number = T.castFirst;
  let prev = 0;
  const halted = (input: MindInput, phase: number, fire: boolean): MindOutput => ({
    target: null, halt: true,
    attack: { phase, side: 'R', variant: 'cast' },
    fire, weaponUp: false,
    faceHeading: input.player ? Math.atan2(input.player.x - input.self.x, input.player.z - input.self.z) : null,
    engaged: true, committed: true, contact: false, aimError: 0,
  });
  return {
    kind: 'zombie',
    meleeCapable: true,
    step(input) {
      cooldown = Math.max(0, cooldown - input.dt);
      if (castT >= 0) {
        castT += input.dt;
        const phase = castT / T.castSec;
        if (phase < 1) {
          const fire = castFires(prev, phase);
          prev = phase;
          return halted(input, phase, fire);
        }
        castT = -1; prev = 0; cooldown = T.castCooldown;
      }
      const out = melee.step(input);
      const p = input.player;
      if (!out.attack && p && melee.debug().alert && input.lineOfSight !== false && cooldown <= 0) {
        const dist = Math.hypot(p.x - input.self.x, p.z - input.self.z);
        if (dist >= T.castBand.min && dist <= T.castBand.max) {
          castT = 0; prev = 0;
          return halted(input, 0, false);
        }
      }
      return out;
    },
    // A stagger cancels the cast AND re-arms castFirst: without it he would recast the moment the hold ended, and
    // shooting the tell would buy the player nothing.
    stagger(holdSec) { castT = -1; prev = 0; cooldown = Math.max(cooldown, T.castFirst); melee.stagger(holdSec); },
    debug: () => {
      const d = melee.debug();
      return castT >= 0 ? { ...d, state: 'cast', variant: 'cast', swingT: castT / T.castSec, cooldown } : { ...d, cooldown };
    },
  };
}
```

`makeZombieMind`'s `stagger()` ignores its argument, and passing one is harmless. Unlike the gibbet, a stagger re-arms
`castFirst`. The stagger test depends on this: without it he recasts inside the test's window and fires.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/enemy-mind-nosferatu.test.ts src/lab/sdf-zombie/webgpu/enemy-mind.test.ts src/lab/sdf-zombie/hound-attack.test.ts && npm run typecheck`
Expected: PASS. If the in-band test sees no cast, the zombie brain is not alert at 8 m. Read `brain.ts`'s notice rule
and give `input()` whatever it needs to notice (the gibbet's test passes `alerted: true`). Don't change the brain.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/enemy-mind.ts src/lab/sdf-zombie/webgpu/enemy-mind-nosferatu.test.ts
git commit -m "feat(nosferatu): the caster mind: rake up close, cast a swarm at range"
```

---

## Task 5: Wire the swarm into the game

**Files:**
- Modify: `src/lab/sdf-zombie/motion-profile.ts` (the `caster` field; `spit` and `caster` on `NOSFERATU_PROFILE`)
- Modify: `src/lab/sdf-zombie/webgpu/rng.ts` (a `bats` stream)
- Modify: `src/lab/sdf-zombie/webgpu/game-state-weapon.ts` (`bats`, `batSwarms`)
- Modify: `src/lab/sdf-zombie/webgpu/game-spawn.ts` (the caster's mind and `onFire`)
- Modify: `src/lab/sdf-zombie/webgpu/game-tick.ts` (pellets kill bats; step; nips; telemetry)
- Modify: `src/lab/sdf-zombie/webgpu/game-dynamite-step.ts` (a blast kills bats)
- Modify: `src/lab/sdf-zombie/webgpu/game-seams-weapon-player.ts` (a `bats` seam)
- Test: `src/lab/sdf-zombie/webgpu/rng.test.ts`, the game-context coverage test, `motion-profile.test.ts`

- [ ] **Step 1: The profile fields**

In `MotionProfile`, after `spit`, add:

```ts
  /** A CASTER (the nosferatu): the game gives it the caster mind (enemy-mind.ts makeNosferatuMind), and its onFire
   *  releases the spell from `spit`'s point. Needs `spit`. */
  caster?: { spell: 'bats' };
```

On `NOSFERATU_PROFILE`, add:

```ts
  // The swarm leaves from his raised right palm: the hand joint (the wrist) plus 9 cm on past it, forward of the
  // claws' roots (game-actor turns the offset by the body's yaw).
  spit: { from: 'handR', offset: [0, 0.05, 0.09] },
  caster: { spell: 'bats' },
```

- [ ] **Step 2: The `bats` RNG stream (test first)**

Add to `rng.test.ts`:

```ts
  it('the bats stream is independent of the other four', () => {
    const a = createRngStreams(1234), b = createRngStreams(1234);
    for (let i = 0; i < 50; i++) { a.misc(); a.bleed(); a.fx(); a.reload(); }
    expect(a.bats()).toBe(b.bats());
  });
```

Run `npx vitest run src/lab/sdf-zombie/webgpu/rng.test.ts`. It should fail. Then, in `rng.ts`:
- add `/** The nosferatu's bat swarms (bats.ts): every spawn and flutter draw. */ bats: () => number;` to `RngStreams`;
- add `bats: 0x165667b1,` to `SALT`;
- add `bats: mulberry32((s ^ SALT.bats) >>> 0),` to `createRngStreams`.

Update the header's "Four streams" to "Five streams". Make sure `setRngSeed` re-creates every stream; if it assigns
named fields one by one, add `bats` there too. Run the test again: PASS.

- [ ] **Step 3: The weapon slice**

In `game-state-weapon.ts`:
- import `import type { Bat } from '../bats';`;
- after `bileViews`, add `/** The nosferatu's bats (bats.ts), every swarm in one list. */ bats: Bat[];` and
  `/** The next cast's swarm id (bats.ts Bat.swarm). */ batSwarms: number;`;
- in the factory, add `bats: [], batSwarms: 0,`;
- in the bindings map, add `bats: 'weapon.bats', batSwarms: 'weapon.batSwarms',`.

In `game-main.ts`, beside `ctx.weapon.bile = [];` (line 4236), add `ctx.weapon.bats = []; ctx.weapon.batSwarms = 0;`.

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-context` (the coverage tests). Expected: PASS.

- [ ] **Step 4: Spawn: the mind and the cast**

In `game-spawn.ts`:
- import `makeNosferatuMind` from `./enemy-mind`, `{ addSwarm, castSwarm }` from `../bats`, `{ rngStreams }` from
  `./rng` and `{ eyeOf }` from `./game-player`, if any of these is missing;
- after the STAB block (line 395), add:

```ts
    // A CASTER profile (the nosferatu): the rake up close and, at range, a bat swarm released from his raised palm
    // (MotionProfile.spit) at the player's head (bats.ts), enemy-mind.ts makeNosferatuMind.
    ...(characterEntry(name).profile.caster ? {
      mind: makeNosferatuMind(),
      onFire: ({ origin }: { origin: Vec3; direction: Vec3 }) => {
        ctx.world.encounter.shot(zombieId);
        const swarm = ctx.weapon.batSwarms++;
        ctx.weapon.bats = addSwarm(ctx.weapon.bats, castSwarm(origin, eyeOf(ctx.player.player), zombieId, swarm, rngStreams.bats));
        ctx.telemetry.telemetry.event('bat-cast', { owner: zombieId, swarm, x: origin[0], y: origin[1], z: origin[2] });
      },
    } : {}),
```

- [ ] **Step 5: Player rounds kill bats**

In `game-tick.ts`'s player-pellet loop, after the level-collider check (the `if (!dead) { for (const b of
ctx.world.colliders) ... }` block, around line 920) and before the actor block, add:

```ts
      if (!dead && ctx.weapon.bats.length) {
        // A BAT (bats.ts) on the segment dies and the round stops there: one hit each, so a shotgun's spread is what
        // clears a swarm.
        const bi = hitBat(ctx.weapon.bats, from, p.pos);
        if (bi >= 0) {
          const b = ctx.weapon.bats[bi]!;
          ctx.weapon.bats[bi] = killBat(b);
          ctx.telemetry.telemetry.event('bat-kill', { by: p.kind, owner: b.owner, x: b.pos[0], y: b.pos[1], z: b.pos[2] });
          dead = true;
        }
      }
```

Import `{ BATS, hitBat, killBat, stepBats }` from `../bats` and `{ rngStreams }` from `./rng`.

This test runs before the actor test on purpose. A bat in front of a body takes the round, and the frame segment is
short (one tick of a pellet), so ordering by kind matches ordering by distance closely enough.

- [ ] **Step 6: Step the swarm, nip the player**

After the BILE block (around line 1054), add:

```ts
    // BATS (the nosferatu's swarm, bats.ts): flock at the player's head, nip and retreat, scatter at lifeSec.
    if (ctx.weapon.bats.length) {
      const stepped = stepBats(ctx.weapon.bats, dt, eyeOf(ctx.player.player), {
        blocked: (from, to) => to[1] <= 0.02 || to[1] >= ceilingAt(ctx, to[0], to[2])
          || ctx.world.colliders.some(box => segmentHitsBox(from, to, box)),
      }, rngStreams.bats);
      ctx.weapon.bats = stepped.live;
      for (const n of stepped.nips) {
        ctx.telemetry.telemetry.event('bat-nip', { owner: n.owner, x: n.at[0], y: n.at[1], z: n.at[2] });
        damagePlayer(ctx, BATS.nipDamage, 'melee');
      }
      // stepBats sets stateSec to exactly 0 on the step a bat turns to `disperse`: those are this step's expiries.
      const expired = stepped.live.filter(b => b.state === 'disperse' && b.stateSec === 0).length;
      if (expired) ctx.telemetry.telemetry.event('bat-expire', { count: expired });
    }
```

Damage kind: `'melee'` goes through the melee invulnerability window. Read `damagePlayer` in `game-loop.ts` and
`player-vitals.ts`'s `DamageKind`:
- If `'melee'` rate-limits so a swarm landing at once deals 4 and not 32, use `'pellet'` instead. Bile uses
  `'pellet'` for the same reason.
- Pick the kind that lets the eight nips add up, and note it.

- [ ] **Step 7: A blast kills bats**

In `game-dynamite-step.ts`'s `detonateAt`, after the explosion bodies are resolved, add:

```ts
  // BATS (bats.ts): a blast kills every bat in the dynamite's reach (explosion-aoe.ts's 4.6875 m reference radius,
  // scaled by the live AOE knob).
  if (ctx.weapon.bats.length) {
    const r = blastBats(ctx.weapon.bats, at, 4.6875 * ctx.vfx.aoeRadiusScale);
    ctx.weapon.bats = r.bats;
    if (r.killed) ctx.telemetry.telemetry.event('bat-kill', { by: 'blast', count: r.killed, x: at[0], y: at[1], z: at[2] });
  }
```

If `explosion-aoe.ts` exports the reference radius as a constant, import it instead of writing the literal.

- [ ] **Step 8: The seam**

In `game-seams-weapon-player.ts`, beside `bile:`, add:

```ts
    /** The nosferatu's bats (bats.ts): the in-game check of the swarm. */
    bats: () => ctx.weapon.bats.map(b => ({ pos: [...b.pos] as Vec3, state: b.state, age: b.age, swarm: b.swarm, owner: b.owner })),
```

- [ ] **Step 9: Typecheck, targeted tests, commit**

Run: `npm run typecheck && npm run test:changed`
Expected: PASS.
```bash
git add -A src/lab/sdf-zombie
git commit -m "feat(nosferatu): cast the swarm in game: pellets and blasts kill bats, nips hurt"
```

- [ ] **Step 10: Prove it in the arena (numbers, no images yet)**

The bats are not drawn until Task 6. Measure through the seam and telemetry:
1. Run `npx vite`.
2. Load `sdf-game.html?level=arena&spawn=nosferatu&seed=1&loader=0` headless. God mode is on in the arena.
3. Place the player 8 m in front of him with the capture pattern's teleport seam (from `arena-cost.mjs`).
4. Wait up to 8 s for a `bat-cast` telemetry event.
5. Record:
   - the time to the first `bat-cast`;
   - the time from it to the first `bat-nip`;
   - the bats' count from the `bats` seam each second.

Kill vite. Put the numbers in the notes. Expected: a cast within `castFirst` plus a moment, eight bats, nips inside
about 2 s, and the swarm in `disperse` by 6 s.

---

## Task 6: Draw the bats

**Files:**
- Create: `src/lab/sdf-zombie/bat-mesh.ts`
- Create: `src/lab/sdf-zombie/bat-mesh.test.ts`
- Create: `src/lab/sdf-zombie/webgpu/bat-flap.wgsl.ts`
- Create: `src/lab/sdf-zombie/webgpu/bat-view.ts`

- [ ] **Step 1: Write the failing mesh test**

```ts
// src/lab/sdf-zombie/bat-mesh.test.ts
import { describe, it, expect } from 'vitest';
import { batMesh } from './bat-mesh';

describe('bat mesh', () => {
  const m = batMesh();
  it('is a low-poly bat: 40-80 triangles', () => {
    const tris = m.index.length / 3;
    expect(tris).toBeGreaterThanOrEqual(40);
    expect(tris).toBeLessThanOrEqual(80);
  });
  it('tags every vertex: 0 on the body, signed span on the wings, mirrored', () => {
    expect(m.wing.length).toBe(m.position.length / 3);
    const left = [...m.wing].filter(w => w < 0).length, right = [...m.wing].filter(w => w > 0).length;
    expect(left).toBe(right);
    expect(Math.max(...m.wing)).toBeCloseTo(1, 6);
    for (let i = 0; i < m.wing.length; i++) if (m.wing[i] === 0) expect(Math.abs(m.position[i * 3]!)).toBeLessThan(0.03);
  });
  it('spans about 0.30 m wingtip to wingtip, the body along +z', () => {
    const xs = [...m.position].filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.26);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.34);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/bat-mesh.test.ts`
Expected: FAIL, because `./bat-mesh` cannot be resolved.

- [ ] **Step 3: Write bat-mesh.ts**

```ts
// src/lab/sdf-zombie/bat-mesh.ts
//
// The bat's low-poly mesh (webgpu/bat-view.ts draws one instance per live bat, bats.ts): a body, two scalloped
// wings and two ears, as plain arrays. `wing` tags each vertex for the flap (webgpu/bat-flap.wgsl.ts): 0 on the
// body, the signed fraction of the half-span on a wing (-1 the left tip, +1 the right). Body along +z (its head),
// +y up, wings along x. Metres.

export interface BatMeshData { position: Float32Array; wing: Float32Array; index: Uint16Array }

const SPAN = 0.15;           // half-span, m
const BODY_LEN = 0.075, BODY_R = 0.018;

export function batMesh(): BatMeshData {
  const pos: number[] = [], wing: number[] = [], idx: number[] = [];
  const v = (x: number, y: number, z: number, w: number) => { pos.push(x, y, z); wing.push(w); return wing.length - 1; };
  // BODY: a 6-sided spindle, nose (+z) to tail (-z) through two rings. 6 + 6 + 12 = 24 triangles.
  const nose = v(0, 0, BODY_LEN * 0.5, 0), tail = v(0, 0, -BODY_LEN * 0.5, 0);
  const ring = (z: number, r: number) => Array.from({ length: 6 }, (_, k) => {
    const a = (k / 6) * Math.PI * 2;
    return v(Math.cos(a) * r * 0.9, Math.sin(a) * r, z, 0);
  });
  const r0 = ring(BODY_LEN * 0.2, BODY_R), r1 = ring(-BODY_LEN * 0.2, BODY_R * 0.8);
  for (let k = 0; k < 6; k++) {
    const n = (k + 1) % 6;
    idx.push(nose, r0[k]!, r0[n]!, tail, r1[n]!, r1[k]!, r0[k]!, r1[k]!, r1[n]!, r0[k]!, r1[n]!, r0[n]!);
  }
  // EARS: two thin triangles off the head, swept back. 2 triangles each side, double-sided by winding = 4.
  for (const s of [-1, 1]) {
    const a = v(s * 0.008, BODY_R * 0.8, BODY_LEN * 0.3, 0), b = v(s * 0.014, BODY_R * 0.8, BODY_LEN * 0.18, 0);
    const tip = v(s * 0.013, BODY_R * 2.2, BODY_LEN * 0.16, 0);
    idx.push(a, b, tip, a, tip, b);
  }
  // WINGS: a fan of five fingers from the shoulder; between each pair of finger tips a scalloped trailing edge
  // dips in. Per side: root + 5 tips + 4 scallops, 4 x 2 = 8 triangles each way, double-sided = 16.
  for (const s of [-1, 1]) {
    const root = v(s * BODY_R, 0, BODY_LEN * 0.1, s * 0.12);
    const tips = [0, 1, 2, 3, 4].map(k => {
      const t = k / 4;
      const x = s * (BODY_R + (SPAN - BODY_R) * (1 - 0.35 * t * t));
      return v(x, 0, BODY_LEN * (0.25 - 0.9 * t), s * Math.abs(x) / SPAN);
    });
    const scallops = [0, 1, 2, 3].map(k => {
      const t = (k + 0.5) / 4;
      const x = s * (BODY_R + (SPAN - BODY_R) * 0.62 * (1 - 0.4 * t));
      return v(x, 0, BODY_LEN * (0.05 - 0.75 * t), s * Math.abs(x) / SPAN);
    });
    for (let k = 0; k < 4; k++) {
      idx.push(root, tips[k]!, scallops[k]!, root, scallops[k]!, tips[k]!);
      idx.push(scallops[k]!, tips[k]!, tips[k + 1]!, scallops[k]!, tips[k + 1]!, tips[k]!);
    }
  }
  // Mirror tags exactly: the root shares the body's shoulder but flaps with the wing (tag kept small).
  return { position: new Float32Array(pos), wing: new Float32Array(wing), index: new Uint16Array(idx) };
}
```

That is 24 body + 4 ear + 32 wing = 60 triangles. The wing tag's maximum is the tip at `x = SPAN`, which gives 1.

- [ ] **Step 4: Run the mesh test**

Run: `npx vitest run src/lab/sdf-zombie/bat-mesh.test.ts`
Expected: PASS. If the body-tag pin fails, an ear vertex sits wider than 3 cm; pull it in.

- [ ] **Step 5: The flap in WGSL**

```ts
// src/lab/sdf-zombie/webgpu/bat-flap.wgsl.ts
//
// The bat's wingbeat (bat-mesh.ts, bat-view.ts): each wing vertex rotates about the body's long axis (z) by an
// angle that follows the instance's flap phase, scaled toward the tip, so the wing bends as it beats. A body vertex
// (wing 0) never moves. `folded` 1 (a dead bat) holds both wings down and in. Hand-written WGSL; TSL only binds it.
export const BAT_FLAP_WGSL = /* wgsl */ `
fn batFlap(p: vec3f, wing: f32, phase: f32, folded: f32) -> vec3f {
  let side = sign(wing);
  let span = abs(wing);
  // Down-stroke fast, up-stroke slow: a skewed sine, +0.9 rad up to -0.7 rad down.
  let s = sin(6.2831853 * phase + 0.6 * sin(6.2831853 * phase));
  let beat = mix(0.1 + 0.8 * s, -1.35, folded);
  let a = beat * (0.55 + 0.45 * span) * side;
  let c = cos(a);
  let n = sin(a);
  // Rotate (x, y) about z: a wing raised by +a on the right is mirrored on the left by side.
  return vec3f(p.x * c - p.y * n * side, p.x * n * side + p.y * c, p.z);
}
`;
```

- [ ] **Step 6: The view**

```ts
// src/lab/sdf-zombie/webgpu/bat-view.ts
//
// Every live bat in the level (bats.ts) as ONE InstancedMesh: the bat-mesh.ts geometry, the wingbeat in
// bat-flap.wgsl.ts, matte black-brown with a faint rim so a bat reads against a dark wall. Unlit by the level
// lights (MeshBasicNodeMaterial): a lit bat would cost every lit-material light, and a black silhouette is the
// read. Zero march cost, one draw call, BATS.maxLive instances.
//
// A dispersing bat shrinks out over its last BATS.disperseSec rather than fading: an opaque material keeps the
// draw out of the transparent pass and its sort.
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, cameraPosition, instancedBufferAttribute, normalWorld, positionLocal, positionWorld, vec4, wgslFn } from 'three/tsl';
import { BATS, type Bat } from '../bats';
import { batMesh } from '../bat-mesh';
import { BAT_FLAP_WGSL } from './bat-flap.wgsl';

export interface BatView { mesh: THREE.InstancedMesh; update(bats: readonly Bat[]): void }

const batFlap = wgslFn(BAT_FLAP_WGSL);
const batShade = wgslFn(/* wgsl */ `
fn batShade(n: vec3f, toEye: vec3f) -> vec4f {
  let rim = pow(1.0 - clamp(abs(dot(normalize(n), normalize(toEye))), 0.0, 1.0), 3.0);
  return vec4f(vec3f(0.035, 0.026, 0.022) + vec3f(0.16, 0.10, 0.10) * rim, 1.0);
}
`);

export function createBatView(): BatView {
  const data = batMesh();
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  geom.setAttribute('wing', new THREE.BufferAttribute(data.wing, 1));
  geom.setIndex(new THREE.BufferAttribute(data.index, 1));
  geom.computeVertexNormals();
  const flap = new THREE.InstancedBufferAttribute(new Float32Array(BATS.maxLive * 2), 2);
  flap.setUsage(THREE.DynamicDrawUsage);
  const mat = new MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const f = instancedBufferAttribute(flap);
  mat.positionNode = batFlap({ p: positionLocal, wing: attribute('wing', 'float'), phase: f.x, folded: f.y });
  mat.colorNode = batShade({ n: normalWorld, toEye: cameraPosition.sub(positionWorld) });
  const mesh = new THREE.InstancedMesh(geom, mat, BATS.maxLive);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.name = 'bats';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const fwd = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  return {
    mesh,
    update(bats) {
      const n = Math.min(bats.length, BATS.maxLive);
      for (let i = 0; i < n; i++) {
        const b = bats[i]!;
        fwd.set(b.vel[0], b.state === 'dead' ? 0 : b.vel[1] * 0.5, b.vel[2]);
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
        q.setFromUnitVectors(Z, fwd.normalize());
        const k = b.state === 'disperse' ? Math.max(0, 1 - b.stateSec / BATS.disperseSec) : 1;
        s.setScalar(k);
        m.compose(p.set(b.pos[0], b.pos[1], b.pos[2]), q, s);
        mesh.setMatrixAt(i, m);
        flap.setXY(i, b.flap, b.state === 'dead' ? 1 : 0);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      flap.needsUpdate = true;
    },
  };
}
```

`batFlap`'s argument names must match its WGSL parameters. If `wgslFn` in this three version wants positional
arguments, read how `game-dynamic-light.ts` calls its `wgslFn`s and match that.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck && npx vitest run src/lab/sdf-zombie/bat-mesh.test.ts`
Expected: PASS.
```bash
git add src/lab/sdf-zombie/bat-mesh.ts src/lab/sdf-zombie/bat-mesh.test.ts src/lab/sdf-zombie/webgpu/bat-flap.wgsl.ts src/lab/sdf-zombie/webgpu/bat-view.ts
git commit -m "feat(bats): one instanced mesh, the wingbeat in WGSL"
```

---

## Task 7: Bats on screen and the palm glow

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-state-weapon.ts` (a `batView` field)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (create the view at boot, register it with the router)
- Modify: `src/lab/sdf-zombie/webgpu/game-tick.ts` (update the view after the step)
- Modify: `src/lab/sdf-zombie/webgpu/game-dynamite-step.ts` (the palm glow in the explosion light pool)
- Modify: `src/lab/sdf-zombie/webgpu/game-state-vfx.ts` (`castGlows`)

- [ ] **Step 1: The view at boot**

In `game-state-weapon.ts`, add `/** Every bat drawn (bat-view.ts), made at boot. */ batView: BatView | null;` with
factory `batView: null` and binding `batView: 'weapon.batView'`. In `game-main.ts`, where `ctx.world.accentGroup` is
built (around line 840), add:

```ts
  // THE BATS (bat-view.ts): one InstancedMesh, built at boot so its pipeline compiles with the level's.
  ctx.weapon.batView = createBatView();
  ctx.boot.handle.scene.add(ctx.weapon.batView.mesh);
```

Where the deferred router registers the level groups (around line 1387), add
`ctx.boot.deferredApi.router.register(ctx.weapon.batView.mesh, 'forward');`. Use the same path as the disco ball,
because the material is unlit. If `ctx.boot.handle.scene` is not the scene's name, use whatever the tracer views add
themselves to (`newTracerView`).

In `game-tick.ts`, after the bat step from Task 5, add `ctx.weapon.batView?.update(ctx.weapon.bats);`.

- [ ] **Step 2: The palm glow**

In `game-state-vfx.ts`, add `/** This frame's casting palms (caster-attack.ts castGlow), written by game-tick. */
castGlows: { pos: Vec3; k: number }[];` with factory `[]` and binding `castGlows: 'vfx.castGlows'`.

In `game-tick.ts`, before the dynamite step, add:

```ts
    // THE CAST'S PALM GLOW (caster-attack.ts castGlow): every nosferatu mid-cast lights the room dark red from about
    // where his raised palm is (body-local: on the centre line, 1.55 m up, 0.55 m forward, turned by his yaw).
    ctx.vfx.castGlows = [];
    for (const a of ctx.world.actors) {
      const d = a.mind().debug();
      if (d.state !== 'cast') continue;
      const { pos, yaw } = a.pose();
      ctx.vfx.castGlows.push({ pos: [pos[0] + Math.sin(yaw) * 0.55, pos[1] + 1.55, pos[2] + Math.cos(yaw) * 0.55], k: castGlow(d.swingT) });
    }
```

Check the facing convention against `enemy-mind.ts`'s `faceHeading`, `atan2(dx, dz)`, so +z is forward at yaw 0 and
`sin` and `cos` are as written.

In `game-dynamite-step.ts`, change the pool writer so the slots that explosions leave idle take cast glows:

```ts
  let glow = 0;
  for (let i = 0; i < ctx.vfx.explosionLightPool.length; i++) {
    const pl = ctx.vfx.explosionLightPool[i]!;
    const e = ctx.vfx.explosionLights[i];
    if (e) {
      const k = explosionLightEnv(ctx, e.age);
      pl.color.setHex(0xffb060);
      pl.position.set(e.pos[0], e.pos[1], e.pos[2]);
      pl.intensity = EXPLOSION_LIGHT.meshPeak * k * ctx.lighting.fxLightScale;
      continue;
    }
    // An idle slot lights a casting nosferatu's palm (caster-attack.ts): dark red, a 12th of a blast's peak.
    const c = ctx.vfx.castGlows[glow++];
    if (!c) { pl.intensity = 0; continue; }
    pl.color.setHex(0x8a0a08);
    pl.position.set(c.pos[0], c.pos[1], c.pos[2]);
    pl.intensity = (EXPLOSION_LIGHT.meshPeak / 12) * c.k * ctx.lighting.fxLightScale;
  }
```

Moving a light's colour and intensity is allowed; only `.visible` is off-limits. The marched bodies do not see these
lights (game-main's MUZZLE FLASH comment). The glow lights the walls and floor, which is the read in a dark room.

- [ ] **Step 3: Typecheck, tests, commit**

Run: `npm run typecheck && npm run test:changed`
Expected: PASS.
```bash
git add -A src/lab/sdf-zombie
git commit -m "feat(nosferatu): draw the bats, light the cast's palm"
```

- [ ] **Step 4: Prove it on screen**

Run `npx vite` and the arena at `seed=1`, then capture three frames:
1. the cast at its fire frame, read from the `bats` seam's first non-empty frame;
2. the swarm halfway to the player;
3. the swarm at the player.

Measure:
- the palm-glow wall luminance against the frame before the cast starts, which must be visibly up;
- the GPU frame ms with no bats against 48 bats (fire `debug` casts by waiting through six casts with god mode on), so
  that one draw call shows as under 0.2 ms;
- the boot-time gate: cold-boot `drawOnce` on this branch against `origin/main`, two fresh-profile runs each.

Kill vite. Record every number in the notes.

---

## Task 8: The head's baked detail

**Files:**
- Create: `scripts/nosferatu-detail-gen.ts` (from `scripts/gibbet-detail-gen.ts`)
- Create: `src/lab/sdf-zombie/characters/nosferatu.detail`
- Create: `public/assets/lab/nosferatu-body-n.png`, `public/assets/lab/nosferatu-body-n.json`
- Modify: `src/lab/sdf-zombie/character-registry.ts` (`bodyNormal` on the entry)

Gate: the owner approved the face in Task 1, Step 9.

- [ ] **Step 1: Generate the detail**

Copy `scripts/gibbet-detail-gen.ts` to `scripts/nosferatu-detail-gen.ts`. Point it at `nosferatu.blob`, and replace
its tables with head detail only:
- a forehead of three brow furrows above the brow ridge;
- four temple veins running from the ears up over the dome;
- crow's-feet at the outer socket corners.

All of it goes in the skull limb region (`--limb skull:...`), with no torso region. The recipe and the parameter
meanings are in the `authoring-sdf-characters` skill's "The default pipeline".

- [ ] **Step 2: Bake**

```bash
npx tsx scripts/nosferatu-detail-gen.ts && npx tsx scripts/bake-body-normal.ts nosferatu 512 320 --limb skull:0:1:0.15:96
```

- [ ] **Step 3: Register and look**

Add to the `nosferatu` entry:
`bodyNormal: { url: '/assets/lab/nosferatu-body-n.png', meta: '/assets/lab/nosferatu-body-n.json', strength: 1 },`
with the comment line the other entries carry. Re-run `npm run blob:shot -- nosferatu` and an arena close-up. The veins
must read at 1.5 m and vanish at 6 m. The march cost must be unchanged, since a normal map adds no prims.

- [ ] **Step 4: Commit**

```bash
git add scripts/nosferatu-detail-gen.ts src/lab/sdf-zombie/characters/nosferatu.detail public/assets/lab/nosferatu-body-n.* src/lab/sdf-zombie/character-registry.ts
git commit -m "feat(nosferatu): veins and furrows on the dome, baked, never marched"
```

---

## Task 9: Captures, the cost gate, the notes

**Files:**
- Create: `scripts/nosferatu-cast-capture.mjs`
- Modify: `docs/dev-notes/2026-10-27-nosferatu/NOTES.md`
- Modify: `TASKS.md` and `docs/tasks/characters.md` (or whichever area page lists enemies)

- [ ] **Step 1: The capture driver**

Write `scripts/nosferatu-cast-capture.mjs` from the skeleton of `arena-cost.mjs` (from PR #87's branch). It should:
1. Load `sdf-game.html?level=arena&spawn=nosferatu&seed=1&loader=0` (not frozen: he has to cast). God mode is on in
   the arena.
2. Wait for `__warmGate.phase === 'ready'`.
3. Put the player 8 m in front of him, facing him.
4. Screenshot every 1/15 s from 0.5 s before the first `bat-cast` until 2.5 s after it, into
   `docs/dev-notes/2026-10-27-nosferatu/gif/`.
5. On the frame the swarm is 2 m from the player, fire the shotgun twice through the input seam the other gates use
   (`grep -l "fire" scripts/*-gate.mjs`), then keep capturing for 1 s.
6. Log the telemetry events and the `bats` seam per frame to `capture.json`.

- [ ] **Step 2: Run it and make the GIF**

```bash
npx vite &
node scripts/nosferatu-cast-capture.mjs
ffmpeg -y -framerate 15 -i docs/dev-notes/2026-10-27-nosferatu/gif/%04d.png -vf "scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" docs/dev-notes/2026-10-27-nosferatu/cast-swarm.gif
```

Kill vite. Look at the GIF. It must show five things: the arm rising, the glow, eight bats, bats dying to pellets, and
dead bats dropping. Report the `bat-kill` count from the two shots.

- [ ] **Step 3: The cost gate**

```bash
git show origin/claude/skeleton-cloak-cost:docs/dev-notes/2026-10-27-skeleton-cloak-cost/arena-cost.mjs > /tmp/arena-cost.mjs
VARIANTS=zombie,cultist,nosferatu node /tmp/arena-cost.mjs
```

If PR #87 has merged, run the committed path instead. **The nosferatu must come in below the cultist at every stage
(close, far, back, head).** Put the table in the notes as ratios to the bare zombie. If he does not come in below:
- drop the skirt's `warp=` first, as the spec allows;
- then re-count the head and report what is left.

Do not pass the gate by loosening it.

- [ ] **Step 4: Notes, the task board, commit**

Finish `NOTES.md` with:
- the turntable and arena frames;
- the GIF;
- the Task 5 and Task 7 numbers;
- the cost table;
- what is open: a true two-arm rake if the owner wants one, bat gore, and placing him in levels.

Add the nosferatu to `TASKS.md`'s in-flight list and its area page. Then:
```bash
git add scripts/nosferatu-cast-capture.mjs docs/dev-notes/2026-10-27-nosferatu TASKS.md docs/tasks
git commit -m "docs(nosferatu): captures, the swarm GIF and the cost gate"
```

- [ ] **Step 5: Final checks and the PR**

Run: `npm run typecheck && npm run test:changed`. Push, and open a PR against `main` that links the spec, this plan
and the notes. Read CI with `gh run list --branch <branch>`.
