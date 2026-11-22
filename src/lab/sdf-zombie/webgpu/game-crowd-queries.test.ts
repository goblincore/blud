// src/lab/sdf-zombie/webgpu/game-crowd-queries.test.ts
import { describe, expect, it } from 'vitest';
import type { GameContext } from './game-context';
import { boneExposedActors } from './game-crowd-queries';

const body = (o: { glow?: number; char?: number; zapping?: boolean; melting?: boolean; wounds?: { decal?: boolean }[] } = {}) => ({
  melting: () => !!o.melting,
  zapping: () => !!o.zapping,
  zapLook: () => (o.zapping || o.char ? { glow: o.glow ?? 0, invert: false, char: o.char ?? 0 } : null),
  visualWounds: () => o.wounds ?? [],
});
const exposed = (actors: ReturnType<typeof body>[], bareSkeleton = false) => {
  const ctx = { render: { visualActors: actors, bareSkeleton, skeletonSources: new Map() } } as unknown as GameContext;
  return boneExposedActors(ctx, ctx);
};

describe('boneExposedActors: the bodies whose bone can show', () => {
  it('an intact body draws no skeleton; a carving wound, a melt and the bare-skeleton view expose it', () => {
    const intact = body(), decal = body({ wounds: [{ decal: true }] }), wounded = body({ wounds: [{}] }), melting = body({ melting: true });
    const set = exposed([intact, decal, wounded, melting]);
    expect([intact, decal, wounded, melting].map(a => set.has(a))).toEqual([false, false, true, true]);
    expect(exposed([intact], true).has(intact)).toBe(true);
  });
  it('a body glowing under the arc is exposed (the x-ray needs its bones in the batches); the statue and the charred corpse are not', () => {
    const glowing = body({ zapping: true, glow: 0.7 }), jolt = body({ zapping: true, glow: 0.56, char: 0.8 });
    const statue = body({ zapping: true, glow: 0, char: 1 }), corpse = body({ char: 1 });
    const set = exposed([glowing, jolt, statue, corpse]);
    expect([glowing, jolt, statue, corpse].map(a => set.has(a))).toEqual([true, true, false, false]);
  });
});
