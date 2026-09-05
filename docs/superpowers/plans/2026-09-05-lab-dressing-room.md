# Lab Dressing Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the WebGPU lab, upload a face image and pick a skin tone, see both live, and save both into the repo (the face PNG and the `.blob` palette line) through a dev-only Vite endpoint.

**Architecture:** `blob-emit.ts` learns a `palette` override (value-span splice, like the face override). `src/lab/dev-save.ts` holds two pure handlers, `saveFace` and `savePalette`, tested against a temp dir; `vite.config.ts` mounts them as `serve`-only middleware. `lab-main.ts` adds an upload control to the face section and a colour picker + lightness slider to the material section, each with a save button that POSTs to the endpoint.

**Tech Stack:** TypeScript, vitest (happy-dom env for `src/**`; handler tests use `node:fs` and `os.tmpdir()`), Vite plugin API, three.js WebGPU.

**Spec:** [docs/superpowers/specs/2026-09-05-lab-dressing-room-design.md](../specs/2026-09-05-lab-dressing-room-design.md)

**Conventions:** run tests with `npx vitest run <file>`; typecheck `npx tsc --noEmit`; commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never use bare `git stash`. `blob-emit.test.ts` round-trips every shipped `.blob` byte-for-byte — it must stay green.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/blob-emit.ts` (modify) | `EmitOverride.palette`, `splicePaletteValues`. |
| `src/lab/dev-save.ts` (new, pure) | `isCharacterName`, `saveFace(root, name, bytes)`, `savePalette(root, name, override)`. |
| `src/lab/dev-save.test.ts` (new) | Handler tests against a temp copy of the soldier. |
| `vite.config.ts` (modify) | `labDevSave()` plugin, `apply: 'serve'`. |
| `src/lab/sdf-zombie/webgpu/lab-main.ts` (modify) | Upload/save-face controls; skin colour + lightness + save-skin controls. |

---

### Task 1: `emitBlob` palette override

**Files:**
- Modify: `src/lab/sdf-zombie/blob-emit.ts`
- Test: `src/lab/sdf-zombie/blob-emit.test.ts` (append)

- [ ] **Step 1: Failing test** (append; the file already imports `parseBlob`, `emitBlob` and the shipped blob sources — reuse `soldierSrc` or add `import soldierSrc from './characters/soldier.blob?raw'`)

```ts
describe('palette override', () => {
  it('splices only the baseColor value span; every other byte survives', () => {
    const doc = parseBlob(soldierSrc);
    const out = emitBlob(doc, { palette: { baseColor: [0.5, 0.25, 0.125] } });
    const before = soldierSrc.split('\n'), after = out.split('\n');
    expect(after.length).toBe(before.length);
    const changed = before.map((l, i) => [l, after[i]!] as const).filter(([a, b]) => a !== b);
    expect(changed.length).toBe(1);
    expect(changed[0]![0]).toMatch(/^\s*baseColor\s/);
    expect(changed[0]![1]).toMatch(/^\s*baseColor\s+0\.5 0\.25 0\.125\s*$/);
    // Re-parses to the new colour.
    expect(parseBlob(out).palette!.baseColor).toEqual([0.5, 0.25, 0.125]);
  });
  it('an override for a character with no palette block throws loudly', () => {
    expect(() => emitBlob(parseBlob(zombieSrc), { palette: { baseColor: [1, 1, 1] } }))
      .toThrow(/no palette block/);
  });
  it('a wrong arity throws', () => {
    expect(() => emitBlob(parseBlob(soldierSrc), { palette: { baseColor: [1, 1] } })).toThrow(/3 values/);
  });
});
```

Confirm `zombie.blob` has no `palette` block (`grep -n '^palette' src/lab/sdf-zombie/characters/zombie.blob` prints nothing); if it does, pick another shipped blob that lacks one.

- [ ] **Step 2: Run** `npx vitest run src/lab/sdf-zombie/blob-emit.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
export interface EmitOverride {
  /** Face parameters to substitute, by name. Omitted keys keep their source line. */
  face?: Record<string, number>;
  /** Palette parameters to substitute, by name — 1 or 3 numbers, matching the
   *  line's own arity. Omitted keys keep their source line. */
  palette?: Record<string, number[]>;
}

interface Owned {
  l: BlobLine;
  faceKey?: string;
  paletteKey?: string;
}

/** Splices every numeric word of a palette line in place, left to right,
 *  keeping indent, padding and any trailing comment. */
function splicePaletteValues(l: BlobLine, values: number[]): string {
  const words = l.words.slice(1);
  if (words.length !== values.length) {
    throw new Error(
      `blob-emit: palette line ${l.line} "${l.words[0]}" has ${words.length} values, override has ${values.length}; ` +
        `an override must carry ${words.length === 1 ? '1 value' : '3 values'}`,
    );
  }
  let raw = l.raw;
  let cursor = l.indent + (l.words[0]?.length ?? 0);
  for (let i = 0; i < words.length; i++) {
    const at = raw.indexOf(words[i]!, cursor);
    if (at === -1) throw new Error(`blob-emit: palette line ${l.line} — could not find "${words[i]}" in "${l.raw}"`);
    const rep = String(values[i]);
    raw = raw.slice(0, at) + rep + raw.slice(at + words[i]!.length);
    cursor = at + rep.length;
  }
  return raw;
}
```

In `emitBlob`: map `doc.paletteTrivia` to `({ l, paletteKey: l.words[0] })`; before the loop, if `override.palette` is given and `doc.palette === null` throw `new Error('blob-emit: palette override for a character with no palette block — declare one first')`; in the loop, `if (paletteKey !== undefined && override.palette?.[paletteKey]) out.push(splicePaletteValues(l, override.palette[paletteKey]!))` before the face branch. Keep the face branch byte-identical.

- [ ] **Step 4: Run** `npx vitest run src/lab/sdf-zombie/blob-emit.test.ts && npx tsc --noEmit` → PASS (including the existing byte-for-byte round trip).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/blob-emit.ts src/lab/sdf-zombie/blob-emit.test.ts
git commit -m "blob-emit: palette override — splice baseColor (or any palette line) in place

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: the dev save handlers and the Vite plugin

**Files:**
- Create: `src/lab/dev-save.ts`, `src/lab/dev-save.test.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Failing test**

```ts
// src/lab/dev-save.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isCharacterName, saveFace, savePalette } from './dev-save';

const SOLDIER = readFileSync('src/lab/sdf-zombie/characters/soldier.blob', 'utf8');
let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'blud-dev-save-'));
  mkdirSync(join(root, 'src/lab/sdf-zombie/characters'), { recursive: true });
  mkdirSync(join(root, 'public/assets/lab/faces'), { recursive: true });
  writeFileSync(join(root, 'src/lab/sdf-zombie/characters/soldier.blob'), SOLDIER);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('dev-save', () => {
  it('validates names', () => {
    expect(isCharacterName('soldier')).toBe(true);
    expect(isCharacterName('schoolgirl-alt')).toBe(true);
    expect(isCharacterName('../etc')).toBe(false);
    expect(isCharacterName('Soldier')).toBe(false);
    expect(isCharacterName('')).toBe(false);
  });
  it('saveFace writes the sheet-declared PNG name under public/assets/lab/faces', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const r = saveFace(root, 'soldier', png);
    expect(r.ok).toBe(true);
    expect(r.path).toBe('public/assets/lab/faces/soldier-face.png');
    expect(readFileSync(join(root, r.path!))).toEqual(Buffer.from(png));
  });
  it('saveFace refuses unknown characters and bad names', () => {
    expect(saveFace(root, 'nobody', new Uint8Array(4)).ok).toBe(false);
    expect(saveFace(root, '../x', new Uint8Array(4)).ok).toBe(false);
    expect(existsSync(join(root, 'public/assets/lab/faces/nobody-face.png'))).toBe(false);
  });
  it('saveFace refuses non-PNG bytes', () => {
    const r = saveFace(root, 'soldier', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PNG/);
  });
  it('savePalette rewrites baseColor and nothing else', () => {
    const r = savePalette(root, 'soldier', { baseColor: [0.4, 0.3, 0.2] });
    expect(r.ok).toBe(true);
    const after = readFileSync(join(root, 'src/lab/sdf-zombie/characters/soldier.blob'), 'utf8');
    const diff = SOLDIER.split('\n').filter((l, i) => l !== after.split('\n')[i]);
    expect(diff.length).toBe(1);
    expect(after).toMatch(/baseColor\s+0\.4 0\.3 0\.2/);
  });
  it('savePalette rejects bad payloads', () => {
    expect(savePalette(root, 'soldier', { baseColor: [1, 2] } as never).ok).toBe(false);
    expect(savePalette(root, 'soldier', { baseColor: ['a', 'b', 'c'] } as never).ok).toBe(false);
    expect(savePalette(root, 'soldier', { deepColor: [0, 0, 0] } as never).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lab/dev-save.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the handlers**

```ts
// src/lab/dev-save.ts
//
// DEV-ONLY save handlers behind the lab's "save face" / "save skin" buttons.
// Pure functions of (project root, character name, payload): the Vite
// plugin in vite.config.ts is a thin adapter, and these are what the tests
// exercise. They write ONLY under the project root, ONLY for a character
// that exists, and the result is an ordinary git diff — no history here,
// that is git's job.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBlob } from './sdf-zombie/blob-parse';
import { emitBlob } from './sdf-zombie/blob-emit';
import { compileSheetImage } from './sdf-zombie/blob-compile';

export interface SaveResult { ok: boolean; path?: string; error?: string }

export function isCharacterName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

function blobPath(name: string): string {
  return `src/lab/sdf-zombie/characters/${name}.blob`;
}

function loadBlob(root: string, name: string): { src: string } | { error: string } {
  if (!isCharacterName(name)) return { error: `bad character name "${name}"` };
  const p = join(root, blobPath(name));
  if (!existsSync(p)) return { error: `no such character: ${blobPath(name)}` };
  return { src: readFileSync(p, 'utf8') };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

/** Writes the PNG the character's `sheet image` line names (default
 *  `<name>-face.png`) under public/assets/lab/faces/. */
export function saveFace(root: string, name: string, bytes: Uint8Array): SaveResult {
  const b = loadBlob(root, name);
  if ('error' in b) return { ok: false, error: b.error };
  if (bytes.length < 8 || PNG_MAGIC.some((v, i) => bytes[i] !== v)) return { ok: false, error: 'not a PNG (magic bytes)' };
  let image: string | null = null;
  try { image = compileSheetImage(parseBlob(b.src)); } catch (e) { return { ok: false, error: String(e) }; }
  const file = image ?? `${name}-face.png`;
  if (!/^[a-z0-9-]+\.png$/.test(file)) return { ok: false, error: `sheet image "${file}" is not a plain png name` };
  const rel = `public/assets/lab/faces/${file}`;
  writeFileSync(join(root, rel), bytes);
  return { ok: true, path: rel };
}

/** Rewrites the character's `palette` baseColor line in place. */
export function savePalette(root: string, name: string, payload: { baseColor: number[] }): SaveResult {
  const b = loadBlob(root, name);
  if ('error' in b) return { ok: false, error: b.error };
  const c = (payload as { baseColor?: unknown }).baseColor;
  if (!Array.isArray(c) || c.length !== 3 || !c.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1))
    return { ok: false, error: 'baseColor must be three numbers in 0..1' };
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'baseColor') return { ok: false, error: 'only baseColor can be saved' };
  let out: string;
  try {
    out = emitBlob(parseBlob(b.src), { palette: { baseColor: c.map(v => Math.round(v * 1000) / 1000) } });
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const rel = blobPath(name);
  writeFileSync(join(root, rel), out);
  return { ok: true, path: rel };
}
```

`compileSheetImage` and `compileSheet` live in `blob-compile.ts` (lab-main imports both from there).

- [ ] **Step 4: The Vite plugin** — in `vite.config.ts`:

```ts
import type { Plugin } from 'vite';
import { saveFace, savePalette } from './src/lab/dev-save';

/** DEV-ONLY: the lab's save endpoints. Never part of a build. */
function labDevSave(): Plugin {
  return {
    name: 'blud-lab-dev-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/__lab/save-')) return next();
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const name = url.searchParams.get('character') ?? '';
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          let result;
          if (url.pathname === '/__lab/save-face') result = saveFace(server.config.root, name, new Uint8Array(body));
          else if (url.pathname === '/__lab/save-palette') {
            try { result = savePalette(server.config.root, name, JSON.parse(body.toString('utf8'))); }
            catch (e) { result = { ok: false, error: `bad JSON: ${String(e)}` }; }
          } else { res.statusCode = 404; res.end(); return; }
          res.setHeader('content-type', 'application/json');
          res.statusCode = result.ok ? 200 : 400;
          res.end(JSON.stringify(result));
        });
      });
    },
  };
}
```

Add `plugins: [labDevSave()],` to `defineConfig`. Importing a TS file from `vite.config.ts` is fine (Vite bundles its config with esbuild).

- [ ] **Step 5: Run** `npx vitest run src/lab/dev-save.test.ts && npx tsc --noEmit` → PASS. Then start the dev server briefly and probe: `curl -s -X POST 'http://localhost:5173/__lab/save-palette?character=nobody' -d '{}'` → `{"ok":false,...}` with HTTP 400 (use whatever port `npx vite --port 5299` gives; kill it after).

- [ ] **Step 6: Commit**

```bash
git add src/lab/dev-save.ts src/lab/dev-save.test.ts vite.config.ts
git commit -m "lab: dev-only save endpoints — face PNG and palette baseColor written into the repo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The panel controls

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts` (the `loadGeneratedFace` image branch ~905-940, the face panel ~3276-3330, the material panel where `reapply()` and the flesh sliders live ~3086 and ~3240-3260)

- [ ] **Step 1: Extract the image-apply path** — the block in `loadGeneratedFace` that builds a `THREE.Texture` from `/assets/lab/faces/${image}` and measures its mean becomes a function usable by both:

```ts
  /** Wear an already-loaded image as the face sheet: whole-image atlas, mean
   *  measured off the pixels, decal mode as the character's sheet block says. */
  function wearFaceImage(tex: THREE.Texture, decal: boolean) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = true;
    faceSheet?.tex.dispose();
    faceSheet = { tex, atlas: new THREE.Vector4(1, 1, 0, 0), mean: 1 };
    faceMode = decal ? 2 : 1;
    for (const v of [view, ...crowd]) v.setFaceTexture(tex, faceSheet.atlas, 1);
    applyMeanOf(tex); // the existing applyMean closure, hoisted to a function that takes the texture
  }
```

Hoist the existing `applyMean` closure to a sibling function `applyMeanOf(t: THREE.Texture)` (same body). In `loadGeneratedFace`, the image branch becomes `const tex = new THREE.TextureLoader().load(url, applyMeanOf); wearFaceImage(tex, params.decal > 0.5); return true;` — keep behaviour identical (mean 1 until decode, then measured).

- [ ] **Step 2: Face upload + save** — in the face section after the `texture` select:

```ts
  let uploadedFace: Uint8Array | null = null;
  const faceFile = document.createElement('input');
  faceFile.type = 'file'; faceFile.accept = 'image/png,image/jpeg';
  faceFile.style.cssText = 'display:block;width:100%;margin:4px 0;font:11px monospace;';
  faceFile.addEventListener('change', async () => {
    const f = faceFile.files?.[0]; if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    const url = URL.createObjectURL(new Blob([buf], { type: f.type }));
    let decal = true;
    try { decal = (compileSheet(parseBlob(activeCharacterSrc()))?.decal ?? 1) > 0.5; } catch { /* keep decal */ }
    const tex = new THREE.TextureLoader().load(url, t => { applyMeanOf(t); URL.revokeObjectURL(url); });
    wearFaceImage(tex, decal);
    uploadedFace = f.type === 'image/png' ? buf : null; // save only PNGs (the endpoint checks magic bytes)
    saveFaceBtn.disabled = uploadedFace === null;
    saveFaceBtn.textContent = uploadedFace ? 'save face → repo' : 'save face (PNG only)';
  });
  faceBox.appendChild(faceFile);
  const saveFaceBtn = addButton(faceBox, 'save face (upload first)', async () => {
    if (!uploadedFace) return;
    const r = await fetch(`/__lab/save-face?character=${encodeURIComponent(activeCharacterName())}`, { method: 'POST', body: uploadedFace });
    const j = await r.json() as { ok: boolean; path?: string; error?: string };
    saveFaceBtn.textContent = j.ok ? `saved ${j.path}` : `save failed: ${j.error}`;
  });
  saveFaceBtn.disabled = true;
```

`compileSheet` is already imported in lab-main from `../blob-compile`.

- [ ] **Step 3: Skin colour + lightness + save** — in the material section, right after the flesh sliders loop (~3255):

```ts
  // Skin tone (owner, 2026-09-05). The picker speaks sRGB, the material linear.
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const hex = (rgb: readonly number[]) => '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255).toString(16).padStart(2, '0')).join('');
  let skinBase: Vec3 = [...flesh.baseColor] as Vec3;
  let skinLight = 0;
  const applySkin = () => {
    flesh.baseColor = skinBase.map(v => Math.min(1, Math.max(0, v * (1 + skinLight)))) as Vec3;
    reapply();
  };
  const skinRow = document.createElement('label');
  skinRow.style.cssText = 'display:flex;gap:6px;align-items:center;font:11px monospace;margin:4px 0;';
  skinRow.textContent = 'skin ';
  const skinPick = document.createElement('input');
  skinPick.type = 'color'; skinPick.value = hex(skinBase);
  skinPick.addEventListener('input', () => {
    const h = skinPick.value;
    skinBase = [1, 3, 5].map(i => toLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as Vec3;
    applySkin();
  });
  skinRow.appendChild(skinPick);
  materialBox.appendChild(skinRow);
  addSlider(materialBox, { label: 'skin lightness', min: -0.5, max: 0.5, step: 0.01, get: () => skinLight, set: v => { skinLight = v; applySkin(); } });
  const saveSkinBtn = addButton(materialBox, 'save skin → repo', async () => {
    const r = await fetch(`/__lab/save-palette?character=${encodeURIComponent(activeCharacterName())}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseColor: flesh.baseColor.map(v => Math.round(v * 1000) / 1000) }),
    });
    const j = await r.json() as { ok: boolean; path?: string; error?: string };
    saveSkinBtn.textContent = j.ok ? `saved ${j.path}` : `save failed: ${j.error}`;
  });
```

`materialBox` is whatever the flesh sliders' section element is called in that block (read the code; it may be `presetBox` or a sliders box). `Vec3` is imported from `../types` already.

- [ ] **Step 4: Typecheck and try it** — `npx tsc --noEmit`, then in the lab (`?character=soldier`): upload a PNG (any face PNG from `public/assets/lab/faces/` will do) → the head wears it; save → button reads `saved public/assets/lab/faces/soldier-face.png` and `git status` shows the file modified (restore it with `git checkout -- public/assets/lab/faces/soldier-face.png` afterwards unless you uploaded the same bytes). Pick a colour → body changes; save skin → `git diff src/lab/sdf-zombie/characters/soldier.blob` shows ONE changed line, `baseColor`. Restore with `git checkout --` too. If you have no browser, run `npx vite --port 5299` and drive the two endpoints with curl as in Task 2, then stop.

- [ ] **Step 5: Notes + TASKS** — append to `docs/dev-notes/2026-09-05-soldier-animation/notes.md` a `## Lab dressing room` paragraph (what the controls do, where saves land), and add one sentence to the SOLDIER ANIMATION entry in `TASKS.md`: "Lab dressing room: upload a face PNG / pick a skin tone, save both into the repo via the dev-only `/__lab/save-*` endpoints ([spec](docs/superpowers/specs/2026-09-05-lab-dressing-room-design.md))."

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/lab-main.ts docs/dev-notes/2026-09-05-soldier-animation/notes.md TASKS.md
git commit -m "lab: upload a face and pick a skin tone, save both to the repo (dressing room)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Self-review

Spec coverage: face upload live (T3 S1-2), save face to the sheet's declared file (T2 saveFace), skin picker + lightness live (T3 S3), save skin via palette override (T1 + T2 savePalette), endpoint serve-only with name validation (T2 S4), gates (T1/T2 tests, T3 S4 manual). Types: `SaveResult`, `saveFace`, `savePalette`, `isCharacterName` (T2) used by the plugin (T2) and the panel (T3 via fetch); `EmitOverride.palette` (T1) used by `savePalette` (T2).
