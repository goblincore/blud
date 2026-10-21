# The Night Train Hands Over to the Flat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Touching the egg in the Night Train plays the ending, holds a black bridge card, hops the page to `/sdf-game.html?level=flat-early&emergence=1&from=night-train`, and the Flat's CRT shows the frame the player last saw while the emergence fades up from black; the early Flat reads lived-in (clutter).

**Architecture:** A level can declare `onComplete` (`goto`, `params`, `bridge`) next to `completeOn`; the loop's `complete` command runs a bridge (pure state machine + a DOM card) and then navigates, instead of the LEVEL COMPLETE overlay. The last `pull` frame is captured to `sessionStorage` (pure storage helper) and the Flat's emergence loads it. The clutter is a JSON layout shared by a Blender module and a TypeScript clearance test.

**Spec:** [`docs/superpowers/specs/2026-10-21-night-train-to-flat-design.md`](../specs/2026-10-21-night-train-to-flat-design.md) (read it first). **Branch:** `claude/night-train-to-flat` (on `main`; #51 is merged).

**House rules (`CLAUDE.md`):** do not run the full test suite; `npm run typecheck`, `npm run test:changed -- origin/main`, `npx vitest run <path>`. WGSL and the page are only checked in a real browser (read the console). **THE OWNER'S MACHINE IS OFTEN BUSY: keep load low** (one headless Chrome at a time, 320 x 240, no loops or soaks, `nice -n 10` on anything heavy). Never touch the owner's dev server on 5173. Commit messages end with exactly `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; stage **by path only** (never `git add -A`). Extracted Blood assets are never committed.

**Facts the tasks rely on (verified 2026-10-21):**
- `completeOn` is parsed in `level-json.ts` (`KEYS.top`, line ~30; `const completeOn`, ~102; the returned object, ~479) and typed in `level-def.ts` (`LevelDef.completeOn`, ~102). `commandsFor(event, completeOn)` (`level-events.ts`) turns the event into `{ kind: 'complete' }`; `runLevelCommand` in `game-loop.ts` (~line 170) handles it. `stepLoop` returns early while `ctx.world.sequence?.active`; the `ending` sequence pushes `ending.end` to `ctx.world.loop.pending` when it finishes (`game-sequence.ts stepSequence`).
- `night-train.level.json` is a Blender export (`scripts/levels/export_level.py` from scene custom props set in `build_night_train.py`; `night_train_layout.py to_level()` writes an equivalent doc). The committed file is `json.dumps(indent=2)`-style: insert the new key as text, do not rebuild the art.
- The `ending` sequence (`ending-sequence.ts SEQUENCES.ending`): `pull` (4 s, drift to `inner-egg`), then `black` (2 s, overlay black alpha 1, text `NIGHT TRAIN`).
- The emergence (`game-emergence.ts`): `createEmergence` (reads `?emergence=`), `PICTURE_URL` still loaded with `THREE.TextureLoader`, `AUTOSTART_S` 2 used in `stepEmergence`, state seam `__sdfGame.emergence()`; `sequenceFor(placement, centreFov)` in `emergence-camera.ts`.
- The page's per-frame hook: `handle.setFrameObserver(fn | null)` (`lab-renderer.ts`): runs in the same rAF task right after the draw, so a canvas read there is valid.
- `__sdfGame.startSequence(id)`, `sequence()` seams exist (`game-sequence.ts createSequenceSeams`); the game's seams are spread in `game-main.ts` ~5912-5916 (`createSequenceSeams(ctx)`, `createEmergenceSeams(ctx)`).
- Flat Blender space is (x, y, z) z up; game is (x, z, -y). Floor top `FLOOR` 0.055; kotatsu top 0.44; hand-off feet game (0.12, 0, -1.455) = Blender (0.12, 1.455).

---

### Task 1: `level-bridge.ts` (pure)

**Files:** create `src/lab/sdf-zombie/webgpu/level-bridge.ts`, `src/lab/sdf-zombie/webgpu/level-bridge.test.ts`.

- [ ] **Step 1: The failing test.**

```ts
// src/lab/sdf-zombie/webgpu/level-bridge.test.ts
import { describe, expect, it } from 'vitest';
import { bridgeHoldS, isLevelId, parseBridge, parseOnComplete, stepBridge, targetUrl } from './level-bridge';

const CARD = { kind: 'card', rgb: [0, 0, 0], text: 'NIGHT TRAIN', holdS: 2.5 };

describe('isLevelId', () => {
  it('accepts the level id alphabet and nothing else', () => {
    expect(isLevelId('flat-early')).toBe(true);
    expect(isLevelId('night-train')).toBe(true);
    for (const bad of ['', 'Flat', 'a b', 'a/b', '../x', 'a?b', 'a&b=c']) expect(isLevelId(bad), bad).toBe(false);
  });
});

describe('parseBridge / parseOnComplete', () => {
  it('parses a card and defaults its colour, text and hold', () => {
    const e: string[] = [];
    expect(parseBridge(CARD, e)).toEqual(CARD);
    expect(parseBridge({ kind: 'card' }, e)).toEqual({ kind: 'card', rgb: [0, 0, 0], text: '', holdS: 2 });
    expect(e).toEqual([]);
  });
  it('refuses an unknown kind, a bad colour, a negative or huge hold', () => {
    for (const bad of [{ kind: 'movie' }, { kind: 'card', rgb: [2, 0, 0] }, { kind: 'card', rgb: [0, 0] }, { kind: 'card', holdS: -1 }, { kind: 'card', holdS: 99 }, { kind: 'card', text: 4 }, 'card', null]) {
      const e: string[] = [];
      expect(parseBridge(bad, e), JSON.stringify(bad)).toBeNull();
      expect(e.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
  it('parses onComplete, keeping its parts and refusing a bad goto or an unknown key', () => {
    const e: string[] = [];
    expect(parseOnComplete({ goto: 'flat-early', params: 'emergence=1&from=night-train', bridge: CARD }, e))
      .toEqual({ goto: 'flat-early', params: 'emergence=1&from=night-train', bridge: CARD });
    expect(parseOnComplete({ goto: 'flat-early' }, e)).toEqual({ goto: 'flat-early', params: '', bridge: null });
    expect(parseOnComplete(undefined, e)).toBeNull();
    expect(e).toEqual([]);
    for (const bad of [{ goto: '../x' }, { goto: 'a', extra: 1 }, { params: 'x=1' }, [], 'flat']) {
      const e2: string[] = [];
      parseOnComplete(bad, e2);
      expect(e2.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});

describe('targetUrl', () => {
  const onc = { goto: 'flat-early', params: 'emergence=1&from=night-train' };
  it('goes to the level with its own params and keeps the others the player booted with', () => {
    const u = new URL(targetUrl('/sdf-game.html', onc, '?level=night-train&res=320&upscale=0&graphics=high')!, 'http://x');
    expect(u.pathname).toBe('/sdf-game.html');
    expect(Object.fromEntries(u.searchParams)).toEqual({ level: 'flat-early', emergence: '1', from: 'night-train', res: '320', upscale: '0', graphics: 'high' });
  });
  it("drops the old level's own params (level, emergence, from) so nothing is duplicated", () => {
    const u = new URL(targetUrl('/sdf-game.html', onc, '?level=night-train&emergence=0&from=x&res=640')!, 'http://x');
    expect(u.searchParams.getAll('level')).toEqual(['flat-early']);
    expect(u.searchParams.getAll('emergence')).toEqual(['1']);
    expect(u.searchParams.getAll('from')).toEqual(['night-train']);
    expect(u.searchParams.get('res')).toBe('640');
  });
  it('is null for a goto that is not a level id', () => {
    expect(targetUrl('/sdf-game.html', { goto: '../x', params: '' }, '')).toBeNull();
  });
});

describe('the bridge clock', () => {
  it('holds the spec\'s seconds (capped), 0 without a bridge', () => {
    expect(bridgeHoldS(CARD as never)).toBe(2.5);
    expect(bridgeHoldS(null)).toBe(0);
  });
  it('navigates once, on the step that reaches the hold', () => {
    let s = { t: 0, holdS: 1, navigated: false };
    const navs: boolean[] = [];
    for (let i = 0; i < 90; i++) { const r = stepBridge(s, 1 / 60); s = r.state; navs.push(r.navigate); }
    expect(navs.filter(Boolean)).toHaveLength(1);
    expect(navs.indexOf(true)).toBe(59);
    expect(s.navigated).toBe(true);
  });
  it('a zero hold navigates on the first step', () => {
    expect(stepBridge({ t: 0, holdS: 0, navigated: false }, 1 / 60).navigate).toBe(true);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/lab/sdf-zombie/webgpu/level-bridge.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: The module.**

```ts
// src/lab/sdf-zombie/webgpu/level-bridge.ts
//
// THE BRIDGE BETWEEN LEVELS (spec 2026-10-21-night-train-to-flat-design.md §3.1): a level's `onComplete` says where the player goes when the level
// completes (`goto`, a level id; `params`, a query string; `bridge`, what plays while the next page loads). Pure: no DOM, no three.js. The runtime is
// game-bridge.ts. The bridge is a slot: a `card` now (a colour, a line of text, a hold), a rendered movie or a title later (a new `kind`).
export type RGB = readonly [number, number, number];
export type BridgeSpec = { kind: 'card'; rgb: RGB; text: string; holdS: number };
export interface OnComplete { goto: string; params: string; bridge: BridgeSpec | null }

const LEVEL_ID = /^[a-z0-9-]+$/;
export const isLevelId = (s: string): boolean => LEVEL_ID.test(s);
/** A hold longer than this is a typo, not a design. */
export const HOLD_MAX_S = 30;
const DEFAULT_HOLD_S = 2;
/** The query params that belong to the level being left: dropped from the carried-over search (the new level's own params replace them). */
const OWN_PARAMS = ['level', 'emergence', 'from'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseBridge(v: unknown, errors: string[]): BridgeSpec | null {
  if (!isObject(v)) { errors.push('onComplete.bridge: expected an object'); return null; }
  if (v.kind !== 'card') { errors.push(`onComplete.bridge.kind: unknown kind ${String(v.kind)} (known: card)`); return null; }
  const rgb = v.rgb === undefined ? [0, 0, 0] : v.rgb;
  if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(c => typeof c === 'number' && c >= 0 && c <= 1)) {
    errors.push('onComplete.bridge.rgb: expected [3 numbers from 0 to 1]');
    return null;
  }
  const text = v.text === undefined ? '' : v.text;
  if (typeof text !== 'string') { errors.push('onComplete.bridge.text: expected a string'); return null; }
  const holdS = v.holdS === undefined ? DEFAULT_HOLD_S : v.holdS;
  if (typeof holdS !== 'number' || !Number.isFinite(holdS) || holdS < 0 || holdS > HOLD_MAX_S) {
    errors.push(`onComplete.bridge.holdS: expected seconds from 0 to ${HOLD_MAX_S}`);
    return null;
  }
  return { kind: 'card', rgb: rgb as unknown as RGB, text, holdS };
}

/** `undefined` is no onComplete (null, no errors); anything else is validated. */
export function parseOnComplete(v: unknown, errors: string[]): OnComplete | null {
  if (v === undefined) return null;
  if (!isObject(v)) { errors.push('onComplete: expected an object'); return null; }
  for (const k of Object.keys(v)) if (k !== 'goto' && k !== 'params' && k !== 'bridge') errors.push(`onComplete: unknown key ${k}`);
  if (typeof v.goto !== 'string' || !isLevelId(v.goto)) { errors.push('onComplete.goto: must match [a-z0-9-]+'); return null; }
  let params = '';
  if (v.params !== undefined) {
    if (typeof v.params === 'string') params = v.params;
    else errors.push('onComplete.params: expected a string');
  }
  const bridge = v.bridge === undefined ? null : parseBridge(v.bridge, errors);
  return { goto: v.goto, params, bridge };
}

/** The seconds the bridge holds before the page hops. */
export function bridgeHoldS(b: BridgeSpec | null): number {
  return b ? Math.min(HOLD_MAX_S, Math.max(0, b.holdS)) : 0;
}

/** The next level's URL on the same page: `level`, then the level's own params, then whatever else the player booted with (`res`, `graphics`,
 *  `upscale`...). Null for a goto that is not a level id. */
export function targetUrl(pathname: string, onc: Pick<OnComplete, 'goto' | 'params'>, currentSearch: string): string | null {
  if (!isLevelId(onc.goto)) return null;
  const carried = new URLSearchParams(currentSearch);
  for (const k of OWN_PARAMS) carried.delete(k);
  const out = new URLSearchParams();
  out.set('level', onc.goto);
  for (const [k, v] of new URLSearchParams(onc.params)) out.set(k, v);
  for (const [k, v] of carried) if (!out.has(k)) out.set(k, v);
  return `${pathname}?${out.toString()}`;
}

export interface BridgeState { t: number; holdS: number; navigated: boolean }
/** One sim step of the bridge: navigates exactly once, on the step whose clock reaches the hold. */
export function stepBridge(s: BridgeState, dt: number): { state: BridgeState; navigate: boolean } {
  if (s.navigated) return { state: s, navigate: false };
  const t = s.t + dt;
  if (t >= s.holdS - 1e-9) return { state: { ...s, t, navigated: true }, navigate: true };
  return { state: { ...s, t }, navigate: false };
}
```

- [ ] **Step 4:** `npx vitest run src/lab/sdf-zombie/webgpu/level-bridge.test.ts`. Expected: PASS. (If the `navs.indexOf(true)` test is off by one because of float accumulation, the 1e-9 tolerance above is what makes step 60 land at index 59; keep the tolerance.)
- [ ] **Step 5:** `npm run typecheck`. Commit (path-only): `feat(bridge): level-bridge.ts, the pure side of a level's onComplete (spec 2026-10-21)`.

---

### Task 2: `onComplete` in the level format and the Night Train's level

**Files:** modify `webgpu/level-def.ts`, `webgpu/level-json.ts`, `webgpu/level-json.test.ts`, `webgpu/level-json.night-train.test.ts`, `public/assets/levels/night-train.level.json`, `scripts/levels/night_train_layout.py`, `scripts/levels/build_night_train.py`, `scripts/levels/export_level.py`.

- [ ] **Step 1: Tests first.** In `level-json.test.ts` add a describe at the end (it uses `fixture('two-rooms')`):

```ts
describe('parseLevelJson: onComplete (spec 2026-10-21)', () => {
  const withOnComplete = (oc: unknown) => ({ ...fixture('two-rooms'), onComplete: oc });
  it('is null when absent (today\'s behaviour: the LEVEL COMPLETE overlay)', () => {
    expect(parseLevelJson(fixture('two-rooms')).onComplete).toBeNull();
  });
  it('parses goto, params and a card bridge', () => {
    const L = parseLevelJson(withOnComplete({ goto: 'flat-early', params: 'emergence=1&from=night-train',
      bridge: { kind: 'card', rgb: [0, 0, 0], text: 'NIGHT TRAIN', holdS: 2.5 } }));
    expect(L.onComplete).toEqual({ goto: 'flat-early', params: 'emergence=1&from=night-train',
      bridge: { kind: 'card', rgb: [0, 0, 0], text: 'NIGHT TRAIN', holdS: 2.5 } });
  });
  it('refuses a goto that is not a level id, an unknown bridge kind and an unknown key', () => {
    expect(() => parseLevelJson(withOnComplete({ goto: '../x' }))).toThrow(/onComplete\.goto/);
    expect(() => parseLevelJson(withOnComplete({ goto: 'a', bridge: { kind: 'movie' } }))).toThrow(/onComplete\.bridge\.kind/);
    expect(() => parseLevelJson(withOnComplete({ goto: 'a', extra: 1 }))).toThrow(/unknown key extra/);
  });
});
```
(Check how the file asserts parse errors — `parseLevelJson` throws an `Error` whose message lists the errors; if it returns errors another way, mirror the file's existing invalid-case style.) In `level-json.night-train.test.ts`, after the line `expect(t.completeOn).toBe('ending.end');` add:

```ts
    expect(t.onComplete).toEqual({
      goto: 'flat-early', params: 'emergence=1&from=night-train',
      bridge: { kind: 'card', rgb: [0, 0, 0], text: 'NIGHT TRAIN', holdS: 2.5 },
    });
```

- [ ] **Step 2:** Run both test files: `npx vitest run src/lab/sdf-zombie/webgpu/level-json.test.ts src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: The parser.** `level-def.ts`: `import type { OnComplete } from './level-bridge';` and in `LevelDef`, after `completeOn: string;` add:

```ts
  /** Where the level hands over when `completeOn` fires (spec 2026-10-21): null = the LEVEL COMPLETE overlay, as before. */
  onComplete?: OnComplete | null;
```
(optional, so literal LevelDefs in other tests still compile.) `level-json.ts`: add `import { parseOnComplete } from './level-bridge';`; add `'onComplete'` to `KEYS.top` after `'completeOn'`; after `const completeOn = ...` add `const onComplete = parseOnComplete(j.onComplete, errors);`; add `onComplete` to the returned object after `completeOn`.

- [ ] **Step 4: The Night Train's JSON (text insert) and its Blender sources.** In `public/assets/levels/night-train.level.json`, replace the line `  "completeOn": "ending.end",` with:

```json
  "completeOn": "ending.end",
  "onComplete": {
    "goto": "flat-early",
    "params": "emergence=1&from=night-train",
    "bridge": {
      "kind": "card",
      "rgb": [
        0,
        0,
        0
      ],
      "text": "NIGHT TRAIN",
      "holdS": 2.5
    }
  },
```
`scripts/levels/night_train_layout.py`: after `COMPLETE_ON = "ending.end"` add

```python
# Where the level hands over when it completes (spec 2026-10-21): the Flat, behind a black card with the title.
ON_COMPLETE = {"goto": "flat-early", "params": "emergence=1&from=night-train",
               "bridge": {"kind": "card", "rgb": [0, 0, 0], "text": "NIGHT TRAIN", "holdS": 2.5}}
```
and in `to_level()` put `"onComplete": ON_COMPLETE,` right after `"completeOn": COMPLETE_ON,`. `build_night_train.py`: add `ON_COMPLETE` to the `from night_train_layout import ...` list and, after `SC["complete_on"] = COMPLETE_ON`, add `SC["on_complete"] = json.dumps(ON_COMPLETE)`. `export_level.py`: after the `complete_on` block add

```python
    if scene.get("on_complete"):
        doc["onComplete"] = json.loads(scene["on_complete"])
```

- [ ] **Step 5:** Re-run the two test files (Expected: PASS), then `python3 -I -c "import json;json.load(open('public/assets/levels/night-train.level.json'))"` (valid JSON) and `python3 -I scripts/levels/night_train_layout.py --help 2>&1 | head -3` is not needed; run `python3 -I -c "import sys;sys.path.insert(0,'scripts/levels');import night_train_layout as L;print(L.to_level()['onComplete']['goto'])"` (Expected: `flat-early`). `npm run typecheck`. Commit: `feat(level): onComplete (goto, params, bridge) in the level format; the Night Train hands over to flat-early`.

---

### Task 3: the bridge runtime

**Files:** create `webgpu/game-bridge.ts`; modify `webgpu/game-loop.ts`, `webgpu/game-tick.ts`, `webgpu/game-main.ts`.

- [ ] **Step 1: The leaf.**

```ts
// src/lab/sdf-zombie/webgpu/game-bridge.ts
//
// THE BRIDGE RUNTIME (spec 2026-10-21 §3.1): when a level completes and declares `onComplete`, show its bridge card, hold it, then hop the page
// to the next level (level-bridge.ts is the pure side). One bridge per page, so the state is this module's, not ctx's. Seams:
// `__sdfGame.bridge()` and `setBridgeNavigate(fn | null)` (a driver replaces `location.assign` with a recorder: nothing in node navigates).
import type { GameContext } from './game-context';
import { bridgeHoldS, stepBridge, targetUrl, type BridgeState, type OnComplete } from './level-bridge';

interface Active { onc: OnComplete; state: BridgeState; el: HTMLElement; url: string | null }
let active: Active | null = null;
let navigateOverride: ((url: string) => void) | null = null;

/** Start the bridge for `onc`. False when there is no card to show and nothing to hop to (the caller then falls back to the overlay). */
export function startBridge(_ctx: GameContext, onc: OnComplete): boolean {
  if (active) return true;
  const url = targetUrl(location.pathname, onc, location.search);
  if (!url) { console.error(`[bridge] onComplete.goto ${onc.goto} is not a level id`); return false; }
  const el = document.createElement('div');
  const rgb = onc.bridge?.rgb ?? [0, 0, 0];
  const c = (v: number) => Math.round(v * 255);
  // z-index above the sequence overlay (44): the card repeats the ending's last black and its title, so the hand-over is one continuous black.
  el.setAttribute('style', `position:fixed; inset:0; z-index:46; pointer-events:none; background:rgb(${c(rgb[0])}, ${c(rgb[1])}, ${c(rgb[2])});`
    + ' display:grid; place-items:center;');
  const text = document.createElement('div');
  text.setAttribute('style', 'font:700 28px/1.2 ui-monospace,Menlo,monospace; color:#f2e6d0; letter-spacing:.3em;');
  text.textContent = onc.bridge?.text ?? '';
  el.appendChild(text);
  document.body.appendChild(el);
  document.exitPointerLock?.();
  active = { onc, state: { t: 0, holdS: bridgeHoldS(onc.bridge), navigated: false }, el, url };
  return true;
}

/** Per sim step (game-tick.ts, after stepSequence): the hold, then the hop. */
export function stepBridgeRuntime(_ctx: GameContext, dt: number): void {
  if (!active || !active.url) return;
  const r = stepBridge(active.state, dt);
  active.state = r.state;
  if (r.navigate) (navigateOverride ?? ((u: string) => location.assign(u)))(active.url);
}

export function createBridgeSeams(_ctx: GameContext) {
  return {
    bridge: () => active && { active: true, t: +active.state.t.toFixed(3), holdS: active.state.holdS, navigated: active.state.navigated, url: active.url, text: active.onc.bridge?.text ?? '' },
    setBridgeNavigate: (fn: ((url: string) => void) | null) => { navigateOverride = fn; },
  };
}
```

- [ ] **Step 2: Wire it.** `game-loop.ts` (imports at the top: `import { startBridge } from './game-bridge';`), replace the `complete` branch of `runLevelCommand`:

```ts
  if (cmd.kind === 'complete') {
    rt.done = true;
    // A level that says where it hands over (spec 2026-10-21) runs its bridge and hops; the rest show the overlay as before.
    const onc = ctx.world.level.def.onComplete;
    if (onc && startBridge(ctx, onc)) return;
    rt.el.complete.style.display = 'grid';
    document.exitPointerLock?.();
  }
```
(`return` is safe: the next two `if`s are for other command kinds; if the function continues past it in the current source, restructure with `else` instead.) `game-tick.ts`: `import { stepBridgeRuntime } from './game-bridge';` and after `stepEmergence(ctx, dt);` add `stepBridgeRuntime(ctx, dt);`. `game-main.ts`: `import { createBridgeSeams } from './game-bridge';` and add `createBridgeSeams(ctx),` next to `createEmergenceSeams(ctx),`.

- [ ] **Step 3:** `npm run typecheck` and `npx vitest run scripts/game-context-coverage.test.ts scripts/seam-merge-guard.test.ts` (the seam and ctx guards). Expected: PASS. If the seam-merge guard complains about a duplicate key, rename.
- [ ] **Step 4:** Commit: `feat(bridge): game-bridge.ts: the card, the hold and the page hop when a level with onComplete completes`. (The headless proof is Task 7.)

---

### Task 4: the CRT picture across the hop (pure storage, capture, trigger)

**Files:** create `webgpu/crt-handoff.ts`, `webgpu/crt-handoff.test.ts`, `webgpu/game-crt-capture.ts`; modify `webgpu/game-sequence.ts`.

- [ ] **Step 1: The failing test.**

```ts
// src/lab/sdf-zombie/webgpu/crt-handoff.test.ts
import { describe, expect, it } from 'vitest';
import { CRT_KEY, CRT_MAX_CHARS, clearCrtPicture, loadCrtPicture, looksBlank, saveCrtPicture, type KeyValueStorage } from './crt-handoff';

const store = (): KeyValueStorage & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('crt-handoff storage', () => {
  it('round-trips a PNG data URL and clears it', () => {
    const s = store();
    expect(saveCrtPicture(s, PNG)).toBe(true);
    expect(s.m.has(CRT_KEY)).toBe(true);
    expect(loadCrtPicture(s)).toBe(PNG);
    clearCrtPicture(s);
    expect(loadCrtPicture(s)).toBeNull();
  });
  it('refuses what is not a PNG data URL, and what is over the cap', () => {
    const s = store();
    expect(saveCrtPicture(s, 'data:image/jpeg;base64,AAAA')).toBe(false);
    expect(saveCrtPicture(s, 'http://x/y.png')).toBe(false);
    expect(saveCrtPicture(s, PNG + 'A'.repeat(CRT_MAX_CHARS))).toBe(false);
    expect(s.m.size).toBe(0);
  });
  it('loads null for a malformed stored value', () => {
    const s = store();
    s.m.set(CRT_KEY, 'javascript:alert(1)');
    expect(loadCrtPicture(s)).toBeNull();
  });
  it('never throws when the storage does', () => {
    const boom: KeyValueStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
    expect(saveCrtPicture(boom, PNG)).toBe(false);
    expect(loadCrtPicture(boom)).toBeNull();
    expect(() => clearCrtPicture(boom)).not.toThrow();
  });
});

describe('looksBlank', () => {
  const px = (n: number, f: (i: number) => [number, number, number]) => {
    const a = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { const [r, g, b] = f(i); a.set([r, g, b, 255], i * 4); }
    return a;
  };
  it('is true for a flat colour (black, white or transparent), false for a picture', () => {
    expect(looksBlank(px(100, () => [0, 0, 0]))).toBe(true);
    expect(looksBlank(px(100, () => [255, 255, 255]))).toBe(true);
    expect(looksBlank(new Uint8ClampedArray(400))).toBe(true);
    expect(looksBlank(px(100, i => [i * 2, 255 - i * 2, (i * 7) % 255]))).toBe(false);
  });
});
```

- [ ] **Step 2:** run it (FAIL). **Step 3: the module.**

```ts
// src/lab/sdf-zombie/webgpu/crt-handoff.ts
//
// THE CRT'S PICTURE ACROSS THE PAGE HOP (spec 2026-10-21 §3.2). The Night Train captures the last frame the player saw; the Flat's CRT shows it.
// The picture is a PNG data URL in sessionStorage, which survives a same-tab navigation. Pure: the storage is injected, every access is guarded
// (a private window, a full quota or blocked site data must never break the hand-over: the Flat falls back to its committed still).
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export const CRT_KEY = 'blud.crtPicture';
/** The data URL's length cap (characters; about 1.5 MB of PNG). */
export const CRT_MAX_CHARS = 2_000_000;
/** The captured picture's size (4:3, the CRT's picture). */
export const CRT_SIZE = { width: 512, height: 384 } as const;
const PNG_PREFIX = 'data:image/png;base64,';

export function saveCrtPicture(storage: KeyValueStorage, dataUrl: string): boolean {
  if (!dataUrl.startsWith(PNG_PREFIX) || dataUrl.length > CRT_MAX_CHARS) return false;
  try { storage.setItem(CRT_KEY, dataUrl); return true; } catch { return false; }
}
export function loadCrtPicture(storage: KeyValueStorage): string | null {
  try {
    const v = storage.getItem(CRT_KEY);
    return v !== null && v.startsWith(PNG_PREFIX) && v.length <= CRT_MAX_CHARS ? v : null;
  } catch { return null; }
}
export function clearCrtPicture(storage: KeyValueStorage): void {
  try { storage.removeItem(CRT_KEY); } catch { /* nothing to clear */ }
}
/** The page's sessionStorage, or null where touching it throws. */
export function sessionStore(): KeyValueStorage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/** Is this RGBA buffer a flat colour (a blank capture)? True when the luma's standard deviation is under 2 (of 255), or the buffer is empty. */
export function looksBlank(rgba: Uint8ClampedArray): boolean {
  const n = rgba.length / 4;
  if (n === 0) return true;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) {
    const y = 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
    sum += y; sum2 += y * y;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sum2 / n - mean * mean)) < 2;
}
```
Run the test: Expected PASS.

- [ ] **Step 4: The capture (DOM leaf).**

```ts
// src/lab/sdf-zombie/webgpu/game-crt-capture.ts
//
// Capture the canvas for the Flat's CRT (spec 2026-10-21 §3.2). A WebGPU canvas is only readable in the task that drew it, so the capture is
// requested, and done by the renderer's frame observer (lab-renderer.ts: it runs in the same rAF task right after the draw). It crops the canvas
// to 4:3, downscales to CRT_SIZE on a 2D canvas, refuses a blank result and saves it (crt-handoff.ts). Every failure is swallowed: the Flat falls
// back to its committed still. Seam: `__sdfGame.crtCapture()` reports the last attempt.
import type { GameContext } from './game-context';
import { CRT_SIZE, looksBlank, saveCrtPicture, sessionStore } from './crt-handoff';

export interface CaptureResult { ok: boolean; reason: string; bytes: number }
let last: CaptureResult | null = null;
let pending = false;

export function requestCrtCapture(ctx: GameContext): void {
  if (pending) return;
  pending = true;
  ctx.boot.handle.setFrameObserver(() => {
    ctx.boot.handle.setFrameObserver(null);
    pending = false;
    last = captureNow(ctx);
  });
}

function captureNow(ctx: GameContext): CaptureResult {
  try {
    const src = ctx.boot.handle.renderer.domElement as HTMLCanvasElement;
    const store = sessionStore();
    if (!store) return { ok: false, reason: 'no sessionStorage', bytes: 0 };
    // Centre-crop the source to 4:3.
    const want = CRT_SIZE.width / CRT_SIZE.height;
    let sw = src.width, sh = src.height;
    if (sw / sh > want) sw = Math.round(sh * want); else sh = Math.round(sw / want);
    const sx = Math.round((src.width - sw) / 2), sy = Math.round((src.height - sh) / 2);
    const c = document.createElement('canvas');
    c.width = CRT_SIZE.width; c.height = CRT_SIZE.height;
    const g = c.getContext('2d');
    if (!g) return { ok: false, reason: 'no 2d context', bytes: 0 };
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    if (looksBlank(g.getImageData(0, 0, c.width, c.height).data)) return { ok: false, reason: 'blank capture', bytes: 0 };
    const url = c.toDataURL('image/png');
    const ok = saveCrtPicture(store, url);
    return { ok, reason: ok ? 'saved' : 'not saved (cap or storage)', bytes: url.length };
  } catch (e) {
    return { ok: false, reason: `threw: ${e instanceof Error ? e.message : String(e)}`, bytes: 0 };
  }
}

export function createCrtCaptureSeams(ctx: GameContext) {
  return { crtCapture: () => last, requestCrtCapture: () => requestCrtCapture(ctx) };
}
```
Add `createCrtCaptureSeams(ctx),` to the seam spread in `game-main.ts` (import it), beside `createBridgeSeams`.

- [ ] **Step 5: The trigger.** In `game-sequence.ts` add `captured?: boolean;` to `SequenceRuntime` (the interface at the top, next to `finished`), `import { requestCrtCapture } from './game-crt-capture';`, and in `stepSequence`, right after `paint(rt);`:

```ts
  // The Night Train's ending: the last frame of the pull (the egg filling the view) is the Flat's CRT picture (spec 2026-10-21 §3.2).
  if (rt.seq.id === 'ending' && at.shot.id === 'pull' && at.u >= 0.96 && !rt.captured) { rt.captured = true; requestCrtCapture(ctx); }
```
- [ ] **Step 6:** `npm run typecheck`; `npx vitest run src/lab/sdf-zombie/webgpu/crt-handoff.test.ts scripts/game-context-coverage.test.ts scripts/seam-merge-guard.test.ts`. Commit: `feat(bridge): the CRT's picture across the hop: crt-handoff.ts, the canvas capture at the end of the pull`. (The headless proof the capture is not blank is Task 7; if it is blank there, STOP and report: the spec's fallback needs a design decision.)

---

### Task 5: the Flat side of the arrival

**Files:** create `webgpu/emergence-entry.ts`, `webgpu/emergence-entry.test.ts`; modify `webgpu/ending-sequence.ts`, `webgpu/ending-sequence.test.ts`, `webgpu/emergence-camera.ts`, `webgpu/emergence-camera.test.ts`, `webgpu/game-emergence.ts`.

- [ ] **Step 1: Tests first.** `emergence-entry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AUTOSTART_DEBUG_S, AUTOSTART_TRAIN_S, FADE_IN_TRAIN_S, emergenceEntry } from './emergence-entry';

describe('emergenceEntry', () => {
  it('the debug flag: autostart after the usual delay, no fade, no stored picture', () => {
    expect(emergenceEntry('?level=flat-early&emergence=1')).toEqual({ fromTrain: false, autostart: true, delayS: AUTOSTART_DEBUG_S, fadeInS: 0 });
  });
  it('from the Night Train: autostart soon, fade up from black, take the stored picture', () => {
    const e = emergenceEntry('?level=flat-early&emergence=1&from=night-train');
    expect(e).toEqual({ fromTrain: true, autostart: true, delayS: AUTOSTART_TRAIN_S, fadeInS: FADE_IN_TRAIN_S });
    expect(emergenceEntry('?level=flat-early&from=night-train').autostart).toBe(true);   // from= implies emergence=1
  });
  it('a bare flat-early load does not autostart; emergence=0 never does, even from the train', () => {
    expect(emergenceEntry('?level=flat-early').autostart).toBe(false);
    expect(emergenceEntry('?level=flat-early&emergence=0&from=night-train').autostart).toBe(false);
  });
  it('only from=night-train counts', () => {
    expect(emergenceEntry('?from=somewhere').fromTrain).toBe(false);
  });
});
```
Add to `ending-sequence.test.ts` (use its existing imports; build a tiny sequence):

```ts
describe('fadeInS: a shot that opens from black', () => {
  const seq = { id: 't', endEvent: 'e', shots: [
    { id: 'a', duration: 4, cut: 'hard' as const, camera: { kind: 'hold' as const }, fadeInS: 1 },
    { id: 'b', duration: 2, cut: 'hard' as const, camera: { kind: 'hold' as const } },
  ] };
  it('is black at the start, clear after fadeInS, monotone between', () => {
    expect(overlayAt(seq, 0).alpha).toBe(1);
    expect(overlayAt(seq, 1).alpha).toBe(0);
    expect(overlayAt(seq, 3).alpha).toBe(0);
    let prev = 1;
    for (let t = 0; t <= 1; t += 0.1) { const a = overlayAt(seq, t).alpha; expect(a).toBeLessThanOrEqual(prev + 1e-12); prev = a; }
  });
  it('a later shot without fadeInS is unchanged', () => {
    expect(overlayAt(seq, 4.5).alpha).toBe(0);
  });
});
```
and to `emergence-camera.test.ts`:

```ts
describe('sequenceFor fade-in', () => {
  it('only the first shot opens from black, when asked', () => {
    const plain = sequenceFor(P);
    expect(plain.shots.every(s => s.fadeInS === undefined)).toBe(true);
    const faded = sequenceFor(P, undefined, { fadeInS: 0.8 });
    expect(faded.shots[0]!.fadeInS).toBe(0.8);
    expect(faded.shots.slice(1).every(s => s.fadeInS === undefined)).toBe(true);
    expect(faded.shots.map(s => s.duration)).toEqual(plain.shots.map(s => s.duration));
  });
});
```
(`P` is the placement the file already builds; match its name.) Run all three files: Expected FAIL.

- [ ] **Step 2: Implement.** `emergence-entry.ts`:

```ts
// src/lab/sdf-zombie/webgpu/emergence-entry.ts
//
// How the Flat's emergence is entered (spec 2026-10-21 §3.3). Pure: a function of the query string.
/** The debug flag's autostart delay after the level is ready (sim seconds; game-emergence.ts AUTOSTART_S before this module). */
export const AUTOSTART_DEBUG_S = 2;
/** From the Night Train the player just waited through the bridge: start almost at once. */
export const AUTOSTART_TRAIN_S = 0.5;
/** The black the sequence opens from when arriving from the train (s). */
export const FADE_IN_TRAIN_S = 0.8;

export interface EmergenceEntry { fromTrain: boolean; autostart: boolean; delayS: number; fadeInS: number }

export function emergenceEntry(search: string): EmergenceEntry {
  const q = new URLSearchParams(search);
  const fromTrain = q.get('from') === 'night-train';
  const flag = q.get('emergence');
  const autostart = flag !== '0' && (flag === '1' || fromTrain);
  return { fromTrain, autostart, delayS: fromTrain ? AUTOSTART_TRAIN_S : AUTOSTART_DEBUG_S, fadeInS: fromTrain ? FADE_IN_TRAIN_S : 0 };
}
```
`ending-sequence.ts`: in `Shot` add `/** The shot opens black and clears over this many seconds (eased). */ fadeInS?: number;`; in `overlayAt`, replace the final non-flash `return` (the line returning `{ rgb: base.rgb, alpha: base.alpha, text: ... }`) by:

```ts
  const fade = shot.fadeInS && shot.fadeInS > 0 ? 1 - ease(local / shot.fadeInS) : 0;
  return { rgb: base.rgb, alpha: Math.max(base.alpha, fade), text: base.text ?? null };
```
(Read the function's last lines first and keep its flash branch intact.) `emergence-camera.ts`: `sequenceFor(placement, centreFov = GAME_CENTRE_FOV, opts: { fadeInS?: number } = {})` builds `shots` as now; `if (opts.fadeInS && shots[0]) shots[0] = { ...shots[0], fadeInS: opts.fadeInS };` and returns `{ id, endEvent, shots }` (shots is `const` today: use `const shots = shotsFor(...)`, a plain array copy `[...shotsFor(...)]`).

- [ ] **Step 3: `game-emergence.ts`.** Add imports: `import { clearCrtPicture, loadCrtPicture, sessionStore } from './crt-handoff';` and `import { emergenceEntry } from './emergence-entry';`. Replace the `AUTOSTART_S` export with `export const AUTOSTART_S = AUTOSTART_DEBUG_S;` re-exported for old users (`import { AUTOSTART_DEBUG_S } from './emergence-entry'` first) or keep the constant and add the new ones: **keep** `AUTOSTART_S` (tests may import it) and add to `EmergenceRuntime` the fields `autostartDelayS: number; picture: 'night-train' | 'still';`. In `createEmergence`:

```ts
  const entry = emergenceEntry(location.search);
  const store = entry.fromTrain ? sessionStore() : null;
  const stored = store ? loadCrtPicture(store) : null;
  if (store) clearCrtPicture(store);
  const picture = new THREE.TextureLoader().load(stored ?? PICTURE_URL, undefined, undefined,
    () => console.error(`[emergence] picture ${stored ? 'from the night train' : PICTURE_URL} failed to load`));
```
(replacing the existing `const picture = new THREE.TextureLoader().load(PICTURE_URL, ...)` statement), `const seq = sequenceFor(placement, undefined, { fadeInS: entry.fadeInS });`, and in the runtime literal `autostart: entry.autostart` (was `param === '1'`), plus `autostartDelayS: entry.delayS, picture: stored ? 'night-train' : 'still'`. In `stepEmergence` replace `AUTOSTART_S` in the autostart comparison (`if (rt.sinceReady >= AUTOSTART_S)`) with `rt.autostartDelayS`. In `createEmergenceSeams`'s `emergence()` object add `picture: rt.picture, overlayAlpha: rt.phase === 'playing' ? +overlayAt(rt.seq, rt.t).alpha.toFixed(3) : null,` (import `overlayAt` from `./ending-sequence`). `createEmergence`'s gate is unchanged: the Flat is `flat-early`, so it builds.

- [ ] **Step 4:** run the three test files + `game-emergence.test.ts` (Expected PASS), `npm run typecheck`. Commit: `feat(emergence): arriving from the Night Train: the stored CRT picture, a quick autostart and a fade up from black`.

---

### Task 6: the early Flat's clutter

**Files:** create `scripts/levels/flat/clutter-layout.json`, `src/lab/sdf-zombie/webgpu/flat-clutter.test.ts`, `scripts/levels/flat/clutter.py`; modify `scripts/levels/build_the_flat.py`, `scripts/levels/flat/props.py` (comment only), regenerate `public/assets/levels/flat-early.art.glb` (and `assets-source/levels/flat-early.blend` if the build writes it).

- [ ] **Step 1: The data.** `scripts/levels/flat/clutter-layout.json` (Blender space; `c` the box centre, `s` the full box size; wall items are 2 cm thick on a wall; floor items' z is `FLOOR` 0.055 plus half their height; `kind` picks the shape, `m` the material key in clutter.py):

```json
{
  "version": 1,
  "items": [
    { "id": "poster-w1", "group": "wall", "kind": "poster", "m": "poster_a", "c": [-1.335, 0.70, 1.40], "s": [0.02, 0.30, 0.42] },
    { "id": "poster-w2", "group": "wall", "kind": "poster", "m": "poster_b", "c": [-1.335, 1.25, 1.55], "s": [0.02, 0.26, 0.36] },
    { "id": "poster-w3", "group": "wall", "kind": "poster", "m": "poster_c", "c": [-1.335, 1.78, 1.35], "s": [0.02, 0.34, 0.44] },
    { "id": "poster-e1", "group": "wall", "kind": "poster", "m": "poster_b", "c": [1.335, 0.55, 1.50], "s": [0.02, 0.32, 0.46] },
    { "id": "poster-e2", "group": "wall", "kind": "poster", "m": "poster_a", "c": [1.335, 1.05, 1.30], "s": [0.02, 0.28, 0.40] },
    { "id": "poster-s1", "group": "wall", "kind": "poster", "m": "poster_c", "c": [1.04, 0.03, 1.45], "s": [0.30, 0.02, 0.42] },
    { "id": "manga-wall", "group": "wall", "kind": "mangawall", "m": "books", "c": [-0.92, 0.04, 1.20], "s": [0.70, 0.08, 0.60] },
    { "id": "plush-bear", "group": "floor", "kind": "plush", "m": "plush_brown", "c": [-0.70, 0.16, 0.165], "s": [0.22, 0.20, 0.22] },
    { "id": "plush-cat", "group": "floor", "kind": "plush", "m": "plush_grey", "c": [-0.35, 0.22, 0.145], "s": [0.18, 0.16, 0.18] },
    { "id": "plush-frog", "group": "floor", "kind": "plush", "m": "plush_green", "c": [0.95, 0.20, 0.135], "s": [0.17, 0.15, 0.16] },
    { "id": "manga-stack-1", "group": "floor", "kind": "stack", "m": "books", "c": [-0.15, 0.50, 0.115], "s": [0.20, 0.28, 0.12] },
    { "id": "manga-stack-2", "group": "floor", "kind": "stack", "m": "books", "c": [1.10, 1.00, 0.135], "s": [0.20, 0.28, 0.16] },
    { "id": "noodle-1", "group": "floor", "kind": "cup", "m": "cup", "c": [1.18, 0.55, 0.115], "s": [0.10, 0.10, 0.12] },
    { "id": "noodle-2", "group": "floor", "kind": "cup", "m": "cup", "c": [0.78, 0.45, 0.115], "s": [0.10, 0.10, 0.12] },
    { "id": "can-1", "group": "floor", "kind": "can", "m": "can_a", "c": [0.62, 0.28, 0.115], "s": [0.066, 0.066, 0.12] },
    { "id": "can-2", "group": "floor", "kind": "can", "m": "can_b", "c": [0.55, 0.60, 0.115], "s": [0.066, 0.066, 0.12] },
    { "id": "sock-1", "group": "floor", "kind": "sock", "m": "sock_a", "c": [-0.55, 0.62, 0.07], "s": [0.20, 0.09, 0.03] },
    { "id": "sock-2", "group": "floor", "kind": "sock", "m": "sock_b", "c": [0.20, 0.10, 0.07], "s": [0.18, 0.08, 0.03] },
    { "id": "gashapon-1", "group": "floor", "kind": "capsule", "m": "cap_a", "c": [0.32, 0.14, 0.085], "s": [0.06, 0.06, 0.06] },
    { "id": "gashapon-2", "group": "floor", "kind": "capsule", "m": "cap_b", "c": [0.40, 0.19, 0.085], "s": [0.06, 0.06, 0.06] },
    { "id": "gashapon-3", "group": "floor", "kind": "capsule", "m": "cap_c", "c": [0.36, 0.26, 0.085], "s": [0.06, 0.06, 0.06] },
    { "id": "cable-1", "group": "floor", "kind": "cable", "m": "cable", "c": [0.78, 0.86, 0.067], "s": [0.65, 0.20, 0.024],
      "path": [[0.45, 0.90], [0.70, 0.75], [0.95, 0.92], [1.10, 0.80]] },
    { "id": "can-3", "group": "desk", "kind": "can", "m": "can_a", "c": [0.47, 2.70, 0.50], "s": [0.066, 0.066, 0.12] },
    { "id": "cup-1", "group": "desk", "kind": "cup", "m": "cup", "c": [-0.25, 2.70, 0.50], "s": [0.10, 0.10, 0.12] }
  ]
}
```

- [ ] **Step 2: The clearance test (red against bad data, green against this data).**

```ts
// src/lab/sdf-zombie/webgpu/flat-clutter.test.ts
//
// The early Flat's clutter (spec 2026-10-21 §3.4): scripts/levels/flat/clutter-layout.json feeds both the Blender module and this test. The clutter
// has no colliders, so the cameras and the hand-off are cleared here, by data: nothing inside the room's limits is wrong, nothing blocks an eye or
// its look line or the hand-off capsule, and nothing sits in the desk set's footprint.
import { describe, expect, it } from 'vitest';
import layout from '../../../../scripts/levels/flat/clutter-layout.json';
import { FLAT_PRESETS } from './emergence-camera';
import { handoffFor } from './emergence-camera';
import { FLAT_KOTATSU, placementFor, toWorld, fromWorld } from './emergence-placement';
import { DESK_Y, KOTATSU, TABLE_FRONT_Z } from './emergence-field';

type Vec3 = [number, number, number];
interface Item { id: string; group: 'wall' | 'floor' | 'desk'; kind: string; m: string; c: Vec3; s: Vec3; path?: number[][] }
const ITEMS = layout.items as Item[];
const P = placementFor(FLAT_KOTATSU, [0, DESK_Y, TABLE_FRONT_Z - KOTATSU.d / 2], DESK_Y);

// Blender (x, y, z) -> game (x, z, -y); a box's centre and size.
const gameBox = (it: Item) => {
  const c: Vec3 = [it.c[0], it.c[2], -it.c[1]], s: Vec3 = [it.s[0], it.s[2], it.s[1]];
  return { min: [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2] as Vec3, max: [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2] as Vec3 };
};
const PAD = 0.05;
const segHits = (a: Vec3, b: Vec3, box: { min: Vec3; max: Vec3 }, pad: number) => {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.02);
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    if (p.every((v, j) => v >= box.min[j]! - pad && v <= box.max[j]! + pad)) return true;
  }
  return false;
};

describe('the early Flat clutter layout', () => {
  it('has unique ids and every item inside the room (x -1.35..1.35, y 0..3.6 Blender, under 2 m)', () => {
    expect(new Set(ITEMS.map(i => i.id)).size).toBe(ITEMS.length);
    for (const it of ITEMS) {
      const [x, y, z] = it.c, [sx, sy, sz] = it.s;
      expect(x - sx / 2, it.id).toBeGreaterThanOrEqual(-1.35 - 1e-9);
      expect(x + sx / 2, it.id).toBeLessThanOrEqual(1.35 + 1e-9);
      expect(y - sy / 2, it.id).toBeGreaterThanOrEqual(0 - 1e-9);
      expect(y + sy / 2, it.id).toBeLessThanOrEqual(3.6 + 1e-9);
      expect(z + sz / 2, it.id).toBeLessThan(2);
    }
  });
  it('floor items stand on the tatami (their bottom at 0.055), desk items on the board (0.44)', () => {
    for (const it of ITEMS.filter(i => i.group === 'floor')) expect(it.c[2] - it.s[2] / 2, it.id).toBeCloseTo(0.055, 2);
    for (const it of ITEMS.filter(i => i.group === 'desk')) expect(it.c[2] - it.s[2] / 2, it.id).toBeCloseTo(0.44, 2);
  });
  it('floor clutter is low (no taller than 0.2 m): nothing the player could mistake for a wall, and nothing a camera looks through', () => {
    for (const it of ITEMS.filter(i => i.group === 'floor')) expect(it.s[2], it.id).toBeLessThanOrEqual(0.2);
  });
  it("floor clutter is clear of the kotatsu quilt's spread (a 1.9 m square round the table) and the futon", () => {
    for (const it of ITEMS.filter(i => i.group === 'floor')) {
      const inQuilt = Math.abs(it.c[0] - 0.12) < 0.95 + it.s[0] / 2 && Math.abs(it.c[1] - 2.36) < 0.95 + it.s[1] / 2;
      const inFuton = it.c[0] < -0.475 && it.c[1] > 0.3 && it.c[1] < 2.2;
      expect(inQuilt, `${it.id} on the quilt`).toBe(false);
      expect(inFuton, `${it.id} on the futon`).toBe(false);
    }
  });
  it("desk clutter is clear of the CRT, keyboard and goo footprint (screen frame x within 0.30, z from -0.55 to 0.65)", () => {
    for (const it of ITEMS.filter(i => i.group === 'desk')) {
      const w = [it.c[0], it.c[2], -it.c[1]] as Vec3;
      const sf = fromWorld(P, w);
      const inside = Math.abs(sf[0]) < 0.30 + it.s[0] / 2 && sf[2] > -0.55 - it.s[1] / 2 && sf[2] < 0.65 + it.s[1] / 2;
      expect(inside, it.id).toBe(false);
    }
  });
  it('no item blocks a shot: every eye and its look line (5 cm clear), every clutter box', () => {
    for (const [id, p] of Object.entries(FLAT_PRESETS)) {
      const eye = toWorld(P, p.eye), at = toWorld(P, p.at);
      for (const it of ITEMS) expect(segHits(eye, at, gameBox(it), PAD), `${id} looks through ${it.id}`).toBe(false);
    }
  });
  it('nothing stands on the hand-off (his capsule, r 0.32, from the feet to the eye) or between his eye and the egg', () => {
    const h = handoffFor(P);
    const feet: Vec3 = [h.feet[0], h.feet[1], h.feet[2]];
    for (const it of ITEMS) {
      const b = gameBox(it);
      const nearest = [Math.max(b.min[0], Math.min(feet[0], b.max[0])), Math.max(b.min[2], Math.min(feet[2], b.max[2]))];
      expect(Math.hypot(nearest[0]! - feet[0], nearest[1]! - feet[2]), `${it.id} on the hand-off spot`).toBeGreaterThan(0.32 + 0.05);
    }
  });
});
```
(`fromWorld`, `handoffFor` and `h.feet` exist per the placement/camera modules; if `fromWorld`'s signature differs, read `emergence-placement.ts` and match it. `handoffFor(P)` returns `{ feet, yaw, pitch, ... }`.)

Run `npx vitest run src/lab/sdf-zombie/webgpu/flat-clutter.test.ts`. Expected: PASS. If an item fails a clearance assertion, **move that item** in the JSON (positions only: away from the named camera line or the spot, keeping it inside its group's rules) and re-run until green; do not loosen the test.

- [ ] **Step 3: The Blender module.** `scripts/levels/flat/clutter.py` (run inside Blender; uses the shared helpers):

```python
# scripts/levels/flat/clutter.py
"""The early Flat's clutter (spec 2026-10-21 §3.4): posters, plushies, manga, noodle cups and cans, socks, gashapon, a cable. Placements are
data (flat/clutter-layout.json, shared with src/lab/sdf-zombie/webgpu/flat-clutter.test.ts); this builds them. No colliders. Early stage only
(build_the_flat.py). Run inside Blender."""
import json
import math
import os
import random

from mathutils import Vector

from flat import common as C
from flat import materials as MAT
from flat.common import box, cyl, sphere, tube

LAYOUT = json.load(open(os.path.join(os.path.dirname(__file__), "clutter-layout.json")))
MT = None


def materials(M):
    """The clutter's materials: plain PBR colours (the room's own `books` texture for the manga)."""
    p = MAT.pbr
    return {
        "poster_a": p("poster_a", (0.78, 0.18, 0.22), rough=0.55), "poster_b": p("poster_b", (0.16, 0.42, 0.62), rough=0.55),
        "poster_c": p("poster_c", (0.92, 0.80, 0.30), rough=0.55), "poster_ink": p("poster_ink", (0.96, 0.94, 0.88), rough=0.6),
        "plush_brown": p("plush_brown", (0.52, 0.34, 0.20), rough=0.95), "plush_grey": p("plush_grey", (0.62, 0.62, 0.66), rough=0.95),
        "plush_green": p("plush_green", (0.30, 0.62, 0.34), rough=0.95), "plush_eye": p("plush_eye", (0.02, 0.02, 0.02), rough=0.3),
        "books": M.BOOKS, "cup": p("cup", (0.92, 0.90, 0.84), rough=0.6), "cup_band": p("cup_band", (0.78, 0.16, 0.14), rough=0.6),
        "can_a": p("can_a", (0.70, 0.72, 0.76), rough=0.3, metal=0.8), "can_b": p("can_b", (0.78, 0.20, 0.18), rough=0.3, metal=0.8),
        "sock_a": p("sock_a", (0.92, 0.92, 0.92), rough=0.95), "sock_b": p("sock_b", (0.20, 0.22, 0.50), rough=0.95),
        "cap_a": p("cap_a", (0.95, 0.35, 0.50), rough=0.25), "cap_b": p("cap_b", (0.35, 0.75, 0.95), rough=0.25),
        "cap_c": p("cap_c", (0.98, 0.85, 0.20), rough=0.25), "cable": p("cable", (0.05, 0.05, 0.05), rough=0.5),
    }


def poster(it, m):
    """A flat print: the paper, and a lighter inset (a title band and a picture) so it reads as a poster, not a coloured tile."""
    (cx, cy, cz), (sx, sy, sz) = it["c"], it["s"]
    box(it["id"], (cx, cy, cz), (sx, sy, sz), m[it["m"]], bevel=0.002)
    wall_x = sx < sy and sx < sz            # on an east/west wall (thin in x), else on a north/south wall (thin in y)
    off = 0.006 * (1 if (cx < 0 if wall_x else cy < 0.1) else -1)
    if wall_x:
        box(it["id"] + "_band", (cx + off, cy, cz - sz * 0.30), (sx, sy * 0.8, sz * 0.28), m["poster_ink"], bevel=0.001)
        box(it["id"] + "_title", (cx + off, cy, cz + sz * 0.38), (sx, sy * 0.7, sz * 0.10), m["poster_ink"], bevel=0.001)
    else:
        box(it["id"] + "_band", (cx, cy + off, cz - sz * 0.30), (sx * 0.8, sy, sz * 0.28), m["poster_ink"], bevel=0.001)
        box(it["id"] + "_title", (cx, cy + off, cz + sz * 0.38), (sx * 0.7, sy, sz * 0.10), m["poster_ink"], bevel=0.001)


def mangawall(it, m):
    """Rows of spines on the wall: three stacked slabs of the books texture."""
    (cx, cy, cz), (sx, sy, sz) = it["c"], it["s"]
    for r in range(3):
        box(f"{it['id']}_row{r}", (cx, cy, cz - sz / 2 + sz * (r + 0.5) / 3), (sx, sy, sz / 3 - 0.012), m["books"], bevel=0.002, uv_size=0.5)
        box(f"{it['id']}_shelf{r}", (cx, cy + 0.01, cz - sz / 2 + sz * r / 3), (sx + 0.02, sy + 0.02, 0.012), MT.OAK)


def plush(it, m):
    (cx, cy, cz), (sx, sy, sz) = it["c"], it["s"]
    base = cz - sz / 2
    sphere(it["id"] + "_body", (cx, cy, base + sz * 0.34), 1.0, m[it["m"]], scale=(sx * 0.46, sy * 0.46, sz * 0.34))
    sphere(it["id"] + "_head", (cx, cy - sy * 0.12, base + sz * 0.74), 1.0, m[it["m"]], scale=(sx * 0.36, sy * 0.34, sz * 0.26))
    for k in (-1, 1):
        sphere(f"{it['id']}_ear{k}", (cx + k * sx * 0.24, cy - sy * 0.12, base + sz * 0.94), 1.0, m[it["m"]], scale=(sx * 0.10, sy * 0.08, sz * 0.10))
        sphere(f"{it['id']}_eye{k}", (cx + k * sx * 0.12, cy - sy * 0.40, base + sz * 0.78), 0.012, m["plush_eye"], seg=8)


def stack(it, m):
    (cx, cy, cz), (sx, sy, sz) = it["c"], it["s"]
    rnd = random.Random(hash(it["id"]) & 0xFFFF)
    n = max(3, int(sz / 0.028))
    for k in range(n):
        box(f"{it['id']}_{k}", (cx + rnd.uniform(-0.012, 0.012), cy + rnd.uniform(-0.012, 0.012), cz - sz / 2 + (k + 0.5) * sz / n),
            (sx, sy, sz / n - 0.002), m["books"], bevel=0.002, rot=(0, 0, rnd.uniform(-0.12, 0.12)), uv_size=0.5)


def cup(it, m):
    (cx, cy, cz), (sx, sy, sz) = it["c"], it["s"]
    cyl(it["id"], (cx, cy, cz), sx / 2, sz, m["cup"], r2=sx * 0.34, verts=20)
    cyl(it["id"] + "_band", (cx, cy, cz + sz * 0.05), sx / 2 * 0.93, sz * 0.22, m["cup_band"], r2=sx * 0.42, verts=20)
    cyl(it["id"] + "_lid", (cx, cy, cz + sz / 2 + 0.003), sx / 2 + 0.004, 0.006, m["cup"], verts=20)


def can(it, m):
    (cx, cy, cz), (sx, sy, sz) = it["c"], it["s"]
    cyl(it["id"], (cx, cy, cz), sx / 2, sz, m[it["m"]], verts=20)
    cyl(it["id"] + "_top", (cx, cy, cz + sz / 2), sx / 2 * 0.9, 0.004, MT.IRON, verts=20)


def sock(it, m):
    (cx, cy, cz), (sx, sy, sz) = it["c"], it["s"]
    sphere(it["id"] + "_leg", (cx + sx * 0.12, cy, cz), 1.0, m[it["m"]], scale=(sx * 0.34, sy * 0.46, sz * 0.5), rot=(0, 0, 0.3))
    sphere(it["id"] + "_foot", (cx - sx * 0.20, cy - sy * 0.18, cz), 1.0, m[it["m"]], scale=(sx * 0.28, sy * 0.40, sz * 0.5), rot=(0, 0, -0.5))


def capsule(it, m):
    (cx, cy, cz), (sx, _, _) = it["c"], it["s"]
    sphere(it["id"], (cx, cy, cz), sx / 2, m[it["m"]], seg=14)


def cable(it, m):
    z = it["c"][2]
    pts = [Vector((x, y, z)) for x, y in it["path"]]
    tube(it["id"], C.catmull(pts, 8), [0.005] * len(C.catmull(pts, 8)), m["cable"], res=4)


BUILDERS = {"poster": poster, "mangawall": mangawall, "plush": plush, "stack": stack, "cup": cup, "can": can, "sock": sock,
            "capsule": capsule, "cable": cable}


def build(M):
    global MT
    MT = M
    m = materials(M)
    for it in LAYOUT["items"]:
        BUILDERS[it["kind"]](it, m)
```
(Helper signatures — `box(name, c, s, material, bevel, rot, uv_size)`, `cyl(name, c, r, d, material, rot, verts, r2, smooth, uv_size)`, `sphere(name, c, r, material, scale, seg, rot, uv_size)`, `tube(name, pts, radii, material, res, cyclic, res_u)`, `catmull(pts, n_per)` — are in `flat/common.py`; read it first and fix any argument that does not match. `box`'s `s` is the full size. `MAT.pbr` creates a material each call: call `materials()` once.)

- [ ] **Step 4: Wire the build.** In `build_the_flat.py` change `from flat import bath, giger, hall, imac, props, shell` to include `clutter`, and after `hall.build(M)` add:

```python
    if STAGE == "early":
        clutter.build(M)     # the lived-in early stage (spec 2026-10-21); the late Flat is as it was
```
In `props.py`'s docstring replace "No clutter (plushies, posters, food, socks, gashapon): a later pass." with "The early stage's clutter (plushies, posters, food, socks, gashapon) is flat/clutter.py."

- [ ] **Step 5: Rebuild the early art** (heavy: Blender headless, `nice -n 10`, one at a time): `FLAT_STAGE=early nice -n 10 blender --background --factory-startup --python scripts/levels/build_the_flat.py`, then the export step exactly as `build_the_flat.py`'s header documents (it names the `export_level.py` invocation and the output paths). Expected: no Python error; `public/assets/levels/flat-early.art.glb` changes; `flat-early.level.json` is **unchanged** (no colliders: confirm `git diff --stat public/assets/levels/flat-early.level.json` is empty; if it differs only by float noise, restore it with `git checkout`). The late `flat.*` files must not change (`git status` shows none).
- [ ] **Step 6:** `npx vitest run src/lab/sdf-zombie/webgpu/flat-clutter.test.ts src/lab/sdf-zombie/webgpu/level-json.flat-early.test.ts` (Expected PASS); `npm run typecheck`. Commit (path-only: the json, the test, clutter.py, build_the_flat.py, props.py, the `.art.glb`, the `.blend` if changed): `feat(flat): the early Flat's clutter: posters, plushies, manga, noodle cups, socks, gashapon (flat-early only)`.

---

### Task 7: the headless checks (one Chrome at a time, 320 x 240)

**Files:** create `scripts/night-train-to-flat-check.sh`, `scripts/night-train-to-flat-check.mjs`; modify `scripts/flat-emergence-check.mjs`, `package.json`.

- [ ] **Step 1: The Train side.** `night-train-to-flat-check.sh` is `flat-emergence-check.sh` with its ports `LAB_VITE_PORT` 5247, `LAB_CDP_PORT` 9247, `OUT` default `$LAB_TMP/night-train-to-flat` and the final line `node scripts/night-train-to-flat-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$OUT"` (copy the file and edit those). `night-train-to-flat-check.mjs` copies the plumbing of `scripts/flat-emergence-check.mjs` (the CDP client, the problem watch, `fail`/`pass`, the watchdog) and then:

```js
// 1. boot the Night Train (the level's rooms are long: 320 x 240 keeps it light) and wait for the warm gate.
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=night-train&res=320` });
// ...the same warm-gate wait as flat-emergence-check.mjs...
// 2. a recorder in place of location.assign, a clean slate in storage, then the ending.
await evaluate(`(() => { window.__nav = []; __sdfGame.setBridgeNavigate(u => window.__nav.push(u)); sessionStorage.removeItem('blud.crtPicture'); return 1; })()`);
if (!(await evaluate(`__sdfGame.startSequence('ending')`))) fail('the ending sequence did not start');
// 3. the pull (4 s) and the card (2 s) run in real time; then the bridge holds 2.5 s and "navigates".
let br = null;
for (let i = 0; i < 80 && !(br && br.navigated); i++) { await sleep(250); br = await evaluate('__sdfGame.bridge()'); }
if (!br) fail('the bridge never started (the ending did not complete into onComplete)');
if (!br.navigated) fail(`the bridge never navigated (state ${JSON.stringify(br)})`);
pass(`the bridge ran: card "${br.text}", held ${br.holdS} s`);
// 4. the recorded URL.
const nav = await evaluate('window.__nav');
if (nav.length !== 1) fail(`expected one navigation, got ${JSON.stringify(nav)}`);
const u = new URL(nav[0], 'http://x');
const got = Object.fromEntries(u.searchParams);
const want = { level: 'flat-early', emergence: '1', from: 'night-train', res: '320' };
if (u.pathname !== '/sdf-game.html' || JSON.stringify(got) !== JSON.stringify(want)) fail(`the hop went to ${nav[0]}, wanted ${JSON.stringify(want)}`);
pass(`the hop: ${nav[0]}`);
// 5. the stored picture: a PNG data URL, 512 x 384, not a flat colour.
const cap = await evaluate('__sdfGame.crtCapture()');
if (!cap || !cap.ok) fail(`the capture did not save: ${JSON.stringify(cap)}`);
const pic = await evaluate(`(async () => {
  const url = sessionStorage.getItem('blud.crtPicture');
  if (!url || !url.startsWith('data:image/png;base64,')) return { ok: false, why: 'no PNG data URL in storage' };
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let s = 0, s2 = 0; const n = d.length / 4;
  for (let i = 0; i < n; i++) { const y = 0.2126 * d[i*4] + 0.7152 * d[i*4+1] + 0.0722 * d[i*4+2]; s += y; s2 += y * y; }
  const mean = s / n;
  return { ok: true, w: img.width, h: img.height, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), chars: url.length };
})()`);
if (!pic.ok) fail(pic.why);
if (pic.w !== 512 || pic.h !== 384) fail(`the stored picture is ${pic.w} x ${pic.h}, wanted 512 x 384`);
if (pic.sd < 2) fail(`the stored picture is blank (luma sd ${pic.sd.toFixed(2)})`);
pass(`the stored picture: ${pic.w} x ${pic.h}, luma sd ${pic.sd.toFixed(1)}, ${pic.chars} chars`);
// 6. console clean, save the picture next to the report.
```
Finish with the same problem check as the Flat script, write the decoded picture to `OUT/crt-picture.png` (`Buffer.from(base64, 'base64')`), and print `PASS night-train-to-flat check`. Add `"night-train-to-flat:check": "bash scripts/night-train-to-flat-check.sh"` to `package.json` after `flat-emergence:check`.

- [ ] **Step 2: The Flat side.** In `scripts/flat-emergence-check.mjs`, after the hand-off assertions and before the cost note, add a second leg (the same tab, so `sessionStorage` carries): seed a known picture, boot `from=night-train`, assert:

```js
// 4b. THE ARRIVAL FROM THE NIGHT TRAIN: seed a known picture, boot the Flat as the hop does, check the entry.
await evaluate(`(() => { const c = document.createElement('canvas'); c.width = 512; c.height = 384; const g = c.getContext('2d');
  g.fillStyle = '#d0208a'; g.fillRect(0, 0, 512, 384); g.fillStyle = '#ffffff'; g.fillRect(64, 64, 128, 96);
  sessionStorage.setItem('blud.crtPicture', c.toDataURL('image/png')); return 1; })()`);
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=flat-early&emergence=1&from=night-train&res=320` });
phase = null;
for (let i = 0; i < 1100 && phase !== 'ready'; i++) { await sleep(500); phase = await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null); if (phase && phase !== 'ready') break; }
if (phase !== 'ready') fail(`the warm gate did not reach ready on the train arrival (phase ${phase})`);
let arr = null;
for (let i = 0; i < 40; i++) { arr = await evaluate('__sdfGame.emergence()'); if (arr && arr.phase === 'playing') break; await sleep(250); }
if (!arr || arr.phase !== 'playing') fail('the emergence did not autostart on the train arrival');
if (arr.picture !== 'night-train') fail(`the CRT took the ${arr.picture}, not the stored picture`);
if (await evaluate("sessionStorage.getItem('blud.crtPicture')")) fail('the stored picture was not cleared after it was taken');
if (arr.overlayAlpha === null || arr.overlayAlpha < 0.5) fail(`the sequence did not open from black (overlay alpha ${arr.overlayAlpha})`);
await sleep(1500);
arr = await evaluate('__sdfGame.emergence()');
if (arr.overlayAlpha > 0.05) fail(`the black did not clear (overlay alpha ${arr.overlayAlpha} at ${arr.t} s)`);
pass('arrival from the Night Train: autostarted, the stored picture taken and cleared, opened from black and cleared');
```
(The first leg's `phase` variable and helpers are in scope; if the leg-1 hand-off left the page in `done`, the navigate resets it.) Also take the settle sheet frame from leg 1 as today; no change.

- [ ] **Step 3: Run them, one at a time:** `nice -n 10 npm run night-train-to-flat:check` (Expected: PASS; the first Night Train boot may take minutes on a cold shader cache; if the capture is blank, STOP and report) and `nice -n 10 npm run flat-emergence:check` (Expected: PASS, the new clutter visible in `.lab-tmp/flat-emergence/sheet.jpg`; open the sheet and look: the room reads lived-in and nothing blocks the shots).
- [ ] **Step 4:** Commit (path-only): `feat(bridge): headless checks for the Night Train hop and the Flat arrival`.

---

### Task 8: notes, wiki, PR

- [ ] Take one frame-cost read of the Flat with the clutter: `nice -n 10 node scripts/flat-frame-cost.mjs` (read its header for its ports and arguments; own ports, one Chrome; record the numbers, not gated). If it needs the late Flat only, record that and skip.
- [ ] `docs/dev-notes/2026-10-21-night-train-to-flat/NOTES.md`: what was built (the table), how to try it (`?level=night-train&res=320`, then walk to the egg, or `__sdfGame.startSequence('ending')`; `?level=flat-early&emergence=1&from=night-train` directly with a stored picture; the seams `bridge()`, `setBridgeNavigate`, `crtCapture()`), the sheet from Task 7 (JPEG under 1 MB, copy `.lab-tmp/flat-emergence/sheet.jpg`), the cost read, known issues, and the owner's questions (the bridge card's text and hold; the pause on a cold cache; the movie slot). `TASKS.md` and `docs/tasks/levels.md`: the entry (built, owner look pending, links). The spec's status line: built, owner look pending; and fix its two stale lines: `Branch ... stacked on #51` becomes "on `main` (#51 merged)", and §3.2/§6's readback fallback becomes "if the capture is blank the check fails and the design is revisited". Regenerate the module index: `npx tsx scripts/module-index.ts` (new modules need a header sentence; the guard test fails without one).
- [ ] `npm run typecheck && npm run test:changed -- origin/main`. Push; open the PR (`gh pr create --repo goblincore/blud --base main`), body: what it is, how to try it, the load notes (heavy: the art rebuild, two headless boots), the owner questions, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Then `mcp__ccd_pr__get_status` (and `bind_pr` if it reports no PR); read CI through it, never poll.
