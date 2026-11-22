// src/lab/sdf-zombie/webgpu/skeleton-spike/skeleton-kit.test.ts
//
// The SHIPPED kit (public/assets/lab/skeleton-kit.glb) held to the SHIPPED zombie: every piece is a segment of the
// body as it now is, lies inside the rest flesh, covers the joints it shares with its neighbours, and falls with one
// melt / gib group. A change to the zombie's rig or bones that moves a segment fails here until the kit is rebuilt
// (scripts/skeleton-kit/build.sh).
// @ts-expect-error — node:fs is available in the Vitest runtime
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { sdBody } from '../../validate';
import { BONE_GROUPS, groupOf } from '../../melt-bones';
import type { Vec3 } from '../../types';
import zombieSrc from '../../characters/zombie.blob?raw';
import soldierSrc from '../../characters/soldier.blob?raw';
import butcherSrc from '../../characters/butcher.blob?raw';
import { createSkeletonSources } from './contract';
import { SegmentMeshCache } from './mesh';
import { KIT_JOINTS, SkeletonKit, kitFramePose, kitJointGaps, kitRevisionOf, kitSources, parseSkeletonKit, type KitSegmentFrame } from './skeleton-kit';
import { createGameBoneMeshCache, skeletonKitWanted } from './sculpt-cache';

const pieces = parseSkeletonKit(readFileSync('public/assets/lab/skeleton-kit.glb'));
const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
const sources = createSkeletonSources(body, bound, { character: 'zombie' });
const bones = sources.filter(s => s.kind === 'bone');

describe('the shipped skeleton kit against the shipped zombie', () => {
  it('has one piece for every bone segment but the head, and no piece for anything else', () => {
    const kit = new SkeletonKit(pieces);
    expect(kit.admit(bones)).toBe(true);
    expect(bones.filter(s => !kit.pieceOf(s)).map(s => s.segment)).toEqual(['head']);
    const live = new Set(bones.map(kitRevisionOf));
    expect(pieces.filter(p => !live.has(p.revision)).map(p => p.segment)).toEqual([]);
    expect(pieces).toHaveLength(19);
  });

  it('carries each segment\'s rest origin', () => {
    const kit = new SkeletonKit(pieces);
    kit.admit(bones);
    for (const s of bones) {
      const piece = kit.pieceOf(s);
      if (!piece) continue;
      const o = s.pose().origin;
      expect(Math.hypot(o[0] - piece.origin[0], o[1] - piece.origin[1], o[2] - piece.origin[2]), s.segment).toBeLessThan(1e-4);
    }
  });

  it('keeps every vertex at least 4 mm inside the rest flesh', () => {
    for (const p of pieces) {
      let worst = -Infinity;
      for (let i = 0; i < p.positions.length; i += 3) worst = Math.max(worst, sdBody([p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!], body));
      expect(worst, p.segment).toBeLessThan(-0.004);
    }
  });

  it('costs no more than the extraction it replaces', () => {
    const verts = pieces.reduce((n, p) => n + p.positions.length / 3, 0), tris = pieces.reduce((n, p) => n + p.index.length / 3, 0);
    // The nineteen segments' surface nets were 15,110 vertices and 30,284 triangles (2026-11-15).
    expect(verts).toBeLessThan(9000);
    expect(tris).toBeLessThan(17000);
  });

  it('has bone of both segments at every joint (nothing meets its neighbour across a gap)', () => {
    // A joint's point is covered by a piece when some vertex of the piece is within reach of it: the bones overlap
    // there, so the point is inside or on both. 3 cm is the largest end the kit has (the femoral condyles).
    const near = (segment: string, at: Vec3): number => {
      const p = pieces.find(q => q.segment === segment)!;
      let best = Infinity;
      for (let i = 0; i < p.positions.length; i += 3) best = Math.min(best, Math.hypot(p.positions[i]! - at[0], p.positions[i + 1]! - at[1], p.positions[i + 2]! - at[2]));
      return best;
    };
    for (const j of KIT_JOINTS) {
      if (j.a !== 'head') expect(near(j.a, j.at), `${j.name}: ${j.a}`).toBeLessThan(0.03);
      expect(near(j.b, j.at), `${j.name}: ${j.b}`).toBeLessThan(0.03);
    }
  });

  it('gives every piece exactly one melt / gib group, by its segment\'s first prim, and covers all eleven', () => {
    const kit = new SkeletonKit(pieces);
    kit.admit(bones);
    const groups = new Map<string, string>();
    for (const s of bones) {
      const names = new Set((s.prims ?? []).map(p => groupOf(p.bone)));
      // game-melter.ts drops a segment with groupOf(s.prims[0].bone).
      const group = groupOf(s.prims?.[0]?.bone);
      expect(BONE_GROUPS).toContain(group);
      if (kit.pieceOf(s)) groups.set(s.segment, group);
      // A limb segment's prims agree; only the trunk's cage piece holds prims of another group's name (the lumbar is
      // authored on the pelvis bone), and it goes with the cage.
      if (s.segment.startsWith('limb')) expect(names.size, s.segment).toBe(1);
    }
    expect(groups.get('axial:0-1')).toBe('pelvis');
    expect(groups.get('axial:1-2')).toBe('cage');
    expect(groups.get('axial:2-3')).toBe('skull');
    expect(groups.get('limb:armL:5-5')).toBe('cage');        // clavicle and scapula
    expect(groups.get('limb:armL:9-9')).toBe('foreArm.l');   // the hand
    expect(groups.get('limb:legL:11-12')).toBe('thigh.l');   // femur and kneecap
    // Every group but the skull's own bone (the head segment, which the kit does not draw) has a kit piece.
    expect(new Set(groups.values())).toEqual(new Set(BONE_GROUPS));
  });
});

describe('SkeletonKit', () => {
  it('builds a segment-local mesh once a piece and shares it', () => {
    const kit = new SkeletonKit(pieces);
    expect(kit.segment(bones.find(s => s.segment === 'limb:legL:11-12')!)).toBeNull();   // not admitted yet
    kit.admit(bones);
    const femur = bones.find(s => s.segment === 'limb:legL:11-12')!;
    const mesh = kit.segment(femur)!;
    expect(mesh.mesher).toBe('asset');
    expect(kit.segment(femur)).toBe(mesh);
    expect(kit.size).toBe(1);
    // The femoral head hangs under the segment's origin (the rig's hip point, at waist height), where the flesh
    // thigh begins: its top is 5 to 7 cm down.
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.min.y).toBeLessThan(-0.44);
    expect(box.max.y).toBeLessThan(-0.05);
    expect(box.max.y).toBeGreaterThan(-0.07);
    kit.dispose();
    expect(kit.size).toBe(0);
  });

  it('admits a body whole or not at all: the butcher shares the zombie\'s pelvis bones and draws none of the kit', () => {
    const kit = new SkeletonKit(pieces);
    for (const [name, src] of [['soldier', soldierSrc], ['butcher', butcherSrc]] as const) {
      const theirs = buildBody(compileBlob(parseBlob(src)), DEFAULT_BUILD_OPTS);
      const made = createSkeletonSources(theirs, bindRig(theirs), { character: name, organs: true });
      expect(kit.admit(made), name).toBe(false);
      expect(made.filter(s => kit.pieceOf(s)), name).toEqual([]);
      expect(kitSources(made, kit, () => [], () => 0), name).toEqual(made);
    }
    // The butcher's pelvis segment IS the zombie's, revision for revision: admission is what keeps it extracted.
    const butcher = buildBody(compileBlob(parseBlob(butcherSrc)), DEFAULT_BUILD_OPTS);
    const pelvis = createSkeletonSources(butcher, bindRig(butcher), { character: 'butcher' }).find(s => s.segment === 'axial:0-1')!;
    expect(kitRevisionOf(pelvis)).toBe(pieces.find(p => p.segment === 'axial:0-1')!.revision);
  });

  it('keeps a zombie that has lost segments, and never draws an organ', () => {
    const kit = new SkeletonKit(pieces);
    const all = createSkeletonSources(body, bound, { character: 'zombie', organs: true });
    const maimed = all.filter(s => !s.segment.startsWith('limb:armL') && !s.segment.startsWith('limb:legR'));
    expect(kit.admit(maimed)).toBe(true);
    expect(maimed.filter(s => s.kind === 'organ').length).toBeGreaterThan(0);
    expect(maimed.filter(s => s.kind === 'organ' && kit.pieceOf(s))).toEqual([]);
    expect(maimed.filter(s => kit.pieceOf(s))).toHaveLength(11);
  });

  it('is what the cache hands out for a covered segment, and the extraction for the rest', () => {
    const cache = new SegmentMeshCache();
    cache.bodyKit = new SkeletonKit(pieces);
    cache.bodyKit.admit(bones);
    const femur = bones.find(s => s.segment === 'limb:legL:11-12')!;
    expect(cache.get(femur).mesher).toBe('asset');
    expect(cache.keyOf(femur)).toBe(`kit:${kitRevisionOf(femur)}`);
    expect(cache.get(bones.find(s => s.segment === 'head')!).mesher).toBe('nets');
    cache.dispose();
  });
});

describe('kit frames', () => {
  const kit = new SkeletonKit(pieces);
  kit.admit(bones);
  const moved = (move: (p: Vec3, i: number) => Vec3) => bound.rig.points.map((p, i) => ({ pos: move(p.pos as Vec3, i) }));

  it('is the identity at rest for every piece', () => {
    const wrapped = kitSources(bones, kit, () => bound.rig.points, () => 0);
    for (const s of wrapped) {
      const f = s.pose(), o = bones.find(b => b.segment === s.segment)!.pose().origin;
      expect(Math.abs(f.quat[3]), s.segment).toBeGreaterThan(1 - 1e-9);
      
      expect(Math.hypot(f.origin[0] - o[0], f.origin[1] - o[1], f.origin[2] - o[2]), s.segment).toBeLessThan(1e-5);   // the file's numbers are rounded to 1e-5
    }
  });

  it('leaves a source without a frame as the object it was', () => {
    const wrapped = kitSources(bones, kit, () => bound.rig.points, () => 0);
    const framed = wrapped.filter((s, i) => s !== bones[i]).map(s => s.segment);
    expect(framed).toEqual(['axial:0-1', 'limb:armL:5-5', 'limb:armR:6-6']);
    expect(kitSources(bones, null, () => bound.rig.points, () => 0)).toEqual(bones);
  });

  it('keeps both femoral heads in their sockets when the hips swing against the spine', () => {
    // The hips shifted 4 cm forward and rolled, the base of the spine left where it was: the pelvis piece goes with
    // the hips. On the pelvis bone's own frame the sockets stayed with the spine, 4 cm from the femoral heads.
    const pts = moved((p, i) => i === 11 ? [p[0], p[1] + 0.02, p[2] + 0.05] : i === 13 ? [p[0], p[1] - 0.02, p[2] + 0.03] : p);
    const piece = pieces.find(p => p.segment === 'axial:0-1')!;
    const f = kitFramePose(piece.frame!, piece.origin, pts, [0, 0, 0], 0);
    for (const hip of [11, 13]) {
      const rest = bound.rig.points[hip]!.pos;
      const carried: Vec3 = [f.origin[0], f.origin[1], f.origin[2]];
      const r: Vec3 = [rest[0] - piece.origin[0], rest[1] - piece.origin[1], rest[2] - piece.origin[2]];
      // world = origin + quat * (rest - pieceOrigin)
      const [x, y, z, w] = f.quat;
      const tx = 2 * (y * r[2] - z * r[1]), ty = 2 * (z * r[0] - x * r[2]), tz = 2 * (x * r[1] - y * r[0]);
      const at: Vec3 = [carried[0] + r[0] + w * tx + (y * tz - z * ty), carried[1] + r[1] + w * ty + (z * tx - x * tz), carried[2] + r[2] + w * tz + (x * ty - y * tx)];
      expect(Math.hypot(at[0] - pts[hip]!.pos[0], at[1] - pts[hip]!.pos[1], at[2] - pts[hip]!.pos[2])).toBeLessThan(0.004);
    }
  });

  it('turns the shoulder girdle about the shoulder joint with the clavicle bone, its inner end staying at the chest', () => {
    // The left shoulder raised 6 cm about the top of the chest (point 2), the clavicle's length kept.
    const chest = bound.rig.points[2]!.pos, sh = bound.rig.points[5]!.pos;
    const len = Math.hypot(sh[0] - chest[0], sh[1] - chest[1], sh[2] - chest[2]);
    const up = 0.06, across = Math.sqrt(len * len - up * up);
    const pts = moved((p, i) => i === 5 ? [chest[0] + across, chest[1] + up, chest[2]] : p);
    const piece = pieces.find(p => p.segment === 'limb:armL:5-5')!;
    const f = kitFramePose(piece.frame!, piece.origin, pts, pts[5]!.pos, 0);
    expect(f.origin).toEqual(pts[5]!.pos);
    // The chest point, carried by the girdle's frame, stays on the chest point.
    const r = [chest[0] - piece.origin[0], chest[1] - piece.origin[1], chest[2] - piece.origin[2]] as Vec3;
    const [x, y, z, w] = f.quat;
    const tx = 2 * (y * r[2] - z * r[1]), ty = 2 * (z * r[0] - x * r[2]), tz = 2 * (x * r[1] - y * r[0]);
    const at: Vec3 = [f.origin[0] + r[0] + w * tx + (y * tz - z * ty), f.origin[1] + r[1] + w * ty + (z * tx - x * tz), f.origin[2] + r[2] + w * tz + (x * ty - y * tx)];
    expect(Math.hypot(at[0] - chest[0], at[1] - chest[1], at[2] - chest[2])).toBeLessThan(1e-5);
  });

  it('measures no joint gap at rest, and the gap a moved frame opens', () => {
    const rest = new Map(pieces.map(p => [p.segment, p.origin]));
    rest.set('head', bones.find(s => s.segment === 'head')!.pose().origin as Vec3);
    const at = (shift: (k: string) => Vec3) => (k: string): KitSegmentFrame | null => {
      const o = rest.get(k);
      if (!o) return null;
      const d = shift(k);
      return { restOrigin: o, origin: [o[0] + d[0], o[1] + d[1], o[2] + d[2]], quat: [0, 0, 0, 1] };
    };
    for (const g of kitJointGaps(at(() => [0, 0, 0]))) expect(g.gap, g.name).toBeLessThan(1e-12);
    const gaps = kitJointGaps(at(k => (k === 'limb:legL:12-15' ? [0, -0.02, 0] : [0, 0, 0])));
    expect(gaps.find(g => g.name === 'knee')!.gap).toBeCloseTo(0.02, 9);
    expect(gaps.find(g => g.name === 'elbow')!.gap).toBe(0);
    expect(gaps.filter(g => g.slides).map(g => g.name)).toEqual(['sacrum between the hip bones']);
  });
});

describe('the game\'s cache and the kit', () => {
  it('attaches the kit that loads, and says once when it does not', async () => {
    const bare = () => Promise.resolve(new SegmentMeshCache());
    const kit = new SkeletonKit(pieces);
    expect((await createGameBoneMeshCache('', () => {}, () => Promise.resolve(kit), 50, bare)).bodyKit).toBe(kit);
    const said: string[] = [];
    const cache = await createGameBoneMeshCache('', line => { said.push(line); }, () => Promise.reject(new Error('404 Not Found')), 50, bare);
    expect(cache.bodyKit).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('404 Not Found');
  });

  it('?bonekit=0 loads no kit', async () => {
    expect(skeletonKitWanted('')).toBe(true);
    expect(skeletonKitWanted('?bonekit=0')).toBe(false);
    let asked = 0;
    const cache = await createGameBoneMeshCache('?bonekit=0', () => {}, () => { asked++; return Promise.reject(new Error('never')); }, 50, () => Promise.resolve(new SegmentMeshCache()));
    expect(cache.bodyKit).toBeNull();
    expect(asked).toBe(0);
  });
});
