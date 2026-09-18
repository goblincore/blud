// scripts/slice-extract.test.ts
//
// The binding inventory for the game-main.ts decomposition is GENERATED, not
// hand-typed, so that it cannot go stale as the file grows. These tests pin the
// two properties that matter: only the immediate main() body scope is reported,
// and a shadowed inner declaration never masquerades as an outer one.

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

  it('routes a panel handle to panels, not to its feature slice', () => {
    expect(sliceFor('dynamitePanel')).toBe('panels');
    expect(sliceFor('gooPanel')).toBe('panels');
  });

  it('routes entity storage to world rather than a resource slice', () => {
    expect(sliceFor('actors')).toBe('world');
    expect(sliceFor('colliders')).toBe('world');
  });

  it('returns null for a name no rule claims, so it must be curated by hand', () => {
    expect(sliceFor('somethingNobodyNamedYet')).toBeNull();
  });
});
