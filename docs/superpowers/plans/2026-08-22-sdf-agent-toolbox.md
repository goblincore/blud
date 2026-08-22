# SDF agent toolbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an agent authoring a `.blob` character a numbers-in / numbers-out loop — `blob-measure` (how wrong, where, which line), `blob-shot` (one command, pictures), `blob-render-check` (is it the renderer lying?) — plus the written rules that turn the mouse session's lessons into defaults, then prove it by dispatching a character task to a different model.

**Architecture:** Everything lives on the existing CPU mirror of the field (`sdBody`/`sdPrimitive` in `validate.ts`) and the existing silhouette/GLB code (`silhouette.ts`), so no engine change is needed except threading a source-line number through the build so a primitive can be named. The three commands are `npx tsx` scripts under `scripts/` registered as npm scripts; the browser-side ones reuse `blob-turntable.mjs`'s CDP pattern against `window.__sdfLab`. Docs changes go into the authoring skill (the one file dispatched agents actually read) and a dispatch task template.

**Tech Stack:** TypeScript, vitest, tsx (available via `npx tsx`, v4.23), Node 22 (native `fetch`/`WebSocket`/`zlib`), Chrome with `--remote-debugging-port`, Vite dev server, dispatch-ui.

---

## Why these five things and not others

From `docs/dev-notes/2026-08-22-painted-sdf-outfit.md`: the mouse converged when numbers were **measured off the mesh** instead of guessed, and the day lost was lost to **renderer bugs blamed on the `.blob`**. So:

| lesson | task |
|---|---|
| "which number is wrong" must name a `.blob` line, not a band index | Task 1 (provenance), Task 2 (`nearestPrim`), Task 4 (`blob-measure`) |
| the reference should be geometry, not a plate | Task 3 (mesh silhouette), Task 9 (refs convention) |
| agents skip steps that need a Chrome dance | Task 5 (`blob-shot`) |
| "round hole + CPU field solid = renderer" must be a command, not folklore | Task 6 (`blob-render-check`) |
| rules only work if they are in the file agents read | Task 7 (skill), Task 8 (dispatch template) |
| we do not know if any of this helps until a different model tries it | Task 10 (baseline), Task 11 (dispatch trial) |

Non-goals (see the separate human-editor spec): GUI, gizmos, `emitBlob` for arbitrary fields, bone editing.

## File structure

| path | responsibility |
|---|---|
| `src/lab/sdf-zombie/types.ts` | `PrimDef.src?: number`, `Primitive.src?: number` — the `.blob` source line |
| `src/lab/sdf-zombie/blob-compile.ts` | set `src` from `p.src.line` |
| `src/lab/sdf-zombie/mirror.ts`, `resolve.ts`, `clusters.ts` | carry `src` through (spreads already do; verified by test) |
| `src/lab/sdf-zombie/validate.ts` | `nearestPrim(p, body)` — CPU twin of the shader's `hitBest` |
| `src/lab/sdf-zombie/silhouette.ts` | `maskFromTriangles(tris, opts)` factored out of `maskFromBody`'s kit raster; `bandOwners(body, mask, report)` |
| `scripts/blob-measure.ts` | the command: build → validate → silhouette vs mesh and/or plate → worst bands with owning lines; `--json` |
| `scripts/blob-shot.sh` | start vite + Chrome if needed, run `blob-turntable.mjs`, stop what it started |
| `scripts/blob-render-check.ts` | one CDP frame vs CPU perspective raster; reports GPU holes the field does not have, naming the owning line |
| `package.json` | `blob:measure`, `blob:shot`, `blob:render-check` |
| `.claude/skills/authoring-sdf-characters/SKILL.md` | new "The loop, with numbers" section replacing the old loop; "Failure triage" table; "every number has a source" rule |
| `docs/dev-notes/refs/README.md` | mesh convention `refs/<character>-mesh/*.glb`, committed with `git add -f` |
| `docs/dev-notes/dispatch-character-task-template.md` | the skeleton for any dispatched character task |
| `TASKS.md` | baseline numbers and the trial result |

---

### Task 1: Source-line provenance on primitives

**Files:**
- Modify: `src/lab/sdf-zombie/types.ts` (PrimDef near line 25, Primitive near line 145)
- Modify: `src/lab/sdf-zombie/blob-compile.ts:226` (the `doc.parts.map`)
- Test: `src/lab/sdf-zombie/blob-compile.test.ts`, `src/lab/sdf-zombie/build-body.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test — a compiled prim knows its line**

Append to `src/lab/sdf-zombie/blob-compile.test.ts`:

```ts
describe('source-line provenance', () => {
  it('every compiled PrimDef carries the 1-based .blob line it came from', () => {
    const src = [
      'character probe',
      'bone pelvis dir=up len=0.2',
      '',
      '# a comment line that must not shift the count',
      '  blob torso on pelvis at=0.5 r=0.05',
      '  blob torso on pelvis at=0.9 r=0.04',
    ].join('\n');
    const doc = parseBlob(src);
    const def = compileBlob(doc, compileFace(doc));
    expect(def.prims.map(p => p.src)).toEqual([5, 6]);
  });
});
```

(Adjust the `character`/root-bone header lines to whatever the existing tests in that file use — copy the smallest fixture already there.)

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run src/lab/sdf-zombie/blob-compile.test.ts -t provenance`
Expected: FAIL — `src` is `undefined`.

- [ ] **Step 3: Add the field and set it**

`types.ts`, in `PrimDef` after `bone`:
```ts
  /**
   * 1-based line in the `.blob` source this primitive was written on. Absent
   * for primitives built in TypeScript (zombie's `makeZombie()`, test
   * fixtures). Exists so a measurement can say "line 143 (snout on skull)"
   * instead of "band 7" — the only form an agent can act on.
   */
  src?: number;
```
Same doc comment and field on `Primitive`.

`blob-compile.ts`, inside the `doc.parts.map` return object, add `src: p.src.line,`.

- [ ] **Step 4: Write the failing test — it survives the build, mirror included**

In `src/lab/sdf-zombie/build-body.test.ts` (create with the same imports as `mouse-blob.test.ts` if it does not exist):

```ts
it('built Primitives keep src through mirror, placement and clustering', () => {
  const src = [
    'character probe',
    'bone pelvis dir=up len=0.2',
    'bone thigh parent=pelvis dir=down len=0.3 side=0.05 mirror',
    '  blob torso on pelvis at=0.5 r=0.05',
    '  bar leg on thigh from=0.0 to=1.0 r=0.03 both',
  ].join('\n');
  const doc = parseBlob(src);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  expect(body.errors).toEqual([]);
  const lines = body.prims.map(p => p.src).sort();
  // one torso prim from line 4, two leg prims (l and r) from line 5
  expect(lines).toEqual([4, 5, 5]);
});
```

- [ ] **Step 5: Run it**

Run: `npx vitest run src/lab/sdf-zombie/build-body.test.ts`
Expected: PASS if `expandMirror`, `placePrims` and `assignClusters` all spread `...p`. If it FAILS with `undefined`, find the stage that builds a fresh object field-by-field (`grep -n "bone: p.bone" src/lab/sdf-zombie/mirror.ts src/lab/sdf-zombie/resolve.ts src/lab/sdf-zombie/clusters.ts`) and add `src: p.src,` there.

- [ ] **Step 6: Full suite, then commit**

Run: `npx vitest run src/lab/sdf-zombie/ 2>&1 | tail -5` — read the exit status line, not a grep.
Expected: all green (the `src` field is optional; no fixture changes).

```bash
git add src/lab/sdf-zombie/types.ts src/lab/sdf-zombie/blob-compile.ts src/lab/sdf-zombie/blob-compile.test.ts src/lab/sdf-zombie/build-body.test.ts
git commit -m "feat(blob): primitives remember the source line they were written on"
```

---

### Task 2: `nearestPrim` — the CPU twin of `hitBest`

**Files:**
- Modify: `src/lab/sdf-zombie/validate.ts` (next to `sdBody`, line 357)
- Test: `src/lab/sdf-zombie/validate.test.ts`

The shader paints and picks by "additive primitive with the smallest distance at the hit". The CPU needs the same answer so a tool can say which line owns a surface point.

- [ ] **Step 1: Failing test**

```ts
describe('nearestPrim', () => {
  it('returns the index of the additive prim with the smallest distance, ignoring carves and dead prims', () => {
    const src = [
      'character probe',
      'bone pelvis dir=up len=0.4',
      '  blob torso on pelvis at=0.1 r=0.05',
      '  blob torso on pelvis at=0.9 r=0.05',
      '  carve on pelvis at=0.9 r=0.02',
    ].join('\n');
    const doc = parseBlob(src);
    const body = buildBody(compileBlob(doc, compileFace(doc)));
    const top = body.prims.findIndex(p => p.src === 4);
    const bottom = body.prims.findIndex(p => p.src === 3);
    // just outside the top blob's surface
    expect(nearestPrim([0, 0.36, 0.055], body)).toBe(top);
    expect(nearestPrim([0, 0.04, 0.055], body)).toBe(bottom);
    // the carve sits on the top blob but must never be returned
    expect(body.prims[nearestPrim([0, 0.36, 0.02], body)]!.op).not.toBe('sub');
  });
});
```

(Bone `at=` runs 0 at the bone head to 1 at its tail; with `dir=up len=0.4` from the root, `at=0.9` is near y 0.36. If the fixture's root sits elsewhere, read `body.prims[top].a` in the test and sample relative to it.)

- [ ] **Step 2: Run, confirm fails**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts -t nearestPrim`
Expected: FAIL — `nearestPrim` not exported.

- [ ] **Step 3: Implement**

In `validate.ts` after `sdBody`:

```ts
/**
 * Index into `body.prims` of the ADDITIVE primitive closest to `p`, or -1 if
 * the body has no live additive prims. This is the CPU mirror of the shader's
 * `hitBest` (march.wgsl.ts) — the same arg-min the paint lookup uses — so a
 * surface point can be attributed to the `.blob` line that authored it.
 * Carves and grooves shape the surface but never own it, exactly as on the
 * GPU.
 */
export function nearestPrim(p: Vec3, body: Body): number {
  let best = -1, bestD = Infinity;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (let i = c.start; i < c.start + c.count; i++) {
      const prim = body.prims[i]!;
      if (prim.op === 'sub' || prim.op === 'groove' || prim.dead) continue;
      const d = sdPrimitive(p, prim);
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}
```

- [ ] **Step 4: Run, confirm passes; commit**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts`
Expected: PASS.

```bash
git add src/lab/sdf-zombie/validate.ts src/lab/sdf-zombie/validate.test.ts
git commit -m "feat(sdf): nearestPrim, the CPU twin of the shader's hitBest"
```

---

### Task 3: Mesh silhouettes and band owners in `silhouette.ts`

**Files:**
- Modify: `src/lab/sdf-zombie/silhouette.ts` (`maskFromBody` at 286 rasterises `opts.kit` triangles inline — factor that out)
- Test: `src/lab/sdf-zombie/silhouette.test.ts`

- [ ] **Step 1: Failing test — a triangle mesh rasterises to a mask on its own**

```ts
describe('maskFromTriangles', () => {
  it('rasterises a unit-ish quad into a filled rectangle, front view', () => {
    // two triangles, a 0.2 wide x 0.4 tall quad at z 0
    const tris = new Float32Array([
      -0.1, 0.0, 0,   0.1, 0.0, 0,   0.1, 0.4, 0,
      -0.1, 0.0, 0,   0.1, 0.4, 0,  -0.1, 0.4, 0,
    ]);
    const m = maskFromTriangles(tris, { view: 'front', heightPx: 64, pad: 0 });
    const filled = m.bits.reduce((a, b) => a + b, 0);
    // a rectangle fills its own bounding box
    expect(filled / (m.w * m.h)).toBeGreaterThan(0.95);
    expect(m.h).toBe(64);
    expect(Math.abs(m.w / m.h - 0.5)).toBeLessThan(0.1);
  });
});
```

- [ ] **Step 2: Run, confirm fails** — `maskFromTriangles` not exported.

- [ ] **Step 3: Implement by extraction**

Read `maskFromBody` from 286 to the end of the kit raster. Move the triangle bounds + scanline raster into:

```ts
export interface TriMaskOpts { view?: 'front' | 'side'; heightPx?: number; pad?: number }

/**
 * Orthographic silhouette of a triangle soup alone — the same raster
 * `maskFromBody` unions a kit with, exposed so a reference MESH (a .glb
 * through `parseGlb` + `gltfTriangles`) can be the thing a .blob is scored
 * against. Same axes as `maskFromBody`: front = (x, y) seen from +z, side =
 * (z, y).
 */
export function maskFromTriangles(tris: Float32Array, opts: TriMaskOpts = {}): Mask
```

`maskFromBody` keeps its behaviour by calling the same inner raster helper with its own bounds. Run the whole silhouette test file after: the existing kit tests are the regression guard.

- [ ] **Step 4: Failing test — band owners**

```ts
describe('bandOwners', () => {
  it('names the .blob line whose primitive forms the silhouette edge at a band', () => {
    const src = [
      'character probe',
      'bone pelvis dir=up len=0.4',
      '  blob torso on pelvis at=0.15 r=0.05',
      '  blob torso on pelvis at=0.85 r=0.10',
    ].join('\n');
    const doc = parseBlob(src);
    const body = buildBody(compileBlob(doc, compileFace(doc)));
    const owners = bandOwners(body, { view: 'front', bands: 4 });
    // top band is owned by the big blob on line 4, bottom by line 3
    expect(owners[0]!.line).toBe(4);
    expect(owners[3]!.line).toBe(3);
    expect(owners[0]!.bone).toBe('pelvis');
  });
});
```

- [ ] **Step 5: Implement `bandOwners`**

```ts
export interface BandOwner { band: number; at: number; line: number | null; bone: string; limb: string; index: number }

/**
 * For each horizontal band of the body's silhouette, the primitive that forms
 * the widest point of the outline — found by walking a ray inward from the
 * left and right extremes of the band at its mid-height until the field goes
 * negative, then asking `nearestPrim`. Pairs with `compareSilhouette`'s band
 * report so "band 7 is 12% too wide" becomes "line 143 (snout on skull) is
 * 12% too wide".
 */
export function bandOwners(body: BuiltBody, opts: { view?: 'front' | 'side'; bands?: number } = {}): BandOwner[]
```

Implementation: take the cluster-sphere bounds as `maskFromBody` does; for band `i` of `n`, `y = maxY - (i + 0.5) / n * (maxY - minY)`; step `u` from `uMin` toward the centre in 2 mm steps (front: `p = [u, y, zMid]` scanning z from `minZ` to `maxZ` in 5 mm steps at each u to find any inside sample — the outline is the union over depth); the first inside sample is the edge; call `nearestPrim`. Do both sides, keep the side whose edge is further from the centreline. `line` is `prim.src ?? null`, `bone`/`limb` from the prim (`Primitive.limb` exists; bone name — if `Primitive` lacks it, read it from `body.prims[i]` after checking `grep -n "bone" src/lab/sdf-zombie/types.ts` and add `bone?: string` the same way `src` was added in Task 1).

- [ ] **Step 6: Run the whole silhouette file; commit**

Run: `npx vitest run src/lab/sdf-zombie/silhouette.test.ts`
Expected: PASS, including the pre-existing kit tests.

```bash
git add src/lab/sdf-zombie/silhouette.ts src/lab/sdf-zombie/silhouette.test.ts
git commit -m "feat(silhouette): mesh-only masks and per-band owning primitives"
```

---

### Task 4: `blob-measure`

**Files:**
- Create: `scripts/blob-measure.ts`
- Modify: `package.json` scripts
- Test: `scripts/tests/blob-measure.test.ts` (the `scripts/tests/` dir exists; check how existing tests there import scripts — if they shell out, do the same)

This replaces `silhouette-match.ts` as the thing agents run (keep the old script; it still works).

- [ ] **Step 1: Write the usage header and argument parsing**

```ts
// One command, every number an agent needs to decide what to change next.
//
//   npm run blob:measure -- mouse
//   npm run blob:measure -- mouse --json           # machine-readable, for agents
//   npm run blob:measure -- mouse --side
//   npm run blob:measure -- mouse --range 0.75:1   # legs + shoes only
//   npm run blob:measure -- goblin --plate docs/dev-notes/refs/goblin-reference.png
//
// Reference resolution, in order:
//   1. --glb <path>
//   2. docs/dev-notes/refs/<name>-mesh/*.glb   (first .glb in the folder)
//   3. --plate <path> or docs/dev-notes/refs/<name>-reference.png
// A mesh is preferred over a plate because a plate poses its arms and a .blob
// does not — see the caveat in silhouette.ts. When both exist, both are
// reported; the mesh score is the one to optimise.
//
// Output (text): build status, validation errors, IoU, the three worst bands
// each with the .blob LINE and bone that own the silhouette there, and the
// ASCII overlay. The worst-band list is the whole point — it is the list of
// lines to edit, in order.
```

Parse `--json`, `--side`, `--range lo:hi`, `--bands n`, `--glb`, `--plate` the way `silhouette-match.ts` does (copy its parser; it is 15 lines).

- [ ] **Step 2: Build and validate**

```ts
const doc = parseBlob(readFileSync(blobPath, 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
const out: Report = { character: name, errors: body.errors, refs: [] };
```

- [ ] **Step 3: Score against each reference**

```ts
for (const ref of refs) {   // { kind: 'mesh' | 'plate', path, mask }
  const got = maskFromBody(body, { view, heightPx: 256 });
  const rep = compareSilhouette(ref.mask, got, { bands, range });   // (ref, got) — that argument order
  const owners = bandOwners(body, { view, bands: rep.bands.length });
  // rep.worst is already sorted worst-first by |delta|; attach the owner by band index
  const worst = rep.worst.slice(0, 3).map(b => ({
    ...b, owner: owners[rep.bands.indexOf(b)],
  }));
  out.refs.push({ kind: ref.kind, path: ref.path, iou: rep.iou,
    meanWidthError: rep.meanWidthError, worst, overlay: renderMask(got, 48) });
}
```

`BandReport` is `{ at, refWidth, gotWidth, delta }` with `delta = gotWidth - refWidth` (negative = ours too narrow), widths as fractions of subject height. `bandOwners` must use the same band count as `compareSilhouette` did, or the indices will not line up — read it back from `rep.bands.length` rather than passing `bands` twice.

- [ ] **Step 4: Print**

Text mode, one worst line looks like:
```
  band 7  at 0.31  ours 0.142  ref 0.118  delta +0.024   line 143  snout on skull (head)
```
JSON mode prints `JSON.stringify(out, null, 2)` and nothing else.

Exit code 0 always (a bad score is information, not a failure); exit 2 on missing files or build errors so a dispatched agent cannot mistake "did not run" for "scored 0".

- [ ] **Step 5: Register**

`package.json`:
```json
"blob:measure": "tsx scripts/blob-measure.ts",
```
(`tsx` resolves through npx if not a devDependency; if `npm run` cannot find it, add `"tsx": "^4.23.0"` to devDependencies — that is the one allowed dependency addition in this plan.)

- [ ] **Step 6: Test — shell the script on the mouse, assert shape**

```ts
import { execFileSync } from 'node:child_process';
it('blob-measure --json reports a mesh score and three owned worst bands for the mouse', () => {
  const raw = execFileSync('npx', ['tsx', 'scripts/blob-measure.ts', 'mouse', '--json'], { encoding: 'utf8' });
  const r = JSON.parse(raw);
  expect(r.errors).toEqual([]);
  const mesh = r.refs.find((x: any) => x.kind === 'mesh');
  expect(mesh.iou).toBeGreaterThan(0.7);
  expect(mesh.worst).toHaveLength(3);
  expect(mesh.worst[0].owner.line).toBeGreaterThan(0);
});
```

This test needs the mouse mesh committed — that is Task 9; until then it will report only the plate. Write the test against `refs[0]` and tighten to `kind === 'mesh'` in Task 9.

- [ ] **Step 7: Run on mouse and goblin by hand; commit**

Run: `npm run blob:measure -- mouse` and `npm run blob:measure -- goblin`
Expected: the mouse's worst three bands should be the hands/arms (known parked work); if the worst band is something else, read the overlay before trusting it.

```bash
git add scripts/blob-measure.ts scripts/tests/blob-measure.test.ts package.json
git commit -m "feat(scripts): blob-measure — IoU, worst bands, and the .blob lines that own them"
```

---

### Task 5: `blob-shot` — one command, pictures

**Files:**
- Create: `scripts/blob-shot.sh`
- Modify: `package.json`, `scripts/blob-turntable.mjs` (header only)

The turntable needs a Vite server and a Chrome with a debug port. Agents skip steps that need that; this wraps it.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# One command to get turntable frames of a .blob character.
#
#   npm run blob:shot -- mouse                 # -> /tmp/blob-shot/mouse/index.html
#   npm run blob:shot -- mouse /some/out/dir 12
#   BLOB_DIST=2.0 npm run blob:shot -- goblin
#
# Starts a Vite dev server on port 5233 and a Chrome on debug port 9223 IF
# they are not already listening, runs scripts/blob-turntable.mjs, then
# stops only what it started. Reusing an existing server is deliberate —
# the owner's lab session and an agent's shot can share one.
#
# Chrome is launched --headless=new first; WebGPU in headless Chrome on
# macOS was verified on 2026-08-22 (see Step 2). If the turntable reports
# "lab never booted", set BLOB_HEADED=1 to get a visible window.
set -euo pipefail
NAME="${1:?usage: blob-shot <character> [outDir] [frames]}"
OUT="${2:-/tmp/blob-shot/$NAME}"
FRAMES="${3:-8}"
VITE_PORT=5233
CDP_PORT=9223
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd "$(dirname "$0")/.."

started_vite=""; started_chrome=""
cleanup() {
  [ -n "$started_vite" ] && kill "$started_vite" 2>/dev/null || true
  [ -n "$started_chrome" ] && kill "$started_chrome" 2>/dev/null || true
}
trap cleanup EXIT

if ! curl -sf "http://localhost:$VITE_PORT/" >/dev/null; then
  npx vite --port $VITE_PORT --strictPort >/tmp/blob-shot-vite.log 2>&1 &
  started_vite=$!
  for i in $(seq 1 40); do curl -sf "http://localhost:$VITE_PORT/" >/dev/null && break; sleep 0.5; done
fi

if ! curl -sf "http://localhost:$CDP_PORT/json/version" >/dev/null; then
  HEADLESS="--headless=new"; [ "${BLOB_HEADED:-}" = "1" ] && HEADLESS=""
  "$CHROME" $HEADLESS --remote-debugging-port=$CDP_PORT --enable-unsafe-webgpu \
    --user-data-dir=/tmp/chrome-blob-shot --no-first-run --window-size=1380,820 \
    about:blank >/tmp/blob-shot-chrome.log 2>&1 &
  started_chrome=$!
  for i in $(seq 1 40); do curl -sf "http://localhost:$CDP_PORT/json/version" >/dev/null && break; sleep 0.5; done
fi

BLOB_CHARACTER="$NAME" node scripts/blob-turntable.mjs $VITE_PORT "$OUT" "$FRAMES" $CDP_PORT
echo "frames: $OUT/index.html"
```

`chmod +x scripts/blob-shot.sh`.

- [ ] **Step 2: Verify headless WebGPU actually works here**

Run: `npm run blob:shot -- mouse`
Expected: 8 frames, each with luma std > 5, `backend: webgpu` in the log. If the lab never boots headless, try `--headless=new --use-angle=metal`; if that also fails, change the script's default to headed and record the finding in the script header (do not leave a default that does not work).

- [ ] **Step 3: Look at the frames**

Open `/tmp/blob-shot/mouse/frame-00.png` with `Read`. It must show the mouse, framed, not a blank or a goblin.

- [ ] **Step 4: Register and document; commit**

`package.json`: `"blob:shot": "scripts/blob-shot.sh",`

In `blob-turntable.mjs`'s header, add one line under Usage: `Prefer scripts/blob-shot.sh, which starts and stops the server and browser for you.`

```bash
git add scripts/blob-shot.sh scripts/blob-turntable.mjs package.json
git commit -m "feat(scripts): blob-shot — turntable frames with no setup"
```

---

### Task 6: `blob-render-check` — is the renderer lying?

**Files:**
- Create: `scripts/blob-render-check.ts`
- Modify: `package.json`

The orb-hole day: the CPU field was solid, the GPU showed a hole, and the `.blob` was edited for hours. This makes that comparison a command.

- [ ] **Step 1: Header and contract**

```ts
// Does the GPU draw what the field says? One frame, front-on, compared
// pixel-by-pixel against a CPU perspective march of the same body through
// the same camera.
//
//   npm run blob:render-check -- mouse
//
// Reports every cluster of pixels where the CPU field is INSIDE (by at least
// 3 px of margin) and the screenshot shows background — a hole the geometry
// does not have — with the .blob line that owns the surface there. Exit 1 if
// any such cluster is larger than 12 px (the size of the orb hole). Exit 0
// with "renderer agrees with the field" otherwise.
//
// If this passes and you still see a hole in the lab, the hole is in your
// .blob. If this fails, STOP editing the .blob and read the triage table in
// the authoring skill: it is the occluder hull, the cone pre-pass, or the
// march, and the fix is in src/lab/sdf-zombie/webgpu/.
//
// Needs a Vite server on 5233 and Chrome on 9223 — run through
// scripts/blob-shot.sh's environment or start them the same way.
```

- [ ] **Step 2: CDP capture (copy from blob-turntable.mjs)**

Copy the `send`/`evaluate`/boot-poll/viewport block from `blob-turntable.mjs` lines 67–140 into the script (TypeScript; `WebSocket` and `fetch` are globals in Node 22). After boot: `setMotionEnabled(false); setWander(false); focusBody(); setCam(0, 0, DIST)` with `DIST = Number(process.env.BLOB_DIST ?? 2.4)`; sleep 4 s; `Page.captureScreenshot` at 1380×820.

Read the camera back:
```ts
const cam = await evaluate(`(() => { const c = window.__sdfLab.camera; c.updateMatrixWorld();
  return JSON.stringify({ fov: c.fov, aspect: c.aspect, pos: c.position.toArray(), m: c.matrixWorld.toArray() }); })()`);
```

- [ ] **Step 3: CPU perspective march**

Decode the screenshot with `decodePng`. For every 4th pixel (345×205 samples):
```ts
const ndcX = (x / W) * 2 - 1, ndcY = 1 - (y / H) * 2;
const tanH = Math.tan(fov * Math.PI / 360);
// ray in camera space, then through matrixWorld's rotation (three.js column-major)
const dirCam = [ndcX * tanH * aspect, ndcY * tanH, -1];
const dir = normalise(applyRotation(m, dirCam));
let t = 0, hit = false;
for (let i = 0; i < 128; i++) {
  const p = [pos[0] + dir[0] * t, pos[1] + dir[1] * t, pos[2] + dir[2] * t];
  const d = sdBody(p, body);
  if (d < 0.002) { hit = true; break; }
  t += Math.max(d, 0.002); if (t > 6) break;
}
```
Record `cpuInside[x,y] = hit` and, when hit, `owner = nearestPrim(p, body)`.

GPU inside: pixel differs from the background `0x1a1116` by more than 24 in any channel (the scene background is that colour — `goo-layer.ts:497`). Confirm by sampling the screenshot's top-left 10×10 and printing its mean; abort with a clear message if it is not close to the background, because then the classification is meaningless.

- [ ] **Step 4: Erode and compare**

Erode `cpuInside` by 3 samples (= 12 px) so silhouette-edge anti-aliasing cannot register. `hole = cpuInsideEroded && !gpuInside`. Flood-fill holes into clusters; for each cluster print size in px, centroid, and the most common owner's `src` line + bone. Exit 1 if any cluster ≥ 12 px.

- [ ] **Step 5: Prove it catches the orb hole**

Check out the `.blob` and engine from before the hull fix and run it — the commit is `git log --oneline --all | grep -i "orb\|hull" | head`. Expected: exit 1, one cluster at the snout, owner = the snout cone line. Then on current main: exit 0. Record both outputs in the script header as the worked example.

If checking out the old engine is impractical, instead temporarily set `HULL_SHRINK` in `occluder-hull.ts` to an absurd value, run, see it fail, revert. Do not skip this step: a checker that has never seen a failure is not a checker.

- [ ] **Step 6: Register; commit**

`package.json`: `"blob:render-check": "tsx scripts/blob-render-check.ts",`

```bash
git add scripts/blob-render-check.ts package.json
git commit -m "feat(scripts): blob-render-check — a GPU hole the field does not have is a renderer bug"
```

---

### Task 7: The authoring skill — loop, triage, rule

**Files:**
- Modify: `.claude/skills/authoring-sdf-characters/SKILL.md` ("## The loop" at line 29; add two sections after "Measure against the mesh, frame-aligned" at line 356)

This file is tracked although `.claude` is gitignored; `git add -f` is not needed for already-tracked files.

- [ ] **Step 1: Replace "## The loop"**

```markdown
## The loop

1. **Get the reference as geometry.** `docs/dev-notes/refs/<name>-mesh/*.glb`
   if it exists; a plate (`<name>-reference.png`) if not. If you have neither,
   stop and ask for one — two characters were authored from prose and both
   drifted a long way (refs/README.md).
2. **Measure before you touch anything:** `npm run blob:measure -- <name>`.
   Read the three worst bands. Each names a `.blob` line. That is your edit
   list, in order.
3. **Edit the line. Re-measure.** One band at a time. The score should move;
   if it does not, the band is owned by a different line than you thought —
   the tool told you which.
4. **Every ~5 edits, look:** `npm run blob:shot -- <name>`, then `Read` the
   frames. The measure cannot see a hole behind the front surface, a feature
   smeared by `blend=`, or a colour. The pictures can.
5. **See something the measure did not predict?** Run
   `npm run blob:render-check -- <name>` *before* editing the `.blob`. If it
   fails, the bug is in `webgpu/`, not in your file.
6. Tests: `npx vitest run src/lab/sdf-zombie/`. The character's own
   `*-blob.test.ts` pins measured properties; update the numbers it pins when
   you change them on purpose, with a comment saying why.
```

Keep the old manual Chrome instructions below it under a heading `### Running the turntable by hand` — they are still true and `blob-shot.sh` documents what it automates.

- [ ] **Step 2: Add "## Failure triage"**

```markdown
## Failure triage — what it looks like vs what it is

Every row here cost at least an hour of editing the wrong file. Check the
table before you change a number.

| what you see | what it usually is | where |
|---|---|---|
| a perfectly ROUND see-through hole, CPU field solid there | occluder hull sized a tapered prim from its fat end, or another hull/pre-pass bug | `webgpu/occluder-hull.ts`; run `blob:render-check` |
| a bent capsule renders as ONE sphere at its start | `coneBend` untapered branch | `webgpu/march.wgsl.ts` |
| a `both`/mirrored part sits on the centreline | mirror did not reflect x | `mirror.ts` |
| a limb's distal part "disconnects" after a paint or reorder | `clusterCore` picked the wrong prim; mark the structural one `core` | `validate.ts` `clusterCore` |
| a small feature is smeared / missing | `blend=` wider than the feature | the `.blob` — shrink blend or use `chamfer` |
| a stripe of flesh through a painted area, from one angle only | the camera, not the paint — `focusBody` was aiming down the collar | look from another yaw first |
| a right-side part renders but the left does not (or vice versa) | the `.r`/`.l` bone suffix is wrong in the `on` clause | the `.blob` |
| the whole body blanks | a zero in a panel override (`setStepsOverride(0)` used to) | `webgpu/lab-main.ts` |
| head reads right but sits 60 mm off in profile vs the mesh | the mesh is not at the same z — frame-align on the torso | `scripts/head-profile.ts` prints the shift |
```

- [ ] **Step 3: Add the rule under "Comment every non-obvious number"**

Append:

```markdown
**Every number has a source.** Either it was measured (say from what:
`# mesh width at y 0.76 = 0.142`) or the comment says why not
(`# eyeballed; the mesh has no ear dish, owner asked for one`). A number with
neither is a guess, and guesses are what `blob:measure` exists to replace.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/authoring-sdf-characters/SKILL.md
git commit -m "docs(skill): the measured loop, the failure triage table, every number has a source"
```

---

### Task 8: Dispatch task template for character work

**Files:**
- Create: `docs/dev-notes/dispatch-character-task-template.md`

- [ ] **Step 1: Write it**

Use the frontmatter shape from `~/.claude/dispatch/plans/2026-08-22-clown-hood-crown.md` (title, project, model, branch, base_branch, priority, max_runtime, allowed_tools, harness). Body:

```markdown
## THE ONE JOB
<one sentence: what the owner will look at to judge this>

## REFERENCE
- mesh: docs/dev-notes/refs/<name>-mesh/<file>.glb   (committed — verify with `git ls-files`)
- plates: docs/dev-notes/refs/<name>-*.png

## YOUR LOOP — do not improvise a different one
1. `npm run blob:measure -- <name>` — record the starting IoU and worst bands in your report.
2. Edit ONE owning line. Re-measure. Repeat.
3. Every ~5 edits: `npm run blob:shot -- <name>` and Read the frames.
4. Any hole or artefact the measure did not predict: `npm run blob:render-check -- <name>` BEFORE editing further. If it fails, report it and stop — the fix is not in the .blob.
5. `npx vitest run src/lab/sdf-zombie/` green before you commit.

## ALREADY ESTABLISHED — do not re-derive
<measured facts; see the skill's "Measure against the mesh" section>

## DONE WHEN
- IoU vs mesh ≥ <target> (from <start>), or the owner's named band within ±<n>%
- frames in /tmp/blob-shot/<name>/ show <the thing>
- report lists start/end numbers and every line you changed, with the reason on the line
```

- [ ] **Step 2: Point to it**

In `docs/dev-notes/refs/README.md` add a line: "Dispatching a character task? Start from `docs/dev-notes/dispatch-character-task-template.md`."

```bash
git add docs/dev-notes/dispatch-character-task-template.md docs/dev-notes/refs/README.md
git commit -m "docs: a dispatch template that makes the measured loop the default"
```

---

### Task 9: Reference meshes — convention and the mouse's

**Files:**
- Modify: `docs/dev-notes/refs/README.md`
- Move: `docs/dev-notes/refs/maus-biped/` → `docs/dev-notes/refs/mouse-mesh/` (primary checkout; currently untracked, 25 MB)
- Modify: `scripts/head-profile.ts:40` default GLB path; `scripts/tests/blob-measure.test.ts`

- [ ] **Step 1: README convention**

```markdown
## Meshes

A plate gives a silhouette; a mesh gives everything, and `blob:measure`
prefers it. Put reference meshes in `refs/<character>-mesh/` as `.glb`
(embedded textures, so paint regions can be read — the mouse's shades and
shoes were located by texel colour). Commit with `git add -f`; dispatched
agents run in fresh worktrees and cannot see untracked files.

Size: a 25 MB mesh is fine once. Do not commit iterations — replace the file.
```

- [ ] **Step 2: Move and commit the mouse mesh** (owner approved committing reference meshes by accepting this plan — if that changes, stop here and leave Task 4's test on the plate)

```bash
git mv docs/dev-notes/refs/maus-biped docs/dev-notes/refs/mouse-mesh 2>/dev/null || mv docs/dev-notes/refs/maus-biped docs/dev-notes/refs/mouse-mesh
git add -f docs/dev-notes/refs/mouse-mesh
```

Update `head-profile.ts`'s default path and the test in Task 4 to `kind === 'mesh'`.

- [ ] **Step 3: Run measure and tests; commit**

Run: `npm run blob:measure -- mouse` — expected: a `mesh` entry appears with IoU ≥ 0.75; `npx vitest run scripts/tests/blob-measure.test.ts` green.

```bash
git add docs/dev-notes/refs/README.md scripts/head-profile.ts scripts/tests/blob-measure.test.ts
git commit -m "refs: mouse reference mesh committed under the <name>-mesh convention"
```

---

### Task 10: Baselines

**Files:**
- Modify: `TASKS.md` (the SDF character section near line 500)

- [ ] **Step 1: Measure every character**

Run `npm run blob:measure -- <name>` for mouse, goblin, clown, clown-alt, zombie (zombie has no reference; record "no ref" and the build status). Run `npm run blob:render-check -- <name>` for each.

- [ ] **Step 2: Record**

Add a table to TASKS.md:

```
| character | ref | IoU front | worst band (line) | render-check |
```

with today's numbers. This is what the trial in Task 11 is judged against.

```bash
git add TASKS.md
git commit -m "tasks: blob-measure baselines for every character"
```

---

### Task 11: The trial — a different model, the new loop

**Files:**
- Create: `~/.claude/dispatch/plans/2026-08-22-trial-<name>.md` (outside the repo; dispatch-ui picks it up)

- [ ] **Step 1: Pick the task**

The mouse hands: parked, measurable (the mesh has a mitt 0.068 × 0.080 × 0.096), bounded, and the worst bands in Task 10 should already point at them. ONE JOB: "the mouse's hands match the mesh's mitt; the hand bands are within ±10% of the mesh".

- [ ] **Step 2: Write the plan from the template** with `model:` set to the model the owner wants to test (the last runs used `openrouter/stealth/ox-alpha:xhigh` and `zai/glm-5.1`; pick the one that is NOT the author of this toolbox), `base_branch: main` after Tasks 1–10 are merged, `max_runtime: 90m`.

- [ ] **Step 3: Run it through dispatch-ui** (`~/go/bin/dispatch-ui`, http://localhost:8090) and read the report.

- [ ] **Step 4: Judge it on three things, write them into TASKS.md**

1. Did the agent run `blob:measure` first and quote numbers? (process)
2. Did the IoU / hand bands move toward the mesh? (result)
3. Did it run `blob:shot` and describe what it saw? (looking)

Whatever the answer, that is the next plan's input. If it ignored the tools, the skill text is the problem, not the model.

```bash
git add TASKS.md
git commit -m "tasks: first trial of the measured loop on a different model"
```

---

## Self-review

- Spec coverage: measure ✔ (T1–4), shot ✔ (T5), renderer check ✔ (T6), rules in the file agents read ✔ (T7), meshes as the default reference ✔ (T3, T9), trial on another model ✔ (T11).
- Placeholders: none — `BandReport`/`SilhouetteReport` field names in Task 4 were read from `silhouette.ts:525–560`.
- Type consistency: `nearestPrim(p, body): number` (T2) is what `bandOwners` (T3) and `blob-render-check` (T6) call; `src?: number` (T1) is what `BandOwner.line` (T3) reads; `maskFromTriangles` (T3) is what `blob-measure` (T4) uses for the mesh mask.
- Open assumption: headless Chrome WebGPU (T5 step 2) — the script must end with a default that works on this machine.
