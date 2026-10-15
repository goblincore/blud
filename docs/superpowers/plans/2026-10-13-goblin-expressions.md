# Goblin Facial Expressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the goblin animated facial expressions (a toothy evil grin first, then scowl, shout and blink): sharp teeth, a hinged jaw, and a generated face sheet that follows, all driven by keyed expression clips.

**Spec:** `docs/superpowers/specs/2026-10-13-goblin-expressions-design.md` — read it first. Decisions already made by the owner (do not re-ask): the set is neutral, grin, scowl, shout plus a blink overlay; teeth are jagged and uneven (5 small upper, 2 upper fangs, 4 small lower, 11 prims); mechanism A (jaw bone plus expression channels), with approach C (per-prim morph targets) only if the owner rejects the look; base is current `main`, lab page only.

**Architecture:** `expression.ts` (pure) turns keyed clips into named channels and then into two mechanism outputs: a `jawGape` scalar (consumed by the bride's existing jaw system in `rig-bind.ts`) and overrides on the goblin's authored `FaceSheetParams`. The `.blob` gets a `jaw` carrier bone, the lower face split onto it, and teeth. The lab regenerates the 64x64 sheet in place only when the quantised sheet params change.

**Tech Stack:** TypeScript, three.js WebGPU (lab glue only), Vitest, headless-Chrome capture scripts (`scripts/blob-shot.sh`, `scripts/blob-turntable.mjs`). No new WGSL.

---

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port, production scope 4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests** (no `three` import; plain data in, plain data out). The renderer-facing module only reads that logic's output and writes uniforms/objects. Here: `expression.ts` is the pure module; `lab-main.ts` is only glue.
  - Rendering that matters goes in hand-written WGSL; this feature adds none.
  - Keep the simulation deterministic (no wall-clock in logic; clip time is passed in).
- Work ONLY in this worktree (`/Users/donny/Projects/blud/.claude/worktrees/wizardly-wing-61896d`). Never `git stash`. `node_modules` is symlinked: do not reinstall.
- **Targeted tests only:** `npx vitest run <path>`, `npm run test:changed`, `npm run typecheck`. **Never the full suite locally**; CI runs it on every push (`gh run list --branch claude/wizardly-wing-61896d`).
- **Headless capture only** — the in-app browser pane loses the WebGPU device. Use `npm run blob:shot` with your OWN ports (`LAB_VITE_PORT=5271 LAB_CDP_PORT=9271`); never touch the owner's dev server on 5173. Kill anything you start outside a capture script in the same step.
- **Prove visual claims with a number and by looking at the frames yourself.**
- Extracted Blood assets are dev placeholders — never commit them.
- **Memory:** use `dualmem` (see `~/.claude/CLAUDE.md`), never MEMORY.md files. `source ~/.claude/hooks/dualmem-env.sh` first. Save warnings and decisions with `--files`.
- Commit messages end with the attribution line the session specifies: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **The owner judges the look.** Tasks that tune numbers by eye stop at a stated gate and show frames; do not decide taste questions alone.

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/lab/sdf-zombie/characters/goblin-head-profile.ts` | Create | Pinned rest-profile probes of the goblin's head and the function that measures them |
| `scripts/goblin-head-profile.ts` | Create | CLI: print measured vs pinned profile (the tuning loop for Tasks 2-3) |
| `src/lab/sdf-zombie/characters/goblin.blob` | Modify | `jaw` bone, lower-face split, lower lip on the jaw, teeth, mouth interior |
| `src/lab/sdf-zombie/characters/goblin-blob.test.ts` | Modify | Profile pins, jaw tests, teeth-hidden-at-rest pins |
| `src/lab/sdf-zombie/blob-face-sheet.ts` | Modify | `eyeLid` param, `sheetToRgba` helper |
| `src/lab/sdf-zombie/blob-face-sheet.test.ts` | Modify | Tests for both |
| `src/lab/sdf-zombie/expression.ts` | Create | Channels, clips, `expressionAt`, `blinkLid`, `withBlink`, `actuate`, `sheetKey` |
| `src/lab/sdf-zombie/expression.test.ts` | Create | Pure tests |
| `src/lab/sdf-zombie/characters/goblin-expressions.ts` | Create | The goblin's tuning table and clips (data) |
| `src/lab/sdf-zombie/expression-library.ts` | Create | `expressionsFor(character)` (mirrors `pose-library.ts`) |
| `src/lab/sdf-zombie/characters/goblin-expressions.test.ts` | Create | Data tests and the motion-wiring test |
| `src/lab/sdf-zombie/motion.ts`, `src/lab/sdf-zombie/actor.ts` | Modify | `jawGape` input on the motion config / actor step |
| `src/lab/sdf-zombie/webgpu/lab-main.ts` | Modify | Gape override, in-place sheet update, expression state, panel, API |
| `scripts/blob-turntable.mjs` | Modify | `BLOB_GAPE`, `BLOB_EXPR` env |
| `scripts/goblin-expression-sheet.sh` | Create | Contact sheet of every expression |
| `docs/dev-notes/2026-10-13-goblin-expressions/` | Create | Frames and NOTES.md |
| `TASKS.md`, `docs/tasks/characters.md` | Modify | Status |

Geometry facts (verified 2026-10-13, goblin rest pose, 1.30 m authored frame): skull bone pivot `(0, 1.1186, 0.0129)`, tip `(0, 1.3527, -0.0076)`; cranium centre `(0, 1.2239, 0.0037)`; the face block's jaw ellipsoid centre `(0, 1.1479, 0.0437)`, semi-axes 0.0688 x 0.0792 x 0.0789; upper lip prim spans y about 1.135-1.165, lower lip prim y about 1.09-1.129, mouth seam about y 1.131, groove at y 1.1327. `.blob` prim anchors: `at=<t>` is the fraction along the declared bone, `offset=` is a world-axis vector added to that point, `tip=` is the vector from the offset point to the far end (so a prim's `a` = anchor + offset and `b` = `a` + tip). Mirror-expanded prims need `both`; the teeth below are written out explicitly, one line each, so none uses `both`.

---

### Task 1: Pin the head's rest profile before touching it

The jaw split must not move the approved head. Pin today's profile first, as a shared data module, a test and a CLI that prints measured vs pinned.

**Files:**
- Create: `src/lab/sdf-zombie/characters/goblin-head-profile.ts`
- Create: `scripts/goblin-head-profile.ts`
- Modify: `src/lab/sdf-zombie/characters/goblin-blob.test.ts` (append a `describe`)

- [ ] **Step 1: Write the shared module**

```ts
// src/lab/sdf-zombie/characters/goblin-head-profile.ts
//
// The goblin head's REST profile as seven reach probes, measured 2026-10-13 on the head BEFORE the jaw split (expression pass,
// docs/superpowers/plans/2026-10-13-goblin-expressions.md). The split puts the lower face on a `jaw` bone; the owner approved the
// head as it stood, so at rest the silhouette has to land where it did. Each probe walks from a point INSIDE the flesh along a
// direction until the field turns positive (the same 0.5 mm march goblin-blob.test.ts's `reach` uses) and reports the distance.
// Used by goblin-blob.test.ts and scripts/goblin-head-profile.ts (the tuning loop).
import { sdBody } from '../validate';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';

/** How far a probe may drift from its pinned value, metres. */
export const PROFILE_TOL = 0.003;

export interface ProfileProbe {
  name: string;
  from: Vec3;
  dir: Vec3;
  /** Pinned reach, metres. */
  want: number;
}

export const PROFILE_PROBES: readonly ProfileProbe[] = [
  // Front of the face, x = 0, going forward from the head's axis: chin, lower lip, mouth groove.
  { name: 'front y1.09 (chin)', from: [0, 1.09, 0], dir: [0, 0, 1], want: 0.1025 },
  { name: 'front y1.11 (lower lip)', from: [0, 1.11, 0], dir: [0, 0, 1], want: 0.118 },
  { name: 'front y1.13 (groove)', from: [0, 1.13, 0], dir: [0, 0, 1], want: 0.116 },
  // Half-width of the face at three heights, going out from the axis.
  { name: 'half-width y1.10', from: [0, 1.10, 0.03], dir: [1, 0, 0], want: 0.054 },
  { name: 'half-width y1.15', from: [0, 1.15, 0.03], dir: [1, 0, 0], want: 0.074 },
  { name: 'half-width y1.20', from: [0, 1.20, 0.03], dir: [1, 0, 0], want: 0.0855 },
  // The underside of the chin, going down.
  { name: 'chin underside', from: [0, 1.10, 0.07], dir: [0, -1, 0], want: 0.029 },
];

/** Distance from `p` along unit `d` to where the body's field turns positive, 0.5 mm steps. NaN if `p` starts outside the
 *  body or the ray never leaves it within `max`. */
export function reachOf(body: BuildResult, p: Vec3, d: Vec3, max = 0.3): number {
  if (sdBody(p, body) > 0) return NaN;
  for (let t = 0; t < max; t += 0.0005)
    if (sdBody([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t], body) > 0) return t;
  return NaN;
}

export function measureProfile(body: BuildResult): { probe: ProfileProbe; got: number }[] {
  return PROFILE_PROBES.map(probe => ({ probe, got: reachOf(body, probe.from, probe.dir) }));
}
```

- [ ] **Step 2: Write the CLI**

```ts
// scripts/goblin-head-profile.ts
//
//   npx tsx scripts/goblin-head-profile.ts            # the committed goblin.blob
//   npx tsx scripts/goblin-head-profile.ts path.blob  # a candidate
//
// Prints each pinned head-profile probe (characters/goblin-head-profile.ts) beside what the .blob measures now, and exits 1 if
// any is outside PROFILE_TOL. This is the tuning loop for the jaw split: edit goblin.blob, rerun, repeat until it is green.
import { readFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { measureProfile, PROFILE_TOL } from '../src/lab/sdf-zombie/characters/goblin-head-profile';

const path = process.argv[2] ?? 'src/lab/sdf-zombie/characters/goblin.blob';
const doc = parseBlob(readFileSync(path, 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
let bad = 0;
for (const { probe, got } of measureProfile(body)) {
  const d = got - probe.want;
  const ok = Number.isFinite(got) && Math.abs(d) <= PROFILE_TOL;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${probe.name.padEnd(24)} want ${probe.want.toFixed(4)}  got ${got.toFixed(4)}  (${(d * 1000).toFixed(1)} mm)`);
}
if (body.errors.length > 0) { console.log('build errors:', body.errors); bad++; }
process.exit(bad === 0 ? 0 : 1);
```

- [ ] **Step 3: Append the test to `goblin-blob.test.ts`**

Add the import near the other imports and the `describe` at the end of the file:

```ts
import { measureProfile, PROFILE_TOL } from './goblin-head-profile';
```

```ts
describe('goblin head rest profile (expression pass)', () => {
  // Pinned BEFORE the jaw split (see goblin-head-profile.ts). The split must leave the approved silhouette where it was.
  it.each(measureProfile(built()).map(m => [m.probe.name, m] as const))('%s is within 3 mm of the approved head', (_n, m) => {
    expect(Number.isFinite(m.got), 'probe starts inside the flesh and leaves it').toBe(true);
    expect(Math.abs(m.got - m.probe.want)).toBeLessThanOrEqual(PROFILE_TOL);
  });
});
```

- [ ] **Step 4: Run it; it must PASS on the unmodified head**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts -t "head rest profile"` and `npx tsx scripts/goblin-head-profile.ts`
Expected: all 7 probes `ok`, exit 0. (If a probe prints FAIL here, the measured number differs from the plan; re-measure with the CLI and update `want` in `goblin-head-profile.ts` to the printed `got`, then say so in the commit message.)

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin-head-profile.ts scripts/goblin-head-profile.ts src/lab/sdf-zombie/characters/goblin-blob.test.ts
git commit -m "test(goblin): pin the head's rest profile before the jaw split

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The jaw bone and the lower-face split

Reuse the bride's jaw system (`jaw.ts`): a carrier bone, `on jaw` prims, `rig.jawGape`. The goblin's lower face is the face block's jaw ellipsoid plus the lower lip, so the ellipsoid is shortened to end at the mouth line and a lower mass (the chin) goes on the jaw.

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin.blob`
- Modify: `src/lab/sdf-zombie/characters/goblin-blob.test.ts`

- [ ] **Step 1: Write the failing jaw tests**

Add imports (merge with existing ones in the file):

```ts
import { bindRig, applyRig } from '../rig-bind';
import { makeActorMotion } from '../actor';
```

Append:

```ts
describe('goblin jaw (expression pass)', () => {
  const body = built();

  it('has a jaw bone: a carrier from the skull pivot down and forward to the chin, below the lips', () => {
    const jaw = body.bones.get('jaw');
    expect(jaw, 'bone jaw').toBeDefined();
    const pivot = body.bones.get('skull')!.head;
    expect(jaw!.head).toEqual(pivot);
    expect(jaw!.tail[1]).toBeLessThan(1.10); // under the lower lip (y 1.09-1.129)
    expect(jaw!.tail[2]).toBeGreaterThan(0.07); // forward of the skull axis
  });

  it('is a named motion joint, so the rig can pin it', () => {
    const m = makeActorMotion(body, { seed: 1 });
    expect(m.motionJoints, 'goblin still builds motion joints').not.toBeNull();
    expect(m.motionJoints!.index.jaw, 'jaw joint index').toBeDefined();
    expect(m.motionJoints!.jaw, 'jaw rest geometry').toBeDefined();
  });

  it('only the `on jaw` prims open (lower lip and chin mass); everything else stays', () => {
    const bound = bindRig(body);
    const shut = applyRig(body, bound, 0);
    const open = applyRig(body, { ...bound, rig: { ...bound.rig, jawGape: 0.15 } }, 0);
    const moved = body.prims.map((_, i) => Math.hypot(
      shut.prims[i]!.a[0] - open.prims[i]!.a[0], shut.prims[i]!.a[1] - open.prims[i]!.a[1], shut.prims[i]!.a[2] - open.prims[i]!.a[2]));
    body.prims.forEach((p, i) => {
      if (p.bone === 'jaw') expect(moved[i], `jaw prim ${i}`).toBeGreaterThan(0.008);
      else expect(moved[i], `${p.bone} prim ${i}`).toBe(0);
    });
    expect(body.prims.filter(p => p.bone === 'jaw').length, 'lower lip + chin mass (+ lower teeth once Task 3 lands)').toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts -t "goblin jaw"`
Expected: FAIL with `bone jaw` undefined.

- [ ] **Step 3: Edit `goblin.blob`**

(a) In the `skeleton` block, directly after the `bone skull ...` line, add (it is a carrier like the bride's; see `jaw.ts` for why the tail sits at the chin; pitch 112 swings the bone forward and below horizontal: direction (0, cos112, sin112), tail = pivot + 0.083 x that = (0, 1.0875, 0.0898)):

```
  # THE JAW (expression pass, 2026-10-13). Not a hinge bone: a CARRIER for one kinematic rig point, exactly as the bride's
  # (bride.blob, bone jaw; jaw.ts). It hangs off the skull's pivot to the chin so gait.ts can name its tail `jaw`. The jaw
  # ROTATES about jaw.ts's JAW_HINGE on the skull axis, and rig-bind turns every prim declared `on jaw` by the gape. Rest tail
  # is (0, 1.0875, 0.0898): below and in front of the lower lip.
  bone jaw    parent=neck   dir=up pitch=112 len=0.083
```

(b) In the `face` block change the three jaw numbers (the upper face mass now ENDS at the mouth line; the chin mass goes on the jaw below). Replace `jawHeight  0.861`, `jawDrop    0.076`, `jawJut     0.04` with the lines below, and add the comment above `headRadius`'s block explaining the exception to "DEFAULT_FACE's values":

```
  # EXPRESSION PASS (2026-10-13): the jaw trio below is NOT default any more. The face block's jaw ellipsoid used to run from the
  # cheeks down to the chin as one rigid mass; the mouth has to hinge, so this ellipsoid is shortened to end at the mouth line (its
  # bottom is now about y 1.122; centre y 1.1749, z 0.0767) and the chin is a separate mass `on jaw` in the body block. The upper
  # edge is unchanged (1.2271). The rest silhouette is pinned by goblin-blob.test.ts ("head rest profile").
  jawHeight  0.571
  jawDrop    0.049
  jawJut     0.073
```

(c) In the body block, replace the LOWER lip line (the one with `offset=(0,-0.028,0.056)`) with the on-jaw version (same shape; offset re-expressed from the jaw tail: `a` was (0, 1.1187, 0.0664), tail is (0, 1.0875, 0.0898), so offset = (0, 0.0312, -0.0234)):

```
  blob head on jaw at=1.0 r=0.024 r2=0.018 wide=1.12 tall=0.42 blend=0.0016 chamfer offset=(0,0.0312,-0.0234) tip=(0,-0.018,0.038)
```

and add, right after the two lip lines and before the groove comment, the lower mass (the chin). Its top is meant to sit a few millimetres above the upper mass's bottom, so at rest the two overlap and the gape opens a gap; centre (0, 1.0985, 0.0640):

```
  # THE CHIN (expression pass): the lower part of what used to be the jaw ellipsoid, on the jaw bone so it opens with the gape.
  # Its top (about y 1.126) overlaps the shortened upper mass (bottom about 1.122) by a few millimetres, so at rest the two read as
  # one surface; at a gape of 0.15 rad the lower lip drops about 13 mm and the overlap becomes a gap. The jaw part starts BELOW
  # the lip line on purpose (the bride's lesson, jaw.ts): started higher, its round top cap swings down WITH the jaw and fills the
  # opening with skin.
  blob head on jaw at=1.0 r=0.045 wide=1.20 tall=0.61 deep=1.20 blend=0.010 offset=(0,0.011,-0.0258)
```

- [ ] **Step 4: Tune to the pinned profile**

Run: `npx tsx scripts/goblin-head-profile.ts`
Expected first run: some FAIL lines (these are starting values, derived by hand). Adjust ONLY these knobs, one at a time, rerunning each time (expect 3-6 iterations): the chin mass's `deep`, `tall`, `wide`, `r` and `offset` z/y; the face block's `jawHeight`/`jawDrop`/`jawJut` within +-0.01. Do not touch the lips' shape, the nose, the ears or the cranium numbers. Stop when the CLI exits 0 (all seven probes within 3 mm, no build errors).
Also run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts` — all existing pins (arm daylight, fuse, head size, the new profile pins) must pass.

- [ ] **Step 5: Run the tests; they must pass**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts src/lab/sdf-zombie/characters/goblin-kit.test.ts src/lab/sdf-zombie/characters/goblin-poses.test.ts`
Expected: PASS. If `goblin-kit.test.ts` fails on a vertex near the head (sunglasses, ear hooks) the head surface moved more than the profile pins catch: re-tune the chin mass until it passes, never edit the kit test's numbers.
If `goblin-poses.test.ts` fails with `pose rig: no bone end for joint "jaw"`, `jointForBoneEnd('jaw','tail')` is not resolving; check the bone is named exactly `jaw` and parented to `neck`.

- [ ] **Step 6: Sync the kit source (the glTF is only rebuilt if WAM is installed)**

The goblin has no kit skeleton-parity test (the bride has one), so nothing fails if this is skipped; it keeps the hand transcription honest. In `src/lab/sdf-zombie/characters/goblin-kit.wam`, directly after the `bone skull ...` line add (the kit is the .blob's numbers x 0.7692, i.e. 1.00/1.30; 0.083 x 0.7692 = 0.0638; an `up` bone's pitch is verbatim):

```
  # THE JAW (goblin.blob, expression pass): a point-carrier from the skull pivot to the chin. No kit piece rides it; it is
  # transcribed so the skeleton matches the .blob. Up bone: pitch verbatim; 0.083 m / 1.30.
  bone jaw    parent=neck   dir=up pitch=112 len=0.0638
```

Then, only if `test -d "${WAM_DIR:-$HOME/Projects/2026/wam}"` succeeds, rebuild with `scripts/build-wam-kit.sh goblin` and re-run `npx vitest run src/lab/sdf-zombie/characters/goblin-kit.test.ts` (geometry must be unchanged; the only new node is `jaw`). If WAM is not installed, revert the `.wam` edit (`git checkout -- src/lab/sdf-zombie/characters/goblin-kit.wam`) so the source and the committed glTF stay in step, and say so in the commit message and the notes.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin.blob src/lab/sdf-zombie/characters/goblin-blob.test.ts
git add src/lab/sdf-zombie/characters/goblin-kit.wam public/assets/lab/goblin-kit.gltf 2>/dev/null || true
git commit -m "feat(goblin): a jaw bone and the lower face split onto it (rest profile unchanged)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Teeth and the mouth's inside

11 prims, jagged and uneven, dirty ivory, pointed; hidden when the mouth is shut. All teeth carry the marker `color=8f8266 gloss=0.15` (the cultist's dirty ivory; clean ivory under the key light reads yellow) so the test can find them.

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin.blob`
- Modify: `src/lab/sdf-zombie/characters/goblin-blob.test.ts`

- [ ] **Step 1: Write the failing tests**

Add near the top-level imports: `import { parseBlob } from '../blob-parse';` is already imported; add `import { readFileSync } from 'node:fs';` is NOT needed (the file uses `?raw`). Append:

```ts
describe('goblin teeth and mouth interior (expression pass)', () => {
  const TOOTH = /color=8f8266 gloss=0\.15/;
  const INTERIOR = /color=2a0608/;
  const bodyOf = (text: string) => buildBody(compileBlob(parseBlob(text), compileFace(parseBlob(text))));
  const full = bodyOf(src);
  const bare = bodyOf(src.split('\n').filter(l => !TOOTH.test(l) && !INTERIOR.test(l)).join('\n'));
  const same = (p: { a: Vec3; b: Vec3 }, q: { a: Vec3; b: Vec3 }) =>
    p.a.every((v, k) => Math.abs(v - q.a[k]!) < 1e-9) && p.b.every((v, k) => Math.abs(v - q.b[k]!) < 1e-9);
  const teeth = full.prims.filter(p => !bare.prims.some(q => same(p, q)));

  it('has 11 teeth plus the mouth interior bar, 5 small and 2 fangs above, 4 small below', () => {
    expect(full.errors).toEqual([]);
    expect(teeth.length).toBe(12); // 11 teeth + 1 interior bar
    const upper = teeth.filter(p => p.bone === 'skull');
    const lower = teeth.filter(p => p.bone === 'jaw');
    expect(upper.length, 'upper: 7 teeth + the interior bar').toBe(8);
    expect(lower.length, 'lower teeth').toBe(4);
  });

  it('every tooth and the interior bar is buried at rest: both ends are inside the tooth-free flesh', () => {
    for (const p of teeth) {
      expect(sdBody(p.a, bare), `end a of ${p.bone} prim`).toBeLessThan(-0.0005);
      expect(sdBody(p.b, bare), `end b of ${p.bone} prim`).toBeLessThan(-0.0005);
    }
  });

  it('adding them does not move the head profile', () => {
    for (const m of measureProfile(full)) expect(Math.abs(m.got - m.probe.want), m.probe.name).toBeLessThanOrEqual(PROFILE_TOL);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts -t "teeth and mouth interior"`
Expected: FAIL (`expected 12 ... 0`).

- [ ] **Step 3: Add the teeth and the interior to `goblin.blob`**

Place directly after the `groove` line in the body block. Upper teeth are on the skull, anchored at the pivot (`at=0.0`), roots at y 1.128 / z 0.100 (offset y 0.0094, z 0.0871) hanging down; lower teeth are on the jaw anchored at its tail (`at=1.0`), roots at y 1.116 / z 0.098 (offset y 0.0285, z 0.0082) pointing up.

```
  # THE MOUTH'S INSIDE AND THE TEETH (expression pass, 2026-10-13; owner: "a toothy evil grin", jagged and uneven with two
  # fangs). Everything below is buried when the jaw is shut (goblin-blob.test.ts pins both ends of every one inside the
  # tooth-free flesh) and shows only as the gape opens the gap between the shortened upper face mass (bottom about y 1.122) and the
  # chin mass on the jaw.
  #
  # The inside is a dark wet bar on the skull, 4 cm behind the lips' front (the bride's trick, bride.blob): never the nearest
  # prim to the rest skin, so it paints nothing at rest, and it is the throat once the jaw drops.
  bar  head on skull from=0.0 to=0.0 offset=(-0.030,0.004,0.057) tip=(0.060,0,0) r=0.010 tall=1.6 blend=0.003 color=2a0608 gloss=0.85
  #
  # Upper row: five small teeth of uneven length and two longer fangs (the 2nd and 6th), spaced so each reads as a tooth against
  # the dark rather than a yellow clump (the cultist's 8-tooth first try). Pointed (r2), chamfered, roots 9 mm inside the face
  # mass. No colour variation and no grain: the owner wants fine surface detail kept small.
  blob head on skull at=0.0 r=0.0045 r2=0.0010 blend=0.002 chamfer offset=(-0.032,0.0094,0.0871) tip=(0,-0.012,0.002) color=8f8266 gloss=0.15
  blob head on skull at=0.0 r=0.0062 r2=0.0010 blend=0.002 chamfer offset=(-0.022,0.0094,0.0871) tip=(0,-0.020,0.002) color=8f8266 gloss=0.15
  blob head on skull at=0.0 r=0.0045 r2=0.0010 blend=0.002 chamfer offset=(-0.011,0.0094,0.0871) tip=(0,-0.013,0.002) color=8f8266 gloss=0.15
  blob head on skull at=0.0 r=0.0045 r2=0.0010 blend=0.002 chamfer offset=(-0.001,0.0094,0.0871) tip=(0,-0.010,0.002) color=8f8266 gloss=0.15
  blob head on skull at=0.0 r=0.0045 r2=0.0010 blend=0.002 chamfer offset=(0.010,0.0094,0.0871) tip=(0,-0.014,0.002) color=8f8266 gloss=0.15
  blob head on skull at=0.0 r=0.0062 r2=0.0010 blend=0.002 chamfer offset=(0.022,0.0094,0.0871) tip=(0,-0.019,0.002) color=8f8266 gloss=0.15
  blob head on skull at=0.0 r=0.0045 r2=0.0010 blend=0.002 chamfer offset=(0.032,0.0094,0.0871) tip=(0,-0.011,0.002) color=8f8266 gloss=0.15
  # Lower row, on the jaw: four small teeth jutting up between the upper ones.
  blob head on jaw at=1.0 r=0.0050 r2=0.0010 blend=0.002 chamfer offset=(-0.027,0.0285,0.0082) tip=(0,0.014,0.002) color=8f8266 gloss=0.15
  blob head on jaw at=1.0 r=0.0055 r2=0.0010 blend=0.002 chamfer offset=(-0.009,0.0285,0.0082) tip=(0,0.016,0.002) color=8f8266 gloss=0.15
  blob head on jaw at=1.0 r=0.0050 r2=0.0010 blend=0.002 chamfer offset=(0.011,0.0285,0.0082) tip=(0,0.012,0.002) color=8f8266 gloss=0.15
  blob head on jaw at=1.0 r=0.0050 r2=0.0010 blend=0.002 chamfer offset=(0.028,0.0285,0.0082) tip=(0,0.015,0.002) color=8f8266 gloss=0.15
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts`
Expected: PASS. If "buried at rest" fails for a tooth, its tip or root lands outside the shut mouth's flesh: move that tooth's offset z 2 mm deeper (smaller z) or its root offset y 2 mm further into the mass, rerun, repeat. If "adding them does not move the head profile" fails, a tooth is breaking the surface at x = 0: same fix.
Also run: `npx tsx scripts/goblin-head-profile.ts` (exit 0) and `npx vitest run src/lab/sdf-zombie/characters/goblin-kit.test.ts src/lab/sdf-zombie/characters/goblin-poses.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin.blob src/lab/sdf-zombie/characters/goblin-blob.test.ts
git commit -m "feat(goblin): jagged teeth, two fangs and a dark mouth interior, all buried when the jaw is shut

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The spike: see the jaw open in the lab (GATE)

A hand-set gape in the lab, frames at three gapes, and a decision point with the owner before the expression system is built on top. This answers the spec's main risk: does a small gape alone read as a grin?

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `scripts/blob-turntable.mjs`
- Create: `docs/dev-notes/2026-10-13-goblin-expressions/` (frames)

- [ ] **Step 1: Add the gape override to `lab-main.ts`**

(a) Import: add `import { JAW_MAX_GAPE } from '../jaw';` near the other `'../'` imports.

(b) Next to `let poseHeld = false;` (around line 964) add:

```ts
  /** THE EXPRESSION LAYER's jaw gape (rad, jaw.ts). The spike sets it by hand (`__sdfLab.setJawGape`); Task 9 drives it from
   *  clips. It rides on top of the motion's own gape (the bride's sword swing): the larger wins. */
  let exprGape = 0;
```

(c) Find the line `const posed = applyRig(current, heroMotion.bound, heroMotion.lastBodyYaw);` (around line 2737) and replace it with:

```ts
    // The expression layer's gape: statue mode and held captures never run the motion step that would set rig.jawGape.
    const boundForPose = exprGape > (heroMotion.bound.rig.jawGape ?? 0)
      ? { ...heroMotion.bound, rig: { ...heroMotion.bound.rig, jawGape: exprGape } }
      : heroMotion.bound;
    const posed = applyRig(current, boundForPose, heroMotion.lastBodyYaw);
```

(d) In the `window.__sdfLab = { ... }` object (next to `holdAuthoredPose`) add:

```ts
    /** Hand-set the jaw gape (rad), clamped to jaw.ts's JAW_MAX_GAPE. Statue and held captures both honour it. */
    setJawGape(g: number) { exprGape = Math.max(0, Math.min(JAW_MAX_GAPE, Number.isFinite(g) ? g : 0)); },
```

- [ ] **Step 2: Add `BLOB_GAPE` to `scripts/blob-turntable.mjs`**

Directly after the line `console.log('pose:', poseResult);` insert:

```js
// BLOB_GAPE=<rad> holds the jaw open that far (lab-main's setJawGape): the expression pass's spike, before expressions exist.
if (process.env.BLOB_GAPE !== undefined) {
  await evaluate(`window.__sdfLab.setJawGape(${Number(process.env.BLOB_GAPE)})`);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Capture the spike frames (own ports)**

```bash
mkdir -p docs/dev-notes/2026-10-13-goblin-expressions/spike
for g in 0 0.15 0.3 0.5; do
  LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 BLOB_DIST=0.7 BLOB_TARGET_Y=1.2 BLOB_GAPE=$g \
    npm run blob:shot -- goblin docs/dev-notes/2026-10-13-goblin-expressions/spike/gape-$g 8
done
```
Expected: each run prints `frames: .../index.html`; `frame-00.png` is the front (yaw 0 is the face), `frame-01.png` is 45 degrees. Open them with the Read tool and look. Check: (1) gape 0 matches the pre-change goblin (compare with a shot of `git show f81e5b10:src/lab/sdf-zombie/characters/goblin.blob` if in doubt, using `blob:shot` on that text is not needed: the profile pins already say it); (2) at 0.15 the mouth is parted and teeth show (the grin's resting point); (3) at 0.5 the mouth is wide open with a dark inside and the chin has dropped; (4) no skin-coloured cap fills the opening, no teeth float outside the mouth, no flicker. Record what you see.

Keep only `frame-00.png` and `frame-01.png` of each gape (delete the rest and `index.html`): `find docs/dev-notes/2026-10-13-goblin-expressions/spike -type f ! -name 'frame-00.png' ! -name 'frame-01.png' -delete`.

- [ ] **Step 5: Commit the hook and the frames**

```bash
git add src/lab/sdf-zombie/webgpu/lab-main.ts scripts/blob-turntable.mjs docs/dev-notes/2026-10-13-goblin-expressions/spike
git commit -m "feat(goblin): hand-set jaw gape in the lab and the spike frames (gape 0 / 0.15 / 0.3 / 0.5)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: GATE: show the owner and decide**

Send the six frames (`gape-0`, `gape-0.15`, `gape-0.5`, front and 45 degrees) to the owner with `SendUserFile` and ask ONE question: does a small gape with these teeth read as the start of a toothy evil grin? Offer: continue to the expression system as planned; add a small lip-offset channel first (an upper-lip lift so the lip leaves the teeth, a follow-up task not in this plan); or stop and plan approach C. **Do not start Task 5 until the owner answers.** If the answer is "tune the teeth/jaw first", edit `goblin.blob` (keep both the profile CLI and the teeth tests green), recapture, and ask again.

---

### Task 3b: A viable toothy grin: move the mouth opening to the lip line and make the teeth show (owner direction, 2026-10-13)

Added after the Task 4 spike. Finding: with the lips and profile held fixed, the jaw split put the mouth opening in the muzzle's bevel at the chin (y 1.10-1.115), 2-3 cm below the lips and the painted mouth, so the teeth hide in shadow (frames: `docs/dev-notes/2026-10-13-goblin-expressions/spike-close/`). The owner saw the same ("hard to see any teeth ... a big bevel to make the lips"). The owner floated big, coloured, lipstick-red lips as a character trait, tried it as the plan, then BACKTRACKED: "i think the main thing is getting a viable toothy grin with teeth". So: **natural flesh-coloured lips at about today's size; no lipstick, no big-lips redesign** (parked as an optional later idea). Still approach A; if this cannot be made to read, the owner's fallback is approach C.

**Goal:** at a gape of about 0.15 the front view shows a dark opening AT THE LIP LINE (about y 1.13, between the upper and lower lip) with the upper teeth and fangs clearly visible in it, and at gape 0 the mouth is closed and no tooth shows. The painted sheet mouth must agree with the real opening (it must not read as a second mouth).

**Files:** `src/lab/sdf-zombie/characters/goblin.blob`, `goblin-blob.test.ts`, `goblin-head-profile.ts` (re-pin if the head's front changes), frames and notes under `docs/dev-notes/2026-10-13-goblin-expressions/grin/`.

**Allowed to change:** the face-block jaw trio, the chin mass, the lip prims' size and position (modestly; keep them flesh, no `color=`), the groove, the teeth and interior bar positions, the goblin's `sheet` mouth numbers (`mouthRise`, `mouthWidth`, `mouthOpen`, `mouthCurve`), the jaw bone's rest tail, and the profile pins in `goblin-head-profile.ts` (re-pin deliberately with a comment saying why). If the hinge height is the problem (jaw.ts `JAW_HINGE` is the bride's global 0.30 of the skull, about 5.6 cm above the goblin's lip line), a per-body hinge is allowed as a small, tested change (parser/BodyDef/jaw.ts/motion.ts/rig-bind.ts); say so in the notes if you need it.

**Escalation the owner has pre-approved (2026-10-13: "if we have to distort or animate other elements of his face geometry of course that is fine since it's SDF"):** try the rest-geometry fixes above FIRST. If after them the upper lip or the cheeks still cover the teeth at gape 0.15, add a SMALL, TESTED per-prim morph mechanism (a minimal approach C): a `.blob` prim may declare a morph (a channel name from `expression.ts` plus an offset and/or radius scale), `applyRig` applies it scaled by that channel's weight (CPU, prims are already re-posed every frame), and `actuate` outputs the channel weights next to `jawGape`. Examples: an upper-lip lift on `smile`/`gape`, cheeks bunching on `smile`, lip corners pulling out. Write the design as a short spec amendment in the notes before coding, keep it pure and tested (the morph math in a renderer-free module), keep neutral bit-identical to today (all weights 0 changes nothing), and report it as its own commit. Do not build it unless the frames show it is needed.

**Must keep:** the nose the face's lead (nose tip at least 1 cm ahead of the lips' front; the old comments warn the lips turned into a snout), ears, cranium, brow, kit fit (`goblin-kit.test.ts`), every non-profile pin in `goblin-blob.test.ts`, the buried-at-rest teeth tests, other characters' tests untouched. Fine surface detail stays small.

- [ ] **Step 1:** Re-read the Task 4 close frames and `goblin.blob`'s lips/jaw/face block. Write down in the notes: the lip line y, the lips' front z, the nose tip z, and where the opening currently is.
- [ ] **Step 2:** Edit `goblin.blob` so the skull-side mass ends at the upper lip's underside and the jaw-side mass (chin and lower lip) carries from the lower lip down: the seam at the lip line. Re-place the teeth behind the lips so the upper row hangs into the opening and the fangs lead; keep 11 teeth, buried at rest. Adjust the sheet's painted mouth to sit on the real seam (thin, not a second mouth).
- [ ] **Step 3:** Render with `LAB_VITE_PORT=5281 LAB_CDP_PORT=9281 BLOB_DIST=0.3 BLOB_TARGET_Y=1.14 BLOB_PITCH=0.05 BLOB_GAPE=<g> npm run blob:shot -- goblin <scratch>/grin-<g> 2` for g = 0, 0.15, 0.3, 0.5. READ the frames. Iterate (up to ten rounds) until the Goal above holds, at 0.5 there is a wide open mouth with a dark inside and no skin cap, and the nose still leads in the 45-degree view. Be honest in the notes about what does not work.
- [ ] **Step 4:** Re-pin `goblin-head-profile.ts` if needed (CLI exit 0) and run `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts src/lab/sdf-zombie/characters/goblin-kit.test.ts src/lab/sdf-zombie/characters/goblin-poses.test.ts src/lab/sdf-zombie/rig-bind.test.ts src/lab/sdf-zombie/pack.test.ts` and `npm run typecheck`.
- [ ] **Step 5:** Keep the frames (front and 45 degrees for each gape) in `docs/dev-notes/2026-10-13-goblin-expressions/grin/`, write what changed and what you see into the notes, commit.

---

### Task 5: The sheet learns to blink, and to upload in place

`eyeSquash` is declared and defaulted in `FaceSheetParams` but never read by `generateFaceSheet` (the eye uses a hard-coded `* 1.25`), so it cannot drive a blink; wiring it in would silently change the goblin's approved eyes (its authored `eyeSquash 1.70` has never taken effect). A NEW param, `eyeLid`, default 0, leaves every character's sheet unchanged. Also factor the RGBA conversion so the lab can refresh a texture in place.

**Files:**
- Modify: `src/lab/sdf-zombie/blob-face-sheet.ts`
- Modify: `src/lab/sdf-zombie/blob-face-sheet.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`

- [ ] **Step 1: Write the failing tests** (append inside the existing file; the `describe` import and helpers are already there)

```ts
import { sheetToRgba } from './blob-face-sheet';

describe('eyeLid', () => {
  const GLOW = 224; // 0.88 * 255: the shader's emissive threshold
  const lit = (s: ReturnType<typeof generateFaceSheet>) => s.pixels.reduce((n, b) => n + (b >= GLOW ? 1 : 0), 0);

  it('defaults to 0, and a closed lid shrinks the lit eye without removing it', () => {
    expect(DEFAULT_SHEET.eyeLid).toBe(0);
    const open = generateFaceSheet(DEFAULT_SHEET);
    const shut = generateFaceSheet({ ...DEFAULT_SHEET, eyeLid: 0.9 });
    expect(lit(open)).toBeGreaterThan(0);
    expect(lit(shut)).toBeGreaterThan(0);
    expect(lit(shut)).toBeLessThan(lit(open));
  });

  it('eyeLid 0 is the same sheet as before the param existed', () => {
    const a = generateFaceSheet(DEFAULT_SHEET);
    const b = generateFaceSheet({ ...DEFAULT_SHEET, eyeLid: 0 });
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
  });
});

describe('sheetToRgba', () => {
  it('writes four equal channels, opaque, rows flipped so the buffer reads bottom-up', () => {
    const s = generateFaceSheet(DEFAULT_SHEET, 16);
    const rgba = sheetToRgba(s);
    expect(rgba).toHaveLength(16 * 16 * 4);
    for (const [x, y] of [[0, 0], [5, 3], [15, 15]] as const) {
      const src = s.pixels[(15 - y) * 16 + x]!;
      const o = (y * 16 + x) * 4;
      expect([rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]).toEqual([src, src, src, 255]);
    }
  });

  it('fills a caller-supplied buffer in place', () => {
    const s = generateFaceSheet(DEFAULT_SHEET, 16);
    const buf = new Uint8Array(16 * 16 * 4);
    expect(sheetToRgba(s, buf)).toBe(buf);
    expect(buf[3]).toBe(255);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/blob-face-sheet.test.ts`
Expected: FAIL (`eyeLid` undefined, `sheetToRgba` is not exported).

- [ ] **Step 3: Implement in `blob-face-sheet.ts`**

In `FaceSheetParams`, after the `eyeSquash` member add:

```ts
  /**
   * Eyelid closure, 0 (open) to 1 (shut): squeezes each eye's height, so a blink is a bright disc thinning to a slit. The
   * EXPRESSION layer's blink channel (expression.ts) writes it. A new param instead of wiring `eyeSquash` in: that one is declared
   * and defaulted but generateFaceSheet has never read it (the eye uses a fixed 1.25), so reading it now would change every
   * authored eye, the goblin's 1.70 included. Default 0 leaves every character's sheet bit-identical.
   */
  eyeLid: number;
```

In `DEFAULT_SHEET`, after `eyeSquash: 1.25,` add `eyeLid: 0,`.

In `generateFaceSheet`, replace the eye distance line

```ts
        const d = Math.hypot(sx - eyeDX, (y - ey) * 1.25);
```

with

```ts
        const d = Math.hypot(sx - eyeDX, ((y - ey) * 1.25) / Math.max(1 - p.eyeLid, 0.08));
```

(the divisor is exactly 1 at `eyeLid` 0, so the result is bit-identical). Leave the catchlight's own `* 1.25` alone.

At the end of the file add:

```ts
/**
 * The sheet as the bytes a three.js RGBA DataTexture takes: four equal channels (the shader reads `tex.rgb`, so a one-channel
 * upload renders the head blood red; see lab-main's loadGeneratedFace), opaque, with the rows FLIPPED because a DataTexture is not
 * given three's flipY at upload. generateFaceSheet keeps writing top-left rows. Pass `out` to refill a texture's buffer in place.
 */
export function sheetToRgba(gen: GeneratedSheet, out?: Uint8Array): Uint8Array {
  const n = gen.size;
  const rgba = out ?? new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const src = (n - 1 - y) * n;
    for (let x = 0; x < n; x++) {
      const v = gen.pixels[src + x]!;
      const o = (y * n + x) * 4;
      rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255;
    }
  }
  return rgba;
}
```

- [ ] **Step 4: Use it in `lab-main.ts`**

Add `sheetToRgba` to the existing `import { generateFaceSheet } from '../blob-face-sheet';` line. In `loadGeneratedFace`, replace the block from `const rgba = new Uint8Array(gen.size * gen.size * 4);` through the closing brace of the `for (let y ...)` loop with `const rgba = sheetToRgba(gen);` (keep the long comment above it about RGBA and the flip). Directly after `faceSheet = { tex, atlas: ..., mean: gen.mean };` in that function add `generatedRgba = rgba;`. Next to `let faceSheet:` declaration add:

```ts
  /** The RGBA buffer behind the generated face sheet's DataTexture, kept so the expression layer can refill it in place. Null
   *  while the face is a PNG or decal. */
  let generatedRgba: Uint8Array | null = null;
```

(Where the sheet becomes a PNG — `loadFaceTexture` and `wearFaceImage` — set `generatedRgba = null;` right after each `faceSheet = {` assignment.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/blob-face-sheet.test.ts src/lab/sdf-zombie/blob-compile.test.ts src/lab/sdf-zombie/characters/goblin-blob.test.ts` and `npm run typecheck`
Expected: PASS (the compile test confirms `eyeLid` is accepted as a sheet key because `compileSheet` validates against `DEFAULT_SHEET`'s keys).

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/blob-face-sheet.ts src/lab/sdf-zombie/blob-face-sheet.test.ts src/lab/sdf-zombie/webgpu/lab-main.ts
git commit -m "feat(sheet): eyeLid for blinks (default 0, no sheet changes) and a sheetToRgba helper

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `expression.ts`, the pure channel layer

**Files:**
- Create: `src/lab/sdf-zombie/expression.ts`
- Create: `src/lab/sdf-zombie/expression.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/expression.test.ts
import { describe, it, expect } from 'vitest';
import {
  REST_CHANNELS, expressionAt, blinkLid, withBlink, actuate, sheetKey,
  type ExpressionClip, type ExpressionTuning,
} from './expression';
import { DEFAULT_SHEET } from './blob-face-sheet';

const TUNING: ExpressionTuning = {
  maxGape: 0.6, smileCurve: 1, smileWiden: 0.25, curlCurve: 0.8, curlNarrow: 0.25,
  browAngle: 10, browHeavy: 0.2, gapeMouthOpen: -0.02, smileMouthOpen: 0.01,
};
const GRIN: ExpressionClip = { name: 'grin', keys: [{ t: 0, channels: {} }, { t: 1, channels: { gape: 0.4, smile: 1 } }] };

describe('expressionAt', () => {
  it('holds the first key before the clip and the last key after it', () => {
    expect(expressionAt(GRIN, -5)).toEqual(REST_CHANNELS);
    expect(expressionAt(GRIN, 9)).toEqual({ ...REST_CHANNELS, gape: 0.4, smile: 1 });
  });

  it('a channel a key does not mention takes its rest value 0', () => {
    expect(expressionAt(GRIN, 0.5).browDown).toBe(0);
    expect(expressionAt(GRIN, 0).gape).toBe(0);
  });

  it('interpolates linearly per channel, and smoothly when the key says so', () => {
    expect(expressionAt(GRIN, 0.5).gape).toBeCloseTo(0.2, 9);
    const smooth: ExpressionClip = { name: 's', keys: [{ t: 0, channels: {} }, { t: 1, channels: { gape: 1 }, ease: 'smooth' }] };
    expect(expressionAt(smooth, 0.25).gape).toBeCloseTo(0.15625, 9); // smoothstep(0.25)
    expect(expressionAt(smooth, 0.5).gape).toBeCloseTo(0.5, 9);
  });

  it('a one-key clip is a held expression', () => {
    const held: ExpressionClip = { name: 'h', keys: [{ t: 0, channels: { lipCurl: 0.7 } }] };
    expect(expressionAt(held, 123).lipCurl).toBe(0.7);
  });

  it('throws on an empty clip', () => {
    expect(() => expressionAt({ name: 'e', keys: [] }, 0)).toThrow(/no keys/);
  });
});

describe('blink', () => {
  it('closes then opens over its duration, and is 0 outside it', () => {
    expect(blinkLid(0.9, 1, 0.2)).toBe(0);
    expect(blinkLid(1.0, 1, 0.2)).toBe(0);
    expect(blinkLid(1.08, 1, 0.2)).toBeCloseTo(1, 9); // the 40% mark: fully shut
    expect(blinkLid(1.14, 1, 0.2)).toBeGreaterThan(0);
    expect(blinkLid(1.14, 1, 0.2)).toBeLessThan(1);
    expect(blinkLid(1.2, 1, 0.2)).toBe(0);
  });

  it('composes with any base expression: the lid is the larger of the two', () => {
    expect(withBlink({ ...REST_CHANNELS, lid: 0.3 }, 0.8).lid).toBe(0.8);
    expect(withBlink({ ...REST_CHANNELS, lid: 0.9 }, 0.2).lid).toBe(0.9);
    expect(withBlink({ ...REST_CHANNELS, gape: 0.5 }, 1).gape).toBe(0.5);
  });
});

describe('actuate', () => {
  it('rest channels give the authored sheet and no gape', () => {
    const a = actuate(REST_CHANNELS, DEFAULT_SHEET, TUNING);
    expect(a.jawGape).toBe(0);
    expect(a.sheet).toEqual({ ...DEFAULT_SHEET, eyeLid: 0 });
    expect(sheetKey(a.sheet)).toBe(sheetKey(DEFAULT_SHEET));
  });

  it('gape scales to radians and is clamped to 0..1 of the tuning', () => {
    expect(actuate({ ...REST_CHANNELS, gape: 0.5 }, DEFAULT_SHEET, TUNING).jawGape).toBeCloseTo(0.3, 9);
    expect(actuate({ ...REST_CHANNELS, gape: 7 }, DEFAULT_SHEET, TUNING).jawGape).toBeCloseTo(0.6, 9);
    expect(actuate({ ...REST_CHANNELS, gape: -1 }, DEFAULT_SHEET, TUNING).jawGape).toBe(0);
  });

  it('smile pulls the mouth arc toward a smile (NEGATIVE mouthCurve in the sheet) and widens it', () => {
    const s = actuate({ ...REST_CHANNELS, smile: 1 }, DEFAULT_SHEET, TUNING).sheet;
    expect(s.mouthCurve).toBeLessThan(DEFAULT_SHEET.mouthCurve); // sheet sign: positive is a frown
    expect(s.mouthWidth).toBeGreaterThan(DEFAULT_SHEET.mouthWidth);
  });

  it('a negative smile and lipCurl frown the arc and narrow the mouth', () => {
    const f = actuate({ ...REST_CHANNELS, smile: -1 }, DEFAULT_SHEET, TUNING).sheet;
    expect(f.mouthCurve).toBeGreaterThan(DEFAULT_SHEET.mouthCurve);
    const c = actuate({ ...REST_CHANNELS, lipCurl: 1 }, DEFAULT_SHEET, TUNING).sheet;
    expect(c.mouthCurve).toBeGreaterThan(DEFAULT_SHEET.mouthCurve);
    expect(c.mouthWidth).toBeLessThan(DEFAULT_SHEET.mouthWidth);
  });

  it('browDown steepens the brow (positive angle is a scowl) and darkens it, within bounds', () => {
    const b = actuate({ ...REST_CHANNELS, browDown: 1 }, DEFAULT_SHEET, TUNING).sheet;
    expect(b.browAngle).toBeCloseTo(DEFAULT_SHEET.browAngle + 10, 9);
    expect(b.browHeavy).toBeGreaterThan(DEFAULT_SHEET.browHeavy);
    expect(actuate({ ...REST_CHANNELS, browDown: 99 }, DEFAULT_SHEET, TUNING).sheet.browHeavy).toBeLessThanOrEqual(1.2);
  });

  it('lid writes eyeLid, never below the authored one', () => {
    expect(actuate({ ...REST_CHANNELS, lid: 0.6 }, DEFAULT_SHEET, TUNING).sheet.eyeLid).toBeCloseTo(0.6, 9);
  });

  it('never touches what it does not animate', () => {
    const s = actuate({ ...REST_CHANNELS, smile: 1, gape: 1, browDown: 1, lid: 1 }, DEFAULT_SHEET, TUNING).sheet;
    for (const k of ['eyeGap', 'eyeSize', 'grain', 'seed', 'nostril', 'jawShade'] as const) expect(s[k]).toBe(DEFAULT_SHEET[k]);
  });
});

describe('sheetKey', () => {
  it('changes when an animated param moves by more than the quantum and not for float dust', () => {
    const a = sheetKey(DEFAULT_SHEET);
    expect(sheetKey({ ...DEFAULT_SHEET, mouthCurve: DEFAULT_SHEET.mouthCurve + 1e-6 })).toBe(a);
    expect(sheetKey({ ...DEFAULT_SHEET, mouthCurve: DEFAULT_SHEET.mouthCurve + 0.02 })).not.toBe(a);
    expect(sheetKey({ ...DEFAULT_SHEET, eyeLid: 0.5 })).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/expression.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/expression.ts
//
// THE EXPRESSION LAYER's pure half (spec docs/superpowers/specs/2026-10-13-goblin-expressions-design.md, plan
// docs/superpowers/plans/2026-10-13-goblin-expressions.md): keyed clips of named face CHANNELS, and the one function that turns
// channels into what a mechanism needs.
//
// A CHANNEL describes the face, never the mechanism: `gape` is how open the mouth is, `smile` is how far the corners are pulled up,
// and so on. `actuate` is where a channel becomes a jaw angle or a sheet parameter, so a different mechanism (per-prim morph
// targets, approach C in the spec) is one more output of that function and clips never change.
//
// A CLIP has the same shape as pose.ts's PoseClip: timed keys, a channel a key does not mention takes its rest value (0), one key
// holds, `ease: 'smooth'` eases INTO a key from the previous one. Time is passed in; nothing here reads a clock (determinism, and
// the Rust port).
//
// Pure: plain data in, plain data out, no renderer. Sheet sign convention (measured, see the warning in blob-face-sheet.ts): a
// POSITIVE mouthCurve puts the mouth's centre higher than its corners, a frown; NEGATIVE is a smile. `smile` here is
// the face's own sense (positive smiles), so `actuate` SUBTRACTS it from mouthCurve.
import type { FaceSheetParams } from './blob-face-sheet';

export const CHANNEL_NAMES = ['gape', 'smile', 'browDown', 'lipCurl', 'lid'] as const;
export type ChannelName = typeof CHANNEL_NAMES[number];

/** Every channel, resolved. Ranges: gape 0..1; smile -1..1 (negative frowns); browDown -1..1 (negative raises); lipCurl 0..1;
 *  lid 0..1 (1 is shut). */
export type Channels = Record<ChannelName, number>;

export const REST_CHANNELS: Readonly<Channels> = { gape: 0, smile: 0, browDown: 0, lipCurl: 0, lid: 0 };

export interface ExpressionKey {
  /** Seconds from the clip's start. */
  t: number;
  /** Channels this key sets; any it omits take their rest value 0. */
  channels: Partial<Channels>;
  /** Easing INTO this key from the previous one. Default 'linear'. */
  ease?: 'linear' | 'smooth';
}

export interface ExpressionClip { name: string; keys: ExpressionKey[] }

/** How channels map onto the two outputs. All data: the goblin's numbers live in characters/goblin-expressions.ts. */
export interface ExpressionTuning {
  /** Jaw gape in radians at gape = 1 (jaw.ts clamps at JAW_MAX_GAPE). */
  maxGape: number;
  /** mouthCurve change per unit smile (the sign is applied inside actuate: a positive smile lowers mouthCurve). */
  smileCurve: number;
  /** Fraction of mouthWidth added at smile = 1 (smiles widen; frowns do not narrow, lipCurl does that). */
  smileWiden: number;
  /** mouthCurve change per unit lipCurl (positive = frown arc). */
  curlCurve: number;
  /** Fraction of mouthWidth removed at lipCurl = 1. */
  curlNarrow: number;
  /** Degrees added to browAngle per unit browDown (positive angles the inner ends down, a scowl). */
  browAngle: number;
  /** Added to browHeavy per unit browDown. */
  browHeavy: number;
  /** mouthOpen (the painted mouth's thickness) added per unit gape. Negative thins the painted mouth as the real gap opens. */
  gapeMouthOpen: number;
  /** mouthOpen added per unit of positive smile. */
  smileMouthOpen: number;
}

export interface Actuation {
  /** Jaw gape in radians, for rig.jawGape / MotionConfig.jawGape. */
  jawGape: number;
  /** The authored sheet with this frame's overrides. Never mutates its input. */
  sheet: FaceSheetParams;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const smooth01 = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

function bracket(clip: ExpressionClip, t: number): { a: ExpressionKey; b: ExpressionKey; f: number } {
  const keys = clip.keys;
  if (keys.length === 0) throw new Error(`expression clip "${clip.name}" has no keys`);
  if (t <= keys[0]!.t) return { a: keys[0]!, b: keys[0]!, f: 0 };
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return { a: last, b: last, f: 0 };
  let i = 0;
  while (keys[i + 1]!.t <= t) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const raw = (t - a.t) / (b.t - a.t);
  return { a, b, f: b.ease === 'smooth' ? smooth01(raw) : raw };
}

/** The channel set of a clip at time t (seconds). One key, or t outside the clip, holds an end. */
export function expressionAt(clip: ExpressionClip, t: number): Channels {
  const { a, b, f } = bracket(clip, t);
  const out = { ...REST_CHANNELS };
  for (const name of CHANNEL_NAMES) out[name] = lerp(a.channels[name] ?? 0, b.channels[name] ?? 0, f);
  return out;
}

/** A blink's lid value at time t: 0 outside [start, start + dur], shut at 40% of the way through, open again by the end. */
export function blinkLid(t: number, start: number, dur = 0.16): number {
  const u = (t - start) / dur;
  if (u <= 0 || u >= 1) return 0;
  return u < 0.4 ? u / 0.4 : (1 - u) / 0.6;
}

/** Overlay a blink on any expression: the lid is the larger of the two, everything else is untouched. */
export function withBlink(base: Channels, blink: number): Channels {
  return { ...base, lid: Math.max(base.lid, blink) };
}

/** Channels to a jaw gape and a sheet. Channels are clamped to their ranges first, so a bad clip cannot drive the face off its rig. */
export function actuate(channels: Channels, base: FaceSheetParams, tuning: ExpressionTuning): Actuation {
  const gape = clamp(channels.gape, 0, 1);
  const smile = clamp(channels.smile, -1, 1);
  const browDown = clamp(channels.browDown, -1, 1);
  const lipCurl = clamp(channels.lipCurl, 0, 1);
  const lid = clamp(channels.lid, 0, 1);
  const grin = Math.max(smile, 0);
  return {
    jawGape: gape * tuning.maxGape,
    sheet: {
      ...base,
      mouthCurve: base.mouthCurve - smile * tuning.smileCurve + lipCurl * tuning.curlCurve,
      mouthWidth: base.mouthWidth * (1 + grin * tuning.smileWiden) * (1 - lipCurl * tuning.curlNarrow),
      mouthOpen: Math.max(0, base.mouthOpen + gape * tuning.gapeMouthOpen + grin * tuning.smileMouthOpen),
      browAngle: base.browAngle + browDown * tuning.browAngle,
      browHeavy: clamp(base.browHeavy + browDown * tuning.browHeavy, 0, 1.2),
      eyeLid: Math.max(base.eyeLid, lid),
    },
  };
}

/** A string that changes when (and only when) a sheet param this layer animates moves by more than 0.005: the lab regenerates the
 *  texture only when it does. */
export function sheetKey(s: FaceSheetParams): string {
  const q = (v: number) => Math.round(v * 200);
  return [s.mouthCurve, s.mouthWidth, s.mouthOpen, s.browAngle, s.browHeavy, s.eyeLid].map(q).join(',');
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/expression.test.ts` and `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/expression.ts src/lab/sdf-zombie/expression.test.ts
git commit -m "feat(expression): pure channel layer (keyed clips, blink overlay, channels to jaw gape and sheet params)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The goblin's expressions (data) and the library

**Files:**
- Create: `src/lab/sdf-zombie/characters/goblin-expressions.ts`
- Create: `src/lab/sdf-zombie/expression-library.ts`
- Create: `src/lab/sdf-zombie/characters/goblin-expressions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/characters/goblin-expressions.test.ts
import { describe, it, expect } from 'vitest';
import { GOBLIN_EXPRESSIONS, GOBLIN_EXPRESSION_TUNING } from './goblin-expressions';
import { expressionsFor } from '../expression-library';
import { expressionAt, actuate, CHANNEL_NAMES } from '../expression';
import { JAW_MAX_GAPE } from '../jaw';
import { compileSheet } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import goblinSrc from './goblin.blob?raw';

const authored = compileSheet(parseBlob(goblinSrc))!;

describe('goblin expressions', () => {
  it('are registered for the goblin and no one else', () => {
    expect(expressionsFor('goblin')?.clips).toBe(GOBLIN_EXPRESSIONS);
    expect(expressionsFor('goblin')?.tuning).toBe(GOBLIN_EXPRESSION_TUNING);
    expect(Object.keys(GOBLIN_EXPRESSIONS).sort()).toEqual(['grin', 'neutral', 'scowl', 'shout']);
    expect(expressionsFor('zombie')).toBeNull();
  });

  it('never asks the jaw for more than jaw.ts allows', () => {
    expect(GOBLIN_EXPRESSION_TUNING.maxGape).toBeLessThanOrEqual(JAW_MAX_GAPE);
  });

  it.each(Object.values(GOBLIN_EXPRESSIONS).map(c => [c.name, c] as const))('%s: keys ascend and every channel stays in range', (_n, clip) => {
    for (let i = 1; i < clip.keys.length; i++) expect(clip.keys[i]!.t).toBeGreaterThan(clip.keys[i - 1]!.t);
    const end = clip.keys[clip.keys.length - 1]!.t;
    for (let k = 0; k <= 10; k++) {
      const c = expressionAt(clip, (end * k) / 10);
      for (const name of CHANNEL_NAMES) expect(Number.isFinite(c[name]), `${clip.name} ${name}`).toBe(true);
      expect(c.gape).toBeGreaterThanOrEqual(0); expect(c.gape).toBeLessThanOrEqual(1);
      expect(Math.abs(c.smile)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.browDown)).toBeLessThanOrEqual(1);
    }
  });

  it('neutral is the authored face: no gape, the sheet unchanged', () => {
    const a = actuate(expressionAt(GOBLIN_EXPRESSIONS.neutral!, 5), authored, GOBLIN_EXPRESSION_TUNING);
    expect(a.jawGape).toBe(0);
    expect(a.sheet).toEqual({ ...authored, eyeLid: 0 });
  });

  it('grin opens the jaw a little and smiles; shout opens it wide; scowl frowns and lowers the brow', () => {
    const at = (name: string) => actuate(expressionAt(GOBLIN_EXPRESSIONS[name]!, 99), authored, GOBLIN_EXPRESSION_TUNING);
    const grin = at('grin'), shout = at('shout'), scowl = at('scowl');
    expect(grin.jawGape).toBeGreaterThan(0.05);
    expect(grin.jawGape).toBeLessThan(shout.jawGape);
    expect(grin.sheet.mouthCurve).toBeLessThan(authored.mouthCurve);       // more of a smile
    expect(shout.jawGape).toBeGreaterThan(0.35);
    expect(scowl.sheet.mouthCurve).toBeGreaterThan(authored.mouthCurve);   // frown
    expect(scowl.sheet.browAngle).toBeGreaterThan(authored.browAngle);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-expressions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/characters/goblin-expressions.ts
//
// The goblin's expressions (expression pass, spec docs/superpowers/specs/2026-10-13-goblin-expressions-design.md): the tuning table
// that maps channels onto this face, and the clips. DATA ONLY, resolved by expression.ts. Every number is a first guess to be
// judged in the lab frames (docs/dev-notes/2026-10-13-goblin-expressions/); each change from the first values is commented with
// the frame that asked for it.
//
// The goblin's authored `sheet` block is the neutral: mouthCurve -0.50 is ALREADY a smile arc by the sheet's sign (the scowl read
// comes from the lips and brows), so `smile` pulls it further negative and `lipCurl` pushes it positive past zero into a frown.
import type { ExpressionClip, ExpressionTuning } from '../expression';

export const GOBLIN_EXPRESSION_TUNING: ExpressionTuning = {
  maxGape: 0.6,
  smileCurve: 0.9,
  smileWiden: 0.25,
  curlCurve: 1.0,
  curlNarrow: 0.25,
  browAngle: 10,
  browHeavy: 0.2,
  gapeMouthOpen: -0.02,
  smileMouthOpen: 0.01,
};

const key = (t: number, channels: ExpressionClip['keys'][number]['channels'], ease?: 'smooth') =>
  ({ t, channels, ...(ease ? { ease } : {}) });

/** The authored face. */
const NEUTRAL: ExpressionClip = { name: 'neutral', keys: [key(0, {})] };

/** The toothy evil grin: jaw parted just enough to show the teeth, the mouth pulled wide and up, the brows a little low. */
const GRIN: ExpressionClip = {
  name: 'grin',
  keys: [key(0, {}), key(0.4, { gape: 0.28, smile: 1, browDown: 0.35 }, 'smooth')],
};

/** Menace: brows down hard, the lip curled into a frown, the jaw just parted to bare the fangs. */
const SCOWL: ExpressionClip = {
  name: 'scowl',
  keys: [key(0, {}), key(0.3, { browDown: 1, lipCurl: 0.8, gape: 0.18 }, 'smooth')],
};

/** A shout: the jaw wide open, the brows pulled in. */
const SHOUT: ExpressionClip = {
  name: 'shout',
  keys: [key(0, {}), key(0.2, { gape: 1, browDown: 0.5 }, 'smooth')],
};

export const GOBLIN_EXPRESSIONS: Readonly<Record<string, ExpressionClip>> = {
  neutral: NEUTRAL, grin: GRIN, scowl: SCOWL, shout: SHOUT,
};
```

```ts
// src/lab/sdf-zombie/expression-library.ts
//
// Which expression clips (and which tuning) each character has, by the name the lab and the game use for it. Data only; the clips
// live beside the characters (characters/<name>-expressions.ts). The twin of pose-library.ts. A character with no entry has none.
import { GOBLIN_EXPRESSIONS, GOBLIN_EXPRESSION_TUNING } from './characters/goblin-expressions';
import type { ExpressionClip, ExpressionTuning } from './expression';

export interface ExpressionSet {
  readonly clips: Readonly<Record<string, ExpressionClip>>;
  readonly tuning: ExpressionTuning;
}

const LIBRARY: Readonly<Record<string, ExpressionSet>> = {
  goblin: { clips: GOBLIN_EXPRESSIONS, tuning: GOBLIN_EXPRESSION_TUNING },
};

export function expressionsFor(character: string): ExpressionSet | null {
  return LIBRARY[character] ?? null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-expressions.test.ts src/lab/sdf-zombie/expression.test.ts` and `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin-expressions.ts src/lab/sdf-zombie/expression-library.ts src/lab/sdf-zombie/characters/goblin-expressions.test.ts
git commit -m "feat(goblin): the expression clips (neutral, grin, scowl, shout) and the library

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The motion path takes a gape

So a goblin driven by the actor pipeline (the screen-emergence lab later, a game actor) can open its jaw, and the kinematic jaw point is pinned to the opened target. The bride's sword swing keeps working: the larger gape wins.

**Files:**
- Modify: `src/lab/sdf-zombie/motion.ts` (interface near line 406; jaw block near line 1352)
- Modify: `src/lab/sdf-zombie/actor.ts` (input near line 143; forward near line 172)
- Modify: `src/lab/sdf-zombie/characters/goblin-expressions.test.ts`

- [ ] **Step 1: Write the failing test** (append to `goblin-expressions.test.ts`; merge the imports)

```ts
import { buildBody } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { motionProfileFor } from '../motion-profile';

describe('the motion path takes an expression gape', () => {
  const doc = parseBlob(goblinSrc);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  const run = (jawGape: number | undefined) => {
    const m = makeActorMotion(body, { seed: 3 });
    const rng = makeRng(3);
    let f = null as ReturnType<typeof stepActorMotion>;
    for (let i = 0; i < 30; i++) {
      f = stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: false, armStyle: undefined, headingFollow: 0, gazeFollow: 0,
        bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, rng, signals: emptyActorSignals(),
        profile: motionProfileFor('goblin'), forceSpeed: 0,
        ...(jawGape === undefined ? {} : { jawGape }),
      });
    }
    return { f: f!, m };
  };

  it('reaches MotionFrame.jawGape and the rig, and no input leaves it 0', () => {
    const open = run(0.3);
    expect(open.f.jawGape).toBeCloseTo(0.3, 9);
    expect(open.m.bound.rig.jawGape).toBeCloseTo(0.3, 9);
    expect(run(undefined).f.jawGape).toBe(0);
  });

  it('pins the jaw point lower than the shut jaw', () => {
    const shut = run(undefined), open = run(0.5);
    const J = shut.m.motionJoints!.index.jaw!;
    expect(open.m.bound.rig.points[J]!.pos[1]).toBeLessThan(shut.m.bound.rig.points[J]!.pos[1] - 0.01);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-expressions.test.ts -t "motion path"`
Expected: FAIL (`jawGape` is not a known input; the frame's gape is 0).

- [ ] **Step 3: Implement**

In `motion.ts`, in the config interface directly after the `pose?: readonly Vec3[];` member add:

```ts
  /** The EXPRESSION layer's jaw gape in radians (expression.ts `actuate`). It opens the jaw like the bride's sword swing does and
   *  the wider of the two wins. Undefined or 0 changes nothing. */
  jawGape?: number;
```

In the jaw block (`let jawGape = 0; if (joints.jaw && ...) { jawGape = attack && ... ? jawGapeAt(...) : 0;`) replace the assignment with:

```ts
    const swingGape = attack && cfg.attack && profile.melee?.kind === 'sword' && isSwordVariant(cfg.attack.variant)
      ? jawGapeAt(cfg.attack.phase, cfg.attack.variant) : 0;
    // The expression layer's gape (expression.ts) opens the jaw too; whichever is wider wins.
    jawGape = Math.max(swingGape, cfg.jawGape ?? 0);
```

In `actor.ts`, in `ActorStepInput` after `pose?: readonly Vec3[];` add:

```ts
  /** The expression layer's jaw gape (rad) for this frame — see MotionConfig.jawGape. Only forwarded when set. */
  jawGape?: number;
```

and in the object passed to `stepMotion` after the `...(input.pose ? { pose: input.pose } : {}),` line add:

```ts
        ...(input.jawGape ? { jawGape: input.jawGape } : {}),
```

- [ ] **Step 4: Run the tests (this touches shared motion code; run its neighbours)**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-expressions.test.ts src/lab/sdf-zombie/characters/bride-blob.test.ts src/lab/sdf-zombie/sword-swing.test.ts src/lab/sdf-zombie/rig-bind.test.ts` and `npm run typecheck`
Expected: PASS (the bride's gape tests prove the swing path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/motion.ts src/lab/sdf-zombie/actor.ts src/lab/sdf-zombie/characters/goblin-expressions.test.ts
git commit -m "feat(motion): an expression jawGape input beside the sword swing's (the wider wins)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The lab plays expressions

State, an in-place sheet refresh, the panel, the `__sdfLab` API and the turntable hook. After this the owner can click an expression in the lab and the capture scripts can shoot one.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `scripts/blob-turntable.mjs`

- [ ] **Step 1: Imports and state in `lab-main.ts`**

Add near the other imports:

```ts
import {
  REST_CHANNELS, expressionAt, actuate, blinkLid, withBlink, sheetKey, type ExpressionClip,
} from '../expression';
import { expressionsFor } from '../expression-library';
```

Directly after the `let exprGape = 0;` added in Task 4, add:

```ts
  /** The active character's expression clips and its authored sheet (the neutral), or null when it has none. `entry` and
   *  `compileCharacterSheet` are the ones loadGeneratedFace uses. */
  const exprSet = expressionsFor(activeCharacterName());
  const exprBase = exprSet ? compileCharacterSheet(entry).sheet : null;
  let exprClip: ExpressionClip | null = null;
  let exprT = 0;            // seconds into the clip
  let exprPlaying = false;  // advance exprT with the frame clock
  let exprClock = 0;        // seconds, for blinks
  let blinkStart = -1;      // exprClock when the last blink began
  let exprLidHold = 0;      // a lid value held for a capture (a blink frame)
  let exprKey = '';         // sheetKey of the sheet last uploaded

  /** Refill the generated face sheet's texture in place from new params; no-op when the face is a PNG or a decal. */
  function refreshSheet(params: Parameters<typeof generateFaceSheet>[0]) {
    if (!faceSheet || !generatedRgba || faceSheet.tex.image.data !== generatedRgba) return;
    const gen = generateFaceSheet(params, 64);
    sheetToRgba(gen, generatedRgba);
    faceSheet.tex.needsUpdate = true;
    faceSheet.mean = gen.mean;
    for (const v of [view, ...crowd]) v.setFaceTexture(faceSheet.tex, faceSheet.atlas, gen.mean);
  }

  /** One expression tick: advance the clock, sample the clip, set the jaw gape, regenerate the sheet only if it changed. */
  function stepExpression(dt: number) {
    if (!exprSet || !exprBase) return;
    exprClock += dt;
    if (exprPlaying) exprT += dt;
    const base = exprClip ? expressionAt(exprClip, exprT) : REST_CHANNELS;
    const lid = Math.max(blinkLid(exprClock, blinkStart), exprLidHold);
    const act = actuate(withBlink(base, lid), exprBase, exprSet.tuning);
    exprGape = act.jawGape;
    const key = sheetKey(act.sheet);
    if (key !== exprKey) { exprKey = key; refreshSheet(act.sheet); }
  }
```

(`generatedRgba`, `faceSheet`, `view`, `crowd` and `generateFaceSheet` must be declared before this block; if `exprSet` is declared before `faceSheet` in the file, move this block to just after the face-sheet code and before `holdAuthoredPose`'s object, keeping `exprGape` above both.)

- [ ] **Step 2: Call it every frame**

Immediately before the `boundForPose` lines added in Task 4 (above `applyRig`), add `stepExpression(dt);`. In the live `stepActorMotion(heroMotion, { ... forceSpeed, carryOverride, })` call (around line 2681) add `jawGape: exprGape,` after `carryOverride,` so a walking goblin's jaw point follows the gape too.

- [ ] **Step 3: The `__sdfLab` API** (next to `setJawGape`)

```ts
    /** Names of the active character's expressions, or []. */
    expressionNames(): string[] { return exprSet ? Object.keys(exprSet.clips) : []; },
    /**
     * THE EXPRESSION LAYER (spec 2026-10-13-goblin-expressions-design.md): hold the named expression of the ACTIVE character at clip
     * time `t` seconds (default 10: past every clip's end, i.e. fully formed), optionally with the lid held at `lid` (a blink frame).
     * Applies the sheet immediately. Returns the name, t and gape, or null when this character has no such expression.
     */
    holdExpression(name: string, t = 10, lid = 0) {
      const clip = exprSet?.clips[name];
      if (!exprSet || !clip) return null;
      exprClip = clip; exprT = t; exprPlaying = false; blinkStart = -1; exprLidHold = lid;
      stepExpression(0);
      return { expression: clip.name, t, jawGape: exprGape };
    },
    /** Play the named expression from its first key, advancing with the frame clock. */
    playExpression(name: string) {
      const clip = exprSet?.clips[name];
      if (!clip) return null;
      exprClip = clip; exprT = 0; exprPlaying = true; exprLidHold = 0;
      return { expression: clip.name };
    },
    /** Blink now. */
    blink() { blinkStart = exprClock; },
```

- [ ] **Step 4: The panel** (after the `postBox` section creation near line 3606, `addSection`/`addButton` are the same helpers `postBox` uses)

```ts
  if (exprSet) {
    const exprBox = addSection(panelEl, 'expression');
    for (const name of Object.keys(exprSet.clips)) {
      addButton(exprBox, name, () => { exprClip = exprSet.clips[name]!; exprT = 0; exprPlaying = true; exprLidHold = 0; });
    }
    addButton(exprBox, 'blink', () => { blinkStart = exprClock; });
  }
```

- [ ] **Step 5: Turntable hook** (`scripts/blob-turntable.mjs`, directly after the `BLOB_GAPE` block from Task 4)

```js
// BLOB_EXPR=<name>[:<t>[:<lid>]] holds one of the character's expressions (lab-main's holdExpression): t in seconds into the clip
// (default 10, fully formed), lid 0..1 held shut for a blink frame. e.g. BLOB_EXPR=grin, BLOB_EXPR=neutral:10:1.
if (process.env.BLOB_EXPR) {
  const [exprName, exprT = '10', exprLid = '0'] = process.env.BLOB_EXPR.split(':');
  const held = await evaluate(`JSON.stringify(window.__sdfLab.holdExpression(${JSON.stringify(exprName)}, ${Number(exprT)}, ${Number(exprLid)}))`);
  console.log('expression:', held);
  if (!held || held === 'null') fail(`no expression "${exprName}" for this character`);
  await sleep(500);
}
```

- [ ] **Step 6: Typecheck and a capture**

Run: `npm run typecheck`
Then: `LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 BLOB_DIST=0.7 BLOB_TARGET_Y=1.2 BLOB_EXPR=grin npm run blob:shot -- goblin /tmp/goblin-expr-check 2` and read `/tmp/goblin-expr-check/frame-00.png` (use the scratchpad dir instead of /tmp if the sandbox asks).
Expected: the log prints `expression: {"expression":"grin","t":10,"jawGape":0.168}` (0.28 x 0.6), the frame shows an open, grinning mouth with teeth, and the painted mouth wider than the neutral one. Also run `BLOB_EXPR=neutral` and confirm it matches the Task 4 gape-0 frame (no drift), and `BLOB_EXPR=nope` exits non-zero with `no expression "nope"`.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/lab-main.ts scripts/blob-turntable.mjs
git commit -m "feat(lab): play, hold and blink the goblin's expressions (panel, __sdfLab API, BLOB_EXPR)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Judge and tune the expressions, then deliver the sheet

**Files:**
- Create: `scripts/goblin-expression-sheet.sh`
- Modify: `src/lab/sdf-zombie/characters/goblin-expressions.ts` (numbers only)
- Create: `docs/dev-notes/2026-10-13-goblin-expressions/NOTES.md` and frames

- [ ] **Step 1: The contact-sheet script**

```bash
#!/usr/bin/env bash
# A contact sheet of the goblin's expressions: front and three-quarter, one blob:shot per expression, plus a blink frame.
#   scripts/goblin-expression-sheet.sh [outDir]
#   LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 scripts/goblin-expression-sheet.sh
# Frame 00 of each run is the front (yaw 0 is the face), frame 01 is 45 degrees. Writes <outDir>/index.html listing them.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-docs/dev-notes/2026-10-13-goblin-expressions/frames}"
mkdir -p "$OUT"
export BLOB_DIST="${BLOB_DIST:-0.7}" BLOB_TARGET_Y="${BLOB_TARGET_Y:-1.2}"
SHOTS=("neutral:neutral" "grin:grin" "scowl:scowl" "shout:shout" "blink:neutral:10:1")
for spec in "${SHOTS[@]}"; do
  label="${spec%%:*}"; expr="${spec#*:}"
  BLOB_EXPR="$expr" scripts/blob-shot.sh goblin "$OUT/$label" 8
  # keep only the front and the three-quarter
  find "$OUT/$label" -type f ! -name 'frame-00.png' ! -name 'frame-01.png' -delete
done
{
  echo '<!doctype html><meta charset="utf-8"><title>goblin expressions</title><body style="background:#111;color:#ddd;font:14px sans-serif">'
  for spec in "${SHOTS[@]}"; do
    label="${spec%%:*}"
    echo "<h3>$label</h3><img src=\"$label/frame-00.png\" width=480> <img src=\"$label/frame-01.png\" width=480>"
  done
} > "$OUT/index.html"
echo "sheet: $OUT/index.html"
```

Run `chmod +x scripts/goblin-expression-sheet.sh`.

- [ ] **Step 2: Capture and LOOK**

Run: `LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 scripts/goblin-expression-sheet.sh`
Read all ten PNGs. For each expression answer in the notes: does it read as intended? Check specifically: the grin shows teeth and a wide mouth and reads as evil rather than friendly (the brows and the sheet mouth carry the evil); the scowl's brows come down and the fangs show; the shout is a clear open mouth with a dark inside and no skin cap; the blink frame closes the eyes (the round sunglasses in the kit will cover them; say so if the kit hides the eyes in every frame); no tooth pokes out when the mouth is closed (neutral frame).

- [ ] **Step 3: Tune by eye**

Edit only numbers in `goblin-expressions.ts` (tuning and clip channels), one expression at a time, recapturing just that expression with `LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 BLOB_DIST=0.7 BLOB_TARGET_Y=1.2 BLOB_EXPR=<name> npm run blob:shot -- goblin /tmp/tune 2`. Every change gets a one-line comment in the file naming the frame that asked for it. Keep the tests green: `npx vitest run src/lab/sdf-zombie/characters/goblin-expressions.test.ts` (they pin ranges and the ordering grin < shout, not exact numbers). Stop when each expression reads as intended to you, or after three rounds on one expression; whatever is left goes in the notes as an open question for the owner rather than being polished forever.

- [ ] **Step 4: Final sheet and notes**

Rerun the sheet script so the committed frames are the final ones. Write `docs/dev-notes/2026-10-13-goblin-expressions/NOTES.md` with: what was built (a paragraph, linking the spec and plan); the frame list with one line per expression on what you see; the spike result and the owner's gate answer from Task 4; the finding that `eyeSquash` is dead in `generateFaceSheet` (goblin's authored 1.70 has never taken effect, `eyeLid` added instead, fixing it would change every character's eyes: an owner decision); the jaw hinge note (the bride's global `JAW_HINGE` at 0.30 of the skull is about 5.6 cm above the goblin's mouth line, so the lower lip swings back about 1.2 cm at a 0.15 rad gape and about 4 cm at a 0.5 rad shout; a per-body hinge is the fix if the owner dislikes it, and it touches the parser, `BodyDef`, `jaw.ts`, `motion.ts` and `rig-bind.ts`); whether the goblin-kit `.wam` jaw line was synced and the glTF rebuilt (Task 2 step 6); how to run everything (`BLOB_EXPR`, `BLOB_GAPE`, the sheet script, the lab panel); and what is deferred (surprise, sneer, the screen-lab wiring after PRs #46/#47, approach C).

- [ ] **Step 5: Commit**

```bash
git add scripts/goblin-expression-sheet.sh src/lab/sdf-zombie/characters/goblin-expressions.ts docs/dev-notes/2026-10-13-goblin-expressions
git commit -m "feat(goblin): the expressions tuned by eye, the contact sheet script and the notes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Cost, docs and wrap-up

**Files:**
- Modify: `TASKS.md`, `docs/tasks/characters.md`
- Modify: `docs/superpowers/specs/2026-10-13-goblin-expressions-design.md` (two corrections)
- Modify: `docs/dev-notes/2026-10-13-goblin-expressions/NOTES.md` (the cost numbers)

- [ ] **Step 1: Measure the frame cost before and after**

Read the header of `scripts/frame-cost.mjs` and `docs/dev-notes/2026-10-08-frame-cost/NOTES.md` for how to take a goblin close-up number with your own ports (never 5173). Take the number AFTER (this branch's HEAD). For the BEFORE, temporarily restore the old head: `git show f81e5b10:src/lab/sdf-zombie/characters/goblin.blob > src/lab/sdf-zombie/characters/goblin.blob`, take the number the same way, then `git checkout -- src/lab/sdf-zombie/characters/goblin.blob` and confirm `git status` shows it clean. Record both numbers (GPU ms of the goblin close-up) and the difference in the notes. If the delta exceeds 1.5 ms, say so plainly and list the cheapest trims in order (drop the two outer upper small teeth, drop two lower teeth, gate the teeth to near distance); do not trim without the owner.

- [ ] **Step 2: Correct two things in the spec**

In `docs/superpowers/specs/2026-10-13-goblin-expressions-design.md`: (1) in "Risks" item 3, replace the claim that the kit parity test will need the bone with: the goblin has no kit skeleton-parity test (the bride does); the `.wam` gets the transcribed `jaw` line for consistency and the glTF is rebuilt with `scripts/build-wam-kit.sh goblin` when WAM is installed. (2) In "What exists", add one bullet: `eyeSquash` is declared and defaulted in `FaceSheetParams` but `generateFaceSheet` never reads it (the eye uses a fixed 1.25), so the blink uses a new `eyeLid` param (default 0, no existing sheet changes).

- [ ] **Step 3: Update `TASKS.md`**

Add one bullet under "In flight / next", in the same style as its neighbours (area: characters), reading:

```
**The goblin's face moves** (owner, 2026-10-13) — [characters](docs/tasks/characters.md)
- [~] **Built 2026-10-13, owner look pending.** A jaw bone (the bride's jaw system), 11 jagged teeth with two fangs, and keyed expression clips
  (neutral, grin, scowl, shout, plus a blink) driving the jaw and the generated face sheet. Judged in the lab (`?character=goblin`; panel
  section "expression", or `BLOB_EXPR=grin npm run blob:shot -- goblin`). [Notes and the expression sheet](docs/dev-notes/2026-10-13-goblin-expressions/NOTES.md) ·
  [spec](docs/superpowers/specs/2026-10-13-goblin-expressions-design.md) · [plan](docs/superpowers/plans/2026-10-13-goblin-expressions.md).
  Next: surprise and sneer (clip data), the screen-emergence lab wiring after PRs #46/#47, and approach C (per-prim morphs) only if the look is rejected.
```

(Also keep the front page under its ~120-line limit; if it would exceed it, shorten an older bullet rather than skip this one.)

- [ ] **Step 4: Update `docs/tasks/characters.md`**

In the goblin section, directly after the pose-layer entry, add a checklist entry with the same facts: what is built (jaw bone and split, teeth, `expression.ts`, clips, lab panel and `BLOB_EXPR`), what is open (`[ ]` owner look; `[ ]` surprise and sneer; `[ ]` screen-lab wiring after #46/#47; `[ ]` per-body jaw hinge if the shout's lower-lip retreat is disliked; `[ ]` decide whether to fix the dead `eyeSquash` for every character), each linking the notes.

- [ ] **Step 5: Run the targeted checks**

Run: `npm run typecheck` and `npm run test:changed`
Expected: PASS. Report any failure verbatim; do not run the full suite.

- [ ] **Step 6: Save to memory and commit**

```bash
source ~/.claude/hooks/dualmem-env.sh
~/go/bin/dualmem add --type architecture --text "Goblin expressions: expression.ts (pure channels gape/smile/browDown/lipCurl/lid, keyed clips, actuate -> jawGape + FaceSheetParams overrides), goblin-expressions.ts (tuning + clips), expression-library.ts; goblin.blob has bone jaw (carrier, pitch 112) with the lower face split onto it and 11 teeth (marker color=8f8266 gloss=0.15) buried at rest; lab-main stepExpression refills the generated sheet in place (sheetToRgba) and rides rig.jawGape; BLOB_EXPR/BLOB_GAPE in blob-turntable; MotionConfig.jawGape for the actor path" --files "src/lab/sdf-zombie/expression.ts,src/lab/sdf-zombie/characters/goblin.blob,src/lab/sdf-zombie/webgpu/lab-main.ts,src/lab/sdf-zombie/characters/goblin-expressions.ts" --salience 0.85
~/go/bin/dualmem add --type warning --text "blob-face-sheet eyeSquash is DEAD: declared and defaulted but generateFaceSheet never reads it (eye uses a fixed 1.25), so the goblin's authored eyeSquash 1.70 has never applied; wiring it in would change every character's eyes. Blink uses the new eyeLid param (default 0)." --files "src/lab/sdf-zombie/blob-face-sheet.ts,src/lab/sdf-zombie/characters/goblin.blob" --salience 0.8
git add TASKS.md docs/tasks/characters.md docs/superpowers/specs/2026-10-13-goblin-expressions-design.md docs/dev-notes/2026-10-13-goblin-expressions
git commit -m "docs(goblin): expressions status, frame cost and spec corrections

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hand off**

Send the owner the contact sheet (`docs/dev-notes/2026-10-13-goblin-expressions/frames/index.html` plus the PNGs) with a short note: what each expression looks like, the measured frame cost, and the open questions (is the grin evil enough; do you want the hinge moved; surprise and sneer next; screen-lab wiring after PRs #46/#47; the dead `eyeSquash`). Then use `superpowers:finishing-a-development-branch` once the owner has judged the look.

---

### Task 12: Brighter teeth and a face that distorts when it smiles (owner direction, 2026-10-15)

After seeing the Task 10 sheet the owner said: "its better. maybe we should like light the teeth somehow or make them brighter, hard to see them tbh. also we might have to distort the face further, like when smiling I feel his face geometry isnt changing enough, like his chins n stuff should get wider." This is the per-prim morph escalation pre-approved in Task 3b ("if we have to distort or animate other elements of his face geometry of course that is fine since its SDF"). Two independent parts, each its own commit(s).

**Part A: teeth that read.** Today the teeth are `color=8f8266 gloss=0.15` (dirty ivory) in a mouth whose interior is a dark bar. In the grin frames they are brownish and low-contrast. Make them clearly visible WITHOUT turning them into a glowing clump: first try lighter ivory (the renderer darkens low sRGB hard and the key light is warm, so keep the source near neutral and let the light yellow it; the cultist's clean ivory read as bright yellow, so find the middle by frames), a little more `gloss`, and check whether the interior bar's dark gloss or the near-light/AO is swallowing the light (the mouth is a cavity; a faint warm light or a lighter interior floor behind the teeth is acceptable if cheap). Fine surface detail stays small: no per-tooth texture. Acceptance by eye AND by a number: in the grin close-up (kit on and kit off, front and 45 degrees) the upper row is individually distinguishable and the mean luma of tooth pixels is at least twice the luma of the gap between them; report the measured ratio before and after. The buried-at-rest tests and `scripts/goblin-head-profile.ts` must stay green (the tooth colour marker the tests find teeth by is `color=8f8266 gloss=0.15`: change the marker in `goblin-blob.test.ts` together with the colour, in one place).

**Part B: face morphs.** A small, tested per-prim morph mechanism, a minimal approach C, built on the channels that already exist.
1. Write the design as a short amendment at the end of `docs/superpowers/specs/2026-10-13-goblin-expressions-design.md` BEFORE coding (what a morph is, the `.blob` syntax, where it applies, how weights travel, how neutral stays bit-identical).
2. A `.blob` prim may declare morphs, e.g. `morph=smile:0.010,0.004,0 morph=smile:*1.15` meaning: when channel `smile` has weight w, add `w * (dx,dy,dz)` to the prim's endpoints and multiply its radius by `1 + w * (k - 1)` (choose a clean syntax; keep the parser's error style: unknown channel names are errors; the legal names are `expression.ts` CHANNEL_NAMES). The pure math lives in a renderer-free module with its own tests (`morph.ts`).
3. `applyRig` (rig-bind.ts) applies the weights to the prim's REST endpoints before any rigid-head or jaw rotation, so a morphed lip still turns with the head and opens with the gape. Weights travel exactly as `jawGape` does: `rig.morphs` (optional record), `MotionConfig`/`ActorStepInput` `morphs` -> `MotionFrame.morphs`... only as far as needed: the lab statue path (`boundForPose`) and the actor path. `actuate` (expression.ts) outputs `morphs` (the channel weights it already computes, clamped) next to `jawGape` and the sheet; `lab-main.ts`'s `stepExpression` passes them on.
4. All weights 0 must change NOTHING: the goblin at rest and every other character render and pack bit-identically (`pack-golden`, `goblin-blob`, `rig-bind` tests; if the morph data would enter `packBody`'s bytes, keep it OUT of the packed struct, in the binding instead, rather than re-recording the golden).
5. Author the goblin's morphs by eye on close-ups with the grin: on `smile` the chin/lower-jaw mass widens and lowers a little, the cheek-fill pair and the mouth-corner pair push OUT and UP (this is what curls the grin's corners), the upper lip lifts a few millimetres to bare the teeth, the face-block jaw ellipsoid cannot be morphed (it is not a `.blob` prim: if it must move, replace its job with authored prims or a morphed fill prim). `gape` and `browDown` get morphs only where a frame asks for it. Keep the shout and scowl reading; keep neutral exactly as today. Keep the +prim count small: prefer morphing existing prims over adding new ones.
6. Re-tune `goblin-expressions.ts` numbers for the new look if needed. Show the grin and the shout, kit on and off, front and 45 degrees, in `docs/dev-notes/2026-10-13-goblin-expressions/morphs/` and update NOTES.md with what changed and what you see.

**Part C: cost.** Report the frame cost before/after Task 12 on the same face close-up the Task 11 notes used (`__sdfLab.benchGpu()` with `setCam`, alternated boots, see NOTES.md), and the cost of the idea "skip the buried teeth and interior while the jaw is shut". Do NOT implement the skip without the owner's go-ahead; report the number and a sketch only.

**Files:** `goblin.blob`, `goblin-blob.test.ts`, `goblin-expressions.ts`/test, `expression.ts`/test, new `morph.ts`/`morph.test.ts`, `blob-ast.ts`, `blob-parse.ts`(+test), `blob-compile.ts`, `types.ts`, `rig-bind.ts`(+test), `rig.ts`, `motion.ts`, `actor.ts`, `webgpu/lab-main.ts`, the authoring skill reference `.claude/skills/authoring-sdf-characters/reference.md` (document the syntax), the spec, NOTES.md. **Rules:** targeted tests only; own ports (`LAB_VITE_PORT=5301 LAB_CDP_PORT=9301`); never 5173; commits end with the Co-Authored-By line; the owner judges the look, so be candid about what does not work.

---

### Task 13: The cinematic variant: expressions move to `goblin-cinematic`, the base goblin goes back (owner direction, 2026-10-15)

After watching the grin clip the owner decided: "lets do the mesh teeth, only in the cinematic variant, but yeah we would have a base goblin without the facial head complexity", and "the cinematic goblin has bare eyes (no sunglasses)". The jaw, teeth, morphs and expression clips are for the CINEMATIC goblin only (the Flat's screen-emergence shots); the base goblin (lab, first-person arms) keeps its pre-expression head and cost. The cinematic goblin in PR #47 is `goblin-home` (not on this branch); this variant is authored here as `goblin-cinematic` so the work lands as one reusable piece, and `goblin-home` can adopt it later.

- [x] **Step 1: Restore the base goblin.** `goblin.blob`, `goblin-kit.wam`, `public/assets/lab/goblin-kit.gltf`, the goblin's entries in `pack-golden` snapshot / `pack.test.ts` prof pin, and the goblin-specific pins in `goblin-blob.test.ts` return to exactly their pre-expression state (`git show f81e5b10:<path>`; the base goblin's head profile pins are the ORIGINAL Task 1 numbers, keep that test on the base goblin so its head stays protected). The base goblin has no jaw bone, no teeth, no morph words, no expression entry in `expression-library.ts`.
- [x] **Step 2: Create the variant.** `src/lab/sdf-zombie/characters/goblin-cinematic.blob` is the CURRENT (expression-pass) `goblin.blob` (`model goblin-cinematic`), keeping its jaw bone with `hinge=`, lower-face split, mouth seam, teeth and interior (Task 14 removes the teeth from the .blob), morphs and sheet. Register it in `character-registry.ts` (src, `kit: '/assets/lab/goblin-cinematic-kit.gltf'`, the goblin's motion profile via `motionProfileFor`, same as `clown-alt` is wired), give it the goblin's poses (`pose-library.ts`) and the expressions (`expression-library.ts`: key it `goblin-cinematic`, not `goblin`). Its kit is `goblin-cinematic-kit.wam` = the current goblin kit WITHOUT the round sunglasses and their ear hooks (bare eyes), with the `jaw` bone line, built with `scripts/build-wam-kit.sh goblin-cinematic`.
- [x] **Step 3: Tests.** Move the expression-pass tests (jaw, teeth, mouth, head-profile re-pins, hinge, morph checks) from `goblin-blob.test.ts` into a new `goblin-cinematic-blob.test.ts` against the variant (its own profile probes: current numbers); `goblin-blob.test.ts` must be byte-for-byte the pre-expression test again. Add a registry test that `goblin-cinematic` builds and has motion joints, and that `goblin` still has none of the jaw/morph/teeth content (no `jaw` bone, no `morph=` word). Regenerate the module index if needed; any golden that moves must be explained (the base goblin's must NOT move relative to `f81e5b10`: prove with `git diff f81e5b10 -- <goblin files>` being empty for goblin.blob, goblin-kit.wam, goblin-kit.gltf, goblin-blob.test.ts).
- [x] **Step 4: Lab and scripts.** `?character=goblin-cinematic` works; `scripts/goblin-expression-sheet.sh` and the capture recipes use `goblin-cinematic`; the sheet's no-kit row is now simply the variant's own bare-eye look (keep the kit-hidden row only if still useful). Capture the variant's grin and neutral close-ups (front, 45 degrees) and confirm the BASE goblin is unchanged (render a base close-up, compare with a pre-expression frame).
- [x] **Step 5: Notes and commit.** Update NOTES.md (what is where now; goblin-home adoption path for PR #47), TASKS.md/characters.md entries (small edits), commit in logical units.

---

### Task 14: Mesh teeth in the cinematic kit (owner direction, 2026-10-15)

The teeth leave the SDF and become POLYGON MESH in `goblin-cinematic-kit` (the 11 SDF tooth prims cost about 23 ms on a face close-up, were hard to light, and are buried flesh for nothing at rest). Upper teeth are skinned to the `skull` bone, lower teeth to the `jaw` bone. The kit renders as polygons over the SDF with its own material, so teeth can be near-white ivory with ordinary lighting.

**The catch (investigate first, write it down):** the SDF `on jaw` prims rotate about the per-body HINGE (a point at `hinge=` along the skull) by the gape scalar; a skinned kit bone rotates its vertices about the BONE'S HEAD (the skull pivot, a different point) by the angle its direction changes. Lower-tooth mesh would therefore drift from the lip by millimetres. Required: the lower teeth must follow EXACTLY the transform the jaw prims get (rotation about the hinge by the gape, composed with the head rotation). Find how the kit is posed (`createCharacterView`, the kit/prop `pose()` call in `lab-main.ts`, `rig-bind.ts` `headTransform`/`jawOrient`/`openAboutHinge`) and add the smallest mechanism that gives the kit's `jaw`-skinned vertices the jaw transform (for example overriding the jaw bone's matrix with the hinge rotation, or a rigid attachment node for the lower teeth). Prove it with a test: a lower-tooth rest vertex lands within 0.5 mm of where an SDF prim authored at the same rest point lands under `applyRig` at gapes 0.1, 0.3, 0.5. Also check depth: buried teeth (shut mouth) must be hidden by the SDF face (the polygon pass composes with SDF depth like the armour does); if the kit does NOT depth-test against the SDF, hide the teeth meshes while `gape` and the morph weights are 0 and say so.

- [x] **Step 1:** Read `goblin-cinematic-kit.wam`, `goblin-kit.wam`, `bride-kit.wam` and the WAM sources at `${WAM_DIR:-$HOME/Projects/2026/wam}` to learn how to author small skinned pieces (cones/spikes sweeps) skinned to a bone. Write the investigation of the hinge catch and the depth question in NOTES.md before building.
- [x] **Step 2:** Add the mesh teeth (7 upper incl. 2 fangs, 4 lower, the same layout the SDF teeth have: x positions, uneven lengths, pointed) to `goblin-cinematic-kit.wam`; remove the 11 tooth prims from `goblin-cinematic.blob` (the interior bar and the dark floor stay SDF); rebuild the kit; update the tests (the 'teeth buried' tests become kit-vertex tests: every tooth vertex is inside the shut mouth's flesh or behind the lips at rest, or hidden).
- [x] **Step 3:** The jaw-transform mechanism and its test (above). The bride and the base goblin must be unaffected (their tests pass, the base goblin's render is unchanged).
- [x] **Step 4:** Material: near-white ivory, mild gloss, lit by the scene; no glow hack needed. Measure the teeth-to-gap luma ratio like Task 12 (it was 9.4 front / 2.2 at 45 degrees with SDF teeth) and report; teeth must read at least as well.
- [x] **Step 5:** Cost: report the cinematic variant's face close-up cost before (SDF teeth) and after (mesh) with the Task 11/12 method; expect about 20+ ms back. Frames, notes, commit.

---

### Task 15: A smile that does not read as surprise: eyes, cheeks, brows (owner direction, 2026-10-15)

Owner's read of the grin clip: "it doesnt really read as a smile ... smiling involves also movement of the eye area where the eyes would have to get smaller with the cheeks and eyelids closing more; the animation feels like its just opening the mouth, it reads more like surprise haha." Decision: the cinematic goblin has BARE EYES (no sunglasses), so the eye squint is visible.

**What a smile is here:** the jaw barely opens (gape at most about 0.12 rad at the grin's peak, the teeth are shown by the lip lift and the corner pull, not by dropping the jaw); the mouth gets WIDER with the corners up and out; the cheeks rise into the lower eyelids; the eyes narrow (smaller and partly closed: lower lid up, upper lid down); the brows come down a little (an EVIL grin: brows down and inward more). Surprise is the opposite (jaw dropped, eyes wide, brows up): it is NOT built here but falls out of the same channels later.

- [x] **Step 1:** Add a `squint` channel (0..1: cheek-raise and lid-narrow) to `expression.ts` CHANNEL_NAMES/REST_CHANNELS/`actuate` (tuning fields `squintLid`, `squintEyeSize`, `squintBrow`, and the sheet's `eyeLid`/`eyeSize`/`eyeTilt` as needed; `lid` keeps meaning blink). `actuate` also returns `squint` in `morphs` like the other weights. Tests in `expression.test.ts` first (range clamps, neutral unchanged, the eye gets smaller as squint rises).
- [x] **Step 2:** Author the eye-area morphs in `goblin-cinematic.blob` (`morph=squint:...` on the cheek-fill pair: up and in under the eyes; on the brow ridge: down a few millimetres; on whatever forms the under-eye): small, tested by a pin that squint 1 raises the cheek mass by a measurable amount while weights 0 stay bit-identical. The sheet's eye is painted, so the lid narrowing is the sheet's `eyeLid`/`eyeSize` (check `blob-face-sheet.ts` eye drawing: `eyeLid` squashes the eye vertically).
- [x] **Step 3:** Rework the clips in `goblin-expressions.ts` (cinematic only): `grin` = smile 1, squint 0.7-0.9, browDown 0.6-1, gape at most 0.12; the corners wider than today (morph amount on the mouth-corner prims; widen if needed). Keep `scowl` and `shout`. Add a plain `smile` clip (friendly: smile 1, squint 0.8, gape 0.05, brows not down) so the two can be compared; add `surprise` only if it is five lines (gape 0.5, browDown -1, no squint): it is the control that proves the grin no longer looks like it.
- [x] **Step 4:** Judge with animation, not stills. Capture the clips: `BLOB_EXPR=<name> BLOB_EXPR_SWEEP=0:0.92 BLOB_YAW=0|0.7 LAB_VITE_PORT=.. LAB_CDP_PORT=.. LAB_TMP=<scratch> BLOB_DIST=0.3 BLOB_TARGET_Y=1.14 BLOB_PITCH=0.05 npm run blob:shot -- goblin-cinematic <scratch>/<name> 24`, then ffmpeg (`hstack` of cropped 700x700 panels, `-framerate 12`; see how `anim/goblin-expressions-anim.mp4` was made, commit `711e2db4`) into one mp4 with grin front, grin 3/4, smile front, surprise front (if built). READ stills from the middle and the end of each. Measure: the eye's lit-pixel area at the grin's peak is at most 60% of neutral's; the mouth is wider than neutral by at least 20%; gape at most 0.12 rad. Be candid about whether it reads as a smile and not surprise; iterate numbers up to six rounds. Deliver the mp4 and frames in `docs/dev-notes/2026-10-13-goblin-expressions/smile/` and update NOTES.md.

---

### Task 16: Teeth with character, a brow ridge that moves, a clean grin (owner feedback on PR #48, 2026-10-15)

Owner, after the smile clip (verbatim): "eye closure seems fine to me. teeth are okay though the original SDF ones had a bit more character, e.g. they werent so simple triangles, i feel the originals had more interesting shape to them also i think the color was a bit better with the original (the mesh ones read very meshy and simple bright). i think stouter teeth is a yes. ... One issue i noticed is although his 'eye brows' move his actual brow shape doesnt (screenshot 1) which i think should change. also there are some weird shape stuff happening in the grin (screenshot 2)." Screenshots: `/private/tmp/claude-501/-Users-donny-Projects-blud--claude-worktrees-wizardly-wing-61896d/4e485213-61ca-4919-a3df-a9bbc29cafb5/images/1.png` (the eye/brow region: a heavy brow ridge cap above the eyes that does not change shape; only the painted brow moves) and `.../images/2.png` (the 3/4 grin: a round knob at the mouth corner, a separate round cheek bump, a pinched/folded lower lip with dark crease lines). READ both first.

**Part A: teeth with character.** In `goblin-cinematic-kit.wam` (mesh teeth, 7 upper incl. 2 fangs on `skull`, 4 lower on `jaw`; keep the jaw-transform mechanism and the root rings that sit inside the flesh): stouter (about 1.5x the root radius; keep them from becoming pegs), NOT uniform cones: each tooth gets an individual silhouette like the earlier SDF ones had (a swollen root that tapers, a slight sabre curve, a leaning or crooked tooth, flattened (non-round) cross-sections, one chipped or broken tip, a spread of lengths bigger than today's). Colour: the earlier SDF teeth were `color=e0d8c0` lit by the scene (see `teeth/` and `mesh-teeth/before-after-*.png` in the dev-notes): match that warmth: a dirty warm ivory, darker and yellower toward the root (gum stain), higher roughness, no clean bright white, small per-tooth variation (separate palette entries/atlas cells per tooth or two-tone parts; WAM bakes one atlas cell per part). Update `kit-overlay.ts` `LOOK` for `tooth` (roughness, env) as needed. Keep the buried-at-rest tests and the 0.5 mm jaw-transform test green (re-pin the per-tooth root/tip numbers deliberately). The teeth must still read: report the teeth-to-gap luma ratio (was 21.5 front, 7.6 at 45 degrees) and keep it above 8 front / 3 at 45 degrees.

**Part B: the brow ridge moves.** The face block's `brow` prim (the ridge over the eyes, from `facePrims`) currently gets only a 1.6-3.4 mm morph on `browDown`. Make the geometry follow the painted brow clearly: `browDown` 1 lowers the ridge and pushes it forward/inward so it visibly overhangs and angles toward the nose (evil), `browDown` -1 (surprise) lifts it; `squint` adds a little. Use the face-block `morph <tag> <channel>:...` lines (they morph `head`, `jaw`, `brow`, `nose`): you may need signed-weight support (browDown is -1..1; check morph.ts / applyRig for how a negative weight is applied: linear is fine) and a wider/forward scale term. Check the cranium ellipsoid does not swallow it (the brow sits in front of the cranium). Prove with a pin (ridge front/top moves by at least 6 mm in y between browDown -1 and +1) and with a before/after eye-region still (kit has no sunglasses; DIST 0.3, TARGET_Y 1.2) for neutral, grin, scowl, surprise.

**Part C: clean the grin's shapes.** Investigate screenshot 2: capture the grin peak from yaw 0, 0.35, 0.7, 1.2 and from slightly below, find which morphed prims make the knob (the mouth-corner pair), the separate cheek bump (the cheek fill), the pinched lower-lip fold (lower lip bar U-morph against the chin mass) and the dark crease lines (smooth-min seams between morphed prims). Fix by authoring: larger `blend` on the corner and cheek prims so they merge into the cheek, smaller or smoother morph scales, move the corner morph so it reads as a cheek pushing up rather than a ball, soften the lower-lip fold. Keep the grin's read (eyes slits, wide crescent, teeth) and the rest face bit-identical; keep pins (cheek mass, corner width 1.2x, gape <= 0.12) green or re-pin deliberately.

**Judging:** by animation and stills; the clip recipe is `BLOB_EXPR=<name> BLOB_EXPR_SWEEP=0:0.92 BLOB_YAW=<yaw> ... npm run blob:shot -- goblin-cinematic <scratch>/<name> 24` and ffmpeg hstack (see commit 711e2db4 and `smile/`). Deliver an updated mp4 (grin front, grin 3/4, scowl front, surprise front) and the stills in `docs/dev-notes/2026-10-13-goblin-expressions/polish/`; update NOTES.md; be candid. Do NOT push: the owner/controller pushes to PR #48.

---

### Task 17: Teeth sculpted in Blender, merged into the cinematic kit (owner direction on PR #48, 2026-10-15)

Owner: the WAM mesh teeth "read very meshy and simple bright"; the earlier SDF teeth "had a bit more character, not so simple triangles ... more interesting shape ... the color was a bit better"; "stouter teeth is a yes"; "sculpt the teeth in Blender" (Blender is running with the MCP connected: `mcp__blender__*` tools, deferred: load them with ToolSearch `select:mcp__blender__execute_blender_code,mcp__blender__get_objects_summary,mcp__blender__render_viewport_to_path,mcp__blender__get_screenshot_of_window_as_image,mcp__blender__get_object_detail_summary`; the Blender scene starts as the unsaved default cube scene; `execute_blender_code` runs `bpy` Python).

**Goal:** 11 individually sculpted teeth (7 upper incl. 2 fangs on `skull`, 4 lower on `jaw`) with real character: stouter (about 1.5x today's root radius, not pegs), a swollen root that tapers, a sabre curve, flattened non-round cross-sections, a crooked or leaning tooth, one chipped or broken tip, a bigger spread of lengths and thicknesses, fine bumps and small chips kept SMALL; warm dirty ivory like the earlier SDF teeth (`e0d8c0` as lit in `docs/dev-notes/2026-10-13-goblin-expressions/teeth/` and `mesh-teeth/before-after-grin.png`), darker and yellower toward the root (gum stain), no clean bright white. 150-400 triangles per tooth is plenty.

**Method:**
1. Read NOTES.md (kit, jaw-transform mechanism, tooth tests, luma method) and extract the CURRENT tooth layout from `public/assets/lab/goblin-cinematic-kit.gltf` (the primitives with the `tooth` material: root point, direction, length, root radius, which bone) so the new teeth sit at the same places, rooted at least 0.5 mm inside the flesh when the mouth is shut (the existing tests check this).
2. Sculpt in Blender through the MCP: write ONE reproducible generator script, `assets-source/goblin-teeth/goblin_teeth.py` (run inside Blender; builds the 11 teeth procedurally with per-tooth parameters: profile along the length, bend, flatten, twist, chip plane, noise displacement, vertex colour gradient; seeded; same style as `docs/dev-notes/2026-10-01-flat-emergence-lookdev/flat_lookdev.py`), render previews to the scratchpad and LOOK (`render_viewport_to_path`, then Read the png); iterate until the teeth look characterful from front and side. Export `assets-source/goblin-teeth/goblin-teeth.glb` (one node per tooth named `tooth_u0..u6`, `tooth_l0..l3`; vertex colours as COLOR_0; units metres; Y-up, +Z forward like the kit). Use the repo's coordinate frame (the kit's), checked against the extracted layout.
3. Merge: a deterministic node script `scripts/merge-kit-teeth.mjs` that takes the WAM-built `goblin-cinematic-kit.gltf` and the teeth glb, REMOVES the WAM tooth primitives, adds the Blender teeth as skinned primitives (JOINTS_0 and WEIGHTS_0 = weight 1 to `skull` for the upper teeth and to `jaw` for the lower ones, matching the kit's skin/joint indices and inverse bind matrices), and a `tooth` material (the kit's material conventions: see how other materials are authored, and `kit-overlay.ts` `LOOK` for how `tooth` is lit; make the vertex colours actually reach the render: check whether the kit loader/materials honour COLOR_0, otherwise bake the colour into a small texture atlas or per-tooth material entries instead). Remove the WAM tooth parts from `goblin-cinematic-kit.wam` (or leave them out of the build) and make `scripts/build-wam-kit.sh goblin-cinematic` run the merge step after WAM so a rebuild keeps the Blender teeth (document it in the script header). Keep the armour byte-identical (vertices, normals, skin weights) and the base goblin kit untouched.
4. Keep the jaw-transform mechanism (`kitFrames`) and its tests green; keep the tooth tests (find teeth by the `tooth` material; buried at rest by at least 0.5 mm; every upper tooth shows at gape 0.15; jaw-skinned vertices follow the SDF jaw prims within 0.5 mm) and re-pin per-tooth numbers deliberately.
5. Judge in the engine: close-up frames (grin, shout, scowl, neutral; front and 45 degrees; `BLOB_DIST=0.3 BLOB_TARGET_Y=1.14 BLOB_PITCH=0.05 BLOB_EXPR=<name> npm run blob:shot -- goblin-cinematic ...`, own ports only) and an updated before/after. Teeth-to-gap luma ratio must stay above 8 front / 3 at 45 degrees (Task 12's marker method, see NOTES.md); the colour must read warm and dirty, and each tooth must be distinguishable by silhouette.
6. Cost: kit triangle count change (the teeth should stay a few thousand triangles at most) and a `benchGpu` before/after on the face close-up (noisy machine: say so).

**Files:** `assets-source/goblin-teeth/` (generator script and exported glb), `scripts/merge-kit-teeth.mjs`, `scripts/build-wam-kit.sh`, `goblin-cinematic-kit.wam`, `public/assets/lab/goblin-cinematic-kit.gltf`, `kit-overlay.ts`, `goblin-cinematic-blob.test.ts` (tooth tests), NOTES.md, frames under `docs/dev-notes/2026-10-13-goblin-expressions/blender-teeth/`. **Rules:** targeted tests only; own ports (`LAB_VITE_PORT=5361 LAB_CDP_PORT=9361`); never 5173; commits end with the Co-Authored-By line; do not push; be candid.

---

## Self-review (spec coverage, placeholders, types)

- **Spec coverage:** channels, clips, `expressionAt`, `actuate`, `sheetKey` (Task 6); goblin data and library (Task 7); jaw bone, split, teeth, interior (Tasks 2-3); motion wiring (Task 8); in-place sheet update, panel, driver API (Tasks 5, 9); look-dev spike and gate (Task 4); frames, notes, cost, `TASKS.md`, `characters.md` (Tasks 10-11); risks: the grin-may-not-read risk is Task 4's gate, the split-changes-the-head risk is Task 1's pins, the kit/skeleton risk is Task 2 step 6 (and corrected in the spec in Task 11), the `ridesHead` trap is covered by Task 3's buried pins and the jaw test, the "fine detail stays small" constraint is in the teeth comments and uses flat colour, the pose-layer inexactness is avoided by judging at rest.
- **Deliberate deviations from the spec, and why:** `eyeLid` is a new sheet param instead of overriding `eyeSquash` (the latter is dead code; see Task 5); the spec's "`cfg.pose` sibling" wiring is split between the motion path (Task 8) and the lab's statue-mode override (Tasks 4 and 9) because captures run in statue mode where no motion step sets `rig.jawGape`; `blink` is an overlay function (`blinkLid`/`withBlink`) rather than a clip, so it composes with any expression.
- **Known soft spot:** the jaw hinge is the bride's global `JAW_HINGE`, tuned for her mouth, about 5.6 cm above the goblin's lip line. It is measured and written up (Task 10 notes); a per-body hinge is deliberately not in this plan.
  *(Superseded 2026-10-14 by Task 3b: the shared hinge swung the goblin's jaw back into the throat from about 0.3 rad, so a per-body
  hinge was built after all: `hinge=<0..1>` on a `.blob` jaw bone (`blob-parse.ts`, `resolve.ts`, `jaw.ts` `jawRestOf`, `rig-bind.ts`,
  `motion.ts`), the goblin's at 0.06 (y 1.1326, the lip line); bodies without it keep `JAW_HINGE` exactly. Task 10's notes say so.)*
- **Type consistency:** `ExpressionClip`, `ExpressionKey`, `ExpressionTuning`, `Channels`, `Actuation`, `REST_CHANNELS`, `expressionAt`, `blinkLid`, `withBlink`, `actuate`, `sheetKey` are defined in Task 6 and used with the same names in Tasks 7 and 9; `ExpressionSet`/`expressionsFor` in Task 7 and 9; `sheetToRgba` and `eyeLid` in Task 5 and used in Tasks 6 and 9; `exprGape` and `setJawGape` in Task 4 and used in Task 9; `MotionConfig.jawGape` / `ActorStepInput.jawGape` in Task 8 and used in Task 9; `measureProfile`/`PROFILE_TOL` in Task 1 and used in Tasks 2-3.
