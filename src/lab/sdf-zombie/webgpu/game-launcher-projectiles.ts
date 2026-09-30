// World rendering/wiring only; all flight, contact and attachment maths is pure.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import { GRENADE, makeGrenade, stepGrenade, grenadeFragments, stepGrenadeFragment, type GrenadeState, type GrenadeFragmentState } from '../grenade-flight';
import { sweepGrenade, type GrenadeBody } from '../grenade-collision';
import { bindGrenade, attachedGrenade, type GrenadeAttachment } from '../grenade-attachment';
import { sub, scale, normalize, len } from '../vec';
import { ceilingAt } from './game-world-leaves';
import { spillVerdict } from './game-vfx-leaves';

export interface LauncherProjectileDeps { detonate(at: Vec3): void }
export interface LauncherProjectiles {
  launch(origin: Vec3, velocity: Vec3): number;
  tick(dt: number): void;
  debug(): Record<string, unknown>;
}
interface LiveGrenade { id: number; state: GrenadeState; mesh: THREE.Group; anchor: GrenadeAttachment | null; anchorActor: number | null }
interface Fragment { state: GrenadeFragmentState; mesh: THREE.Mesh; host: number | null }
export function createLauncherProjectiles(ctx: GameContext, round: THREE.Object3D, deps: LauncherProjectileDeps): LauncherProjectiles {
  const scene = ctx.boot.handle.scene;
  const material = (name: string) => {
    const source = (round.getObjectByName(name) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    // Stable paint keeps the tiny world prop readable under the game's very
    // bright local lights. Stock Basic materials are warmed with this pool.
    return new THREE.MeshBasicMaterial({ color: source.color.clone().multiplyScalar(1.3) });
  };
  const olive = material('projectile'), brass = material('case_rim');
  const bodyGeo = new THREE.CylinderGeometry(.034, .034, .08, 16);
  const noseGeo = new THREE.SphereGeometry(.034, 16, 10);
  const ringGeo = new THREE.CylinderGeometry(.035, .035, .012, 16);
  const fragGeo = new THREE.BoxGeometry(.008, .008, .065);
  const spare: THREE.Group[] = [], fragmentPool: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const can = new THREE.Group(); can.name = `launcher-grenade-${i}`;
    const body = new THREE.Mesh(bodyGeo, olive); body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(noseGeo, olive); nose.position.z = -.04; nose.scale.z = .65;
    const ring = new THREE.Mesh(ringGeo, brass); ring.rotation.x = Math.PI / 2; ring.position.z = .025;
    can.add(body, nose, ring); can.visible = false; scene.add(can); spare.push(can);
    ctx.boot.deferredApi?.router.register(can, 'mesh', 'level-only');
  }
  for (let i = 0; i < GRENADE.fragments * 3; i++) {
    const mesh = new THREE.Mesh(fragGeo, brass); mesh.name = `launcher-fragment-${i}`;
    mesh.visible = false; scene.add(mesh); fragmentPool.push(mesh);
    ctx.boot.deferredApi?.router.register(mesh, 'mesh', 'level-only');
  }
  const live: LiveGrenade[] = [], fragments: Fragment[] = [];
  const forward = new THREE.Vector3(0, 0, -1), dir = new THREE.Vector3();
  const roll = new THREE.Quaternion();
  let launched = 0, detonations = 0, embeds = 0, totalBounces = 0, fragmentHits = 0;
  let lastLaunch: { origin: Vec3; velocity: Vec3 } | null = null;
  let lastExplosion: { at: Vec3; embedded: number | null; id: number } | null = null;
  function launch(origin: Vec3, velocity: Vec3): number {
    // Never steal a visible projectile from a live simulation. Normal fire can
    // have only one 1.6 s fuse outstanding; the spare pool also supports seams.
    const mesh = spare.pop(); if (!mesh) return -1;
    const id = ++launched;
    const state = makeGrenade(origin, velocity);
    live.push({ id, state, mesh, anchor: null, anchorActor: null });
    mesh.visible = true; draw(mesh, state.pos, state.direction, 0);
    lastLaunch = { origin: [...origin], velocity: [...velocity] };
    ctx.telemetry.telemetry.event('grenade-launch', { id, x: origin[0], y: origin[1], z: origin[2] });
    return id;
  }
  function draw(mesh: THREE.Object3D, pos: Vec3, direction: Vec3, spin: number): void {
    mesh.position.fromArray(pos); dir.fromArray(direction).normalize();
    mesh.quaternion.setFromUnitVectors(forward, dir);
    roll.setFromAxisAngle(forward, spin); mesh.quaternion.multiply(roll);
  }
  function bodies(): GrenadeBody[] {
    return ctx.world.actors.map(a => ({ id: a.id, body: a.drawnBody(), yaw: a.pose().yaw,
      flesh: a.profileName() !== 'skeleton' }));
  }
  function tick(dt: number): void {
    if (!(dt > 0) || (!live.length && !fragments.length)) return;
    const targets = bodies();
    const sweep = (from: Vec3, to: Vec3, r: number) => sweepGrenade(from, to, r,
      ctx.world.colliders, ceilingAt(ctx, to[0], to[2]), targets);
    // Older fragments step before a new explosion creates its fragment cloud.
    for (let i = fragments.length - 1; i >= 0; i--) {
      const f = fragments[i]!;
      const stepped = stepGrenadeFragment(f.state, dt, { sweep: (from, to, radius) => sweepGrenade(from, to, radius,
        ctx.world.colliders, ceilingAt(ctx, to[0], to[2]), targets.filter(t => t.id !== f.host)) });
      f.state = stepped.state;
      const hit = stepped.hit;
      if (hit?.actorId !== undefined) {
        const actor = ctx.world.actors.find(a => a.id === hit.actorId);
        const wound = actor?.hit(hit.point, normalize(f.state.vel), { weapon: 'explosion' });
        if (wound) { fragmentHits++; spillVerdict(ctx, actor!, wound); }
      }
      if (stepped.expired) {
        f.mesh.visible = false; fragmentPool.push(f.mesh); fragments.splice(i, 1);
      } else draw(f.mesh, f.state.pos, normalize(f.state.vel), 0);
    }
    for (let i = live.length - 1; i >= 0; i--) {
      const g = live[i]!, previous = g.state;
      g.state = stepGrenade(g.state, dt, { sweep, attached: (actorId, pos, direction) => {
        const actor = ctx.world.actors.find(a => a.id === actorId);
        if (actor && (!g.anchor || g.anchorActor !== actorId)) {
          g.anchor = bindGrenade(actor.drawnBody(), actor.pose().yaw, pos, direction); g.anchorActor = actorId;
        }
        const p = actor && g.anchor ? attachedGrenade(actor.drawnBody(), actor.pose().yaw, g.anchor) : null;
        if (!p) { g.anchor = null; g.anchorActor = null; }
        return p;
      } });
      totalBounces += g.state.bounces - previous.bounces;
      if (g.state.embedded !== null && previous.embedded === null) {
        const actor = ctx.world.actors.find(a => a.id === g.state.embedded);
        if (actor) {
          g.anchor = bindGrenade(actor.drawnBody(), actor.pose().yaw, g.state.pos, g.state.direction);
          g.anchorActor = actor.id;
          embeds++;
          // A modest puncture/flinch, then the fuse supplies the killing blast.
          const wound = actor.hit(sub(g.state.pos, scale(g.state.direction, GRENADE.embedDepthM)),
            g.state.direction, { weapon: 'explosion' });
          if (wound) spillVerdict(ctx, actor, wound);
          ctx.telemetry.telemetry.event('grenade-embed', { id: g.id, actorId: actor.id });
        }
      }
      if (g.state.detonated) {
        const at = g.state.pos;
        lastExplosion = { at: [...at], embedded: g.state.embedded, id: g.id };
        detonations++;
        g.mesh.visible = false; spare.push(g.mesh); live.splice(i, 1);
        deps.detonate(at);
        for (const direction of grenadeFragments(g.id)) {
          const mesh = fragmentPool.pop(); if (!mesh) break;
          const f = { state: { pos: [...at] as Vec3, vel: scale(direction, GRENADE.fragmentSpeedMps), age: 0 }, mesh, host: g.state.embedded };
          fragments.push(f); mesh.visible = true; draw(mesh, f.state.pos, direction, 0);
        }
        ctx.telemetry.telemetry.event('grenade-detonate', { id: g.id, embedded: g.state.embedded });
      } else draw(g.mesh, g.state.pos, g.state.direction, g.state.spin);
    }
  }
  return { launch, tick, debug: () => ({ tuning: { ...GRENADE }, launched, detonations, embeds,
    bounces: totalBounces, fragmentHits, fragments: fragments.length, lastLaunch, lastExplosion,
    live: live.map(g => ({ id: g.id, ...g.state, visible: g.mesh.visible,
      anchorErrorM: g.anchor && g.state.embedded !== null ? (() => {
        const actor = ctx.world.actors.find(a => a.id === g.state.embedded);
        const p = actor && attachedGrenade(actor.drawnBody(), actor.pose().yaw, g.anchor!);
        return p ? len(sub(g.state.pos, p.pos)) : null;
      })() : null })),
  }) };
}
