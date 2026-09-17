# `game-main.ts` decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `src/lab/sdf-zombie/webgpu/game-main.ts` (14,763 lines; a ~9,400-line `main()` holding ~493 bindings and 106 nested functions in one closure) into a ~1–2k-line orchestrator over a feature-sliced `GameContext` and per-concern `game-*.ts` modules, with byte-identical rendered output at every step.

**Architecture:** A `GameContext` holds one plain-mutable state slice per concern (`ctx.probes`, `ctx.gibs`, …) plus entity arrays under `ctx.world`. Slices are authored as new files (interface + `makeXState()` factory + binding map + test), mirroring the existing `game-weapon-slots.ts` idiom. A scope-aware codemod built on the TypeScript compiler API then rewrites `game-main.ts` in one pass — **rewriting lines in place, never moving them**, so initialization order is preserved by construction. Only after the state is sliced are the 106 functions extracted into modules. Every task is gated by `march-hash.mjs`, which self-validates against pinned canonical hashes.

**Tech Stack:** TypeScript 5.6 (compiler API, already a dependency — **no new packages**), `tsx` 4.23, vitest 2.1, three r185 WebGPU, lab scripts (`scripts/lab-servers.sh`, `scripts/march-hash.mjs`, `scripts/sdf-demo-hash.sh`).

**Spec:** [`docs/superpowers/specs/2026-09-17-game-main-decomposition-design.md`](../specs/2026-09-17-game-main-decomposition-design.md)

---

## Conventions

- **Gates on every task:** `npx tsc --noEmit -p .` clean; `npx vitest run` green with no new skips; `node scripts/march-hash.mjs` = `0b84c119e04fc8b2f7a3fe2f69b85737448ec86c` (shipped default, crowd + boxes + tiles on) — the script fails itself if the canonical moved, so a green run *is* the proof.
- **Browser scripts run under bash inside `scripts/lab-servers.sh`** with `LAB_VITE_PORT=5323 LAB_CDP_PORT=9323`. Never invoke `march-hash.mjs` without servers up — it will fail on connect, which is not a gate result.
- **A hash mismatch is never resolved by loosening the gate.** It means behavior changed. Revert the task and diagnose.
- **The migration rule — lines do not move, lines are only rewritten.** `let probeWeight = X` at line N becomes `ctx.probes.weight = X` at line N. Never hoist, reorder, merge or delete a declaration.
- **Forbidden inside any migration task:** reordering, merging declarations, deleting apparently-dead bindings, renaming beyond the slice path, fixing bugs, changing control flow. File anything noticed in `TASKS.md`; do not fix it here.
- **Names fixed here:** `GameContext`, `makeGameContext()`, `ctx` as the local name in `main()`; per slice `game-state-<slice>.ts` exporting `<Slice>State`, `make<Slice>State()` and `<SLICE>_BINDINGS`; tools `scripts/slice-extract.ts`, `scripts/game-context-codemod.ts`.
- **The 14 slices:** `render`, `lighting`, `probes`, `gibs`, `dynamite`, `weapon`, `player`, `goo`, `crowd`, `bake`, `vfx`, `demo`, `telemetry`, `panels`.
- **Exemplar to copy:** `src/lab/sdf-zombie/webgpu/game-weapon-slots.ts` and its test. Read both before writing any slice.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File map

| File | Change |
| --- | --- |
| `scripts/slice-extract.ts` | **new** — AST dump of `main()`-scope bindings, their initializers and reference counts, grouped by slice prefix rules |
| `scripts/slice-extract.test.ts` | **new** — fixture-driven tests for the extractor |
| `scripts/game-context-codemod.ts` | **new** — scope-aware rename driven by the slices' `*_BINDINGS` maps |
| `scripts/game-context-codemod.test.ts` | **new** — declaration rewrite, reference rewrite, shorthand properties, shadowing, strings/comments left alone |
| `src/lab/sdf-zombie/webgpu/game-context.ts` | **new** — `GameContext`, `makeGameContext()` |
| `src/lab/sdf-zombie/webgpu/game-context.test.ts` | **new** — every slice present, factory defaults, no shared mutable references between two contexts |
| `src/lab/sdf-zombie/webgpu/game-state-<slice>.ts` ×14 | **new** — `<Slice>State`, `make<Slice>State()`, `<SLICE>_BINDINGS` |
| `src/lab/sdf-zombie/webgpu/game-state-<slice>.test.ts` ×14 | **new** — factory defaults, binding-map totality |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | rewritten by codemod (task 8), then progressively emptied by extraction (tasks 9–12) |
| `docs/architecture/repository-map.md` | updated in task 13 |
| `TASKS.md` | updated in task 13 |

---

## Task 0: Prove the gates are green before touching anything

**Files:**
- Create: `docs/dev-notes/2026-09-17-game-main-decomposition/baseline.md`

- [ ] **Step 1: Confirm a clean tree and record the base commit**

```bash
git status --porcelain            # expect: empty
git rev-parse HEAD                # record this SHA in baseline.md
```

- [ ] **Step 2: Run the type and unit gates on untouched HEAD**

```bash
npx tsc --noEmit -p .
npx vitest run
```
Expected: `tsc` prints nothing and exits 0. `vitest` reports all files passed. **Record the exact test count** in `baseline.md` — later tasks compare against it to catch silently-skipped tests.

- [ ] **Step 3: Run the pixel gate inside lab servers**

```bash
bash -c '
  set -euo pipefail
  cd "$(git rev-parse --show-toplevel)"
  export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323
  . scripts/lab-servers.sh
  trap lab_servers_down EXIT
  lab_servers_up
  node scripts/march-hash.mjs
'
```
Expected: one JSON line, `room1` = `0b84c119e04fc8b2f7a3fe2f69b85737448ec86c`, `room1-repeat` equal to it, `room1-wounded` different. If `room1` differs, **stop** — HEAD has drifted from the pinned canonical and that must be understood before any refactor starts.

- [ ] **Step 4: Run the frame gate**

```bash
scripts/sdf-demo-hash.sh ab
```
Expected: both legs report identical per-frame hashes.

- [ ] **Step 5: Write `baseline.md` and commit**

Record: base SHA, `vitest` test count, the three march hashes, the demo-hash result, machine and date.

```bash
git add docs/dev-notes/2026-09-17-game-main-decomposition/baseline.md
git commit -m "docs(baseline): record pre-refactor gate results for game-main decomposition"
```

---

## Task 1: `slice-extract.ts` — generate the binding inventory

Hand-typing ~493 binding names is how a plan goes stale. The inventory is generated.

**Files:**
- Create: `scripts/slice-extract.ts`
- Test: `scripts/slice-extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/slice-extract.test.ts
import { describe, expect, it } from 'vitest';
import { extractBindings, sliceFor } from './slice-extract';

const SRC = `
async function main() {
  let probeWeight = 0.5;
  let probeGatherRate = 2;
  const actors: Actor[] = [];
  let gibMode = 'march';
  function helper() { let probeWeight = 9; return probeWeight; }
}
`;

describe('extractBindings', () => {
  it('finds only bindings in the immediate main() body scope', () => {
    const got = extractBindings(SRC).map(b => b.name).sort();
    expect(got).toEqual(['actors', 'gibMode', 'probeGatherRate', 'probeWeight']);
  });

  it('does not report the shadowed inner declaration twice', () => {
    expect(extractBindings(SRC).filter(b => b.name === 'probeWeight')).toHaveLength(1);
  });

  it('records kind and initializer text', () => {
    const probe = extractBindings(SRC).find(b => b.name === 'probeWeight')!;
    expect(probe.kind).toBe('let');
    expect(probe.initializer).toBe('0.5');
  });
});

describe('sliceFor', () => {
  it('maps a known prefix to its slice', () => {
    expect(sliceFor('probeGatherRate')).toBe('probes');
    expect(sliceFor('gibMode')).toBe('gibs');
  });

  it('returns null for an unclassified name so it must be curated by hand', () => {
    expect(sliceFor('marker')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run scripts/slice-extract.test.ts
```
Expected: FAIL — `Cannot find module './slice-extract'`.

- [ ] **Step 3: Implement the extractor**

```ts
// scripts/slice-extract.ts
//
// Dumps the bindings declared directly in `main()`'s body in game-main.ts, so
// slice authors curate a generated list instead of hand-typing ~493 names.
//
//   npx tsx scripts/slice-extract.ts            # all slices, as a table
//   npx tsx scripts/slice-extract.ts probes     # one slice, as TS field stubs
import * as ts from 'typescript';
import { readFileSync } from 'node:fs';

export interface Binding {
  name: string;
  kind: 'let' | 'const';
  initializer: string;
  line: number;
}

/** Prefix -> slice. Order matters: the first match wins, so longer prefixes
 *  must precede shorter ones that would also match. */
const PREFIX_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^probe/i, 'probes'],
  [/^gib/i, 'gibs'],
  [/^goo/i, 'goo'],
  [/^crowd/i, 'crowd'],
  [/^dyn/i, 'dynamite'],
  [/^(bake|baked|chunk|carved|lastBake|maxChunks|nextChunkId|totalBakes)/i, 'bake'],
  [/^(adaptive|sdfScale|refine|bone|occluder|hull|actorCull|visibleActors|frozenHull|meshSync|texProbe|upscale)/i, 'render'],
  [/^(hemi|level(Probe|Shadow)|light|flicker|tracerLight|bodyFlash|bounceSpot|dungeonOn|fxLight)/i, 'lighting'],
  [/^(demo|replay|simFrame|simLocked|frameCount|wanderFrozen|recorder)/i, 'demo'],
  [/^(telemetry|firstTelemetry|normalGradient|volumeAtlasBuilds)/i, 'telemetry'],
  [/Panel$|^panelsHidden$/, 'panels'],
];

export function sliceFor(name: string): string | null {
  for (const [re, slice] of PREFIX_RULES) if (re.test(name)) return slice;
  return null;
}

export function extractBindings(source: string): Binding[] {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const out: Binding[] = [];

  const main = findMain(sf);
  if (!main?.body) return out;

  // Only the IMMEDIATE body scope. Statements nested inside any further block
  // or function belong to a different scope and are not ours to migrate.
  for (const stmt of main.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const kind = stmt.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'let';
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;   // skip destructuring
      out.push({
        name: decl.name.text,
        kind,
        initializer: decl.initializer?.getText(sf) ?? '',
        line: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1,
      });
    }
  }
  return out;
}

function findMain(sf: ts.SourceFile): ts.FunctionDeclaration | undefined {
  let found: ts.FunctionDeclaration | undefined;
  sf.forEachChild(n => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'main') found = n;
  });
  return found;
}

if (process.argv[1]?.endsWith('slice-extract.ts')) {
  const target = process.argv[2];
  const src = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8');
  const all = extractBindings(src);
  const rows = target ? all.filter(b => sliceFor(b.name) === target) : all;
  for (const b of rows) {
    console.log(`${String(b.line).padStart(5)}  ${(sliceFor(b.name) ?? '?').padEnd(10)} ${b.kind.padEnd(5)} ${b.name} = ${b.initializer.slice(0, 60)}`);
  }
  console.log(`\n${rows.length} bindings${target ? ` in slice '${target}'` : ''}; unclassified: ${all.filter(b => !sliceFor(b.name)).length}`);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run scripts/slice-extract.test.ts
```
Expected: 5 passed.

- [ ] **Step 5: Run it against the real file and eyeball the split**

```bash
npx tsx scripts/slice-extract.ts
```
Expected: ~493 rows. A non-zero unclassified count is **expected and fine** — those are curated by hand into slices in tasks 5–6.

- [ ] **Step 6: Commit**

```bash
git add scripts/slice-extract.ts scripts/slice-extract.test.ts
git commit -m "feat(tools): AST extractor for game-main.ts main()-scope bindings"
```

---

## Task 2: `game-context.ts` skeleton

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-context.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/game-context.test.ts
import { describe, expect, it } from 'vitest';
import { SLICE_NAMES, makeGameContext } from './game-context';

describe('makeGameContext', () => {
  it('creates every declared slice', () => {
    const ctx = makeGameContext();
    for (const name of SLICE_NAMES) expect(ctx).toHaveProperty(name);
  });

  it('gives each context its own slice objects', () => {
    const a = makeGameContext();
    const b = makeGameContext();
    for (const name of SLICE_NAMES) {
      expect(a[name]).not.toBe(b[name]);
    }
  });

  it('gives each context its own entity arrays', () => {
    const a = makeGameContext();
    const b = makeGameContext();
    a.world.actors.push({} as never);
    expect(b.world.actors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/game-context.test.ts
```
Expected: FAIL — `Cannot find module './game-context'`.

- [ ] **Step 3: Implement the skeleton**

Slices start empty and gain their fields in tasks 5–6; this task establishes the container and the totality test only.

```ts
// src/lab/sdf-zombie/webgpu/game-context.ts
//
// The state container for game-main.ts's main(). One PLAIN MUTABLE slice per
// concern — no getters, setters, proxies or freezing. `let x = 1; x = 2` must
// migrate to `ctx.s.x = 1; ctx.s.x = 2` and nothing subtler, because accessors
// would change evaluation timing and timing is what the pixel gate catches.
//
// Slices are shaped as ECS-resources-to-be and ctx.world as component-storage-
// to-be, so the eventual ECS move is a refactor rather than a rewrite.
import { makeRenderState, type RenderState } from './game-state-render';
import { makeLightingState, type LightingState } from './game-state-lighting';
import { makeProbeState, type ProbeState } from './game-state-probes';
import { makeGibState, type GibState } from './game-state-gibs';
import { makeDynamiteState, type DynamiteState } from './game-state-dynamite';
import { makeWeaponState, type WeaponState } from './game-state-weapon';
import { makePlayerState, type PlayerState } from './game-state-player';
import { makeGooState, type GooState } from './game-state-goo';
import { makeCrowdState, type CrowdState } from './game-state-crowd';
import { makeBakeState, type BakeState } from './game-state-bake';
import { makeVfxState, type VfxState } from './game-state-vfx';
import { makeDemoState, type DemoState } from './game-state-demo';
import { makeTelemetryState, type TelemetryState } from './game-state-telemetry';
import { makePanelState, type PanelState } from './game-state-panels';

export const SLICE_NAMES = [
  'render', 'lighting', 'probes', 'gibs', 'dynamite', 'weapon', 'player',
  'goo', 'crowd', 'bake', 'vfx', 'demo', 'telemetry', 'panels',
] as const;

export type SliceName = typeof SLICE_NAMES[number];

export interface GameContext {
  render: RenderState;
  lighting: LightingState;
  probes: ProbeState;
  gibs: GibState;
  dynamite: DynamiteState;
  weapon: WeaponState;
  player: PlayerState;
  goo: GooState;
  crowd: CrowdState;
  bake: BakeState;
  vfx: VfxState;
  demo: DemoState;
  telemetry: TelemetryState;
  panels: PanelState;
  world: {
    actors: unknown[];
    shells: unknown[];
    soldierCorpses: unknown[];
    colliders: unknown[];
  };
}

export function makeGameContext(): GameContext {
  return {
    render: makeRenderState(),
    lighting: makeLightingState(),
    probes: makeProbeState(),
    gibs: makeGibState(),
    dynamite: makeDynamiteState(),
    weapon: makeWeaponState(),
    player: makePlayerState(),
    goo: makeGooState(),
    crowd: makeCrowdState(),
    bake: makeBakeState(),
    vfx: makeVfxState(),
    demo: makeDemoState(),
    telemetry: makeTelemetryState(),
    panels: makePanelState(),
    world: { actors: [], shells: [], soldierCorpses: [], colliders: [] },
  };
}
```

> `world`'s element types are `unknown[]` only until task 12, which replaces them with the real `ZombieActor` / shell / corpse / collider types once those are importable without a cycle. This is tracked by task 12 step 1, not left open.

- [ ] **Step 4: Confirm it still fails for the right reason**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/game-context.test.ts
```
Expected: FAIL — cannot resolve `./game-state-render` etc. That is correct: task 2 lands the container, tasks 5–6 land the slices. **Do not stub the slice modules here** — a stub that later diverges from the real slice is how a binding silently goes missing.

- [ ] **Step 5: Commit without the green test**

```bash
git add src/lab/sdf-zombie/webgpu/game-context.ts src/lab/sdf-zombie/webgpu/game-context.test.ts
git commit -m "feat(context): GameContext container and totality test (slices land in tasks 5-6)"
```

> This is the one task that intentionally commits red. `tsc` and `vitest` go green at the end of task 6, which is where the gate is enforced.

---

## Task 3: codemod — rewrite declarations

**Files:**
- Create: `scripts/game-context-codemod.ts`
- Test: `scripts/game-context-codemod.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/game-context-codemod.test.ts
import { describe, expect, it } from 'vitest';
import { applyCodemod } from './game-context-codemod';

const MAP = { probeWeight: 'probes.weight', sdfScale: 'render.sdfScale' };

describe('applyCodemod — declarations', () => {
  it('rewrites a let declaration in place as an assignment', () => {
    const src = `async function main() {\n  let probeWeight = 0.5;\n}\n`;
    expect(applyCodemod(src, MAP)).toBe(`async function main() {\n  ctx.probes.weight = 0.5;\n}\n`);
  });

  it('rewrites a const declaration the same way', () => {
    const src = `async function main() {\n  const sdfScale = 1.0;\n}\n`;
    expect(applyCodemod(src, MAP)).toBe(`async function main() {\n  ctx.render.sdfScale = 1.0;\n}\n`);
  });

  it('keeps the declaration on its original line', () => {
    const src = `async function main() {\n  const a = 1;\n  let probeWeight = 0.5;\n  const b = 2;\n}\n`;
    const lines = applyCodemod(src, MAP).split('\n');
    expect(lines[2]).toBe('  ctx.probes.weight = 0.5;');
  });

  it('leaves a declaration with no mapping untouched', () => {
    const src = `async function main() {\n  let untouched = 7;\n}\n`;
    expect(applyCodemod(src, MAP)).toBe(src);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run scripts/game-context-codemod.test.ts
```
Expected: FAIL — `Cannot find module './game-context-codemod'`.

- [ ] **Step 3: Implement declaration rewriting**

```ts
// scripts/game-context-codemod.ts
//
// Rewrites game-main.ts's main()-scope bindings into ctx.<slice>.<field>.
//
// SCOPE-AWARE, NOT TEXTUAL. A regex rename would corrupt shadowed identifiers,
// property names, string contents and comment text. This walks the AST and only
// rewrites identifiers that resolve to the main()-scope declaration.
//
// THE RULE: lines do not move, lines are only rewritten. A declaration becomes
// an assignment AT ITS ORIGINAL LINE, so initialization order is preserved by
// construction and no binding can be read before it was written.
import * as ts from 'typescript';

export type BindingMap = Readonly<Record<string, string>>;

interface Edit { start: number; end: number; text: string; }

export function applyCodemod(source: string, map: BindingMap): string {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const main = findMain(sf);
  if (!main?.body) return source;

  const edits: Edit[] = [];
  const owned = new Set<string>();

  // Pass 1 — declarations in the immediate main() body scope.
  for (const stmt of main.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const decls = stmt.declarationList.declarations;
    for (const decl of decls) {
      if (!ts.isIdentifier(decl.name)) continue;
      const path = map[decl.name.text];
      if (!path) continue;
      owned.add(decl.name.text);
      if (decls.length !== 1) {
        throw new Error(`multi-declarator statement for '${decl.name.text}' — split it by hand first`);
      }
      const init = decl.initializer?.getText(sf);
      edits.push({
        start: stmt.getStart(sf),
        end: stmt.getEnd(),
        text: init === undefined ? '' : `ctx.${path} = ${init};`,
      });
    }
  }

  return applyEdits(source, edits);
}

function findMain(sf: ts.SourceFile): ts.FunctionDeclaration | undefined {
  let found: ts.FunctionDeclaration | undefined;
  sf.forEachChild(n => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'main') found = n; });
  return found;
}

function applyEdits(source: string, edits: Edit[]): string {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run scripts/game-context-codemod.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/game-context-codemod.ts scripts/game-context-codemod.test.ts
git commit -m "feat(codemod): rewrite main()-scope declarations as ctx assignments"
```

---

## Task 4: codemod — rewrite references, shorthand and shadowing

`probeWeight` and `sdfScale` both appear as `{ name }` shorthand in the real file. A codemod that turns `{ probeWeight }` into `{ ctx.probes.weight }` produces a syntax error; one that leaves it alone produces a silently wrong object. Both are tested here.

**Files:**
- Modify: `scripts/game-context-codemod.ts`
- Test: `scripts/game-context-codemod.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/game-context-codemod.test.ts`:

```ts
describe('applyCodemod — references', () => {
  const MAP2 = { probeWeight: 'probes.weight' };

  it('rewrites reads and writes', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  probeWeight = 1;\n  use(probeWeight);\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('ctx.probes.weight = 1;');
    expect(out).toContain('use(ctx.probes.weight);');
  });

  it('expands shorthand properties instead of corrupting them', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  send({ probeWeight });\n}\n`;
    expect(applyCodemod(src, MAP2)).toContain('send({ probeWeight: ctx.probes.weight });');
  });

  it('leaves a property named the same alone', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  const o = { probeWeight: 3 };\n  use(o.probeWeight);\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('const o = { probeWeight: 3 };');
    expect(out).toContain('use(o.probeWeight);');
  });

  it('leaves a shadowed inner binding alone', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  function inner() { let probeWeight = 9; return probeWeight; }\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('let probeWeight = 9; return probeWeight;');
  });

  it('leaves strings and comments alone', () => {
    const src = `async function main() {\n  let probeWeight = 0;\n  // probeWeight is tuned\n  log('probeWeight');\n}\n`;
    const out = applyCodemod(src, MAP2);
    expect(out).toContain('// probeWeight is tuned');
    expect(out).toContain(`log('probeWeight');`);
  });
});
```

- [ ] **Step 2: Run and confirm the new tests fail**

```bash
npx vitest run scripts/game-context-codemod.test.ts
```
Expected: the 4 declaration tests pass; the 5 reference tests FAIL (references are not yet rewritten).

- [ ] **Step 3: Add reference rewriting**

In `scripts/game-context-codemod.ts`, insert before `return applyEdits(...)`:

```ts
  // Pass 2 — references. Walk the whole of main(), tracking scopes that
  // redeclare an owned name so shadowed uses are left alone.
  const shadowed: Array<Set<string>> = [];

  const isShadowed = (name: string) => shadowed.some(s => s.has(name));

  const collectShadows = (node: ts.Node): Set<string> => {
    const names = new Set<string>();
    node.forEachChild(function scan(child) {
      if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && owned.has(child.name.text)) {
        names.add(child.name.text);
      }
      if (ts.isParameter(child) && ts.isIdentifier(child.name) && owned.has(child.name.text)) {
        names.add(child.name.text);
      }
      // Do not descend into nested functions; they get their own scope frame.
      if (!isFunctionLike(child)) child.forEachChild(scan);
    });
    return names;
  };

  const visit = (node: ts.Node): void => {
    const opensScope = isFunctionLike(node) && node !== main;
    if (opensScope) shadowed.push(collectShadows(node));

    if (ts.isIdentifier(node) && owned.has(node.text) && !isShadowed(node.text)) {
      const path = map[node.text];
      const p = node.parent;

      const isDeclName = ts.isVariableDeclaration(p) && p.name === node;
      const isPropName = (ts.isPropertyAssignment(p) && p.name === node)
        || (ts.isPropertyAccessExpression(p) && p.name === node)
        || (ts.isMethodDeclaration(p) && p.name === node);
      const isParam = ts.isParameter(p) && p.name === node;

      if (ts.isShorthandPropertyAssignment(p)) {
        // { probeWeight } -> { probeWeight: ctx.probes.weight }
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `${node.text}: ctx.${path}` });
      } else if (!isDeclName && !isPropName && !isParam) {
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `ctx.${path}` });
      }
    }

    node.forEachChild(visit);
    if (opensScope) shadowed.pop();
  };

  visit(main);
```

And add the helper at module scope:

```ts
function isFunctionLike(n: ts.Node): boolean {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)
    || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
}
```

Strings and comments need no handling: they are not `Identifier` nodes, so the walk never sees them. That is the whole reason this is an AST pass.

- [ ] **Step 4: Run the test and confirm all pass**

```bash
npx vitest run scripts/game-context-codemod.test.ts
```
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/game-context-codemod.ts scripts/game-context-codemod.test.ts
git commit -m "feat(codemod): scope-aware reference rewriting with shorthand expansion"
```

---

## Task 5: the `probes` slice — the worked example

Every other slice copies this shape exactly. Read `game-weapon-slots.ts` first.

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-state-probes.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-state-probes.test.ts`

- [ ] **Step 1: Generate the binding list**

```bash
npx tsx scripts/slice-extract.ts probes
```
Expected: ~19 rows with line numbers, kinds and initializers. **Use this output as the source of truth** for the field list — do not type it from memory.

- [ ] **Step 2: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/game-state-probes.test.ts
import { describe, expect, it } from 'vitest';
import { PROBE_BINDINGS, makeProbeState } from './game-state-probes';

describe('makeProbeState', () => {
  it('starts at the values game-main.ts declared', () => {
    const s = makeProbeState();
    expect(s.frame).toBe(0);
    expect(s.gatherRate).toBe(2);
    expect(s.gatherErrors).toBe(0);
  });

  it('gives each call its own object', () => {
    expect(makeProbeState()).not.toBe(makeProbeState());
  });
});

describe('PROBE_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeProbeState() as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(PROBE_BINDINGS)) {
      expect(path.startsWith('probes.'), `${oldName} must map into the probes slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('probes.'.length));
    }
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/game-state-probes.test.ts
```
Expected: FAIL — `Cannot find module './game-state-probes'`.

- [ ] **Step 4: Write the slice**

Fill every field from the step-1 output. Literal initializers become the factory default; computed ones (`parseIntParam(...)`, anything reading a later-built object) get a placeholder of the right type, because the in-place assignment at the original line supplies the real value.

```ts
// src/lab/sdf-zombie/webgpu/game-state-probes.ts
//
// Probe-gather state, lifted out of game-main.ts's main() closure.
// Shape mirrors game-weapon-slots.ts: interface + factory + a binding map the
// codemod consumes. Plain mutable fields — no accessors (see game-context.ts).
import type { ProbeGatherBinding } from './probe-gather-compute';

export interface ProbeState {
  /** Dispatch counter; also the demo-seed base. Never reset mid-session. */
  frame: number;
  gather: ProbeGatherBinding | null;
  gatherRate: number;
  gatherTick: number;
  gatherErrors: number;
  weight: number;
  dynGain: number;
  visStrength: number;
  flashBoost: number;
  optimized: boolean;
  gateLogs: number;
  lastGates: unknown;
  lastCapsules: number;
  lastLights: number;
}

export function makeProbeState(): ProbeState {
  return {
    frame: 0,
    gather: null,
    gatherRate: 2,
    gatherTick: 0,
    gatherErrors: 0,
    weight: 0,
    dynGain: 0.15,
    visStrength: 1,
    flashBoost: 4,
    optimized: true,
    gateLogs: 0,
    lastGates: null,
    lastCapsules: 0,
    lastLights: 0,
  };
}

/** Old `main()` binding name -> path within GameContext. Consumed by
 *  scripts/game-context-codemod.ts. */
export const PROBE_BINDINGS = {
  probeFrame: 'probes.frame',
  probeGather: 'probes.gather',
  probeGatherRate: 'probes.gatherRate',
  probeGatherTick: 'probes.gatherTick',
  probeGatherErrors: 'probes.gatherErrors',
  probeWeight: 'probes.weight',
  probeDynGain: 'probes.dynGain',
  probeVisStrength: 'probes.visStrength',
  probeFlashBoost: 'probes.flashBoost',
  probeOptimized: 'probes.optimized',
  probeGateLogs: 'probes.gateLogs',
  probeLastGates: 'probes.lastGates',
  probeLastCapsules: 'probes.lastCapsules',
  probeLastLights: 'probes.lastLights',
} as const;
```

> The `*Boot` bindings (`probeGatherRateBoot`, `probeRaysBoot`, `probeLightsBoot`, `probeBlendBoot`, `probeFallBoot`) are **deliberately excluded**: they are boot-time URL-param reads consumed once and never reassigned. Leave them as locals. If step 1's output shows any of them being reassigned later, add them — the extractor's initializer column tells you.

- [ ] **Step 5: Run the test and confirm it passes**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/game-state-probes.test.ts
```
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-state-probes.ts src/lab/sdf-zombie/webgpu/game-state-probes.test.ts
git commit -m "feat(state): probes slice — interface, factory and binding map"
```

---

## Task 6: the remaining 13 slices

Thirteen independent sub-tasks, each identical in shape to task 5 and each touching only its own two new files. They may be run in any order, serially or in parallel — dispatch concurrency sets the batch size, not this plan.

**For each slice below, perform every step of Task 5 verbatim**, substituting the slice name, and using `npx tsx scripts/slice-extract.ts <slice>` as the field source of truth. Do not copy task 5's field list; each slice has its own.

The shape, repeated here so this task stands alone if read out of order — for a slice `foo`:

```ts
// src/lab/sdf-zombie/webgpu/game-state-foo.ts
export interface FooState {
  /** one field per binding from `npx tsx scripts/slice-extract.ts foo` */
  someField: number;
}

export function makeFooState(): FooState {
  // Literal initializer in game-main.ts -> that literal here.
  // Computed initializer -> a placeholder of the right type; the in-place
  // assignment at the original line supplies the real value.
  return { someField: 0 };
}

/** Old `main()` binding name -> path within GameContext. */
export const FOO_BINDINGS = {
  someOldName: 'foo.someField',
} as const;
```

```ts
// src/lab/sdf-zombie/webgpu/game-state-foo.test.ts
import { describe, expect, it } from 'vitest';
import { FOO_BINDINGS, makeFooState } from './game-state-foo';

describe('makeFooState', () => {
  it('starts at the values game-main.ts declared', () => {
    expect(makeFooState().someField).toBe(0);
  });

  it('gives each call its own object', () => {
    expect(makeFooState()).not.toBe(makeFooState());
  });
});

describe('FOO_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeFooState() as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(FOO_BINDINGS)) {
      expect(path.startsWith('foo.'), `${oldName} must map into the foo slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('foo.'.length));
    }
  });
});
```

Commit each slice on its own: `git commit -m "feat(state): <slice> slice — interface, factory and binding map"`.

- [ ] **Step 1: `render`** — `game-state-render.ts` / `.test.ts`, `RenderState`, `makeRenderState()`, `RENDER_BINDINGS`. Source: `npx tsx scripts/slice-extract.ts render` (~21 bindings: `sdfScale`, `adaptiveEnabled`, `adaptiveBudgetMs`, `adaptiveState`, `visibleActors`, `actorCullEnabled`, `boneCull`, `boneCullMode`, `boneMesh`, `refineTailWanted`, `refinedBodies`, `occluderDesired`, `hullExclusionsEnabled`, `frozenHullBuilt`, `meshSyncMarked`, `texProbe`, `upscaleAbLabel`, …).
- [ ] **Step 2: `lighting`** — ~13 bindings (`levelProbeWeight`, `levelProbeGain`, `levelShadowEnabled`, `hemiBase`, `lightClockFrozen`, `flickerClockFrozenAt`, `tracerLightGain`, `tracerLightSlots`, `bodyFlashGain`, `bounceSpotGain`, `dungeonOn`, `fxLightScale`, `liveTracers`).
- [ ] **Step 3: `gibs`** — ~16 bindings (`gibAtlas`, `gibAtlasSource`, `gibMode`, `gibRenderMode`, `gibBones`, `gibBoneMesh`, `gibShutter`, `gibOccluderEnabled`, `gibStaggerFrames`, `gibTearSec`, `gibVelScale`, `gibWounds`, `gibBlurPrevKeys`, `gibAssetMaterial`, `gibAssetRuntime`, `gibSpriteAtlasWarned`).
- [ ] **Step 4: `dynamite`** — ~21 bindings, all `dyn*` plus `dynamitePanel`. **Note:** `dynamitePanel` belongs to the `panels` slice, not this one — the `Panel$` rule in `slice-extract.ts` already routes it there. Confirm with the extractor output before writing the map.
- [ ] **Step 5: `weapon`** — ~42 bindings, the largest slice (`gunGroup`, `gunReady`, `resolveGunReady`, `aim`, `aimRig`, `arms`, `breechNodes`, `muzzleNodes`, `shellNodes`, `topLeverNode`, `extractorNode`, `extractorRestZ`, `hingePivot`, `flashGroup`, `flashLight`, `flashMaterial`, `flashAge`, `fireAge`, `fireBarrels`, `cooldown`, `burstCursor`, `reloadAge`, `reloadSeed`, `reloadSpeed`, `pinnedReloadSeed`, `pendingFire`, `pendingReload`, `recoilPitch`, `shells`, `shotAlert`, `slotState`, `infiniteAmmo`, `lastEjectOrigin`, `heldProp`, `handMaterial`, `foreHandGroup`, `gripHandGroup`, `weaponPitchDeg`, `weaponYawDeg`, `weaponSlideXm`, `weaponSlideYm`, `muzzleLight`). Because it is the largest, split its commit only if the test file exceeds ~200 lines; otherwise keep one commit.
- [ ] **Step 6: `player`** — ~17 bindings (`autopilot`, `freeAimOn`, `holdPlayerPose`, `bobAmount`, `bobDistance`, `strafeDir`, `strafeT`, `stuckT`, `lastWalkPos`, `prevPlayerPos`, `prevInputKeys`, `currentInputFrame`, `pendingDx`, `parked`, `centerFovDeg`, `marker`, `reticleEl`).
- [ ] **Step 7: `goo`** — ~7 bindings (`gooEnabled`, `gooLayer`, `gooReconstruction`, `gooConnectionsEnabled`, `gooStrandsEnabled`, `gooSheetsEnabled`; `gooPanel` routes to `panels`).
- [ ] **Step 8: `crowd`** — ~5 bindings (`crowdOn`, `crowdDispatch`, `crowdFallbackReason`, `crowdSegMetaWarned`, `crowdRefineWarned`).
- [ ] **Step 9: `bake`** — ~23 bindings (`chunkBakeEnabled`, `chunkBakeInput`, `chunkDetailAlbedo`, `chunkDetailFreq`, `chunkDetailOverride`, `chunkObjects`, `chunksHidden`, `bakedChunkMat`, `bakedChunkReference`, `bakedChunkSeed`, `bakeSubmitFrame`, `lastBakeInfo`, `lastBakeMs`, `lastBakeRequestMs`, `lastBakeSwapFrame`, `lastBakeSwapMs`, `totalBakes`, `maxChunks`, `nextChunkId`, `carvedBuildMs`, `carvedLibrary`, `carvedMaterial`, `carvedWarned`).
- [ ] **Step 10: `vfx`** — ~12 bindings (`explosionVfx`, `burstLayer`, `bleedClock`, `bleedEnabled`, `blastDistortStrength`, `fxSize`, `fxSpread`, `cook`, `gorePartMat`, `goreShowcase`, `spriteBenchGroup`, `soldierCorpses`).
- [ ] **Step 11: `demo`** — ~9 bindings (`demoHold`, `demoSeedBase`, `recorder`, `replayActive`, `replayFrame`, `simFrame`, `simLocked`, `frameCount`, `wanderFrozen`).
- [ ] **Step 12: `telemetry`** — ~6 bindings (`firstTelemetryFrame`, `telemetryVisibilityGap`, `normalGradientDebug`, `normalGradientMode`, `volumeAtlasBuilds`, `drawReady`).
- [ ] **Step 13: `panels`** — ~9 bindings (`dynamitePanel`, `gooPanel`, `vhsPanel`, `woundPanel`, `shutterPanel`, `panelsHidden`, `shutterGame`, `impactSplashEnabled`, `impactSplashLayer`).

- [ ] **Step 14: Curate whatever the extractor left unclassified**

```bash
npx tsx scripts/slice-extract.ts | grep '  ?  '
```
For each remaining binding decide its slice and add it to that slice's map, **or** deliberately leave it a local. A binding is correctly left local when it is assigned once at declaration and never reassigned. Record each such decision as a one-line comment in the slice file so the next reader does not re-litigate it.

- [ ] **Step 15: Full gate — context and slices now compile together**

```bash
npx tsc --noEmit -p .
npx vitest run
```
Expected: `tsc` clean (task 2's red imports now all resolve); `vitest` green with 14 new slice test files plus `game-context.test.ts`, and the pre-existing count from `baseline.md` otherwise unchanged.

- [ ] **Step 16: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-state-*.ts src/lab/sdf-zombie/webgpu/game-state-*.test.ts
git commit -m "feat(state): remaining 13 context slices; game-context compiles green"
```

---

## Task 7: codemod dry run and diff review

The apply step is irreversible-feeling and large. It gets a rehearsal first.

**Files:**
- Modify: `scripts/game-context-codemod.ts` (add the CLI entrypoint)

- [ ] **Step 1: Add the CLI with an explicit `--write` flag**

Append to `scripts/game-context-codemod.ts`:

```ts
if (process.argv[1]?.endsWith('game-context-codemod.ts')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const slices = await import('../src/lab/sdf-zombie/webgpu/game-context-bindings');
  const map: Record<string, string> = Object.assign({}, ...Object.values(slices));
  const PATH = 'src/lab/sdf-zombie/webgpu/game-main.ts';
  const src = readFileSync(PATH, 'utf8');
  const out = applyCodemod(src, map);
  const changed = out === src ? 0 : out.split('\n').filter((l, i) => l !== src.split('\n')[i]).length;
  console.log(`${Object.keys(map).length} bindings mapped; ${changed} lines changed`);
  if (process.argv.includes('--write')) {
    writeFileSync(PATH, out);
    console.log(`wrote ${PATH}`);
  } else {
    console.log('dry run — pass --write to apply');
  }
}
```

- [ ] **Step 2: Create the aggregator the CLI imports**

```ts
// src/lab/sdf-zombie/webgpu/game-context-bindings.ts
//
// Every slice's binding map in one place, for scripts/game-context-codemod.ts.
// Kept separate from game-context.ts so the codemod does not pull the whole
// three/WebGPU import graph into a Node script.
export { RENDER_BINDINGS } from './game-state-render';
export { LIGHTING_BINDINGS } from './game-state-lighting';
export { PROBE_BINDINGS } from './game-state-probes';
export { GIB_BINDINGS } from './game-state-gibs';
export { DYNAMITE_BINDINGS } from './game-state-dynamite';
export { WEAPON_BINDINGS } from './game-state-weapon';
export { PLAYER_BINDINGS } from './game-state-player';
export { GOO_BINDINGS } from './game-state-goo';
export { CROWD_BINDINGS } from './game-state-crowd';
export { BAKE_BINDINGS } from './game-state-bake';
export { VFX_BINDINGS } from './game-state-vfx';
export { DEMO_BINDINGS } from './game-state-demo';
export { TELEMETRY_BINDINGS } from './game-state-telemetry';
export { PANEL_BINDINGS } from './game-state-panels';
```

- [ ] **Step 3: Add a collision test**

Two slices claiming the same old name would silently drop one. Append to `scripts/game-context-codemod.test.ts`:

```ts
it('has no binding claimed by two slices', async () => {
  const slices = await import('../src/lab/sdf-zombie/webgpu/game-context-bindings');
  const seen = new Map<string, string>();
  for (const [sliceName, map] of Object.entries(slices)) {
    for (const key of Object.keys(map as object)) {
      expect(seen.has(key), `${key} claimed by both ${seen.get(key)} and ${sliceName}`).toBe(false);
      seen.set(key, sliceName);
    }
  }
});
```

- [ ] **Step 4: Run the dry run**

```bash
npx vitest run scripts/game-context-codemod.test.ts
npx tsx scripts/game-context-codemod.ts
```
Expected: 10 passed; the CLI reports roughly 300–500 bindings mapped and several thousand lines changed, then `dry run`.

- [ ] **Step 5: Commit the tooling, not the rewrite**

```bash
git add scripts/game-context-codemod.ts scripts/game-context-codemod.test.ts src/lab/sdf-zombie/webgpu/game-context-bindings.ts
git commit -m "feat(codemod): CLI, binding aggregator and cross-slice collision test"
```

---

## Task 8: apply the codemod — the one big rewrite

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (mechanical, whole-file)

- [ ] **Step 1: Declare `ctx` at the top of `main()`**

Immediately after `async function main() {`, before any other statement:

```ts
  const ctx = makeGameContext();
```
and add to the import block:
```ts
import { makeGameContext } from './game-context';
```

- [ ] **Step 2: Apply**

```bash
npx tsx scripts/game-context-codemod.ts --write
```
Expected: `wrote src/lab/sdf-zombie/webgpu/game-main.ts`.

- [ ] **Step 3: Type-check and fix only genuine misses**

```bash
npx tsc --noEmit -p .
```
Every error here is a binding the maps missed or mistyped. **Fix it in the slice file and re-run the codemod from a clean checkout of `game-main.ts`** — never hand-patch the generated output, or the next re-run silently reverts your fix:

```bash
git checkout src/lab/sdf-zombie/webgpu/game-main.ts   # then redo steps 1-2
```

- [ ] **Step 4: Confirm the file did not change length**

```bash
wc -l src/lab/sdf-zombie/webgpu/game-main.ts
```
Expected: **14,763 ± the one `ctx` line and one import line**. A materially different count means lines moved, which violates the migration rule. Investigate before proceeding.

- [ ] **Step 5: Run the full gate**

```bash
npx vitest run
bash -c '
  set -euo pipefail
  cd "$(git rev-parse --show-toplevel)"
  export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323
  . scripts/lab-servers.sh
  trap lab_servers_down EXIT
  lab_servers_up
  node scripts/march-hash.mjs
'
scripts/sdf-demo-hash.sh ab
```
Expected: `vitest` matches `baseline.md`'s count; `room1` = `0b84c119e04fc8b2f7a3fe2f69b85737448ec86c`; demo-hash legs identical. **Any march-hash difference means the rewrite changed behavior — revert the whole task and diagnose.** Do not proceed on a mismatch.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "refactor(game-main): migrate main()-scope bindings to GameContext slices

Mechanical, codemod-applied, lines rewritten in place. march-hash room1
unchanged at 0b84c119e04fc8b2f7a3fe2f69b85737448ec86c."
```

---

## Tasks 9–12: extract the functions, one slice per wave

With state in slices, a function that touches only one slice moves out whole. These tasks contend on `game-main.ts`, so they integrate one at a time.

**For each wave, per function extracted:**

- [ ] **Step 1: Identify single-slice functions**

First add the `--functions` reporter to `scripts/slice-extract.ts`:

```ts
/** Per main()-scope function, which ctx slices its body touches. A function
 *  touching exactly one slice is extractable as-is; one touching several stays
 *  in main() until its extra dependencies are made parameters. */
export function functionSlices(source: string): Array<{ name: string; slices: string[]; line: number }> {
  const sf = ts.createSourceFile('game-main.ts', source, ts.ScriptTarget.ES2022, true);
  const main = findMain(sf);
  if (!main?.body) return [];
  const out: Array<{ name: string; slices: string[]; line: number }> = [];

  for (const stmt of main.body.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue;
    const slices = new Set<string>();
    const walk = (n: ts.Node): void => {
      // Match ctx.<slice> in a ctx.<slice>.<field> access.
      if (ts.isPropertyAccessExpression(n)
        && ts.isIdentifier(n.expression)
        && n.expression.text === 'ctx') {
        slices.add(n.name.text);
      }
      n.forEachChild(walk);
    };
    walk(stmt);
    out.push({
      name: stmt.name.text,
      slices: [...slices].sort(),
      line: sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1,
    });
  }
  return out;
}
```

Wire it into the CLI block, before the existing binding listing:

```ts
  if (process.argv[2] === '--functions') {
    const want = process.argv[3];
    for (const f of functionSlices(src)) {
      if (want && !f.slices.includes(want)) continue;
      const mark = f.slices.length === 1 ? 'EXTRACTABLE' : `touches ${f.slices.length}`;
      console.log(`${String(f.line).padStart(5)}  ${mark.padEnd(12)} ${f.name}  [${f.slices.join(', ')}]`);
    }
    process.exit(0);
  }
```

Then run it:

```bash
npx tsx scripts/slice-extract.ts --functions <slice>
```
Expected: one row per `main()`-scope function, marked `EXTRACTABLE` when it touches exactly one slice.

- [ ] **Step 2: Move the function into `game-<slice>.ts`**, changing its signature from closure capture to an explicit first parameter: `function applyBoneCullMode(mode)` becomes `export function applyBoneCullMode(render: RenderState, mode: …)`.

- [ ] **Step 3: Write its test** in `game-<slice>.test.ts`, following `game-weapon-slots.test.ts`: exercise behavior through the exported function, not internals.

- [ ] **Step 4: Update call sites** in `game-main.ts` to pass `ctx.<slice>`.

- [ ] **Step 5: Gate and commit** — the full four-gate ladder, then commit per slice.

Waves:

- [ ] **Task 9: `render`, `telemetry`, `crowd`, `demo`** — the least entangled; do these first to validate the extraction recipe on easy cases.
- [ ] **Task 10: `probes`, `lighting`, `goo`, `panels`**.
- [ ] **Task 11: `gibs`, `dynamite`, `vfx`, `bake`**.
- [ ] **Task 12: `weapon`, `player`** — the largest and most entangled with the render loop; expect several functions to resist extraction because they touch three or more slices. **Leave those in `main()`** and note them; forcing them out is how behavior drift enters. Also in this task: replace `game-context.ts`'s `world: { actors: unknown[] … }` with the real `ZombieActor`, shell, corpse and collider types now that the modules are importable without a cycle, and delete the note in that file.

---

## Task 13: collapse `main()` and update the docs

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `docs/architecture/repository-map.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Measure what is left**

```bash
wc -l src/lab/sdf-zombie/webgpu/game-main.ts
npx tsx scripts/slice-extract.ts
```
Expected: substantially reduced; remaining `main()`-scope bindings are the genuinely cross-cutting ones. **Record the real number** — do not assert the 1–2k target was hit if it was not.

- [ ] **Step 2: Group what remains** into clearly-commented boot / loop / teardown sections. No behavior change.

- [ ] **Step 3: Full gate**

```bash
npx tsc --noEmit -p .
npx vitest run
bash -c '
  set -euo pipefail
  cd "$(git rev-parse --show-toplevel)"
  export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323
  . scripts/lab-servers.sh
  trap lab_servers_down EXIT
  lab_servers_up
  node scripts/march-hash.mjs
'
scripts/sdf-demo-hash.sh ab
```
Expected: identical to `baseline.md` on every gate.

- [ ] **Step 4: Update `docs/architecture/repository-map.md`** — replace the `webgpu/game-main.ts (active game)` entry with the slice/module layout, and note that `game-weapon-slots.ts` is the shape every slice follows.

- [ ] **Step 5: Update `TASKS.md`** — mark the decomposition done with the final line count and a link to this plan; add a row for anything filed-not-fixed during the migration.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts docs/architecture/repository-map.md TASKS.md
git commit -m "refactor(game-main): collapse main() to an orchestrator; update source map"
```

---

## Verification summary

| Gate | Command | Pass condition |
| --- | --- | --- |
| Types | `npx tsc --noEmit -p .` | clean |
| Unit | `npx vitest run` | count ≥ `baseline.md`, no new skips |
| Pixel | `node scripts/march-hash.mjs` (inside lab-servers) | `room1` = `0b84c119e04fc8b2f7a3fe2f69b85737448ec86c` |
| Frame | `scripts/sdf-demo-hash.sh ab` | both legs identical |

A march-hash mismatch is **never** resolved by loosening the gate.
