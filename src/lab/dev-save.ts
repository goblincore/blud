// src/lab/dev-save.ts
//
// DEV-ONLY save handlers behind the lab's "save face" / "save skin" buttons.
// Pure functions of (project root, character name, payload): the Vite
// plugin in vite.config.ts is a thin adapter, and these are what the tests
// exercise. They write ONLY under the project root, ONLY for a character
// that exists, and the result is an ordinary git diff — no history here,
// that is git's job.
// @ts-expect-error — node:fs available in vite/vitest; the app tsconfig is vite/client-only
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-expect-error — node:path available in vite/vitest; the app tsconfig is vite/client-only
import { join } from 'node:path';
import { parseBlob } from './sdf-zombie/blob-parse';
import { emitBlob } from './sdf-zombie/blob-emit';
import { compileSheetImage } from './sdf-zombie/blob-compile';
import { MATERIAL_SLIDERS } from './sdf-zombie/panel';

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

/** Saves skin color and the material section's sliders, preserving other authored fields. */
export function savePalette(root: string, name: string, payload: unknown): SaveResult {
  const b = loadBlob(root, name);
  if ('error' in b) return { ok: false, error: b.error };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return { ok: false, error: 'expected a skin/material object' };
  const values = payload as Record<string, unknown>;
  const c = values.baseColor;
  if (!Array.isArray(c) || c.length !== 3 || !c.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1))
    return { ok: false, error: 'baseColor must be three numbers in 0..1' };
  const palette: Record<string, number[]> = { baseColor: c.map(v => Math.round(v * 1000) / 1000) };
  for (const [key, value] of Object.entries(values)) {
    if (key === 'baseColor') continue;
    const slider = MATERIAL_SLIDERS.find(s => s.key === key);
    if (!slider) return { ok: false, error: `unknown material setting: ${key}` };
    if (typeof value !== 'number' || !Number.isFinite(value) || value < slider.min || value > slider.max)
      return { ok: false, error: `${key} must be a number in ${slider.min}..${slider.max}` };
    palette[key] = [value];
  }
  let out: string;
  try {
    out = emitBlob(parseBlob(b.src), { palette });
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const rel = blobPath(name);
  writeFileSync(join(root, rel), out);
  return { ok: true, path: rel };
}
