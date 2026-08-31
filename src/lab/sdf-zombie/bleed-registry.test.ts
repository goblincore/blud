import { describe, it, expect } from 'vitest';
import { BleedRegistry, PER_BODY_EMITTER_CAP, woundEmitAnchorAndNormal } from './bleed-registry';
import type { Wound } from './damage';
import type { Primitive, Vec3 } from './types';

const capsule = (a: [number, number, number], b: [number, number, number]): Primitive =>
  ({ a, b, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'armL', cluster: 2 });

const wound = (over: Partial<Wound> = {}): Wound => ({
  primIdx: 0,
  local: [0, 0, 0],
  radius: 0.055,
  type: 'pellet',
  ageSec: 0,
  ...over,
});

describe('BleedRegistry — the game page\'s wound-emitter ledger', () => {
  it('keeps at most PER_BODY_EMITTER_CAP per body, evicting the OLDEST', () => {
    const r = new BleedRegistry();
    for (let i = 0; i < PER_BODY_EMITTER_CAP + 2; i++) {
      r.register(1, wound({ primIdx: i }), 'pellet', i);
    }
    const live = r.live(0);
    expect(live).toHaveLength(PER_BODY_EMITTER_CAP);
    // The two oldest (bornAt 0 and 1) were evicted; survivors are 2..7 in order.
    expect(live[0]!.bornAt).toBe(2);
    expect(live.at(-1)!.bornAt).toBe(PER_BODY_EMITTER_CAP + 1);
  });

  it('the cap is PER BODY — other bodies are untouched', () => {
    const r = new BleedRegistry();
    for (let i = 0; i < PER_BODY_EMITTER_CAP; i++) r.register(1, wound(), 'pellet', i);
    r.register(2, wound(), 'slug', 10);
    expect(r.live(0).filter(e => e.bodyId === 2)).toHaveLength(1);
    expect(r.live(0).filter(e => e.bodyId === 1)).toHaveLength(PER_BODY_EMITTER_CAP);
  });

  it('expired emitters (past their kind lifetime) drop out of live()', () => {
    const r = new BleedRegistry();
    r.register(1, wound(), 'pellet', 0);   // 2 s
    r.register(1, wound({ type: 'blast' }), 'slug', 0); // 6 s
    r.register(1, wound({ type: 'blast' }), 'stump', 0); // 10 s
    expect(r.live(0)).toHaveLength(3);
    expect(r.live(2.01)).toHaveLength(2);  // pellet dead
    expect(r.live(6.01)).toHaveLength(1);  // slug dead
    expect(r.live(10.01)).toHaveLength(0); // stump dead
    expect(r.size).toBe(0);                // and pruned from the ledger
  });

  it('live() hands back the SAME wound references (anchors ride the body)', () => {
    const r = new BleedRegistry();
    const w = wound();
    r.register(3, w, 'slug', 0);
    expect(r.live(0)[0]!.wound).toBe(w);
  });

  it('evictForBody clears one body\'s emitters (body removal), only theirs', () => {
    const r = new BleedRegistry();
    r.register(1, wound(), 'stump', 0);
    r.register(2, wound(), 'stump', 0);
    r.evictForBody(1);
    expect(r.live(0).map(e => e.bodyId)).toEqual([2]);
  });

  it('accumulator carry survives the round trip', () => {
    const r = new BleedRegistry();
    r.register(1, wound(), 'slug', 0);
    const e = r.live(0)[0]!;
    e.acc = 0.42;
    expect(r.live(0)[0]!.acc).toBeCloseTo(0.42, 12);
  });
});

describe('woundEmitAnchorAndNormal — where blood leaves the wound', () => {
  it('negates the carve normal when the wound carries a depth slab', () => {
    const prims = [capsule([0, 1, 0], [0, 1.4, 0])];
    // For a +Y-axis capsule the local frame is [z, x, y], so carveN
    // [0, 0, 1] transports to world +Y — INTO the flesh from a top hit.
    const w = wound({ carveN: [0, 0, 1] });
    const { anchor, normal } = woundEmitAnchorAndNormal(prims, w);
    // Anchor is the wound's world position (prim.a at local 0,0,0).
    expect(anchor).toEqual([0, 1, 0]);
    // Inward slab points INTO the flesh; the spray leaves the OPPOSITE way.
    const l = Math.hypot(normal[0], normal[1], normal[2]);
    expect(normal[1] / l).toBeCloseTo(-1, 9);
  });

  it('falls back to surface-outward from the prim axis when there is no slab', () => {
    // Stump wounds (sever.ts) carry no carveN. Anchor sits on +x of a
    // Y-axis capsule, so the outward spray points AWAY from the axis.
    // Local [z, x, y] => world (+0.1 x, +1 y) is local [0, 0.1, 1].
    const prims = [capsule([0, 0, 0], [0, 2, 0])];
    const w = wound({ local: [0, 0.1, 1] });
    const { normal } = woundEmitAnchorAndNormal(prims, w);
    const l = Math.hypot(normal[0], normal[1], normal[2]);
    expect(normal[0] / l).toBeGreaterThan(0.99); // essentially +x
  });

  it('degenerate anchor-on-axis falls back to up', () => {
    const prims = [capsule([0, 0, 0], [0, 2, 0])];
    // Local [0, 0, 1] = world [0, 1, 0]: ON the axis, no outward direction.
    const w = wound({ local: [0, 0, 1] });
    const { normal } = woundEmitAnchorAndNormal(prims, w);
    expect(normal).toEqual([0, 1, 0]);
  });
});
