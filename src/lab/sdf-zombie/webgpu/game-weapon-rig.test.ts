// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-weapon-rig.test.ts
//
// The gun's fire path: a slug fired through fire() carries where the player was aiming (the eye and the crosshair's ray) on its provenance.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GameContext } from './game-context';
import { aimDir, convergedDir, fire, launchSlug, muzzleWorld } from './game-weapon-rig';
import { eyeOf } from './game-player';
import { SLUG, type Projectile } from './game-weapon';
import type { Vec3 } from '../types';

/** A page with the gun up, loaded and at rest, a player at `pos` looking along (yaw, pitch), and nothing else: no
 *  HUD, no flash rig, no smoke, no game loop. The muzzle locators stand where the gun holds them, beside and under
 *  the eye. */
function page(o: { pos?: Vec3; yaw?: number; pitch?: number; freeAim?: boolean; aim?: { x: number; y: number }; slug?: boolean } = {}) {
  const pellets: Projectile[] = [];
  const player = { pos: o.pos ?? [1, 0, 2], vel: [0, 0, 0], yaw: o.yaw ?? 0.3, pitch: o.pitch ?? -0.05, grounded: true };
  const eye = eyeOf(player as never);
  const node = (dx: number) => { const n = new THREE.Object3D(); n.position.set(eye[0] + 0.2 + dx, eye[1] - 0.12, eye[2] - 0.5); n.updateMatrixWorld(true); return n; };
  const events: unknown[] = [];
  const ctx = {
    player: { player, freeAimOn: o.freeAim ?? false },
    boot: { hudEl: null, handle: { camera: { fov: 58, aspect: 4 / 3 } } },
    world: { loop: null },
    telemetry: { telemetry: { event: (...a: unknown[]) => { events.push(a); } } },
    vfx: { smokePuffs: [] },
    weapon: {
      slotState: { live: 'shotgun', phase: 'up' }, launcher: null, gunReady: true, cooldown: 0, reloadAge: Infinity,
      infiniteAmmo: true, shells: 2, slugMode: o.slug ?? true, shotAlert: false, recoilPitch: 0, flashAge: 9, fireAge: 9,
      fireBarrels: 0, flashGroup: null, flashTextures: [], muzzleNodes: [node(-0.02), node(0.02)], aim: o.aim ?? { x: 0, y: 0 }, pellets,
    },
  } as unknown as GameContext;
  return { ctx, pellets, eye, events };
}
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

describe('a fired slug carries the aim it was fired with', () => {
  it('fire() in slug mode puts one slug in flight whose provenance holds the eye and the crosshair\'s ray as the gun fired', () => {
    const p = page();
    const want = aimDir(p.ctx), muz = muzzleWorld(p.ctx), flight = convergedDir(p.ctx, muz);
    expect(fire(p.ctx, 1)).toBe(true);
    expect(p.pellets).toHaveLength(1);
    const s = p.pellets[0]!;
    expect(s.kind).toBe('slug');
    expect(s.shot).toMatchObject({ weapon: 'slug', shotId: expect.any(Number) });
    const aim = s.shot!.weapon === 'slug' ? s.shot!.aim : undefined;
    expect(aim).toBeDefined();
    expect(aim!.eye).toEqual(p.eye);
    expect(aim!.dir).toEqual(want);
    expect(Math.hypot(...aim!.dir)).toBeCloseTo(1, 12);
    // The slug itself leaves from the muzzle along the converged ray: not from the eye, and not along the aim.
    expect(s.pos).toEqual(muz);
    expect(unit(s.vel)[0]).toBeCloseTo(flight[0], 12);
    expect(Math.hypot(...s.vel)).toBeCloseTo(SLUG.speed, 9);
    expect(Math.hypot(s.pos[0] - aim!.eye[0], s.pos[1] - aim!.eye[1], s.pos[2] - aim!.eye[2])).toBeGreaterThan(0.3);
    const cos = flight[0] * want[0] + flight[1] * want[1] + flight[2] * want[2];
    expect(cos).toBeLessThan(1 - 1e-5);
    expect(cos).toBeGreaterThan(0.99);
  });
  it('the aim is a copy taken at the trigger: turning the player afterwards does not move it', () => {
    const p = page();
    fire(p.ctx, 1);
    const aim = (p.pellets[0]!.shot as { aim: { eye: Vec3; dir: Vec3 } }).aim, was = { eye: [...aim.eye], dir: [...aim.dir] };
    p.ctx.player.player.yaw += 1; p.ctx.player.player.pos[0] += 3;
    expect(aim).toEqual(was);
  });
  it('under free aim the recorded ray is the reticle\'s, not the camera\'s forward axis', () => {
    const centre = page({ freeAim: true, aim: { x: 0, y: 0 } }), off = page({ freeAim: true, aim: { x: 0.4, y: -0.2 } });
    fire(centre.ctx, 1); fire(off.ctx, 1);
    const a = (centre.pellets[0]!.shot as { aim: { dir: Vec3 } }).aim.dir, b = (off.pellets[0]!.shot as { aim: { dir: Vec3 } }).aim.dir;
    const fwd = aimDir(page({ freeAim: false }).ctx);
    expect(a[0]).toBeCloseTo(fwd[0], 12); expect(a[1]).toBeCloseTo(fwd[1], 12); expect(a[2]).toBeCloseTo(fwd[2], 12);
    expect(b).toEqual(aimDir(off.ctx));
    // 0.4 of the half-width at a 58 degree vertical field of view and 4:3 is about 16 degrees off the axis.
    const cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(Math.acos(cos) * 180 / Math.PI).toBeGreaterThan(10);
  });
  it('launchSlug is what fire() launches', () => {
    const p = page();
    const s = launchSlug(p.ctx);
    fire(p.ctx, 1);
    const f = p.pellets[0]!;
    expect({ ...s, shot: { ...s.shot, shotId: 0 } }).toEqual({ ...f, shot: { ...f.shot, shotId: 0 } });
  });
  it('a pellet volley carries no aim: the split is the slug\'s', () => {
    const p = page({ slug: false });
    expect(fire(p.ctx, 1)).toBe(true);
    expect(p.pellets.length).toBeGreaterThan(1);
    for (const q of p.pellets) { expect(q.kind).toBe('pellet'); expect(q.shot).not.toHaveProperty('aim'); }
  });
  it('a gun that does not fire launches nothing', () => {
    const p = page();
    p.ctx.weapon.cooldown = 0.2;
    expect(fire(p.ctx, 1)).toBe(false);
    expect(p.pellets).toHaveLength(0);
  });
});
