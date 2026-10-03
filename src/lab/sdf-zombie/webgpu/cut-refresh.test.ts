// What character-view's wound refresh hands the GPU view for a cut: META.w sag, the (dir, kerf) cut row, null for craters.
import { describe, expect, it } from 'vitest';
import { createWoundRing } from './character-view';
import { CUT, ROD_CALIBRE, stampCut } from '../cut-wound';
import { WOUND_PROFILES, type Wound } from '../damage';
import { prim } from '../head-pop';
import { sdBody } from '../validate';
import type { Primitive, Vec3 } from '../types';

const torso = prim([0, 1.0, 0], [0, 1.5, 0], 0.15, [1, 1, 1], { limb: 'torso', cluster: 1 });
const prims: Primitive[] = [torso];
const posed = { prims, clusters: [{ start: 0, count: 1, alive: true }] } as never;
const field = (p: Vec3) => sdBody(p, { prims, clusters: [{ start: 0, count: 1, alive: true }] } as never);

interface Captured { offsets: number[]; cuts: readonly ({ dir: Vec3; kerf: number } | null)[] }
function refreshWith(rows: Wound[]): Captured {
  let got!: Captured;
  const view = { setWounds(_p: Vec3[], _r: number[], _t: number[], _a: number[], _s: number[], offsets: number[], _c: unknown, _o: unknown,
    _h: unknown, _d: unknown, _tr: unknown, _w: unknown, cuts: Captured['cuts']) { got = { offsets, cuts }; } };
  createWoundRing().refresh(view as never, posed, 0, rows);
  return got;
}
const crater = (): Wound => ({ primIdx: 0, local: [0, 0.2, 0.15], radius: 0.05, type: 'pellet', ageSec: 0 });
// Across the torso's curve (a chord), so the cut has a real sag.
const z = Math.sqrt(0.15 * 0.15 - 0.1 * 0.1);
const cut = (): Wound => stampCut(prims, { a: [-0.1, 1.25, z], b: [0.1, 1.25, z], view: [0, 0, -1] }, ROD_CALIBRE, 0, field);

describe('refresh uploads cut wounds', () => {
  it('a cut: offsetScale is its sag, cuts[i] = (world along unit, kerf)', () => {
    const w = cut();
    expect(w.shape).toBe('cut');
    expect(w.sag).toBeGreaterThan(0);
    const { offsets, cuts } = refreshWith([w]);
    expect(offsets[0]).toBe(w.sag);
    const c = cuts[0]!;
    expect(c.kerf).toBe(w.kerf);
    expect(Math.hypot(...c.dir)).toBeCloseTo(1, 6);
    expect(Math.abs(c.dir[0])).toBeGreaterThan(0.99);   // along the chord (world x)
  });
  it('a crater: the usual offset scale and no cut', () => {
    const { offsets, cuts } = refreshWith([crater()]);
    expect(offsets[0]).toBe(WOUND_PROFILES.pellet.rimOffsetScale);
    expect(cuts[0]).toBeNull();
  });
  it('a cut without cutDir is a crater everywhere (no sag in META.w, no cut row)', () => {
    const w = { ...cut(), cutDir: undefined };
    const { offsets, cuts } = refreshWith([w]);
    expect(cuts[0]).toBeNull();
    expect(offsets[0]).toBe(WOUND_PROFILES[w.type].rimOffsetScale);
  });
  it('a cut with no kerf of its own uploads CUT.defaultKerf', () => {
    const { cuts } = refreshWith([{ ...cut(), kerf: undefined }]);
    expect(cuts[0]!.kerf).toBe(CUT.defaultKerf);
  });
});
