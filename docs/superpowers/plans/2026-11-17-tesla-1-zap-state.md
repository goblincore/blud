# Tesla 1: The Zap State Implementation Plan

> Status: executed 2026-11-17. The code departs from this plan in places; the spec and docs/dev-notes/2026-11-17-tesla-zap/NOTES.md record what was built.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Holding fire on slot 9 puts the body under the crosshair into the zap: rigid star pose with a tremor, blue-white x-ray glow with its skeleton showing, charring late, and dying when fully cooked.

**Spec:** `docs/superpowers/specs/2026-11-17-tesla-arc-design.md` — read it first. This is plan 1 of 3 (pieces 1 to 5 of the spec). Plan 2 is the arc; plan 3 is the ash death.

**Architecture:** The clock (`zap.ts`) and the pose (`zap-pose.ts`) are pure modules. The actor applies them as an override of its mind's verdict, the way it applies the burn panic. The glow rides the spare `w` of the burn record to a new WGSL block in the body march; the skeleton x-ray is a per-instance attribute on the existing mesh-skeleton batches (no new batch, no new pipeline). `game-tesla.ts` is the slot 9 harness.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest, headless-Chrome capture scripts (`scripts/*.mjs`).

All paths below are relative to `src/lab/sdf-zombie/` unless they start with `docs/` or `scripts/`.

## Where this plan departs from the spec

Each is deliberate; the spec is updated in Task 7.

- **No arc is drawn.** That is plan 2. Slot 9 zaps what it points at with nothing visible between gun and body.
- **The death is the body's ordinary death.** On a full cook the body holds as a charred statue for `ZAP.statueSec`, then is killed and falls the way it normally would. Plan 3 replaces the fall with the crumble. `statueSec` therefore lives in `ZAP`, not `ASH`.
- **A statue still takes hits.** The no-hit rule arrives with the crumble in plan 3.
- **No tiptoes, no bent knees.** The legs belong to the foot plants; the star is arms, trunk, head and jaw. Variant 1 in the spec ("arms level with knees bent") is replaced by "arms higher".
- **The tremor is a trunk rotation, not a root translation.** A sway and pitch jitter of `tremorM / 0.5 m` radians moves the chest by `tremorM`, and needs no new motion channel.
- **The x-ray is not a second batch.** The spec's "x-ray batch per bone material" is a per-instance `iZap` attribute on the batches that already draw: the zapped body's bone instances are pulled toward the camera and shaded flat. Same picture, no extra draw.
- **The flesh block sits in two places.** `blocks/post/zap.wgsl.ts` gathers the zap terms beside the burn block; the colour is mixed in at the end of `light.wgsl.ts`, because that is where the lit colour exists.
- **`ZapOut` gains `pose` and `statueDone`; `ZapState` gains private clock fields.**

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests** (no `three` import; plain data in, plain data out — the `burn-state`, `burn-behaviour`, `burn-room-light` pattern). The renderer-facing module only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string modules). TSL node graphs are for thin glue (binding, blending), not for the effect itself.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module — never as new `main()` bindings (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (seeded RNG, sim-time clocks, no wall-clock in logic) and console/capture seams in plain data.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npx vitest run <path>`, or `npm run test:changed`) plus `npm run typecheck`. Never the full suite locally: CI runs it on every push (`gh run list --branch <branch>`). zsh does not word-split `$VAR`: pass test paths literally.
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Capture scripts require `window.__warmGate.phase === 'ready'` and fail on renderer pipeline errors.
- **Prove visual and performance claims with a number** (crop luminance, frame-to-frame change, GPU ms, boot time) and look at the images yourself.
- **Boot time is a gate:** a change that touches shaders or materials reports cold-boot `drawOnce` against the base branch (fresh profile each run).
- WebGPU: alpha in `colorNode.w`, never `alphaHash`/`alphaTest`. Never toggle a light's `.visible`. Never sample the render target you are writing. In `march.wgsl.ts`'s positional uniform lists never put a `:` inside a comment.
- Bullet time: player-side timers (the weapon) use `pdt`/`fireDt`; the body's clock uses the world `dt`.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders — never commit them.
- **The module index is checked.** `docs/architecture/module-index.md` is generated from each module's header comment, and `scripts/module-index.test.ts` fails when it is stale. Every task that adds a source file runs `npx tsx scripts/module-index.ts` before its commit and adds `docs/architecture/module-index.md` to it. Every new file starts with the `// src/lab/sdf-zombie/<path>` line, a `//` line, then a first sentence that says what the module owns.
- Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## File map

| File | New? | Responsibility |
| --- | --- | --- |
| `zap.ts` | new | The zap clock: cook, glow envelope and flicker, jolts, char, death. Pure. |
| `zap.test.ts` | new | Its tests. |
| `motion-profile.ts` | edit | `ZapTier`, `ZAP_TIER_DEFAULT`, `resolveZapTier`, `MotionProfile.zap`. |
| `zap-pose.ts` | new | The star pose and tremor as hand targets and trunk angles. Pure. |
| `zap-pose.test.ts` | new | Its tests. |
| `motion.ts` | edit | `cfg.zapPose`: feeds the pose through the burn flail's arm solve. |
| `webgpu/game-actor.ts` | edit | The `zap` slot, the override, `beginZap` / `setArc` / `zapPhase` / `zapLook`. |
| `webgpu/game-actor-zap.test.ts` | new | The actor under the zap. |
| `webgpu/crowd-records.ts`, `webgpu/zombie-gpu.ts` | edit | `REC_BURN.w` carries the zap. |
| `webgpu/march/body/blocks/post/zap.wgsl.ts` | new | `ZAP_BLOCK` (terms) and `ZAP_LIGHT_BLOCK` (colour), `ZAP_LOOK`. |
| `webgpu/march/body/blocks/post/zap.wgsl.test.ts` | new | String pins for both blocks. |
| `webgpu/march/fields/groups.wgsl.ts`, `webgpu/march/body/trace.wgsl.ts`, `webgpu/march/body/light.wgsl.ts` | edit | The `gZap` private and the two splices. |
| `webgpu/game-zap.ts` | new | Host side: actor zap look to uniforms and to the skeleton's `iZap`; `zapActor`. |
| `webgpu/game-burning.ts` | edit | Stop zeroing `burnCfg.w`. |
| `webgpu/skeleton-spike/zap-xray.ts` | new | The x-ray maths (pull, colour) in TS with matching WGSL. |
| `webgpu/skeleton-spike/zap-xray.test.ts` | new | Its tests. |
| `webgpu/skeleton-spike/segment-instance.ts`, `webgpu/skeleton-spike/mesh-renderer.ts` | edit | `iZap` attribute, the pull, the colour wrap, `syncZap`. |
| `webgpu/game-tesla.ts` | new | Slot 9 harness: placeholder prop, held fire, target stick. |
| `webgpu/tesla-stick.ts` | new | The pure stick test (angle to the target's centre). |
| `webgpu/tesla-stick.test.ts` | new | Its tests. |
| `webgpu/game-weapon-slots.ts` (+ test), `game-state-weapon.ts`, `game-main.ts`, `game-tick.ts`, `game-weapon-rig.ts`, `game-loop.ts`, `game-hud.ts`, `aim-style.ts`, `game-seams-fire.ts` (all `webgpu/`) | edit | Slot 9 wiring, in the melter's footsteps. |
| `scripts/zap-trace.mjs` | new | Headless trace: phases, timings, pipeline count. |
| `docs/dev-notes/2026-11-17-tesla-zap/NOTES.md` | new | Build notes and numbers. |

---

## Task 1: The zap clock

**Files:**
- Create: `zap.ts`, `zap.test.ts`
- Modify: `motion-profile.ts` (beside `BurnTier`, about line 143 and line 206)

- [ ] **Step 1: Add the tier to `motion-profile.ts`**

In `MotionProfile`, under the `burn?: Partial<BurnTier>;` field:

```ts
  /** HOW THIS BODY TAKES THE TESLA ARC (zap.ts): absent fields take ZAP_TIER_DEFAULT. */
  zap?: Partial<ZapTier>;
```

Under `resolveBurnTier`:

```ts
export function resolveZapTier(profile: Pick<MotionProfile, 'zap'> | null | undefined): ZapTier {
  return { ...ZAP_TIER_DEFAULT, ...(profile?.zap ?? {}) };
}
```

Under `BURN_TIER_DEFAULT`:

```ts
/** How a character takes the tesla arc: how long it cooks, whether that kills it, and how it stands. */
export interface ZapTier {
  /** Seconds of arc to a full cook, rolled per body. */
  cookSec: readonly [number, number];
  /** A full cook kills this body. False: it holds at full cook while the arc stays, then recovers. */
  dies: boolean;
  /** Seconds the glow, tremor and pose take to leave once the arc does. */
  recoverSec: number;
  /** It takes the star pose. False (a non-biped rig, the gorehound): tremor only, arms left alone. */
  star: boolean;
}
export const ZAP_TIER_DEFAULT: ZapTier = Object.freeze({ cookSec: [1.6, 2.2] as const, dies: true, recoverSec: 0.6, star: true });
```

Then find the profile that carries `burn: BURN_BEAST` (`grep -n "BURN_BEAST" src/lab/sdf-zombie/motion-profile.ts`) and add `zap: { star: false },` on the line after each use.

- [ ] **Step 2: Write the failing test**

`zap.test.ts`:

```ts
// src/lab/sdf-zombie/zap.test.ts
import { describe, expect, it } from 'vitest';
import { createZap, stepZap, ZAP } from './zap';
import { ZAP_TIER_DEFAULT, resolveZapTier, type ZapTier } from './motion-profile';

const DT = 1 / 60;
const run = (s: ReturnType<typeof createZap>, sec: number, arc: boolean) => {
  let o = stepZap(s, DT, arc);
  for (let i = 1; i < Math.round(sec / DT); i++) o = stepZap(s, DT, arc);
  return o;
};

describe('the zap clock', () => {
  it('rolls cookSec inside the tier range, the same for the same seed', () => {
    const a = createZap(7, ZAP_TIER_DEFAULT), b = createZap(7, ZAP_TIER_DEFAULT), c = createZap(8, ZAP_TIER_DEFAULT);
    expect(a.cookSec).toBeGreaterThanOrEqual(1.6);
    expect(a.cookSec).toBeLessThanOrEqual(2.2);
    expect(b.cookSec).toBe(a.cookSec);
    expect(c.cookSec).not.toBe(a.cookSec);
  });

  it('cooks at 1 / cookSec under the arc and cools at coolRate off it', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    run(s, 0.5, true);
    expect(s.cook).toBeCloseTo(0.5 / s.cookSec, 3);
    const before = s.cook;
    run(s, 0.2, false);
    expect(s.cook).toBeCloseTo(before - ZAP.coolRate * 0.2, 3);
    expect(s.phase).toBe('recovering');
  });

  it('snaps the glow on, flickers inside its band, and fades it over recoverSec', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    const o = run(s, 0.1, true);
    expect(o.glow).toBeGreaterThanOrEqual(ZAP.flickerLo - 1e-6);
    expect(o.glow).toBeLessThanOrEqual(1);
    expect(o.pose).toBe(1);
    const half = run(s, ZAP_TIER_DEFAULT.recoverSec / 2, false);
    expect(half.pose).toBeCloseTo(0.5, 1);
    expect(half.done).toBe(false);
    const end = run(s, ZAP_TIER_DEFAULT.recoverSec, false);
    expect(end.glow).toBe(0);
    expect(end.done).toBe(true);
  });

  it('resumes from where the cook fell to when the arc returns mid-recovery', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    run(s, 1.0, true);
    run(s, 0.2, false);
    const fell = s.cook;
    const o = stepZap(s, DT, true);
    expect(s.phase).toBe('zapped');
    expect(s.cook).toBeGreaterThan(fell);
    expect(o.done).toBe(false);
  });

  it('chars only in the last stretch, and never un-chars', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    const early = run(s, s.cookSec * 0.5, true);
    expect(early.char).toBe(0);
    const late = run(s, s.cookSec * 0.4, true);
    expect(late.char).toBeGreaterThan(0.3);
    const after = run(s, 0.5, false);
    expect(after.char).toBe(late.char);
  });

  it('dies once, on a dying tier, then holds as a statue for statueSec', () => {
    const s = createZap(1, ZAP_TIER_DEFAULT);
    let deaths = 0, o = stepZap(s, DT, true);
    for (let i = 0; i < 4 * 60 && !o.statueDone; i++) { o = stepZap(s, DT, true); if (o.die) deaths++; }
    expect(deaths).toBe(1);
    expect(s.phase).toBe('statue');
    expect(o.statueDone).toBe(true);
    expect(o.glow).toBe(0);
    expect(o.char).toBe(1);
    expect(o.tremor).toBe(0);
    expect(s.t).toBeGreaterThanOrEqual(s.cookSec + ZAP.statueSec - 2 * DT);
  });

  it('holds at a full cook on a tier that does not die, and recovers on release', () => {
    const tier: ZapTier = { ...ZAP_TIER_DEFAULT, dies: false };
    const s = createZap(1, tier);
    const o = run(s, 4, true);
    expect(o.die).toBe(false);
    expect(s.cook).toBe(1);
    expect(s.phase).toBe('zapped');
    expect(run(s, tier.recoverSec + 0.1, false).done).toBe(true);
  });

  it('jolts at seeded irregular gaps, each one a new variant, inverted for its length', () => {
    const times = (seed: number) => {
      const s = createZap(seed, { ...ZAP_TIER_DEFAULT, dies: false });
      const at: number[] = []; let was = 0, lastVariant = -1;
      for (let i = 0; i < 3 * 60; i++) {
        const o = stepZap(s, DT, true);
        if (o.jolt > 0 && was === 0) { at.push(i); expect(o.variant).not.toBe(lastVariant); lastVariant = o.variant; }
        expect(o.invert).toBe(o.jolt > 0);
        expect(o.variant).toBeGreaterThanOrEqual(0);
        expect(o.variant).toBeLessThanOrEqual(2);
        was = o.jolt;
      }
      return at;
    };
    const a = times(3);
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(times(3)).toEqual(a);
    expect(times(4)).not.toEqual(a);
    for (let i = 1; i < a.length; i++) {
      const gap = (a[i]! - a[i - 1]!) * DT;
      expect(gap).toBeGreaterThanOrEqual(ZAP.joltGapSec[0] - 2 * DT);
      expect(gap).toBeLessThanOrEqual(ZAP.joltGapSec[1] + ZAP.joltSec + 2 * DT);
    }
  });

  it('resolves a profile tier over the default', () => {
    expect(resolveZapTier(null)).toEqual(ZAP_TIER_DEFAULT);
    expect(resolveZapTier({ zap: { star: false } }).star).toBe(false);
    expect(resolveZapTier({ zap: { star: false } }).dies).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/zap.test.ts`
Expected: FAIL, cannot resolve `./zap`.

- [ ] **Step 4: Write `zap.ts`**

```ts
// src/lab/sdf-zombie/zap.ts
//
// THE ZAP CLOCK (spec 2026-11-17-tesla-arc-design.md). One per body under the tesla arc:
//   zapped      the arc is on it: cook climbs, the glow is on, it jolts;
//   recovering  the arc left: cook falls, the glow and the pose fade over the tier's recoverSec;
//   statue      it cooked through on a tier that dies: held, charred, glow out, for ZAP.statueSec.
// The actor applies the output as an override of its mind's verdict (the burn panic's pattern).
// Pure: no clock of its own, no randomness beyond the seed. stepZap mutates the state it is given.
import type { ZapTier } from './motion-profile';

export const ZAP = Object.freeze({
  /** Cook lost per second off the arc. */
  coolRate: 0.5,
  /** Seconds for the glow and the pose to come fully on. */
  attackSec: 0.06,
  /** Cook at which the flesh starts to char. */
  charFrom: 0.6,
  /** A jolt's length, and the range of the gap to the next (seconds). */
  joltSec: 0.08,
  joltGapSec: [0.25, 0.7] as const,
  /** The glow's floor under the flicker (its ceiling is 1). */
  flickerLo: 0.55,
  /** Seconds a cooked body holds as a statue before it is killed. */
  statueSec: 0.8,
  /** The tremor: how far the chest moves (m) and how fast (Hz). */
  tremorM: 0.012,
  tremorHz: 25,
});

export interface ZapState {
  phase: 'zapped' | 'recovering' | 'statue';
  /** 0..1: how cooked. */
  cook: number;
  cookSec: number;
  /** Seconds since the zap began. */
  t: number;
  seed: number;
  dies: boolean;
  recoverSec: number;
  /** Private clock fields. */
  rng: number;
  env: number;
  charMax: number;
  joltIn: number;
  joltLeft: number;
  variant: number;
  statueT: number;
  phase0: number;
}

export interface ZapOut {
  /** 0..1 body glow, flicker included. 0 on a statue. */
  glow: number;
  /** 0..1 char. Monotonic for the life of the state. */
  char: number;
  /** 0..1 tremor amplitude. */
  tremor: number;
  /** 1 during a jolt, else 0. */
  jolt: number;
  /** 0..2: which star variant to hold. */
  variant: number;
  /** Bones bright on dark flesh, for the length of a jolt. */
  invert: boolean;
  /** 0..1 how far into the pose the body is (the glow's envelope, without the flicker). */
  pose: number;
  /** The recovery has ended: drop the state. */
  done: boolean;
  /** True on the one step the body cooks through (dying tiers only). */
  die: boolean;
  /** The statue has stood for statueSec. */
  statueDone: boolean;
}

const TAU = Math.PI * 2;
/** mulberry32 step on the state's own word: 0..1. */
function next(s: ZapState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let x = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const smooth = (a: number, b: number, v: number) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
const gap = (s: ZapState) => ZAP.joltGapSec[0] + (ZAP.joltGapSec[1] - ZAP.joltGapSec[0]) * next(s);

export function createZap(seed: number, tier: ZapTier): ZapState {
  const s: ZapState = {
    phase: 'zapped', cook: 0, cookSec: 0, t: 0, seed: seed | 0, dies: tier.dies, recoverSec: Math.max(1e-3, tier.recoverSec),
    rng: seed | 0, env: 0, charMax: 0, joltIn: 0, joltLeft: 0, variant: 0, statueT: 0, phase0: 0,
  };
  const [lo, hi] = tier.cookSec;
  s.cookSec = Math.max(0.1, lo + (hi - lo) * next(s));
  s.phase0 = next(s) * TAU;
  s.joltIn = gap(s);
  return s;
}

export function stepZap(s: ZapState, dt: number, arcOn: boolean): ZapOut {
  s.t += dt;
  if (s.phase === 'statue') {
    s.statueT += dt;
    return { glow: 0, char: 1, tremor: 0, jolt: 0, variant: s.variant, invert: false, pose: 1, done: false, die: false, statueDone: s.statueT >= ZAP.statueSec };
  }
  if (arcOn) {
    s.phase = 'zapped';
    s.cook = Math.min(1, s.cook + dt / s.cookSec);
    s.env = Math.min(1, s.env + dt / ZAP.attackSec);
    if (s.joltLeft > 0) s.joltLeft = Math.max(0, s.joltLeft - dt);
    else {
      s.joltIn -= dt;
      if (s.joltIn <= 0) {
        s.joltLeft = ZAP.joltSec;
        s.joltIn = gap(s);
        // One of the OTHER two variants, so every jolt is a visible change.
        s.variant = (s.variant + 1 + Math.floor(next(s) * 2)) % 3;
      }
    }
  } else {
    s.phase = 'recovering';
    s.cook = Math.max(0, s.cook - ZAP.coolRate * dt);
    s.env = Math.max(0, s.env - dt / s.recoverSec);
    s.joltLeft = 0;
  }
  s.charMax = Math.max(s.charMax, smooth(ZAP.charFrom, 1, s.cook));
  if (arcOn && s.dies && s.cook >= 1) {
    s.phase = 'statue';
    s.statueT = 0;
    s.charMax = 1;
    return { glow: 0, char: 1, tremor: 0, jolt: 0, variant: s.variant, invert: false, pose: 1, done: false, die: true, statueDone: false };
  }
  // Two incommensurate rates: never periodic over a zap's length.
  const f = 0.5 + 0.5 * (0.6 * Math.sin(s.t * 17.3 * TAU + s.phase0) + 0.4 * Math.sin(s.t * 29.1 * TAU + s.phase0 * 1.7));
  const jolt = s.joltLeft > 0 ? 1 : 0;
  return {
    glow: s.env * (ZAP.flickerLo + (1 - ZAP.flickerLo) * f),
    char: s.charMax, tremor: s.env, jolt, variant: s.variant, invert: jolt > 0, pose: s.env,
    done: !arcOn && s.env <= 0, die: false, statueDone: false,
  };
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/lab/sdf-zombie/zap.test.ts`
Expected: PASS, 9 tests. If the jolt-gap bound fails by a frame, the bound is wrong, not the clock: widen the `2 * DT` slack to `3 * DT` and say so in the notes.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/lab/sdf-zombie/zap.ts src/lab/sdf-zombie/zap.test.ts src/lab/sdf-zombie/motion-profile.ts
git commit -m "feat(zap): the zap clock and the per-character zap tier"
```

---

## Task 2: The star pose

**Files:**
- Create: `zap-pose.ts`, `zap-pose.test.ts`
- Modify: `motion.ts` (the `burnFlail` cfg field near line 517; the `burnPose` line near 1091; the arm loop near 1713; the jaw near 1664)

The burn flail already has everything the star needs: hand targets in shoulder coordinates solved by `solveElbow`, a trunk pitch and sway, a head toss. The zap pose returns the same shape and goes down the same path.

- [ ] **Step 1: Write the failing test**

`zap-pose.test.ts`:

```ts
// src/lab/sdf-zombie/zap-pose.test.ts
import { describe, expect, it } from 'vitest';
import { zapPose, ZAP_POSE } from './zap-pose';
import { FLAIL_REST } from './burn-flail';
import { ZAP } from './zap';

const len = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);

describe('the zap pose', () => {
  it('keeps both hands inside the arm reach in every variant at every tremor phase', () => {
    for (let variant = 0; variant < 3; variant++) {
      for (let i = 0; i < 240; i++) {
        const p = zapPose({ t: i / 240, seed: 5, amp: 1, variant, tremor: 1, star: true });
        expect(len(p.handL!)).toBeLessThanOrEqual(ZAP_POSE.reach + 1e-9);
        expect(len(p.handR!)).toBeLessThanOrEqual(ZAP_POSE.reach + 1e-9);
      }
    }
  });

  it('throws the arms out and up, arches the back and throws the head back', () => {
    const p = zapPose({ t: 0, seed: 5, amp: 1, variant: 0, tremor: 0, star: true });
    expect(p.handL![0]).toBeGreaterThan(0.6);   // out
    expect(p.handL![1]).toBeGreaterThan(0.2);   // up
    expect(p.handR![0]).toBeGreaterThan(0.6);
    expect(p.pitch).toBeLessThan(0);            // + is forward
    expect(p.headToss).toBeLessThan(0);
    expect(p.jaw).toBeGreaterThan(0.3);
  });

  it('gives three different silhouettes', () => {
    const at = (variant: number) => zapPose({ t: 0, seed: 5, amp: 1, variant, tremor: 0, star: true });
    expect(at(1).handL![1]).toBeGreaterThan(at(0).handL![1] + 0.15);       // arms higher
    expect(Math.abs(at(2).handL![1] - at(2).handR![1])).toBeGreaterThan(0.4);   // one up, one out
  });

  it('shakes the trunk by tremorM at the chest and by nothing at tremor 0', () => {
    const still = zapPose({ t: 0.013, seed: 5, amp: 1, variant: 0, tremor: 0, star: true });
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      const p = zapPose({ t: i / 200, seed: 5, amp: 1, variant: 0, tremor: 1, star: true });
      peak = Math.max(peak, Math.abs(p.sway - still.sway));
    }
    expect(peak * ZAP_POSE.chestM).toBeGreaterThan(ZAP.tremorM * 0.8);
    expect(peak * ZAP_POSE.chestM).toBeLessThan(ZAP.tremorM * 1.2);
  });

  it('eases out of the rest pose with amp, and is the rest pose at amp 0', () => {
    const rest = zapPose({ t: 0, seed: 5, amp: 0, variant: 0, tremor: 0, star: true });
    expect(rest.handL).toEqual(FLAIL_REST);
    expect(rest.pitch).toBe(0);
    const half = zapPose({ t: 0, seed: 5, amp: 0.5, variant: 0, tremor: 0, star: true });
    const full = zapPose({ t: 0, seed: 5, amp: 1, variant: 0, tremor: 0, star: true });
    expect(half.handL![0]).toBeGreaterThan(FLAIL_REST[0]);
    expect(half.handL![0]).toBeLessThan(full.handL![0]);
  });

  it('leaves the arms alone on a body that takes no star', () => {
    const p = zapPose({ t: 0.02, seed: 5, amp: 1, variant: 0, tremor: 1, star: false });
    expect(p.handL).toBeNull();
    expect(p.handR).toBeNull();
    expect(p.headToss).toBe(0);
    expect(p.jaw).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/zap-pose.test.ts`
Expected: FAIL, cannot resolve `./zap-pose`.

- [ ] **Step 3: Write `zap-pose.ts`**

```ts
// src/lab/sdf-zombie/zap-pose.ts
//
// THE ZAP POSE, as a pure pose (spec 2026-11-17-tesla-arc-design.md): the electrocuted star. Arms flung
// out, back arched, head thrown back, jaw open, the whole trunk shaking. It returns the same shape the
// burning flail does (burn-flail.ts) and motion.ts places it by the same arm solve, so no segment
// stretches.
//
// Hand targets are in SHOULDER coordinates, in units of the arm's full length:
//   [out, up, forward]   out = away from the body's midline (the same sign for both arms).
// Pure: no clock, no randomness beyond the seed.
import type { Vec3 } from './types';
import { FLAIL_REST } from './burn-flail';
import { ZAP } from './zap';

export const ZAP_POSE = Object.freeze({
  /** The furthest a hand target sits from the shoulder (arm lengths). */
  reach: 0.97,
  /** Hip to chest (m): turns the tremor's metres into the trunk's radians. */
  chestM: 0.5,
  /** Trunk pitch (rad, + forward): the arched back. */
  arch: -0.18,
  /** Head toss (rad, + forward): thrown back. */
  head: -0.35,
  /** Jaw gape (rad). */
  jaw: 0.5,
  /** Hand jitter under the tremor (arm lengths). */
  handShake: 0.02,
});

/** [left, right] hand targets per variant. 0 the star, 1 arms higher, 2 one up and one out. */
const VARIANTS: readonly (readonly [Vec3, Vec3])[] = [
  [[0.78, 0.5, 0.1], [0.78, 0.5, 0.1]],
  [[0.5, 0.8, 0.05], [0.5, 0.8, 0.05]],
  [[0.3, 0.88, 0.08], [0.93, 0.08, 0.12]],
];

export interface ZapPoseIn {
  /** Seconds since the zap began. */
  t: number;
  seed: number;
  /** 0..1 how far into the pose (ZapOut.pose). */
  amp: number;
  /** 0..2 (ZapOut.variant). */
  variant: number;
  /** 0..1 (ZapOut.tremor). */
  tremor: number;
  /** ZapTier.star. */
  star: boolean;
}

/** The burn flail's pose shape, with the arms optional and a jaw. */
export interface ZapPose {
  handL: Vec3 | null; handR: Vec3 | null;
  pitch: number; sway: number; headToss: number;
  /** Jaw gape (rad). */
  jaw: number;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);
const mix = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const capped = (h: Vec3): Vec3 => {
  const l = Math.hypot(h[0], h[1], h[2]);
  return l > ZAP_POSE.reach ? [h[0] * ZAP_POSE.reach / l, h[1] * ZAP_POSE.reach / l, h[2] * ZAP_POSE.reach / l] : h;
};

export function zapPose(i: ZapPoseIn): ZapPose {
  const a = clamp01(i.amp), k = clamp01(i.tremor) * a;
  const ph = ((i.seed | 0) % 97) / 97 * TAU;
  const w = i.t * ZAP.tremorHz * TAU + ph;
  // The trunk's shake: the chest moves tremorM, split between a side sway and a pitch a quarter turn apart.
  const shake = (ZAP.tremorM / ZAP_POSE.chestM) * k;
  const sway = shake * Math.sin(w), nod = shake * 0.6 * Math.cos(w);
  if (!i.star) return { handL: null, handR: null, pitch: nod, sway, headToss: 0, jaw: 0 };
  const v = VARIANTS[Math.min(2, Math.max(0, i.variant | 0))]!;
  const hand = (target: Vec3, lane: number): Vec3 => {
    const j = ZAP_POSE.handShake * k;
    const shaken: Vec3 = [target[0] + j * Math.sin(w * 1.31 + lane), target[1] + j * Math.cos(w * 1.17 + lane * 2), target[2] + j * Math.sin(w * 0.93 + lane * 3)];
    return a === 0 ? FLAIL_REST : capped(mix(FLAIL_REST, shaken, a));
  };
  return {
    handL: hand(v[0], 0), handR: hand(v[1], 1),
    pitch: ZAP_POSE.arch * a + nod, sway,
    headToss: ZAP_POSE.head * a, jaw: ZAP_POSE.jaw * a,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lab/sdf-zombie/zap-pose.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Feed it through `motion.ts`**

Import, beside the `burn-flail` import (line 49):

```ts
import { zapPose } from './zap-pose';
```

In the config interface, after the `burnFlail?:` field (line 517):

```ts
  /** THE ZAP (zap-pose.ts): while present and the body stands, the star pose replaces the burn flail on
   *  the same path (arm solve, trunk pitch and sway, head toss) and opens the jaw. ABSENT on every frame
   *  a body is not under the tesla arc: the zombie path is pinned on the key being absent. */
  zapPose?: { t: number; seed: number; amp: number; variant: number; tremor: number; star: boolean };
```

Replace the `burnPose` declaration (line 1091 to 1092) with:

```ts
  // The zap takes the flail's path and wins over it: a burning body under the arc holds the star.
  const zapP = cfg.zapPose && cfg.zapPose.amp > 0 && !collapsed && burnArms ? zapPose(cfg.zapPose) : null;
  const burnPose = zapP ?? (cfg.burnFlail && cfg.burnFlail.amp > 0 && !collapsed && burnArms
    ? burnFlailPose(cfg.burnFlail.t, cfg.burnFlail.seed, cfg.burnFlail.amp, cfg.burnFlail.fold) : null);
```

In the arm loop (the `for (const side of ['L', 'R'] as const)` inside `if (burnPose)`, near line 1715), replace the line that reads the hand:

```ts
      const h = side === 'L' ? burnPose.handL : burnPose.handR;
      if (!h) continue;   // a zap on a body that takes no star: the arms are left where they are
```

At the jaw (line 1664), replace `jawGape = Math.max(swingGape, cfg.jawGape ?? 0);` with:

```ts
    jawGape = Math.max(swingGape, cfg.jawGape ?? 0, zapP?.jaw ?? 0);
```

If `zapP` is not in scope at the jaw (it is declared about 570 lines below it), move the `zapP` declaration up to just above the jaw block and leave the `burnPose` line reading it. `collapsed` and `idx` are both declared well above the jaw; `burnArms` is not, so move its declaration up with `zapP`.

- [ ] **Step 6: Run the motion tests the edit could touch, and typecheck**

Run: `npx vitest run src/lab/sdf-zombie/zap-pose.test.ts src/lab/sdf-zombie/burn-flail.test.ts src/lab/sdf-zombie/motion.test.ts`
Expected: PASS. Any pinned-output test in `motion.test.ts` must be unchanged: an absent `zapPose` takes the old expressions exactly.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/zap-pose.ts src/lab/sdf-zombie/zap-pose.test.ts src/lab/sdf-zombie/motion.ts
git commit -m "feat(zap): the star pose, placed by the burn flail's arm solve"
```

---

## Task 3: The actor under the zap

**Files:**
- Modify: `webgpu/game-actor.ts` (interface near line 457; state near line 980; the override near line 2077 to 2170; the `stepMotion` cfg near line 2267; the reset near line 3212; the returned object near line 3260)
- Create: `webgpu/game-actor-zap.test.ts`

- [ ] **Step 1: Write the failing test**

`webgpu/game-actor-zap.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-actor-zap.test.ts
//
// The zap on a game actor (game-actor.ts beginZap / setArc): the real actor with a stub view, on
// game-actor-melt.test.ts's pattern.
import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { createZombieActor } from './game-actor';
import { ROOMS, wanderBounds, spawnPoints } from './game-level';
import { ZAP } from '../zap';
import { ZAP_TIER_DEFAULT } from '../motion-profile';
import type { Vec3 } from '../types';

function actor() {
  const view = {
    setRootShift: () => {}, setHeadRotation: () => {}, setTime: () => {},
    update: () => {}, setMelt: () => {}, setPackBones: () => {}, setBonesBare: () => {},
  };
  const doc = parseBlob(zombieBlobSrc);
  const built = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
  const room = ROOMS[0]!;
  const start = spawnPoints(room)[0]! as Vec3;
  const a = createZombieActor({
    id: 1, room: room.id, body: translateBody(built, start), view: view as never,
    start, seed: 1337, bounds: wanderBounds(room), furniture: [],
  });
  for (let i = 0; i < 30; i++) a.step(1 / 60);
  return a;
}
const run = (a: ReturnType<typeof actor>, sec: number) => { for (let i = 0; i < Math.round(sec * 60); i++) a.step(1 / 60); };
const dist = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[2] - q[2]);

describe('a game actor under the tesla arc', () => {
  it('stands rigid where it is, glowing, for as long as the arc is on it', () => {
    const a = actor();
    expect(a.zapPhase()).toBe('none');
    expect(a.zapLook()).toBeNull();
    expect(a.beginZap()).toBe(true);
    a.setArc(true);
    run(a, 0.2);
    const at = a.pose().pos.slice() as Vec3;
    expect(a.zapPhase()).toBe('zapped');
    expect(a.zapping()).toBe(true);
    expect(a.zapLook()!.glow).toBeGreaterThan(0.5);
    run(a, 0.8);
    expect(dist(a.pose().pos as Vec3, at)).toBeLessThan(0.05);
    expect(a.motionFrame()?.collapsed).toBe(false);
  });

  it('recovers when the arc leaves, keeping no glow', () => {
    const a = actor();
    a.beginZap(); a.setArc(true);
    run(a, 0.5);
    a.setArc(false);
    run(a, 0.1);
    expect(a.zapPhase()).toBe('recovering');
    run(a, ZAP_TIER_DEFAULT.recoverSec + 0.2);
    expect(a.zapPhase()).toBe('none');
    expect(a.zapLook()).toBeNull();
    expect(a.motionFrame()?.collapsed).toBe(false);
  });

  it('cooks through, holds as a charred statue, then dies', () => {
    const a = actor();
    a.beginZap(); a.setArc(true);
    run(a, ZAP_TIER_DEFAULT.cookSec[1] + 0.1);
    expect(a.zapPhase()).toBe('statue');
    expect(a.zapLook()).toEqual({ glow: 0, invert: false, char: 1 });
    expect(a.motionFrame()?.collapsed).toBe(false);
    expect(a.beginZap()).toBe(false);           // already a statue
    run(a, ZAP.statueSec + 1.5);
    expect(a.zapPhase()).toBe('none');
    expect(a.motionFrame()?.collapsed).toBe(true);
    expect(a.zapLook()).toEqual({ glow: 0, invert: false, char: 1 });   // the char stays on the corpse
    expect(a.beginZap()).toBe(false);           // a corpse
  });

  it('refuses a melting body', () => {
    const a = actor();
    expect(a.beginMelt()).toBe(true);
    expect(a.beginZap()).toBe(false);
  });

  it('keeps the char it had when the zap ends short of a full cook', () => {
    const a = actor();
    a.beginZap(); a.setArc(true);
    run(a, ZAP_TIER_DEFAULT.cookSec[0] * 0.9);
    const char = a.zapLook()!.char;
    expect(char).toBeGreaterThan(0);
    a.setArc(false);
    run(a, 1.5);
    expect(a.zapPhase()).toBe('none');
    expect(a.zapLook()).toEqual({ glow: 0, invert: false, char });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor-zap.test.ts`
Expected: FAIL, `a.zapPhase is not a function`.

- [ ] **Step 3: Declare the interface**

In the `ZombieActor` interface, after `setBurning(on: boolean): void;` (line 461):

```ts
  /**
   * THE ZAP (zap.ts, spec 2026-11-17-tesla-arc-design.md): the tesla arc has landed on this body. False,
   * and nothing done, when it is melting, tearing, a corpse or already a statue. The caller then holds
   * the arc on it with setArc(true) each tick and drops it with setArc(false).
   */
  beginZap(): boolean;
  setArc(on: boolean): void;
  /** Under the arc, recovering from it, or standing as a statue. */
  zapping(): boolean;
  zapPhase(): 'none' | 'zapped' | 'recovering' | 'statue';
  /** What the renderer draws: the glow, whether the bones are inverted, and the char. Null on a body the
   *  arc has never charred and is not on. */
  zapLook(): { glow: number; invert: boolean; char: number } | null;
```

- [ ] **Step 4: Add the state**

Imports, beside the `burn-behaviour` import:

```ts
import { createZap, stepZap, type ZapOut, type ZapState } from '../zap';
```

and add `resolveZapTier` to the existing `'../motion-profile'` import list (line 79).

After the `burnStuckT` declaration (near line 990):

```ts
  /**
   * THE ZAP (zap.ts). Non-null while the body is under the tesla arc, recovering from it or standing as
   * a statue. Applied below as an override of the mind's verdict, after the burn panic's, which it
   * suspends. `zapArc` is the weapon's word, each tick, on whether the arc is still on this body.
   */
  let zap: ZapState | null = null;
  let zapArc = false;
  let zapOut: ZapOut | null = null;
  /** The most char the arc has left on this body, kept after the zap ends. */
  let zapChar = 0;
  /** The statue's time ran out: the body is killed, and the collapse is forced until it is down. */
  let zapDied = false;
  /** This frame's pose for stepMotion; null = none. */
  let zapPoseCfg: { t: number; seed: number; amp: number; variant: number; tremor: number; star: boolean } | null = null;
  const zapTier = resolveZapTier(opts.profile);
  const zapSeed = opts.id * 104729 + 3;
```

- [ ] **Step 5: Apply the override**

In the burn override, change the guard `if (burnPanic && !doomed && !burnDied) {` (line 2084) to:

```ts
      if (burnPanic && !doomed && !burnDied && !zap) {
```

That is the suspension: under the zap the burn clock does not advance, and it resumes where it stopped.

Immediately before the comment `// Burned to death: no agenda, and the collapse is forced every frame until it is down.` (line 2127), insert:

```ts
      // THE ZAP. An override of the mind's verdict, after the burn panic's so a body that is both alight
      // and under the arc holds the star. Killed by something else mid-zap: the zap ends there, the glow
      // cuts, and the char it had stays.
      zapPoseCfg = null;
      if (zap && zap.phase !== 'statue' && downOtherwise()) { zap = null; zapOut = null; zapArc = false; }
      if (zap && !doomed) {
        const o = stepZap(zap, sdt, zapArc);
        zapChar = Math.max(zapChar, o.char);
        if (o.statueDone) {
          zap = null; zapOut = null; zapArc = false;
          zapDied = true;
          // A soldier reaches his death through his own path (the burn death's rule).
          if (soldierDamage) soldierFatal = true;
        } else if (o.done) {
          zap = null; zapOut = null;
        } else {
          zapOut = o;
          think = { ...think, target: null, halt: true, fire: false, weaponUp: false, attack: null, contact: false, faceHeading: null };
          // A statue holds the variant it died in, with no tremor and a stopped clock.
          zapPoseCfg = { t: zap.phase === 'statue' ? 0 : zap.t, seed: zapSeed, amp: o.pose, variant: o.variant, tremor: o.tremor, star: zapTier.star };
        }
      }
      if (zapDied) {
        think = { ...think, target: null, halt: true, attack: null, fire: false, contact: false };
        signals.forcedCollapse = true;
      }
```

If `think`'s type has no `contact` or `weaponUp` key the compiler will say so: copy the exact key set from the two burn lines beside this block (2118 and 2129) instead.

After the line `if ((burnPanic && !doomed) || burnDied) signals.fire = false;` (line 2168), add:

```ts
      if (zap || zapDied) signals.fire = false;
```

- [ ] **Step 6: Hand the pose to motion**

In the `stepMotion` cfg, after `...(burnFlail ? { burnFlail } : {}),` (line 2267):

```ts
          ...(zapPoseCfg ? { zapPose: zapPoseCfg } : {}),
```

- [ ] **Step 7: Reset and expose**

In the reset (line 3212, the line that starts `burnDied = false; burnPanic = null;`), add on the next line:

```ts
      zap = null; zapArc = false; zapOut = null; zapChar = 0; zapDied = false; zapPoseCfg = null;
```

In the returned object, after the `burnPhase: () => burnPhaseNow,` line:

```ts
    beginZap: () => {
      if (zap) return zap.phase !== 'statue';
      if (zapDied || melt || doomed || downOtherwise() || (tear !== null && tear.age < tearTuning.sec)) return false;
      zap = createZap(zapSeed, zapTier);
      return true;
    },
    setArc: (on: boolean) => { zapArc = on && zap !== null && zap.phase !== 'statue'; },
    zapping: () => zap !== null,
    zapPhase: () => zap?.phase ?? 'none',
    zapLook: () => (zap && zapOut
      ? { glow: zapOut.glow, invert: zapOut.invert, char: zapChar }
      : zapChar > 0 ? { glow: 0, invert: false, char: zapChar } : null),
```

`melt` is the melt slot (`let melt:` at line 952) and the last clause is the body of the `tearing:` member (line 3207).

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor-zap.test.ts src/lab/sdf-zombie/webgpu/game-actor-melt.test.ts`
Expected: PASS, both files.

If "cooks through, holds as a charred statue, then dies" fails on `collapsed` after the statue: a `physicsDeath` zombie may need more than 1.5 s to register as down. Print `a.motionFrame()` each 0.25 s, find when it collapses, and raise the wait to that plus 0.5 s. If it never collapses, `signals.forcedCollapse` is not the zombie's kill path: read how `burnDied` reaches a collapsed frame for `ZOMBIE_PROFILE` (`burnFell()` and the `authoredDeath` cfg line at 2265) and kill the same way.

- [ ] **Step 9: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors. Any stub actor in other tests that implements the full `ZombieActor` interface by hand will now fail to typecheck; add the five members there as no-ops returning `false`, `undefined`, `false`, `'none'`, `null`.

```bash
git add src/lab/sdf-zombie/webgpu/game-actor.ts src/lab/sdf-zombie/webgpu/game-actor-zap.test.ts
git commit -m "feat(zap): the actor holds the star under the arc, recovers, or cooks through and dies"
```

---

## Task 4: The glow on the flesh

**Files:**
- Create: `webgpu/march/body/blocks/post/zap.wgsl.ts`, `webgpu/march/body/blocks/post/zap.wgsl.test.ts`, `webgpu/game-zap.ts`
- Modify: `webgpu/crowd-records.ts:87,138`, `webgpu/zombie-gpu.ts:1871`, `webgpu/march/fields/groups.wgsl.ts:356`, `webgpu/march/body/trace.wgsl.ts:33,429`, `webgpu/march/body/light.wgsl.ts:88`, `webgpu/game-burning.ts:333`, `webgpu/game-tick.ts:1355`, `webgpu/game-seams-fire.ts:27`

The lane: `burnCfg.w` on the view (and so `REC_BURN.w` on the record) carries the glow, negative when the bones are inverted. Zero on every body the arc is not on.

- [ ] **Step 1: Write the failing shader test**

`webgpu/march/body/blocks/post/zap.wgsl.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/march/body/blocks/post/zap.wgsl.test.ts
import { describe, expect, it } from 'vitest';
import { ZAP_BLOCK, ZAP_LIGHT_BLOCK, ZAP_LOOK } from './zap.wgsl';
import { MARCH_BODY_TRACE } from '../../trace.wgsl';
import { MARCH_BODY_LIGHT } from '../../light.wgsl';
import { FOLD_GROUP } from '../../../fields/groups.wgsl';

describe('the zap blocks', () => {
  it('reads the lane from the view or the record, whichever is larger in size', () => {
    expect(ZAP_BLOCK).toContain('let zapRaw = select(gInstBurn.w, burnCfg.w, abs(burnCfg.w) > abs(gInstBurn.w));');
  });

  it('does nothing on a body the arc is not on', () => {
    expect(ZAP_BLOCK).toContain('if (zapRaw != 0.0) {');
    expect(ZAP_LIGHT_BLOCK).toContain('if (gZap.x > 0.0) {');
    // Every write of gZap and every glow edit sits inside the gate.
    const gate = ZAP_BLOCK.indexOf('if (zapRaw != 0.0) {');
    expect(ZAP_BLOCK.indexOf('gZap = ')).toBeGreaterThan(gate);
    expect(ZAP_BLOCK.indexOf('faceGlow = ')).toBeGreaterThan(gate);
  });

  it('probes the bones only when the body packs bone rows', () => {
    expect(ZAP_BLOCK).toContain('if (gInstCounts2.x > 0.0) {');
    expect(ZAP_BLOCK).toContain('applyBones(1e9, pS, data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta)');
  });

  it('is spliced after the burn block and after the lit compose', () => {
    expect(MARCH_BODY_TRACE).toContain(ZAP_BLOCK);
    expect(MARCH_BODY_TRACE.indexOf(ZAP_BLOCK)).toBeGreaterThan(MARCH_BODY_TRACE.indexOf('gBurnOut = vec4<f32>(burnAmt, charAmt, fire, 1.0);'));
    expect(MARCH_BODY_LIGHT).toContain(ZAP_LIGHT_BLOCK);
    expect(MARCH_BODY_LIGHT.indexOf(ZAP_LIGHT_BLOCK)).toBeGreaterThan(MARCH_BODY_LIGHT.indexOf('+ glow + gBurnEmit;'));
    // The old compose line is untouched: an unzapped pixel shades as before.
    expect(MARCH_BODY_LIGHT).toContain('var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow + gBurnEmit;');
  });

  it('declares the private once', () => {
    expect(FOLD_GROUP.split('var<private> gZap: vec4<f32>').length).toBe(2);
  });

  it('carries the look as numbers a panel can change later', () => {
    expect(ZAP_LOOK.core).toHaveLength(3);
    expect(ZAP_LOOK.bone).toHaveLength(3);
    expect(ZAP_LOOK.probeDepthM).toBeGreaterThan(0);
  });
});
```

`FOLD_GROUP` (`groups.wgsl.ts` line 48) is the export whose string holds the march's private globals, `gBurnEmit` among them.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/body/blocks/post/zap.wgsl.test.ts`
Expected: FAIL, cannot resolve `./zap.wgsl`.

- [ ] **Step 3: Write the blocks**

`webgpu/march/body/blocks/post/zap.wgsl.ts`:

```ts
// src/lab/sdf-zombie/webgpu/march/body/blocks/post/zap.wgsl.ts
//
// THE ZAP ON THE FLESH (spec 2026-11-17-tesla-arc-design.md): a body under the tesla arc is a flat
// blue-white glow, brighter at its silhouette, with its skeleton showing in it. Two pieces, because the
// march body is two strings:
//   ZAP_BLOCK        in the post-hit material (trace.wgsl.ts, after BURN_BLOCK): gathers the terms into
//                    the private gZap = (glow, invert, nearBone, 1);
//   ZAP_LIGHT_BLOCK  at the end of the lighting tail (light.wgsl.ts): mixes the lit colour toward the glow.
// The lane is burnCfg.w per view and gInstBurn.w per crowd instance (crowd-records.ts REC_BURN): the
// glow 0..1, NEGATIVE while the bones are inverted (a jolt). Zero on every body the arc is not on, so no
// other pixel pays for either block.
//
// The skeleton of a mesh-skeleton body is drawn by its bone meshes (skeleton-spike/zap-xray.ts): such a
// body packs no bone rows, the probe below is skipped and nearBone stays 0. A body that DOES pack bone
// rows (the procedural skeleton) gets its bones from the probe, the way the burn's show-through does.

/** The look, in linear RGB. Baked into the shader: change a number, rebuild. */
export const ZAP_LOOK = Object.freeze({
  /** The glow's colour at the body's centre. */
  core: [0.62, 0.8, 1.0] as const,
  /** Gain at the centre and the extra at the silhouette. */
  gain: 1.5,
  rim: 1.9,
  /** The skeleton's colour in the glow. */
  bone: [0.015, 0.02, 0.04] as const,
  /** How far under the surface a bone still shows (m): the procedural-skeleton probe. */
  probeDepthM: 0.14,
});

const v3 = (c: readonly [number, number, number]) => `vec3<f32>(${c[0]}, ${c[1]}, ${c[2]})`;
const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

export const ZAP_BLOCK = /* wgsl */ `  // THE ZAP. burnCfg.w is the per-view lane and gInstBurn.w the per-instance one; the larger in size
  // wins, sign and all, so one shader serves single and crowd draws.
  let zapRaw = select(gInstBurn.w, burnCfg.w, abs(burnCfg.w) > abs(gInstBurn.w));
  if (zapRaw != 0.0) {
    var zapBone = 0.0;
    if (gInstCounts2.x > 0.0) {
      let zapProbe = applyBones(1e9, pS, data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta);
      zapBone = 1.0 - smoothstep(0.0, ${f(ZAP_LOOK.probeDepthM)}, max(zapProbe, 0.0));
    }
    gZap = vec4<f32>(clamp(abs(zapRaw), 0.0, 1.0), select(0.0, 1.0, zapRaw < 0.0), zapBone, 1.0);
    // A body that IS the light carries no face or prim glow of its own under it.
    faceGlow = faceGlow * (1.0 - gZap.x);
    primGlow = primGlow * (1.0 - gZap.x);
  }`;

export const ZAP_LIGHT_BLOCK = /* wgsl */ `  // THE ZAP (zap.wgsl.ts). Unlit and flat: the colour depends on the view angle alone, so wounds, blood
  // and shadow all go under it. gZap.x is 0 on every body the arc is not on.
  if (gZap.x > 0.0) {
    let zapRim = pow(1.0 - max(dot(n, V), 0.0), 2.0);
    let zapGlow = ${v3(ZAP_LOOK.core)} * (${f(ZAP_LOOK.gain)} + ${f(ZAP_LOOK.rim)} * zapRim);
    let zapDark = ${v3(ZAP_LOOK.bone)};
    // Dark bones in bright flesh; on a jolt (gZap.y) the two swap.
    let zapFlesh = mix(zapGlow, zapDark, gZap.y);
    let zapBones = mix(zapDark, zapGlow, gZap.y);
    lit = mix(lit, mix(zapFlesh, zapBones, gZap.z), gZap.x);
  }`;
```

- [ ] **Step 4: Declare the private and splice the blocks**

`webgpu/march/fields/groups.wgsl.ts`, after the `var<private> gBurnOut: vec4<f32> = vec4<f32>(0.0);` line (356):

```wgsl
// THE ZAP (blocks/post/zap.wgsl.ts): (glow 0..1, bones inverted 0/1, near a bone 0..1, 1 when written).
// Written in the surface prep's zap block and read by the lighting tail, like gBurnEmit.
var<private> gZap: vec4<f32> = vec4<f32>(0.0);
```

`webgpu/march/body/trace.wgsl.ts`: add the import under the burn import (line 33)

```ts
import { ZAP_BLOCK } from './blocks/post/zap.wgsl';
```

and splice it after the burn block (line 429), keeping the blank line pattern of its neighbours:

```
${BURN_BLOCK}

${ZAP_BLOCK}

${MELT_BLOCK}${afterHitStop(34, 'albedo + n * (wmRim + cm + gore)')}
```

`webgpu/march/body/light.wgsl.ts`: import `ZAP_LIGHT_BLOCK` from `'./blocks/post/zap.wgsl'`, and after the line `var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow + gBurnEmit;` (88) add a blank line and:

```
${ZAP_LIGHT_BLOCK}
```

- [ ] **Step 5: Carry the lane in the record**

`webgpu/crowd-records.ts`: in the snapshot type, under `charAmount: number;` (line 87):

```ts
  /** THE ZAP (zap.wgsl.ts): the glow 0..1, negative while the bones are inverted. Absent = 0. */
  zap?: number;
```

Change line 138 to:

```ts
      put4(b + REC_BURN * 4, [s.burn, s.burnSec, s.charAmount, s.zap ?? 0]);
```

and the two comments that call the lane spare (lines 43 and 46) to read `w = zap glow (signed)` and `// burn, burnSec, char, zap`.

`webgpu/zombie-gpu.ts` line 1871, extend the snapshot:

```ts
    burn: u.burnCfg.value.x, burnSec: u.burnCfg.value.y, charAmount: u.burnCfg.value.z, zap: u.burnCfg.value.w,
```

and change the `burnCfg` comment at line 825 from `w spare` to `w = the zap glow, signed (zap.wgsl.ts)`.

- [ ] **Step 6: Stop the burn writer zeroing the lane**

`webgpu/game-burning.ts` line 333, in `writeUniforms`:

```ts
    // w is the zap's (game-zap.ts) and z is shared with it: the larger char wins.
    u.burnCfg.value.set(s.burn, s.burnSec, Math.max(s.char, a.zapLook()?.char ?? 0), u.burnCfg.value.w);
```

- [ ] **Step 7: Write the host side**

`webgpu/game-zap.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-zap.ts
//
// THE ZAP IN THE GAME (spec 2026-11-17-tesla-arc-design.md). The zap itself is the actor's
// (game-actor.ts beginZap / setArc, on zap.ts and zap-pose.ts). This file is the game's half: starting
// one on a body (zapActor) and, each tick, copying every body's zap look to its view (stepZapLook).
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';

/**
 * Start the zap on `a` and put the arc on it. False, and nothing done, when the body cannot be zapped
 * (melting, tearing, a corpse, a statue) or is queued to gib.
 */
export function zapActor(ctx: GameContext, a: ZombieActor): boolean {
  if (ctx.gibs.pendingGibs.some(q => q.actor === a)) return false;
  if (!a.beginZap()) return false;
  a.setArc(true);
  ctx.telemetry.telemetry.event('zap', { actor: a.id });
  return true;
}

/** The bodies whose view carries a zap glow this tick: the only ones stepZapLook has to clear. */
const glowing = new Set<ZombieActor>();

/**
 * Actor zap look -> view uniforms. The glow rides burnCfg.w (signed: negative = bones inverted) and the
 * char rides burnCfg.z, where the burn's own char may already be larger. A body the arc has never
 * touched is skipped after one null check. Call after the burn step, which writes x, y and z.
 */
export function stepZapLook(ctx: GameContext): void {
  for (const a of ctx.world.actors) {
    const z = a.zapLook();
    if (!z) {
      if (glowing.delete(a)) a.view.uniforms.burnCfg.value.w = 0;
      continue;
    }
    const v = a.view.uniforms.burnCfg.value;
    v.w = z.invert ? -z.glow : z.glow;
    if (z.char > v.z) v.z = z.char;
    if (z.glow > 0) glowing.add(a); else glowing.delete(a);
  }
}

/** Console readout: every body the arc has touched. */
export function zaps(ctx: GameContext): { id: number; phase: string; glow: number; char: number }[] {
  return ctx.world.actors.flatMap(a => {
    const z = a.zapLook();
    return z ? [{ id: a.id, phase: a.zapPhase(), glow: z.glow, char: z.char }] : [];
  });
}
```

`webgpu/game-tick.ts`: import `stepZapLook` from `'./game-zap'` beside the `stepMelts` import (line 48), and after `stepMelts(ctx, dt);` (line 1355) add:

```ts
    // The zap's look (game-zap.ts): after the burn step, which owns the rest of burnCfg.
    stepZapLook(ctx);
```

The burn step (`ctx.vfx.burning.step(dt)`, line 450) runs earlier in the same tick, so this line has the last word on `burnCfg`.

`webgpu/game-seams-fire.ts`: import `{ zapActor, zaps }` from `'./game-zap'` beside the melter import (line 11), and after the `meltActor:` member (line 26 to 27) add:

```ts
    // ZAP (game-zap.ts): put the arc on actor `id` (or every body when omitted), how many started; drop it;
    // and the readout.
    zapActor: (id?: number) => ctx.world.actors.filter(a => id === undefined || a.id === id)
      .filter(a => zapActor(ctx, a)).length,
    unzapActor: (id?: number) => { for (const a of ctx.world.actors) if (id === undefined || a.id === id) a.setArc(false); },
    zaps: () => zaps(ctx),
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/body/blocks/post/zap.wgsl.test.ts src/lab/sdf-zombie/webgpu/march/body/blocks/post/burn.wgsl.test.ts src/lab/sdf-zombie/webgpu/march/body/blocks/post/prim-material.wgsl.test.ts src/lab/sdf-zombie/webgpu/crowd-records.test.ts`
Expected: PASS. If `test:changed` (below) turns up a test that pins the member names of `__sdfGame`, add `zapActor`, `unzapActor` and `zaps` to its list.

Run: `npm run test:changed` and `npm run typecheck`
Expected: PASS, no errors. A byte-pinned march source test (a hash or a golden of the joined WGSL) will fail because the source grew: re-record it by the test's own instructions and name it in the notes. A PIXEL golden must not change; if one does, an unzapped pixel moved and the gate in one of the two blocks is wrong.

- [ ] **Step 9: Look at it**

Write `scripts/zap-trace.mjs` by copying `scripts/burn-behaviour-trace.mjs` whole (its vite + headless Chrome harness, the `__warmGate` gate, the luma gate, the pipeline-error guard, the contact sheet) and changing only:

- the header comment, to say what this script proves;
- `OUT` to `docs/dev-notes/2026-11-17-tesla-zap`, and the default ports to `5541` and `9541`;
- the page URL to `/sdf-game.html?level=arena&spawn=zombie`;
- the scenario: wait for ready; read `__sdfGame.pipelineLog().totalPipelines`; call `__sdfGame.zapActor()`; sample `__sdfGame.zaps()` and save a frame every 0.25 s for 4 s; call nothing else; read `totalPipelines` again;
- the assertions: the first sample's phase is `zapped`; some sample's phase is `statue`; the last sample has `glow` 0 and `char` 1; the pipeline count is unchanged;
- the measurement: for each saved frame, the mean luminance of the centre 30% crop. Print the series.

Run: `node scripts/zap-trace.mjs`
Expected: assertions pass. The crop luminance during `zapped` is at least 1.5 times the first frame's (before the zap), and falls back below the first frame's by the last sample (a charred corpse). Open the contact sheet and look: the body is a blue-white shape with a brighter edge, standing in the star. No skeleton yet (the zombie is on the mesh skeleton; Task 5 draws it).

- [ ] **Step 10: Boot-time gate and commit**

Run: `node scripts/boot-time.mjs` on this branch and on `main` (a second worktree, or stash nothing: check out `main` in a scratch clone). Read the script's header for its arguments.
Expected: cold-boot `drawOnce` within the run-to-run spread of `main`'s. Record both numbers in `docs/dev-notes/2026-11-17-tesla-zap/NOTES.md` (create it: a title, the date, a "Task 4" heading, the luminance series and the two boot numbers).

```bash
git add src/lab/sdf-zombie/webgpu scripts/zap-trace.mjs docs/dev-notes/2026-11-17-tesla-zap
git commit -m "feat(zap): the x-ray glow on the flesh, on the burn record's spare lane"
```

---

## Task 5: The skeleton in the glow

**Files:**
- Create: `webgpu/skeleton-spike/zap-xray.ts`, `webgpu/skeleton-spike/zap-xray.test.ts`
- Modify: `webgpu/skeleton-spike/segment-instance.ts:99-106`, `webgpu/skeleton-spike/mesh-renderer.ts` (the `SegmentMeshRenderer` interface near line 235; the material list near line 633; `debrisEyeGeometry` near line 640; `ensureLights` near line 719; the returned object near line 1383), `webgpu/game-zap.ts`, `webgpu/game-main.ts:2258`

A zapped body's bone instances are pulled toward the camera, far enough to clear their own flesh, and shaded flat. The pull is a scale about the eye, so a vertex keeps its place on screen and only its depth changes; a wall nearer than the pull still hides it.

- [ ] **Step 1: Write the failing test**

`webgpu/skeleton-spike/zap-xray.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/skeleton-spike/zap-xray.test.ts
import { describe, expect, it } from 'vitest';
import { xrayColour, xrayPull, ZAP_XRAY, ZAP_XRAY_PULL_WGSL, ZAP_XRAY_COLOUR_WGSL } from './zap-xray';
import { ZAP_LOOK } from '../march/body/blocks/post/zap.wgsl';

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]!);
const len = (a: number[]) => Math.hypot(...a);

describe('the skeleton x-ray', () => {
  it('pulls a point toward the eye by pullM along its own ray', () => {
    const eye = [1, 1.6, 0], p = [1, 1.2, -5];
    const q = xrayPull(p, eye, 1);
    const d0 = sub(p, eye), d1 = sub(q, eye);
    expect(len(d0) - len(d1)).toBeCloseTo(ZAP_XRAY.pullM, 6);
    // Same ray: the direction is unchanged, so the point does not move on screen.
    expect(d1[0]! / len(d1)).toBeCloseTo(d0[0]! / len(d0), 9);
    expect(d1[1]! / len(d1)).toBeCloseTo(d0[1]! / len(d0), 9);
    expect(d1[2]! / len(d1)).toBeCloseTo(d0[2]! / len(d0), 9);
  });

  it('leaves a point alone at zap 0', () => {
    expect(xrayPull([1, 1.2, -5], [1, 1.6, 0], 0)).toEqual([1, 1.2, -5]);
  });

  it('never pulls a near point through the eye', () => {
    const eye = [0, 0, 0], p = [0, 0, -0.3];
    const q = xrayPull(p, eye, 1);
    expect(q[2]!).toBeLessThan(0);
    expect(len(q)).toBeCloseTo(0.3 * ZAP_XRAY.minKeep, 6);
  });

  it('shades the bone dark in the glow, bright on a jolt, and not at all at zap 0', () => {
    const lit = [0.4, 0.35, 0.3];
    expect(xrayColour(lit, 0)).toEqual(lit);
    expect(xrayColour(lit, 1)).toEqual([...ZAP_LOOK.bone]);
    const jolt = xrayColour(lit, -1);
    expect(jolt[2]!).toBeGreaterThan(1);
    const half = xrayColour(lit, 0.5);
    expect(half[0]!).toBeCloseTo((lit[0]! + ZAP_LOOK.bone[0]) / 2, 6);
  });

  it('says the same thing in WGSL', () => {
    expect(ZAP_XRAY_PULL_WGSL).toContain('fn zapXrayPull(p: vec3<f32>, eye: vec3<f32>, zap: f32) -> vec3<f32>');
    expect(ZAP_XRAY_PULL_WGSL).toContain(`${ZAP_XRAY.pullM}`);
    expect(ZAP_XRAY_PULL_WGSL).toContain(`${ZAP_XRAY.minKeep}`);
    expect(ZAP_XRAY_COLOUR_WGSL).toContain('fn zapXrayColour(lit: vec3<f32>, zap: f32) -> vec3<f32>');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/zap-xray.test.ts`
Expected: FAIL, cannot resolve `./zap-xray`.

- [ ] **Step 3: Write `zap-xray.ts`**

```ts
// src/lab/sdf-zombie/webgpu/skeleton-spike/zap-xray.ts
//
// THE SKELETON X-RAY (spec 2026-11-17-tesla-arc-design.md): the bone meshes of a body under the tesla
// arc show through its glowing flesh. No second draw: each bone instance carries `iZap` (the body's
// zap glow, negative on a jolt), and where it is not zero the vertex is pulled toward the camera and
// the fragment is shaded flat.
//
// The pull is a scale about the eye, so a vertex stays on its own view ray: its place on screen is
// unchanged and only its depth moves. pullM clears a body's own flesh; a wall nearer than that still
// hides the bone. The maths is here in TS (tested) and in WGSL (what runs).
import { ZAP_LOOK } from '../march/body/blocks/post/zap.wgsl';

export const ZAP_XRAY = Object.freeze({
  /** How far a zapped bone is pulled toward the eye (m). */
  pullM: 0.6,
  /** The least fraction of its distance a pulled point keeps, so a near bone never crosses the eye. */
  minKeep: 0.25,
});

/** `p` pulled toward `eye` when `zap` is not zero. */
export function xrayPull(p: readonly number[], eye: readonly number[], zap: number): number[] {
  if (zap === 0) return [p[0]!, p[1]!, p[2]!];
  const d = [p[0]! - eye[0]!, p[1]! - eye[1]!, p[2]! - eye[2]!];
  const l = Math.max(Math.hypot(d[0]!, d[1]!, d[2]!), 1e-4);
  const keep = Math.max(ZAP_XRAY.minKeep, 1 - ZAP_XRAY.pullM / l);
  return [eye[0]! + d[0]! * keep, eye[1]! + d[1]! * keep, eye[2]! + d[2]! * keep];
}

/** The bone's colour under a zap of `zap`: its lit colour at 0, the dark bone as |zap| reaches 1, and the
 *  glow instead of the dark on a jolt (zap < 0). */
export function xrayColour(lit: readonly number[], zap: number): number[] {
  const k = Math.min(1, Math.abs(zap));
  const to = zap < 0
    ? ZAP_LOOK.core.map(c => c * (ZAP_LOOK.gain + ZAP_LOOK.rim * 0.5))
    : [...ZAP_LOOK.bone];
  return lit.map((c, i) => c + (to[i]! - c) * k);
}

const v3 = (c: readonly number[]) => `vec3<f32>(${c[0]}, ${c[1]}, ${c[2]})`;

export const ZAP_XRAY_PULL_WGSL = /* wgsl */ `fn zapXrayPull(p: vec3<f32>, eye: vec3<f32>, zap: f32) -> vec3<f32> {
  if (zap == 0.0) { return p; }
  let d = p - eye;
  let l = max(length(d), 1e-4);
  let keep = max(${ZAP_XRAY.minKeep}, 1.0 - ${ZAP_XRAY.pullM} / l);
  return eye + d * keep;
}`;

export const ZAP_XRAY_COLOUR_WGSL = /* wgsl */ `fn zapXrayColour(lit: vec3<f32>, zap: f32) -> vec3<f32> {
  let k = min(1.0, abs(zap));
  let bright = ${v3(ZAP_LOOK.core)} * ${ZAP_LOOK.gain + ZAP_LOOK.rim * 0.5};
  let dark = ${v3(ZAP_LOOK.bone)};
  return mix(lit, select(dark, bright, zap < 0.0), k);
}`;
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/zap-xray.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: The pull, in the instance vertex stage**

`webgpu/skeleton-spike/segment-instance.ts`. Add `wgslFn` and `cameraPosition` to the file's `three/tsl` import (line 30), import the WGSL, and build the function once at module scope:

```ts
import { ZAP_XRAY_PULL_WGSL } from './zap-xray';

const zapXrayPull = wgslFn(ZAP_XRAY_PULL_WGSL);
```

Replace the body of `segmentInstance` (lines 99 to 105):

```ts
export const segmentInstance = Fn((builder: NodeBuilder) => {
  const m = mat4(...SEGMENT_MATRIX_ATTRS.map(name => attribute(name, 'vec4')) as [never, never, never, never]);
  const has = (name: string) => (builder as unknown as { hasGeometryAttribute(name: string): boolean }).hasGeometryAttribute(name);
  // THE ZAP X-RAY (zap-xray.ts): a zapped body's bones are pulled toward the eye, clear of its flesh. The
  // batches sit under an identity group, so the instanced position is the world position. Geometry
  // without the attribute (anything not drawn by mesh-renderer.ts) takes the plain path.
  const placed = m.mul(positionLocal).xyz;
  positionLocal.assign(has('iZap')
    ? zapXrayPull({ p: placed, eye: cameraPosition, zap: attribute('iZap', 'float') })
    : placed);
  if (has('normal')) {
    normalLocal.assign(transformNormal(normalLocal, m as never));
  }
}, 'void');
```

Check the claim in the comment before relying on it: in `mesh-renderer.ts`, find where `group` is created and confirm nothing sets its position, rotation or scale, and that the caller adds it to the scene root (`grep -n "segMeshRenderer.object" src/lab/sdf-zombie/webgpu/game-main.ts`). If the group is ever transformed, transform `cameraPosition` into its space with the group's inverse world matrix as a uniform instead, and say so in the notes.

Every batch of a material shares ONE node build, so `iZap` must be on every geometry those materials draw, or the build that happened to come first decides for all of them. Step 6 puts it everywhere `iFill` is.

- [ ] **Step 6: The attribute, the colour and the sync, in `mesh-renderer.ts`**

Import:

```ts
import { ZAP_XRAY_COLOUR_WGSL } from './zap-xray';
```

**The attribute.** In `ensureLights` (line 719), after the `iFill` line:

```ts
    ensureInstanced(geometry, 'iZap', 1, 0, cap);
```

On `debrisEyeGeometry` (line 640), after its `iFill` line:

```ts
  debrisEyeGeometry.setAttribute('iZap', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
```

Then run `grep -n "'iFill'" src/lab/sdf-zombie/webgpu/skeleton-spike/*.ts src/lab/sdf-zombie/webgpu/*.ts` and, at every site that CREATES an `iFill` attribute on a geometry drawn with a segment material (not the sites that only `setX` an existing one), create an `iZap` beside it, zero-filled, one float per instance. The vertex-buffer budget is 8 per pipeline; the split batches were at six (the comment above `splitRows`) and are now at seven.

**The colour.** Directly after the loop that calls `useSegmentInstance` on every material (line 633 to 635), wrap each material's colour:

```ts
  // THE ZAP X-RAY (zap-xray.ts): where an instance's iZap is not zero its lit colour gives way to the flat
  // bone-in-the-glow colour. Zero on every instance of every body the arc is not on (mix by 0 is exact).
  const zapColour = wgslFn(ZAP_XRAY_COLOUR_WGSL);
  const zapAttr = attribute('iZap', 'float');
  for (const m of [material, material2, ...skullMaterials.values(), eyeMaterial, organMaterial, splitMaterial, splitMaterial2, ...skullSplitMaterials.values(), eyeSplitMaterial]) {
    if (!m?.colorNode) continue;
    const lit = m.colorNode as unknown as { xyz: unknown; w: unknown };
    m.colorNode = vec4(zapColour({ lit: lit.xyz as never, zap: zapAttr }) as never, lit.w as never);
  }
```

This must run after every `colorNode` in that list has been assigned. The split and skull-split materials are assigned further down than line 633 in some branches (lines 567 to 620 are above it, so they are set; confirm `skullSplitMaterial.colorNode` at 620 is too). If any is assigned later, move this loop below the last assignment.

**The sync.** In the `SegmentMeshRenderer` interface, after `syncLights` (line 235):

```ts
  /** THE ZAP X-RAY (zap-xray.ts): copy each drawn instance's owner's zap glow (signed: negative on a jolt)
   *  into its batch's iZap. `zapOf(owner)` is 0 for a body the arc is not on. Call it after update, on
   *  every frame anything is zapped and for one frame after, so the last glow is cleared. */
  syncZap(zapOf: (owner: unknown) => number): void;
```

In the returned object, after `syncLights` (line 1383 to 1401):

```ts
    syncZap(zapOf) {
      for (const b of batches.values()) {
        if (b.count === 0) continue;
        const attr = b.mesh.geometry.getAttribute('iZap') as THREE.InstancedBufferAttribute;
        const arr = attr.array as Float32Array;
        for (let i = 0; i < b.count; i++) arr[i] = zapOf(b.owners[i]);
        markLive(attr, b.count);
      }
    },
```

- [ ] **Step 7: Drive it from the game**

`webgpu/game-zap.ts`, add:

```ts
/** True while any body's bones carry a zap glow, and for the one frame after the last one goes out. */
let xrayLive = false;

/**
 * The skeleton's half of the look: each bone instance takes its owner's signed glow (zap-xray.ts). Call
 * once a frame after the segment renderer's update. Nothing zapped, and nothing to clear: no work.
 */
export function syncZapXray(ctx: GameContext): void {
  const any = glowing.size > 0;
  if (!any && !xrayLive) return;
  xrayLive = any;
  ctx.render.segMeshRenderer?.syncZap(owner => {
    const z = (owner as ZombieActor).zapLook?.();
    return z && z.glow > 0 ? (z.invert ? -z.glow : z.glow) : 0;
  });
}
```

`webgpu/game-main.ts` line 2258 is where `segMeshRenderer.syncLights(ownerBodyLights, ownerFill)` is called, inside `if (listOn)`. The x-ray must not depend on the light list: add the call just OUTSIDE that `if`, after it:

```ts
      syncZapXray(ctx);
```

with `import { syncZapXray } from './game-zap';` at the top. Read the fifteen lines round 2258 first: the owners the renderer was given must be the actors themselves for the cast in `syncZapXray` to hold (`ownerBodyLights` is defined near line 2657 and shows what an owner is). If an owner is not the actor, map it to its actor the way `ownerBodyLights` does.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/zap-xray.test.ts src/lab/sdf-zombie/webgpu/skeleton-spike/segment-instance.test.ts src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-renderer.test.ts`
Expected: PASS.

Run: `npm run test:changed` and `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 9: Look at it, and measure**

Run: `node scripts/zap-trace.mjs`
Expected: assertions pass, including the unchanged pipeline count.

Add one measurement to the script: at the first `zapped` sample, save the frame twice, once as it is and once after `__sdfGame.segMeshRenderer?.show` (or the seam `game-seams-skeleton.ts` exposes for hiding bones: read that file for its name) hides the bones. The mean absolute difference of the two frames over the body's crop is the skeleton's contribution. Expected: at least 8 on a 0 to 255 scale. Under 2 means the bones are not drawing in front of the flesh: check `iZap` reaches the batch (`syncZap` called, `markLive`), then raise `ZAP_XRAY.pullM`.

Open the contact sheet and look. What should be there: ribs, skull, pelvis and limb bones as a dark figure inside the glow, in register with the body; on a jolt frame, bright bones in a dark body. What should not: bones visible through the arena wall when the body stands in front of it (they are nearer, so they should draw), bones of an unzapped body changed in any way.

Record the difference number and what the sheet shows under a "Task 5" heading in the notes.

- [ ] **Step 10: Boot-time gate and commit**

Run: `node scripts/boot-time.mjs`
Expected: within `main`'s spread. The colour wrap touches every segment material, so this number matters: record it.

```bash
git add src/lab/sdf-zombie/webgpu scripts/zap-trace.mjs docs/dev-notes/2026-11-17-tesla-zap
git commit -m "feat(zap): the mesh skeleton shows through the glow, pulled clear of its own flesh"
```

---

## Task 6: Slot 9

**Files:**
- Create: `webgpu/tesla-stick.ts`, `webgpu/tesla-stick.test.ts`, `webgpu/game-tesla.ts`
- Modify: `webgpu/game-weapon-slots.ts:40-57`, `webgpu/game-weapon-slots.test.ts:36,40`, `webgpu/game-state-weapon.ts:46,104,254`, `webgpu/game-main.ts:315,3377,3401,3435`, `webgpu/game-tick.ts:587`, `webgpu/game-weapon-rig.ts:266`, `webgpu/game-loop.ts:171`, `webgpu/game-hud.ts:36`, `webgpu/aim-style.ts:33`, `webgpu/game-seams-fire.ts`

- [ ] **Step 1: Write the failing tests**

`webgpu/tesla-stick.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/tesla-stick.test.ts
import { describe, expect, it } from 'vitest';
import { arcSticks, TESLA } from './tesla-stick';

const eye: [number, number, number] = [0, 1.6, 0];
const aimAt = (deg: number): [number, number, number] => {
  const r = deg * Math.PI / 180;
  return [Math.sin(r), 0, -Math.cos(r)];
};

describe('the arc sticks to its target', () => {
  const centre: [number, number, number] = [0, 1.6, -5];
  it('holds while the aim is inside stickDeg of the body centre', () => {
    expect(arcSticks(eye, aimAt(0), centre)).toBe(true);
    expect(arcSticks(eye, aimAt(TESLA.stickDeg - 0.5), centre)).toBe(true);
  });
  it('drops once the aim leaves it', () => {
    expect(arcSticks(eye, aimAt(TESLA.stickDeg + 0.5), centre)).toBe(false);
    expect(arcSticks(eye, aimAt(180), centre)).toBe(false);
  });
  it('drops a target beyond range', () => {
    expect(arcSticks(eye, aimAt(0), [0, 1.6, -(TESLA.rangeM + 1)])).toBe(false);
  });
  it('holds a target the eye is standing in', () => {
    expect(arcSticks(eye, aimAt(90), [0, 1.6, 0])).toBe(true);
  });
});
```

In `webgpu/game-weapon-slots.test.ts`, change the slot list assertion (line 40) to end `'axe', 'melter', 'tesla']` and add under the `Digit8` line (36):

```ts
    expect(slotForKey('Digit9')).toBe('tesla');
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/tesla-stick.test.ts src/lab/sdf-zombie/webgpu/game-weapon-slots.test.ts`
Expected: FAIL: cannot resolve `./tesla-stick`; `Digit9` is null.

- [ ] **Step 3: Write `tesla-stick.ts`**

```ts
// src/lab/sdf-zombie/webgpu/tesla-stick.ts
//
// THE TESLA'S TARGET STICK (spec 2026-11-17-tesla-arc-design.md), numbers only. Once the arc is on a
// body it stays on while the aim is within a small angle of the body's centre, so an aim wobble does
// not drop it. The line-of-sight half of the rule is the caller's (it needs the level).
import type { Vec3 } from '../types';

export const TESLA = Object.freeze({
  /** The arc's reach (m). */
  rangeM: 12,
  /** The arc holds its target inside this angle of the body's centre (degrees). */
  stickDeg: 8,
});

/** Does an arc from `eye` along the unit `aim` still hold a body centred at `centre`? */
export function arcSticks(eye: Vec3, aim: Vec3, centre: Vec3): boolean {
  const d: Vec3 = [centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l > TESLA.rangeM) return false;
  if (l < 1e-3) return true;
  const cos = (d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2]) / l;
  return cos >= Math.cos(TESLA.stickDeg * Math.PI / 180);
}
```

- [ ] **Step 4: Add the slot**

`webgpu/game-weapon-slots.ts`: append to the doc comment above `WeaponSlot` (after the melter's lines, line 39):

```ts
 *  `tesla` is the tesla arc's dev harness (game-tesla.ts, 2026-11-17): a
 *  placeholder prop; hold fire to zap the body under the crosshair. */
```

then:

```ts
export type WeaponSlot = 'flail' | 'shotgun' | 'dynamite' | 'launcher' | 'flare' | 'rod' | 'axe' | 'melter' | 'tesla';
```

add `, 9 → tesla` to the slot-order comment, `'tesla'` to the end of `WEAPON_SLOTS`, and to `SLOT_BY_KEY`:

```ts
  Digit9: 'tesla',
```

`npm run typecheck` now lists every exhaustive `Record<WeaponSlot, …>` and switch that needs the new slot. Fix each by copying its `melter` entry: `webgpu/aim-style.ts` line 33 gets `tesla: 'free',`; `webgpu/game-loop.ts` line 171 gets `|| slot === 'tesla'` after `slot === 'melter'` (and its comment at 166 names the tesla among the dev harnesses); `webgpu/game-hud.ts` line 36 gets, before the `melter` branch:

```ts
                : S.live === 'tesla'
                  ? '9 TESLA (hold to zap)'
```

- [ ] **Step 5: Write the harness**

`webgpu/game-tesla.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-tesla.ts
//
// WEAPON SLOT 9: THE TESLA ARC'S DEV HARNESS (spec 2026-11-17-tesla-arc-design.md).
//
// A placeholder primitive in hand and ONE verb, in the melter's mould (game-melter.ts): while fire is
// held, the body under the crosshair is zapped (game-zap.ts zapActor), and stays zapped while the aim
// stays near it (tesla-stick.ts). No projectile, no wound. Plan 2 draws the arc between this prop and
// the body; until then there is nothing to see between them.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import { zapActor } from './game-zap';
import { arcSticks } from './tesla-stick';
import { slotLowerAmount, slotReady } from './game-weapon-slots';

const TESLA_REST = new THREE.Vector3(0.11, -0.13, -0.42);

export interface TeslaHarnessDeps {
  /** The ballistic slug march, from an arbitrary ray (game-main's traceSlugHitFrom). */
  traceSlugHitFrom(origin: Vec3, dir: Vec3): { actorId: number; hit: Vec3 | null };
  eye(): Vec3;
  aimDir(): Vec3;
}

export interface TeslaHarness {
  /** A mousedown while slot 9 is live. True = consumed. */
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  /** Once a tick, on the player's clock: finds, holds or drops the target. */
  tick(dt: number): void;
  /** Holster travel, from the same slot state the other rigs read. */
  updateRig(): void;
  /** Hold or release fire (console seam). */
  fire(on: boolean): void;
  /** The body the arc is on, or null. */
  target(): ZombieActor | null;
}

export function createTeslaHarness(ctx: GameContext, deps: TeslaHarnessDeps): TeslaHarness {
  const rig = new THREE.Group();
  rig.name = 'tesla-rig';
  ctx.weapon.aimRig!.add(rig);
  let held = false;
  let target: ZombieActor | null = null;

  // THE PLACEHOLDER PROP: a stubby coil on a grip, a glowing ball on its tip. Primitives only, so there
  // is no asset to be missing; the real weapon replaces this whole group.
  const prop = new THREE.Group();
  prop.name = 'tesla-placeholder';
  {
    const body = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.55, metalness: 0.6 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xb8632c, roughness: 0.35, metalness: 0.9 });
    const spark = new THREE.MeshStandardMaterial({ color: 0xcfe4ff, roughness: 0.2, metalness: 0, emissive: 0x6fa8ff, emissiveIntensity: 1.6 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.2, 14), body);
    core.rotation.x = Math.PI / 2;             // cylinder axis -> view -Z
    core.position.set(0, 0, -0.06);
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 18), copper);
      ring.position.set(0, 0, -0.01 - i * 0.03);
      prop.add(ring);
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), spark);
    ball.position.set(0, 0, -0.18);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.1, 0.045), body);
    grip.position.set(0, -0.07, 0.04);
    grip.rotation.x = THREE.MathUtils.degToRad(-18);
    prop.add(core, ball, grip);
  }
  prop.position.copy(TESLA_REST);
  rig.add(prop);
  if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(rig, 'mesh', 'level-only');

  const drop = () => { if (target) { target.setArc(false); target = null; } };
  const live = () => ctx.weapon.slotState.live === 'tesla' && slotReady(ctx.weapon.slotState);

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'tesla') return false;
      if (button === 0) held = true;
      return true;
    },
    onMouseUp(button) { if (button === 0) held = false; },
    tick() {
      if (!held || !live()) { drop(); return; }
      ctx.weapon.shotAlert = true;   // it is still a weapon: the arc turns heads
      const eye = deps.eye(), aim = deps.aimDir();
      // Hold the target while the aim stays near its centre and it can still be zapped. A statue, a
      // corpse or a body another weapon took refuses setArc's hold: zapPhase leaves 'zapped'.
      if (target) {
        const c = target.pose().pos;
        const centre: Vec3 = [c[0], c[1] + 1.0, c[2]];
        const seen = deps.traceSlugHitFrom(eye, norm([centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]])).actorId === target.id;
        if (arcSticks(eye, aim, centre) && seen && target.zapPhase() !== 'statue' && target.zapping()) { target.setArc(true); return; }
        drop();
      }
      const hit = deps.traceSlugHitFrom(eye, aim);
      if (hit.actorId < 0) return;
      const a = ctx.world.actors.find(x => x.id === hit.actorId);
      if (a && zapActor(ctx, a)) {
        target = a;
        ctx.telemetry.telemetry.event('tesla-arc', { actorId: a.id });
      }
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'tesla');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      rig.visible = lower < 0.999;
    },
    fire(on) { held = on; },
    target: () => target,
  };
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
```

Two things to check against the code before running:

- `traceSlugHitFrom` has no range argument here. Read its definition (`grep -n "function traceSlugHitFrom" src/lab/sdf-zombie/webgpu/*.ts`) for how far it marches. If it reaches past `TESLA.rangeM`, reject a first hit whose `hit` point is further than `TESLA.rangeM` from the eye (`arcSticks` already rejects a held target out of range).
- `pose().pos` is the body's root on the floor (the melt test reads it as `at`); `+ 1.0` puts the centre at chest height for a man-sized body. If the actor exposes a body centre (`grep -n "bodyCentre\|centre()" src/lab/sdf-zombie/webgpu/game-actor.ts`), use that instead.

- [ ] **Step 6: Wire it, beside the melter at every site**

`webgpu/game-state-weapon.ts`: `import type { TeslaHarness } from './game-tesla';` under the melter import (46); under the `melter:` field (104):

```ts
  /** Slot 9 (the tesla arc's dev harness, game-tesla.ts); null until the aim rig exists. */
  tesla: TeslaHarness | null;
```

and `tesla: null,` under `melter: null,` (254). If `game-state-weapon.test.ts` pins the slice's keys, add `tesla`.

`webgpu/game-main.ts`: `import { createTeslaHarness } from './game-tesla';` under the melter import (315). After the melter's mousedown line (3377):

```ts
    // SLOT 9 (the tesla): held; the tick finds and holds the target.
    if (ctx.weapon.tesla?.onMouseDown(e.button)) return;
```

After the rod's mouseup listener (3401):

```ts
  window.addEventListener('mouseup', (e) => ctx.weapon.tesla?.onMouseUp(e.button));
```

After the melter's `createMelterHarness` block (3435 to 3437):

```ts
  // WEAPON SLOT 9 (the tesla arc's dev harness, game-tesla.ts): its own rig on aimRig.
  ctx.weapon.tesla = createTeslaHarness(ctx, {
    traceSlugHitFrom: withCtx(ctx, traceSlugHitFrom), eye: () => eyeOf(ctx.player.player), aimDir: withCtx(ctx, aimDir),
  });
```

`webgpu/game-tick.ts`, after `ctx.weapon.melter?.tickCooldown(fireDt);` (587):

```ts
  ctx.weapon.tesla?.tick(fireDt);
```

`webgpu/game-weapon-rig.ts`, after `ctx.weapon.melter?.updateRig();` (266):

```ts
  ctx.weapon.tesla?.updateRig();
```

`webgpu/game-seams-fire.ts`, after the `zaps:` member added in Task 4:

```ts
    // Slot 9's verb: hold (true) or release (false) the tesla's fire.
    fireTesla: (on = true) => { ctx.weapon.tesla?.fire(on); },
```

(add `fireTesla` to any seam-name list test, as in Task 4.)

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/tesla-stick.test.ts src/lab/sdf-zombie/webgpu/game-weapon-slots.test.ts src/lab/sdf-zombie/webgpu/game-state-weapon.test.ts`
Expected: PASS.

Run: `npm run test:changed` and `npm run typecheck`
Expected: PASS, no errors. `game-context-coverage` must pass: the harness's state is inside the feature module and on `ctx.weapon`, not in `main()`.

- [ ] **Step 8: Drive it headless**

Extend `scripts/zap-trace.mjs` with a second scenario after the first (reload the page between them): select slot 9 through the seam `game-seams-weapon-aim.ts` exposes for slot select (read the file for its name); aim at the spawned zombie with that file's aim helper; `__sdfGame.fireTesla(true)`; sample `__sdfGame.zaps()` every 0.1 s for 0.6 s; `__sdfGame.fireTesla(false)`; sample for a further 1.2 s.

Assertions: a sample within 0.2 s of fire shows phase `zapped`; the first sample after release shows `recovering`; the last shows no entry for the body, or an entry with `glow` 0 and `char` 0.

Run: `node scripts/zap-trace.mjs`
Expected: both scenarios pass.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/webgpu scripts/zap-trace.mjs
git commit -m "feat(tesla): slot 9, a placeholder coil that zaps the body it is held on"
```

---

## Task 7: Notes, spec, board

**Files:**
- Modify: `docs/dev-notes/2026-11-17-tesla-zap/NOTES.md`, `docs/superpowers/specs/2026-11-17-tesla-arc-design.md`, `docs/tasks/combat-and-gore.md`, `TASKS.md`, `docs/architecture/module-index.md`

- [ ] **Step 1: Finish the notes**

`docs/dev-notes/2026-11-17-tesla-zap/NOTES.md` gets, beside the per-task numbers already there:

- what was built, one line per file in the file map;
- every place the code differs from this plan, and why;
- the final `scripts/zap-trace.mjs` output (phases, timings, luminance series, the skeleton difference, the pipeline counts);
- the two boot-time numbers from Task 5;
- **Not verified:** the look in motion (the owner's, in the arena), any character but the zombie, the procedural-skeleton probe (`?skeleton=procedural`), a zap on a body in a crowd draw, bullet time.

- [ ] **Step 2: Bring the spec in line**

In `docs/superpowers/specs/2026-11-17-tesla-arc-design.md`, edit the text so it says what was built: the six departures listed at the top of this plan (the statue's time is `ZAP.statueSec`; no tiptoes or knees; variant 1 is "arms higher"; the tremor is a trunk rotation; `iZap` on the existing batches instead of an x-ray batch; the flesh block in two places; `ZapOut.pose` and `statueDone`). Change its status line to `Status: plan 1 (the zap state) built 2026-11-17; plans 2 and 3 not built.`

- [ ] **Step 3: The board**

Add a section at the top of `docs/tasks/combat-and-gore.md`, in the style of the melt section under it:

```markdown
## The tesla arc — 2026-11-17

Spec [2026-11-17-tesla-arc-design.md](../superpowers/specs/2026-11-17-tesla-arc-design.md). Three plans.

- [x] **1 The zap state** ([plan](../superpowers/plans/2026-11-17-tesla-1-zap-state.md) · [notes](../dev-notes/2026-11-17-tesla-zap/NOTES.md)):
  slot 9 placeholder; hold fire and the body under the crosshair goes rigid in the star, glows blue-white with its
  skeleton showing, chars late and dies on a full cook (its ordinary death, for now). Console: `__sdfGame.zapActor(id?)`,
  `unzapActor(id?)`, `fireTesla(on)`, `zaps()`. Owner to judge the look in the arena; every number is a first guess.
- [ ] **2 The arc**: the bolt, forks, crawl arcs and light. No plan yet.
- [ ] **3 The ash death**: statue, then crumble to an ash heap. No plan yet.
```

In `TASKS.md`, add one line under the in-flight list pointing at that section.

- [ ] **Step 4: Check the module index**

Run: `npx tsx scripts/module-index.ts --check` and `npx tsx scripts/module-index.ts --missing`
Expected: not stale, nothing missing. Every new module in the file map has its line.

- [ ] **Step 5: Last checks and commit**

Run: `npm run typecheck` and `npm run test:changed`
Expected: no errors; PASS.

```bash
git add docs TASKS.md
git commit -m "docs(tesla): notes, spec and board for the zap state"
```

---

## What the owner looks at

`npm run dev:arena`, key `9`, hold fire on the zombie. `-` and `=` cycle characters.

- Does the star read as "electrocuted" at a glance, and is the tremor too much or too little?
- Is the glow the right colour and brightness, and does the skeleton read inside it?
- Do the jolts (pose snap plus inverted bones) land, or are they too frequent?
- Is two seconds to cook right, and does the char arrive at the right moment?
