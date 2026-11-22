// src/lab/sdf-zombie/webgpu/door-frame-geometry.test.ts
import { describe, expect, it } from 'vitest';
import { doorCues, doorFrameMesh, FRAME, LAMP_RGB, leafInset, RECESS_INSET_M, type FrameSideOptions } from './door-frame-geometry';
import { doorFaceSigns, doorLeafMesh, LEAF_INSET_M } from './door-leaf-geometry';
import type { SectorDoorDef } from './sector-def';

// A doorway along z at x 0.25 (faces x 0 and x 0.5), 2 m wide, 0.5 m deep, 2 m tall, rooms 3 m tall.
const def: SectorDoorDef = { id: 'd', sector: 1, faces: [1, 5], a: [0.25, -1], b: [0.25, 1], width: 2, depth: 0.5, height: 2,
  zones: [0, 1], style: 'split', speed: 3, wait: 4, key: null };
const signs = doorFaceSigns(def, [[0, 0], [0.5, 0]]);
const opts = (o: Partial<FrameSideOptions> = {}): FrameSideOptions => ({
  frame: true, light: true, inset: leafInset(def, true, LEAF_INSET_M), floor: 0, roomFloor: 0, roomCeil: 3, sign: signs[0],
  plate: { near: 0.12, far: 0.12 }, ...o,
});
/** Local across-coordinate w (from the centre line, + toward side 0's room) and along m (metres from a). */
const local = (p: number[]) => ({ m: p[2]! + 1, w: (0.25 - p[0]!) * signs[0], y: p[1]! });

describe('?doorcues=', () => {
  it('absent: all on; none / empty: all off; a list: only those; -name removes from all', () => {
    expect(doorCues(null)).toEqual({ frame: true, light: true, recess: true, tone: true });
    expect(doorCues('none')).toEqual({ frame: false, light: false, recess: false, tone: false });
    expect(doorCues('')).toEqual({ frame: false, light: false, recess: false, tone: false });
    expect(doorCues('frame,light')).toEqual({ frame: true, light: true, recess: false, tone: false });
    expect(doorCues('all,-light')).toEqual({ frame: true, light: false, recess: true, tone: true });
    expect(doorCues('tone,bogus')).toEqual({ frame: false, light: false, recess: false, tone: true });
  });
});

describe('recess', () => {
  it('sets the leaves back RECESS_INSET_M, keeping each leaf half at least 6 cm thick', () => {
    expect(leafInset(def, false, LEAF_INSET_M)).toBe(LEAF_INSET_M);
    expect(leafInset(def, true, LEAF_INSET_M)).toBe(RECESS_INSET_M);
    expect(leafInset({ ...def, depth: 0.2 }, true, LEAF_INSET_M)).toBeCloseTo(0.04, 9);
    const s1 = doorLeafMesh(def, 1, 0, signs, RECESS_INSET_M);
    const xs = new Set(s1.position.filter((_, i) => i % 3 === 0).map(v => +v.toFixed(6)));
    expect([...xs]).toEqual([+(0.5 - RECESS_INSET_M).toFixed(6)]);
  });
});

describe('door frame mesh data', () => {
  it('is empty with neither the frame nor the light', () => {
    expect(doorFrameMesh(def, opts({ frame: false, light: false })).count).toBe(0);
  });
  it('winds every triangle toward its normal', () => {
    const f = doorFrameMesh(def, opts());
    expect(f.count % 3).toBe(0);
    for (let k = 0; k < f.count / 3; k++) {
      const [a, b, c] = [0, 1, 2].map(i => f.position.slice((k * 3 + i) * 3, (k * 3 + i) * 3 + 3)) as [number[], number[], number[]];
      const n = f.normal.slice(k * 9, k * 9 + 3);
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const cr = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      expect(cr[0]! * n[0]! + cr[1]! * n[1]! + cr[2]! * n[2]!).toBeGreaterThan(0);
    }
  });
  it('never enters the leaves\' slab (any open fraction), save the threshold plate under them', () => {
    const o = opts();
    const halfD = def.depth / 2 - o.inset;
    const f = doorFrameMesh(def, o);
    for (let k = 0; k < f.count / 3; k++) {
      const vs = [0, 1, 2].map(i => local(f.position.slice((k * 3 + i) * 3, (k * 3 + i) * 3 + 3)));
      if (vs.every(v => v.y <= FRAME.plateLift + 1e-9)) continue;          // the plate
      const sgn = Math.sign(vs.reduce((t, v) => t + v.w, 0));
      for (const v of vs) {
        expect(Math.sign(v.w)).toBe(sgn);
        expect(Math.abs(v.w)).toBeGreaterThanOrEqual(halfD - 1e-9);
      }
    }
  });
  it('stands proud of the face, frames the doorway with posts and a header, and stays under the room ceiling', () => {
    const f = doorFrameMesh(def, opts({ plate: null }));
    const pts = Array.from({ length: f.count }, (_, i) => local(f.position.slice(i * 3, i * 3 + 3)));
    expect(Math.max(...pts.map(p => p.w))).toBeCloseTo(def.depth / 2 + FRAME.proud + 0.03, 9);   // the lamp on the header
    expect(Math.min(...pts.map(p => p.m))).toBeCloseTo(-FRAME.post, 9);
    expect(Math.max(...pts.map(p => p.m))).toBeCloseTo(def.width + FRAME.post, 9);
    expect(Math.max(...pts.map(p => p.y))).toBeCloseTo(def.height + FRAME.header, 9);
    const low = doorFrameMesh(def, opts({ roomCeil: 2.1 }));
    const ys = Array.from({ length: low.count }, (_, i) => low.position[i * 3 + 1]!);
    expect(Math.max(...ys)).toBeLessThan(2.1);
  });
  it('puts the lamp on the header centre, with a spill round it; beside the doorway where there is no header room', () => {
    const f = doorFrameMesh(def, opts());
    const lamp = Array.from({ length: f.count }, (_, i) => i).filter(i => f.lamp[i] === 1).map(i => local(f.position.slice(i * 3, i * 3 + 3)));
    expect(lamp.length).toBeGreaterThan(0);
    expect(Math.min(...lamp.map(p => p.y))).toBeGreaterThan(def.height);
    expect((Math.min(...lamp.map(p => p.m)) + Math.max(...lamp.map(p => p.m))) / 2).toBeCloseTo(def.width / 2, 9);
    expect(Math.max(...f.spill)).toBe(1);
    expect(f.spill.some(v => v > 0 && v < 1) || f.spill.filter(v => v === 0).length > 0).toBe(true);
    const flat = doorFrameMesh(def, opts({ roomCeil: 2.03 }));
    const side = Array.from({ length: flat.count }, (_, i) => i).filter(i => flat.lamp[i] === 1).map(i => local(flat.position.slice(i * 3, i * 3 + 3)));
    expect(Math.max(...side.map(p => p.y))).toBeLessThan(def.height);
    expect(side.some(p => p.m < 0) && side.some(p => p.m > def.width)).toBe(true);
  });
  it('lamp only (no frame) mounts on the wall face; the frame alone has no lamp', () => {
    const l = doorFrameMesh(def, opts({ frame: false }));
    expect(l.count).toBeGreaterThan(0);
    expect(l.lamp.every(v => v === 1)).toBe(true);
    const pts = Array.from({ length: l.count }, (_, i) => local(l.position.slice(i * 3, i * 3 + 3)));
    expect(Math.min(...pts.map(p => p.w))).toBeCloseTo(def.depth / 2, 9);
    const fr = doorFrameMesh(def, opts({ light: false }));
    expect(fr.lamp.every(v => v === 0) && fr.spill.every(v => v === 0)).toBe(true);
  });
  it('the threshold plate overhangs only the faces asked for', () => {
    const f = doorFrameMesh(def, opts({ plate: { near: 0.12, far: 0 } }));
    const plate = Array.from({ length: f.count }, (_, i) => local(f.position.slice(i * 3, i * 3 + 3))).filter(p => p.y <= FRAME.plateLift + 1e-9 && p.m >= 0 && p.m <= def.width);
    expect(Math.max(...plate.map(p => p.w))).toBeCloseTo(def.depth / 2 + 0.12, 9);
    expect(Math.min(...plate.map(p => p.w))).toBeCloseTo(-def.depth / 2, 9);
  });
  it('status colours: red shut, green opening and open, amber closing', () => {
    expect(LAMP_RGB.closed[0]).toBeGreaterThan(LAMP_RGB.closed[1] * 5);
    expect(LAMP_RGB.open[1]).toBeGreaterThan(LAMP_RGB.open[0] * 5);
    expect(LAMP_RGB.opening).toEqual(LAMP_RGB.open);
    expect(LAMP_RGB.closing[0]).toBeGreaterThan(LAMP_RGB.closing[1]);
    expect(LAMP_RGB.closing[1]).toBeGreaterThan(LAMP_RGB.closing[2] * 5);
  });
});
