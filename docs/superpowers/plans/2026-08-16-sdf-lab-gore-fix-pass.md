# SDF Lab Gore Fix-Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four playtest findings on the gore-feel pass (2026-08-16): default blasts weld arm to torso, mid-limb carves leave floating limb pieces, gib pieces launch too soft, and blood droplets render as oversized orbs.

**Architecture:** All lab-scoped (`src/lab/sdf-zombie/`), both renderer paths. Per-wound-type profiles ride the spare `ROW_WOUND_META` channels so pellet/blast/burn each carry their own rim character ("weapon calibres"). Mid-limb severing adds a per-prim dead flag to the packed data (`primScale.w = 2`) so distal prims can be dropped without re-packing (the smooth-min fold order must never change). Velocity and droplet-size items are pure tuning.

**Tech Stack:** TypeScript, vitest, three / three/webgpu (NEVER import plain `three` under `webgpu/`).

**Context for every task:** Read the gore-feel spec+plan first
(`docs/superpowers/specs/2026-08-16-sdf-lab-gore-feel-design.md`,
`docs/superpowers/plans/2026-08-16-sdf-lab-gore-feel.md`). Ground rules from
that plan apply verbatim (node_modules symlink, `npx tsc --noEmit` clean and
`npm test` green before every commit, WGSL reserved-word lint).

---

### Task 1: Per-wound-type profiles + tighter rim locality

**Files:**
- Modify: `src/lab/sdf-zombie/damage.ts` (wound profile table)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (APPLY_WOUNDS)
- Modify: `src/lab/sdf-zombie/march.glsl.ts` (same lines)
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`writeWounds`), `src/lab/sdf-zombie/zombie.ts` (wound upload), both `lab-main.ts` (profile source)
- Test: `src/lab/sdf-zombie/damage.test.ts`, `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

Two changes with one mechanism:

1. **Profiles.** Add to `damage.ts`:

```ts
/** Per-type wound character — the "weapon calibre" knobs. rimSplayScale and
 *  rimOffsetScale multiply the global woundCfg rim settings PER WOUND, packed
 *  into the spare ROW_WOUND_META channels (z, w). */
export interface WoundProfile {
  radius: number;
  rimSplayScale: number;
  rimOffsetScale: number;
}
export const WOUND_PROFILES: Record<WoundType, WoundProfile> = {
  // Pellet: small clean punch, modest lip.
  pellet: { radius: 0.055, rimSplayScale: 0.8, rimOffsetScale: 1.0 },
  // Blast: big crater but a TAMED lip — the default splay welded the arm to
  // the torso at the shoulder (playtest 2026-08-16 screenshot 1).
  blast: { radius: 0.13, rimSplayScale: 0.45, rimOffsetScale: 0.85 },
  // Burn: chars and contracts; barely everts (shader already scales by 0.25).
  burn: { radius: 0.08, rimSplayScale: 1.0, rimOffsetScale: 1.0 },
};
```

Both lab-mains replace their local `RADIUS[type]` lookups with
`WOUND_PROFILES[type].radius` (delete the local `RADIUS` tables), and the
wound-upload paths write `rimSplayScale` / `rimOffsetScale` into meta z/w:
in `zombie-gpu.ts` `writeWounds` gains two parallel array params
`(splayScales: number[], offsetScales: number[])` written to meta texel z/w
(default 1 when omitted — chunk torn ends pass nothing and get 1s); in
`zombie.ts` the `uWoundMeta` writes gain the same two slots. Thread the values
from the callers: body wounds come from `wounds[i].type` via `WOUND_PROFILES`;
`refreshWounds` in BOTH lab-mains passes the per-wound scales.

2. **Shader.** In WGSL `APPLY_WOUNDS`, the rim block becomes (GLSL mirrored):

```wgsl
    let x = (r - depth * woundCfg.w * wMeta.w) / max(depth * woundCfg2.x, 1e-4);
    let amp = depth * woundCfg.z * wMeta.z * select(1.0, 0.25, isBurn);
    // Tighter surface locality than the first cut: 0.35/0.7 (was 0.5/1.2).
    // At blast amplitude the old reach exceeded the armpit gap and the rim
    // still bridged arm to torso from the shoulder side.
    let rimLocal = 1.0 - smoothstep(amp * 0.35, amp * 0.7, dIn);
    d = d - exp(-x * x) * amp * rimLocal;
```

(`wMeta` is already loaded in the loop. GLSL: same two multipliers from its
meta array's z/w and the same 0.35/0.7 constants.)

- [ ] Failing tests first: `damage.test.ts` asserts WOUND_PROFILES exists with the three types, blast rimSplayScale < 1, radii match the previous RADIUS values; `march.wgsl.test.ts` rim tripwire updated to assert `wMeta.z` and `wMeta.w` appear in applyWounds and the smoothstep uses `amp * 0.35`.
- [ ] Implement; `npx tsc --noEmit` + `npm test` green.
- [ ] Commit: `feat(sdf-lab): per-wound-type profiles + tighter rim locality`

---

### Task 2: Mid-limb connectivity + distal severing

**Files:**
- Modify: `src/lab/sdf-zombie/connectivity.ts` (+ its test)
- Modify: `src/lab/sdf-zombie/pack.ts` (dead-flag write), `src/lab/sdf-zombie/validate.ts` (CPU mirror skip), `src/lab/sdf-zombie/sever.ts` (`severDistal`)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` + `src/lab/sdf-zombie/march.glsl.ts` (dead-flag skip)
- Modify: both `lab-main.ts` (wire the new cut kind)
- Test: `sever.test.ts`, `connectivity.test.ts`, `march.wgsl.test.ts`, `validate.test.ts`

The playtest (screenshot 2) carved an arm through mid-forearm and the distal
piece FLOATED: `cutLimbs` only samples the torso-attachment neck. Fix in three
parts:

1. **Dead flag.** `primScale.w` encoding becomes: `0` add, `1` carve, `2` dead.
   - `pack.ts`: add `markPrimDead(packed, primIdx)` helper setting the w slot to 2 (and a matching `alive` check used by tests).
   - WGSL `MAP_BODY` additive loop: `if (S.w > 0.5) { continue; }` already skips both 1 and 2 — unchanged. `APPLY_CARVES`: replace `if (S.w < 0.5) { continue; }` with `if (S.w < 0.5 || S.w > 1.5) { continue; }` so dead prims stop carving too. GLSL: mirror the same two conditions. `validate.ts` `sdBody` CPU mirror: mirror the same skip rules (find its add/carve branches and apply identical w semantics — the CPU field backs click-to-shoot and MUST match).
   - `march.wgsl.test.ts`: tripwire that applyCarves contains `S.w > 1.5`.
2. **Chain cuts.** In `connectivity.ts` add:

```ts
export interface ChainCut { limb: LimbId; /** index into body.prims of the FIRST dead prim */ fromPrim: number }
/** Joints along each live limb chain whose cross-section a wound engulfs.
 *  Returns the outermost cut per limb (everything distal to it detaches). */
export function cutChains(body: BuildResult, wounds: Wound[]): ChainCut[]
```

   For each live non-torso cluster, order its add-prims root→tip (root = prim
   whose endpoint is nearest the torso centre; walk shared endpoints with the
   same JOINT_EPS=0.06 logic `gibAllPieces` uses). For each joint between
   consecutive prims, test the engulfing condition from `cutLimbs` (dist +
   local girth < wound.radius, blast/pellet only) at the joint point. The
   FIRST (most proximal) cut joint wins; `fromPrim` = the body.prims index of
   the distal prim at that joint.
3. **severDistal.** In `sever.ts`:

```ts
/** Severs a limb FROM a mid-chain prim outward: distal prims go dead (never
 *  removed — fold order is sacred), the cluster stays alive with its proximal
 *  prims, and the detached prims come back as a chunk group. */
export function severDistal(body: BuildResult, cut: ChainCut): SeverResult
```

   Implementation: collect the distal prim indices (the `fromPrim` prim plus
   every add-prim of that cluster further from the root along the chain), mark
   each `dead: true` on a NEW optional `Primitive.dead?: boolean` field (packBody
   writes w=2 for dead adds), rebuild `packed` via the normal update path, and
   return `chunk = { limb, prims: <copies of the detached prims>, origin: mean
   midpoint, tornAt: [the cut joint] }` plus a `stumpWound` at the joint
   (radius = joint girth * 1.2, type blast). The returned `body` keeps the
   cluster alive. `gibAllPieces`/`gibAll`/`severLimb` must SKIP dead prims when
   building groups (a later full sever of that arm must not resurrect the hand).
4. **Wire.** In both lab-mains' shoot handlers, after the existing `cutLimbs`
   loop: run `cutChains(current, wounds)` and for each cut call `severDistal`,
   push the stump wound, `spawnChunk(cut.limb, chunk.origin, chunk.prims,
   undefined, chunk.tornAt)`, then `view.update(current); refreshWounds();
   rebind();`. (Full-limb cuts from `cutLimbs` run first and take precedence —
   skip `cutChains` entries for limbs `cutLimbs` already severed this shot.)

- [ ] Failing tests first: chain-cut detection (engulf a knee joint ⇒ legL cut with the shin+foot prims distal; nick ⇒ none; burn ⇒ none), severDistal (cluster stays alive, distal prims dead, chunk carries exactly the distal prims, stump wound at joint, packBody writes w=2 for them, `sdBody` no longer registers the dead prims), gibAllPieces skips dead prims.
- [ ] Implement; full suite green.
- [ ] Commit: `feat(sdf-lab): mid-limb severing — carved-through joints drop the distal piece`

---

### Task 3: Game-hot gib launch velocities

**Files:**
- Modify: both `lab-main.ts` (gibEverything + spawnChunk default velocity)
- Test: none new (tuning) — but keep suite green.

Playtest: "not really like Blud where the pieces go flying out very far."
Match the game ChunkSystem's hand-tuned burst (chunks.ts `spawnOne`):

- `gibEverything` per-piece velocity: `speed = 5.0 + Math.random() * 4.0`
  (was 2.4 + rng*2.0); vertical `y: (0.8 + Math.random() * 0.8) * speed * 0.8`
  (was 2.2 + rng*2.4); keep the radial direction + jitter.
- `spawnChunk`'s default (sever pop) velocity: horizontal `(rng-0.5) * 4.5`,
  vertical `2.5 + rng * 2.5` (arm should pop, not slump).
- Both labs identical.

- [ ] Implement, eyeball one gib in the browser if available, suite green.
- [ ] Commit: `feat(sdf-lab): game-hot gib launch velocities`

---

### Task 4: Droplet visual size — trails, not orbs

**Files:**
- Modify: `src/lab/sdf-zombie/blood-view.ts` + `src/lab/sdf-zombie/webgpu/blood-view-gpu.ts`
- Modify: `src/lab/sdf-zombie/blood-sim.ts` (burst droplet size)
- Test: `blood-sim.test.ts` (size band)

Playtest: droplets render as "big dropping orbs"; the game's small billboard
trails are the reference. The game constants stay imported and untouched — the
LAB applies a view-side scale:

- In both blood views add `const DROPLET_VIEW_SCALE = 0.45;` (one shared
  constant per file, same value, commented as the lab-camera compensation:
  BLOOD_TRAIL.size was tuned for game camera distances) and multiply the
  droplet instance scale by it. Stretch cap drops from 1.4 to 0.8
  (`1 + Math.min(speed * 0.18, 0.8)`).
- Splat quads unchanged.
- `blood-sim.ts` burst droplets: size `0.03 + rng * 0.03` (was 0.05 + rng*0.05).
- Update the blood-sim size test band accordingly.

- [ ] Failing size test → implement → suite green.
- [ ] Commit: `fix(sdf-lab): droplets render trail-sized, not orb-sized`

---

### Task 5: Verification + TASKS.md

**Files:**
- Modify: `TASKS.md`

- [ ] `npm test` + `npx tsc --noEmit` clean.
- [ ] Browser pass if available (drive via `window.__sdfLab`, remember rAF
  pauses when the pane hides — no wall-clock perf claims, `benchGpu()` only):
  shoulder blast at DEFAULTS no longer welds arm to torso; carving mid-forearm
  drops the hand+forearm as a chunk; G-gib sprays pieces hard and far;
  droplets read as small trailing beads. Note any misses as PENDING for the
  interactive session rather than failing.
- [ ] TASKS.md: append under X1.19 (≤2 lines): `X1.19.1 [x] Fix-pass: per-type
  wound profiles, tighter rim locality, mid-limb severing, game-hot launch,
  trail-sized droplets.`
- [ ] Commit: `docs(tasks): X1.19.1 gore fix-pass landed`
