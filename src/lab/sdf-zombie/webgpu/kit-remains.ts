// src/lab/sdf-zombie/webgpu/kit-remains.ts
//
// WHO HOLDS A KIT AFTER ITS BODY IS GONE. A gibbed actor leaves the world and its view retires (game-gib-spawn.ts
// retireActor), so what it dropped (character-view.ts surrenderEquipment) needs another owner: this one steps it until
// it lands and disposes it when it ages out. Bounded by count and by the index entries kept drawing: a kit costs the
// same draws lying on the floor as it did walking, and the sculpted kits are 700k entries. Oldest goes first.
//
// No three.js at runtime: the state slice (game-state-gibs.ts) builds one of these, and the tests drive it with fakes.
import type { DebrisGround } from '../debris-ground';
import type { Vec3 } from '../types';
import type { SurrenderedEquipment } from './character-view';
import type { KitBurstPieceReport } from './kit-burst-mesh';

export const KIT_REMAINS = {
  /** Bodies' worth of kit and gun kept. */
  maxBodies: 16,
  /** Index entries kept across every wreck (about 800k triangles: three of the heaviest sculpted kits, or plenty of
   *  the WAM kits, which are small). The newest is always kept, whatever it costs. */
  maxIndices: 2_400_000,
  /** A gun still moving after this stops where it is (a gun on a crate that floorAt does not know of). */
  propMaxAgeSec: 6,
} as const;

export interface KitRemainsReport {
  pieces: KitBurstPieceReport[];
  prop: { pos: Vec3; resting: boolean } | null;
  resting: boolean;
}

export interface KitRemains {
  add(left: SurrenderedEquipment): void;
  /** Advance whatever still moves. `ground` may be null when nothing moves (`moving` is false). */
  step(dt: number, ground: DebrisGround | null): void;
  /** Anything still in the air: the tick skips building a ground otherwise. */
  readonly moving: boolean;
  readonly count: number;
  report(): KitRemainsReport[];
  /** Dispose everything (a cast rebuild). */
  clear(): void;
}

interface Entry { left: SurrenderedEquipment; moving: boolean; age: number }

export function createKitRemains(limits: { maxBodies: number; maxIndices: number } = KIT_REMAINS): KitRemains {
  const entries: Entry[] = [];
  const free = (e: Entry) => {
    e.left.kit?.object.removeFromParent();
    e.left.kit?.dispose();
    e.left.prop?.object.removeFromParent();
    e.left.prop?.dispose();
  };
  const indices = () => entries.reduce((n, e) => n + (e.left.wreck?.indexCount ?? 0), 0);
  return {
    get moving() { return entries.some(e => e.moving); },
    get count() { return entries.length; },
    add(left) {
      entries.push({ left, moving: true, age: 0 });
      while (entries.length > 1 && (entries.length > limits.maxBodies || indices() > limits.maxIndices)) free(entries.shift()!);
    },
    step(dt, ground) {
      if (!ground) return;
      for (const e of entries) {
        if (!e.moving) continue;
        e.age += dt;
        const { wreck, prop } = e.left;
        const kitMoving = wreck?.step(dt, ground) ?? false;
        if (prop && e.age < KIT_REMAINS.propMaxAgeSec) prop.step(dt, 0, ground);
        const propMoving = !!prop && e.age < KIT_REMAINS.propMaxAgeSec && prop.dropped()?.resting === false;
        e.moving = kitMoving || propMoving;
      }
    },
    report() {
      return entries.map(e => ({ pieces: e.left.wreck?.report() ?? [], prop: e.left.prop?.dropped() ?? null, resting: !e.moving }));
    },
    clear() {
      for (const e of entries) free(e);
      entries.length = 0;
    },
  };
}
