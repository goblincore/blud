// src/lab/sdf-zombie/bone-exposure-yaw.test.ts
//
// Bone exposure rides the wound's own body frame (the cut wounds M1 final review, item 1). Every stamp resolves its wound
// with the LIVE body yaw and the ring uploads it with that yaw (character-view.ts refresh), so the exposure spheres the bone
// instancer / segment meshes read (game-main via boneExposureOf) must use it too. game-main passed yaw 0 outside the
// ?bounded-wounds preview: on a turned body the exposure slid off the carve (a yaw-pi torso cut exposed bone on the back).
// The oracle here is the UPLOAD itself: a stub view captures the rows refresh() writes (position, cap normal, cut dir).
import { describe, expect, it } from 'vitest';
import zombieSrc from './characters/zombie.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import { buildBody, type BuildResult } from './build-body';
import { bindRig, applyRig } from './rig-bind';
import { rotateYaw } from './gait';
import { translateBody } from './translate';
import { sdBody } from './validate';
import { add, cross, dot, len, normalize, scale, sub } from './vec';
import { worldHitToWound, type Wound } from './damage';
import { ROD_CALIBRE, boneExposureOf, cutExposureSpheres, stampCut } from './cut-wound';
import { createWoundRing } from './webgpu/character-view';
import type { VisualWound } from './shared-wounds/torso';
import type { Vec3 } from './types';

const ORIGIN: Vec3 = [1.3, 0, -0.8];

/** The zombie posed at `yaw` about ORIGIN (rig-yaw.test's turn: the rig points AND applyRig's bodyYaw). */
function turnedZombie(yaw: number): BuildResult {
  const body = translateBody(buildBody(compileBlob(parseBlob(zombieSrc))), ORIGIN);
  const bound = bindRig(body);
  const turn = (p: Vec3) => add(ORIGIN, rotateYaw(sub(p, ORIGIN), yaw));
  return applyRig(body, { ...bound, rig: { ...bound.rig,
    points: bound.rig.points.map(p => ({ ...p, pos: turn(p.pos), prev: turn(p.prev) })) } }, yaw);
}

/** Sphere-trace from `o` along unit `d` to the body's surface. */
function surfaceAlong(posed: BuildResult, o: Vec3, d: Vec3): Vec3 {
  let t = 0;
  for (let i = 0; i < 400; i++) {
    const p = add(o, scale(d, t)), s = sdBody(p, posed);
    if (s < 1e-5) return p;
    t += Math.max(s * 0.9, 1e-5);
  }
  throw new Error('ray missed the body');
}

type Row = { pos: Vec3; n: Vec3 | null; dir: Vec3 | null; kerf: number | null };
/** What the ring uploads for `rows` at `yaw` (the same call game-actor's refreshWounds makes). */
function uploaded(posed: BuildResult, yaw: number, rows: Wound[], visual = false): Row[] {
  const ring = createWoundRing();
  let out: Row[] = [];
  const gpu = { setWounds(...args: unknown[]) {
    const pos = args[0] as Vec3[], caps = args[6] as ({ n: Vec3; depth: number } | null)[];
    const cuts = args[args.length - 1] as ({ dir: Vec3; kerf: number } | null)[];
    out = pos.map((p, i) => ({ pos: p, n: caps[i]?.n ?? null, dir: cuts[i]?.dir ?? null, kerf: cuts[i]?.kerf ?? null }));
  } };
  if (visual) ring.refresh(gpu as never, posed, yaw, rows as VisualWound[]);
  else { ring.set(rows); ring.refresh(gpu as never, posed, yaw); }
  return out;
}

const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
/** How far the exposure chain of wound `w` strays from the uploaded row's slot: the centre line must pass through the
 *  uploaded position offset along the uploaded inward axis (the end stations sit `sag + kerf/2` in, cutExposureSpheres),
 *  and every station must lie in the (dir, inward) plane, between the slot's ends. Returns the worst error (m). */
function slotError(spheres: { pos: Vec3; radius: number }[], w: Wound, row: Row): number {
  if (w.shape !== 'cut') return Math.max(...spheres.map(s => dist(s.pos, row.pos)));
  const dir = normalize(row.dir!), n = normalize(row.n!), side = normalize(cross(dir, n));
  const ends = scale(add(spheres[0]!.pos, spheres[spheres.length - 1]!.pos), 0.5);
  let err = dist(ends, add(row.pos, scale(n, Math.max(0, w.sag ?? 0) + row.kerf! / 2)));
  for (const s of spheres) {
    const rel = sub(s.pos, row.pos);
    err = Math.max(err, Math.abs(dot(rel, side)), Math.max(0, Math.abs(dot(rel, dir)) - w.radius));
  }
  return err;
}

const YAWS = [0.7, Math.PI / 2, Math.PI, -Math.PI / 2, -2.3];

describe('bone exposure rides the wound body frame (turned bodies)', () => {
  for (const yaw of YAWS) {
    it(`yaw ${yaw.toFixed(3)}: craters and cuts, sphere and capsule prims, both upload modes`, () => {
      const posed = turnedZombie(yaw);
      const field = (p: Vec3) => sdBody(p, posed);
      const front = rotateYaw([0, 0, 1], yaw), right = rotateYaw([1, 0, 0], yaw), up: Vec3 = [0, 1, 0];
      const centre = (limb: string) => {
        const ps = posed.prims.filter(p => p.limb === limb && p.op === 'add');
        return scale(ps.reduce((m, p) => add(m, add(p.a, p.b)), [0, 0, 0] as Vec3), 0.5 / ps.length);
      };
      // Hit points from the body's front and side: the torso (sphere blobs), a thigh, a forearm-side shot, the head.
      const shots: [Vec3, Vec3][] = [
        [centre('torso'), front], [add(centre('torso'), scale(up, 0.12)), front], [add(centre('torso'), scale(up, -0.1)), right],
        [centre('legL'), front], [centre('armR'), scale(right, -1)], [centre('head'), front],
      ];
      const wounds: Wound[] = [];
      for (const [c, d] of shots) {
        const hit = surfaceAlong(posed, add(c, scale(d, 0.8)), scale(d, -1));
        wounds.push(worldHitToWound(posed.prims, hit, 0.055, 'pellet', yaw, field));
        // A cut through the same spot, across the body (the rod's stampCut, with the live yaw as game-rod passes it).
        const across = normalize(cross(d, up));
        wounds.push(stampCut(posed.prims, { a: add(hit, scale(across, -0.05)), b: add(hit, scale(across, 0.05)), view: scale(d, -1) }, ROD_CALIBRE, yaw, field));
      }
      const kinds = wounds.map(w => { const p = posed.prims[w.primIdx]!; return p.orient && !p.poseOrient ? 'orient' : p.a.every((v, i) => v === p.b[i]) ? 'sphere' : 'capsule'; });
      expect(kinds).toContain('sphere');
      expect(kinds).toContain('capsule');
      expect(wounds.filter(w => w.shape === 'cut').length).toBe(shots.length);

      // Default mode: the ring's own rows.
      const rows = uploaded(posed, yaw, wounds);
      const actor = { posed: () => posed, pose: () => ({ yaw }), visualWounds: () => wounds };
      const fixed = boneExposureOf(actor);
      let at = 0, worstFixed = 0, worstOld = 0;
      const perKind: Record<string, number> = {};
      wounds.forEach((w, i) => {
        const mine = cutExposureSpheres(posed.prims, w, yaw);
        expect(fixed.slice(at, at + mine.length)).toEqual(mine);
        at += mine.length;
        const e = slotError(mine, w, rows[i]!);
        worstFixed = Math.max(worstFixed, e);
        const old = slotError(cutExposureSpheres(posed.prims, w, 0), w, rows[i]!);
        worstOld = Math.max(worstOld, old);
        perKind[`${kinds[i]}/${w.shape ?? 'crater'}`] = Math.max(perKind[`${kinds[i]}/${w.shape ?? 'crater'}`] ?? 0, old);
      });
      expect(at).toBe(fixed.length);
      console.log(`yaw ${yaw.toFixed(3)}: worst exposure-vs-upload error ${(worstFixed * 1000).toFixed(4)} mm (live yaw), old yaw-0 call ${JSON.stringify(Object.fromEntries(Object.entries(perKind).map(([k, v]) => [k, +(v * 1000).toFixed(1)])))} mm`);
      expect(worstFixed).toBeLessThan(1e-6);
      // The old call (yaw 0) misses on this turned body: the test bites.
      expect(worstOld).toBeGreaterThan(0.01);

      // The bounded-wounds preview: visual rows (preset cutters on the torso anchors) upload through the same refresh.
      const visual: VisualWound[] = wounds.slice(0, 4).map((w, i) => (i % 2 ? w : { ...w, presetCut: true }));
      const vRows = uploaded(posed, yaw, visual, true);
      const vActor = { posed: () => posed, pose: () => ({ yaw }), visualWounds: () => visual };
      const vFixed = boneExposureOf(vActor);
      let k = 0;
      visual.forEach((w, i) => {
        const mine = cutExposureSpheres(posed.prims, w, yaw);
        expect(slotError(vFixed.slice(k, k + mine.length), w, vRows[i]!)).toBeLessThan(1e-6);
        k += mine.length;
      });
    });
  }

  it('a decal exposes no bone; at yaw 0 the frames coincide', () => {
    const posed = turnedZombie(0);
    const field = (p: Vec3) => sdBody(p, posed);
    const t = posed.prims.find(p => p.limb === 'torso' && p.op === 'add')!;
    const hit = surfaceAlong(posed, add(t.a, [0, 0, 0.8]), [0, 0, -1]);
    const w = worldHitToWound(posed.prims, hit, 0.055, 'pellet', 0, field);
    const decal = { ...w, decal: true };
    const ex = boneExposureOf({ posed: () => posed, pose: () => ({ yaw: 0 }), visualWounds: () => [w, decal] });
    expect(ex).toEqual(cutExposureSpheres(posed.prims, w, 0));
    expect(dist(ex[0]!.pos, uploaded(posed, 0, [w])[0]!.pos)).toBeLessThan(1e-9);
  });
});
