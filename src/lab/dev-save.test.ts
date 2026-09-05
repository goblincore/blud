import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
// @ts-expect-error — node:path available in vitest via happy-dom/node
import { join } from 'node:path';
// @ts-expect-error — node:os available in vitest via happy-dom/node
import { tmpdir } from 'node:os';
import { isCharacterName, saveFace, savePalette } from './dev-save';

const SOLDIER: string = readFileSync('src/lab/sdf-zombie/characters/soldier.blob', 'utf8');
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
    // @ts-expect-error — Buffer is a node global; untyped under the app's vite/client-only types
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
