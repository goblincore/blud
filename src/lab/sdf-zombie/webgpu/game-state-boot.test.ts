// src/lab/sdf-zombie/webgpu/game-state-boot.test.ts
//
// The boot slice is a bag of mutable fields, so there is little logic to test.
// What matters is the contract the codemod leans on: the factory hands out
// private objects (no shared nested arrays or objects), the literal boot
// defaults are what game-main.ts declares, and every old binding name resolves
// to a field that actually exists on the state.

import { describe, expect, it } from 'vitest';
import { BOOT_BINDINGS, makeBootState } from './game-state-boot';

describe('makeBootState', () => {
  it('gives each call its own object', () => {
    expect(makeBootState()).not.toBe(makeBootState());
  });

  it('gives each call its own nested arrays and objects', () => {
    const a = makeBootState();
    const b = makeBootState();
    expect(a.marks).not.toBe(b.marks);
    expect(a.errors).not.toBe(b.errors);
    expect(a.hud).not.toBe(b.hud);
    expect(a.search).not.toBe(b.search);
    expect(a.seedSearch).not.toBe(b.seedSearch);
  });

  it('starts at the declared defaults', () => {
    const s = makeBootState();
    // Literal initializers in game-main.ts: bootMarks = [], drawReady = false,
    // onSeverDispatch = null, errors = [], nextId = 1,
    // nextEmitterStream = 1, hud = { lockHint: true }, frameEma = 0.
    expect(s.marks).toEqual([]);
    expect(s.drawReady).toBe(false);
    expect(s.onSeverDispatch).toBeNull();
    expect(s.errors).toEqual([]);
    expect(s.nextId).toBe(1);
    expect(s.nextEmitterStream).toBe(1);
    expect(s.hud.lockHint).toBe(true);
    expect(s.frameEma).toBe(0);
  });
});

describe('BOOT_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeBootState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(BOOT_BINDINGS)) {
      expect(path.startsWith('boot.'), `${oldName} must map into the boot slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('boot.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(BOOT_BINDINGS)).toHaveLength(43); // +onGoreDispatch (head pop, 2026-09-24)
  });
});
