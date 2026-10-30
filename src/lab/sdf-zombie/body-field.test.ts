// src/lab/sdf-zombie/body-field.test.ts
//
// The shot path's fast fields (body-field.ts) must not change a single answer: bodyField is bit-identical to sdBody,
// and a pellet traced through traceField lands where it lands through sdBody. Pinned over the whole cast, at rest and
// with a limb severed (a dead cluster), on random points around each body and on random shot segments through it.
import { afterEach, describe, expect, it } from 'vitest';
import { bodyField, setShotFix, traceField } from './body-field';
import { sdBody, type Body } from './validate';
import { characterNames, characterEntry } from './character-registry';
import { buildCharacterBody } from './webgpu/character-view';
import { GRAPESHOT, traceProjectile } from './webgpu/game-weapon';
import type { Vec3 } from './types';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function bodies(): { name: string; body: Body }[] {
  const out: { name: string; body: Body }[] = [];
  for (const name of characterNames()) {
    let body: Body;
    try { body = buildCharacterBody(characterEntry(name), [0, 0, 0], []); } catch { continue; }
    out.push({ name, body });
    // A severed limb: its cluster dead, as sever.ts leaves it.
    const live = body.clusters.findIndex(c => c.limb !== 'torso' && c.alive);
    if (live >= 0) out.push({ name: `${name}-severed`, body: { ...body, clusters: body.clusters.map((c, i) => i === live ? { ...c, alive: false } : c) } });
  }
  return out;
}

afterEach(() => setShotFix(true));

describe('bodyField', () => {
  const cast = bodies();
  it('covers the cast', () => { expect(cast.length).toBeGreaterThan(10); });
  for (const { name, body } of cast) {
    it(`${name}: bit-identical to sdBody`, () => {
      const f = bodyField(body);
      const r = rng(name.length * 977 + 13);
      let mismatches = 0;
      for (let i = 0; i < 3000; i++) {
        // Half in a box around the body, half pulled near the skin (where the blends and wound probes live).
        const p: [number, number, number] = [(r() - 0.5) * 2.4, r() * 2.4 - 0.2, (r() - 0.5) * 2.4];
        if (i % 2) {
          for (let k = 0; k < 4; k++) {
            const d = sdBody(p, body);
            const c = body.clusters.find(cc => cc.alive) ?? body.clusters[0]!;
            const v: Vec3 = [c.center[0] - p[0], c.center[1] - p[1], c.center[2] - p[2]];
            const l = Math.hypot(v[0], v[1], v[2]) || 1;
            const s = Math.max(-0.05, Math.min(0.3, d)) * (0.4 + r() * 0.8);
            p[0] += v[0] / l * s; p[1] += v[1] / l * s; p[2] += v[2] / l * s;
          }
        }
        if (f(p) !== sdBody(p, body)) mismatches++;
      }
      expect(mismatches).toBe(0);
    });
  }
});

describe('traceField', () => {
  const cast = bodies();
  for (const { name, body } of cast) {
    it(`${name}: pellet traces land identically`, () => {
      const r = rng(name.length * 31 + 7);
      const f = traceField(body, GRAPESHOT.hitEps);
      let hits = 0;
      for (let i = 0; i < 300; i++) {
        // From 2-4 m out at eye-ish height, through a point near the body, 2.7 m long (an 80 m/s pellet at 30 Hz).
        const yaw = r() * Math.PI * 2, dist = 2 + r() * 2;
        const from: Vec3 = [Math.sin(yaw) * dist, 0.6 + r() * 1.2, Math.cos(yaw) * dist];
        const aim: Vec3 = [(r() - 0.5) * 0.8, 0.2 + r() * 1.5, (r() - 0.5) * 0.8];
        const d: Vec3 = [aim[0] - from[0], aim[1] - from[1], aim[2] - from[2]];
        const l = Math.hypot(d[0], d[1], d[2]);
        const len = 2.7 * (0.6 + r() * 0.8);
        const to: Vec3 = [from[0] + d[0] / l * len, from[1] + d[1] / l * len, from[2] + d[2] / l * len];
        const want = traceProjectile(from, to, q => sdBody(q, body));
        const got = traceProjectile(from, to, f);
        expect(got).toEqual(want);
        if (want) hits++;
      }
      expect(hits).toBeGreaterThan(0);
    });
  }
});

describe('?shotfix=0', () => {
  it('is plain sdBody', () => {
    const body = buildCharacterBody(characterEntry('zombie'), [0, 0, 0], []);
    setShotFix(false);
    const f = bodyField(body), t = traceField(body, GRAPESHOT.hitEps);
    const p: Vec3 = [3, 1, 0];
    expect(f(p)).toBe(sdBody(p, body));
    expect(t(p)).toBe(sdBody(p, body));
  });
});
