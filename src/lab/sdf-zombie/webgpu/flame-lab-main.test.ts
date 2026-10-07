// @vitest-environment happy-dom
// Importing the module runs its bootstrap, which bails before createLabRenderer
// because the test DOM has no #app, so what this proves is that the imports
// resolve, the syntax is valid, and the page shows the two bodies the spec names.
// (The source-text pins that used to follow were removed in the 2026-10-07 text-pin audit.)
import { describe, it, expect } from 'vitest';
import { FLAME_LAB_BODIES } from './flame-lab-main';

describe('flame lab page', () => {
  it('shows a zombie and a soldier, the two characters the spec names', () => {
    expect(FLAME_LAB_BODIES.map(b => b.name)).toEqual(['zombie', 'soldier']);
    expect(new Set(FLAME_LAB_BODIES.map(b => b.x)).size).toBe(2);
  });
});
