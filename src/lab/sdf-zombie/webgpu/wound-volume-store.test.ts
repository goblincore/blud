import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import { DEFAULT_FACE } from '../face';
import { worldHitToWound, woundWorldPos, type Wound } from '../damage';
import { sampleVolume } from '../wound-volume-stamp';
import { createBodyWoundVolumes, createWoundVolumeAtlas, stampable, worldToFrameQuat } from './wound-volume-store';
import { WV_MAX_ENTRIES } from './march/wound-volume-flag';
import type { Primitive, Vec3 } from '../types';
import { add, qFromAxisAngle, qRotate, sub } from '../vec';

const rest = buildBody(makeZombie({ ...DEFAULT_FACE }), DEFAULT_BUILD_OPTS);
const qRot = (q: number[], v: Vec3): Vec3 => qRotate(q as [number, number, number, number], v);
/** A hit on the surface of the first torso primitive. */
function torsoWound(prims: Primitive[]): Wound {
  const c = rest.clusters.find(x => x.limb === 'torso')!;
  const p = prims[c.start]!;
  const hit: Vec3 = [p.a[0], p.a[1], p.a[2] + p.radius];
  return worldHitToWound(prims, hit, 0.055, 'pellet', 0);
}
/** What the shader does with a table entry: world point to voxel-space metres in the box. */
function boxLocal(table: Float32Array, e: number, p: Vec3): Vec3 {
  const o = e * 16;
  const q = [table[o + 4]!, table[o + 5]!, table[o + 6]!, table[o + 7]!];
  return qRot(q, sub(p, [table[o + 8]!, table[o + 9]!, table[o + 10]!]));
}

describe('the baked wound volume store', () => {
  it('turns world directions into frame components', () => {
    const q = qFromAxisAngle([0.3, 0.9, -0.2], 1.1);
    const f = { u: qRotate(q, [1, 0, 0]), v: qRotate(q, [0, 1, 0]), w: qRotate(q, [0, 0, 1]) };
    const got = qRot(worldToFrameQuat(f), add(add([f.u[0] * 2, f.u[1] * 2, f.u[2] * 2], [f.v[0] * -3, f.v[1] * -3, f.v[2] * -3]), [f.w[0] * 0.5, f.w[1] * 0.5, f.w[2] * 0.5]));
    expect(got[0]).toBeCloseTo(2, 5);
    expect(got[1]).toBeCloseTo(-3, 5);
    expect(got[2]).toBeCloseTo(0.5, 5);
  });

  it('stamps a crater where the wound is, and the table finds it from the world', () => {
    const atlas = createWoundVolumeAtlas([96, 96, 96]);
    const body = createBodyWoundVolumes(atlas, 0.02);
    const w = torsoWound(rest.prims);
    expect(stampable(w)).toBe(true);
    expect(body.stamp(w, rest.prims, 0)).toBe(true);
    const table = new Float32Array(WV_MAX_ENTRIES * 16);
    const t = body.table(table, rest.prims, 0)!;
    expect(t.count).toBe(1);
    const world = woundWorldPos(rest.prims, w, 0);
    // The crater's centre is inside the entry's bound and inside the body's.
    expect(Math.hypot(world[0] - table[0]!, world[1] - table[1]!, world[2] - table[2]!)).toBeLessThan(table[3]!);
    expect(Math.hypot(world[0] - t.bound[0], world[1] - t.bound[1], world[2] - t.bound[2])).toBeLessThan(t.bound[3]);
    // The shader's transform lands the centre on the voxels the stamp filled: the colour mask is full there.
    // The table holds the touched part of the box only; table[11] is the shape-to-colour offset (the whole box's width).
    const voxel = 0.02, colourX = table[11]!, local = boxLocal(table, 0, world);
    const dims = [table[15]! % 256, Math.floor(table[15]! / 256) % 256, Math.floor(table[15]! / 65536)];
    const g = local.map(v => Math.floor(v / voxel));
    for (let k = 0; k < 3; k++) { expect(g[k]).toBeGreaterThan(0); expect(g[k]).toBeLessThan(dims[k]! - 1); }
    const AW = 96, AH = 96;
    const tex = (x: number, y: number, z: number) => atlas.data[(((table[14]! + z) * AH + table[13]! + y) * AW + table[12]! + x) * 4]!;
    expect(colourX).toBeGreaterThanOrEqual(dims[0]!);
    expect(tex(g[0]! + colourX, g[1]!, g[2]!)).toBeGreaterThan(200); // colour box: beside the shape box along x
    expect(tex(g[0]!, g[1]!, g[2]!)).toBeGreaterThan(80);              // shape box: the chain is above zero (byte 60 is 0 m)
  });

  it('follows the primitive: the same material point reads the same voxel after the body moves', () => {
    const body = createBodyWoundVolumes(createWoundVolumeAtlas([96, 96, 96]), 0.02);
    const w = torsoWound(rest.prims);
    body.stamp(w, rest.prims, 0);
    const table = new Float32Array(WV_MAX_ENTRIES * 16);
    body.table(table, rest.prims, 0);
    const before = boxLocal(table, 0, woundWorldPos(rest.prims, w, 0));
    // The whole body turned about the vertical and moved (the yaw the game hands the wound code).
    const yaw = 0.7, shift: Vec3 = [0.4, 0, -1.2];
    const turn = (v: Vec3): Vec3 => add(qRotate(qFromAxisAngle([0, 1, 0], yaw), v), shift);
    const moved = rest.prims.map(p => ({ ...p, a: turn(p.a), b: turn(p.b) }));
    body.table(table, moved, yaw);
    const after = boxLocal(table, 0, woundWorldPos(moved, w, yaw));
    for (let k = 0; k < 3; k++) expect(after[k]).toBeCloseTo(before[k]!, 4);
  });

  it('refuses what is not a crater, and frees its boxes', () => {
    const atlas = createWoundVolumeAtlas([96, 96, 96]);
    const body = createBodyWoundVolumes(atlas, 0.02);
    const w = torsoWound(rest.prims);
    expect(body.stamp({ ...w, shape: 'cut' }, rest.prims, 0)).toBe(false);
    expect(body.stamp({ ...w, headRegion: 'jaw' }, rest.prims, 0)).toBe(false);
    expect(body.stamp(w, rest.prims, 0)).toBe(true);
    expect(atlas.stats().boxes).toBe(1);
    expect(sampleVolume).toBeTypeOf('function');
    body.dispose();
    expect(atlas.stats()).toMatchObject({ boxes: 0, bytes: 0, freeListed: 1 });
    expect(atlas.data.some(b => b !== 0)).toBe(false);
  });
});
