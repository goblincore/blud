// src/lab/sdf-zombie/webgpu/game-state-demo.test.ts
//
// The demo slice is a plain bag of fields, so what is worth testing is that it
// is a FRESH bag every time (no shared mutable state between callers) and that
// the binding map covers exactly the bindings it claims to.

import { describe, expect, it } from 'vitest';
import { DEMO_BINDINGS, makeDemoState } from './game-state-demo';

describe('makeDemoState', () => {
  it('gives each call its own object', () => {
    expect(makeDemoState()).not.toBe(makeDemoState());
  });

  it('starts at the declared defaults', () => {
    const s = makeDemoState();
    // Literal initializers in game-main.ts: simFrame = 0, demoHold = false,
    // demoSeedBase = 0, frameCount = 0 and the nullable recorder/hudEl.
    expect(s.simFrame).toBe(0);
    expect(s.hold).toBe(false);
    expect(s.seedBase).toBe(0);
  });

  it('is not a frozen or accessor-backed object', () => {
    const s = makeDemoState();
    s.frameCount = 7;
    expect(s.frameCount).toBe(7);
    const desc = Object.getOwnPropertyDescriptor(s, 'frameCount');
    expect(desc?.value).toBe(7);
    expect(desc?.get).toBeUndefined();
  });

  it('gives each call its own mutable fields', () => {
    const a = makeDemoState();
    const b = makeDemoState();
    a.frameCount = 3;
    a.recorder = null;
    expect(b.frameCount).toBe(0);
  });
});

describe('DEMO_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeDemoState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(DEMO_BINDINGS)) {
      expect(path.startsWith('demo.'), `${oldName} must map into the demo slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('demo.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(DEMO_BINDINGS)).toHaveLength(11);
  });
});
