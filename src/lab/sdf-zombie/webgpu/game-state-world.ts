// src/lab/sdf-zombie/webgpu/game-state-world.ts
//
// WORLD slice of the GameContext decomposition. The level and the state the
// per-frame actor cull reads: the collision boxes every mover clamps against,
// the live actor list with its visibility-cull scratch (frustum, projected
// matrix, body sphere, dwell map, counters, coverage readings and the actor
// sight vector), the encounter navigation graph and director with their
// per-agent homes, the level surface specs and the meshes/material groups
// built from them, the room-probe grids, and the soldier-corpse bake handles
// with the baked-chunk materials that ride the flashlight beam.
//
// Pure by construction: the only non-local imports are erased `import type`s,
// so this module carries no runtime Three.js/WebGPU dependency. Fields are
// plain and mutable — no getters, setters, `readonly` or `Object.freeze` —
// because the codemod moves the original assignments onto these fields and an
// accessor would change evaluation timing around the pixel gate.
//
// Computed initializers (`levelColliders()`, `new THREE.Frustum()`,
// `createEncounterDirector(...)`, `createRoomProbes({ ... })`, ...) get a
// type-correct placeholder in the factory; the codemod supplies the real value
// at the binding's original line. Every call still hands out fresh containers.

import type * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
import type { ActiveLevel } from './active-level';
import type { BakedChunkMaterial } from './baked-chunks';
import type { EncounterNavigation } from './encounter-navigation';
import type { ZombieActor } from './game-actor';
import type { Aabb } from './game-level';
import type { RoomProbes } from './room-probes';
import type { OuterHull } from './shell-hull-outer';
import type { ThemeMaterialSet } from '../../../game/level/theme-material-set';

/** Type of `createEncounterDirector()` (no exported name in its module). */
type EncounterDirector = ReturnType<typeof import('./encounter-director').createEncounterDirector>;
/** Type of `levelSurfaces()` (no exported name; the spec is structural). */
type LevelSurfaces = ReturnType<typeof import('./game-level').levelSurfaces>;
/** Type of `createSoldierCorpseBakes()` (no exported name in its module). */
type SoldierCorpseBakes = ReturnType<typeof import('./soldier-corpse-bake').createSoldierCorpseBakes>;

/**
 * Placeholder for a binding whose real value is a live handle built at that
 * binding's original line. The field is non-null in game-main.ts, so the
 * placeholder must satisfy the declared type even though no code reads it
 * before the original assignment runs.
 */
function unbuilt<T>(): T {
  return null as unknown as T;
}

export interface WorldState {
  /** The loaded level (the ring testbed, or ?level=<id>). Every reader of
   *  rooms, corridors, furniture, start, colliders and surfaces goes through it. */
  level: ActiveLevel;
  /** Gates opened so far (authored levels). */
  openGates: Set<string>;
  /** Gate meshes by gate id, hidden when the gate opens. */
  gateMeshes: Map<string, THREE.Object3D>;
  /** Mesh key: what the level's art file placed, or null (no art / `?art=0`). */
  art: { file: string; meshes: number; instanced: number; instances: number; objects: THREE.Object3D[] } | null;
  /** Collision boxes for the level — the same list the player and gibs clamp
   *  against, split around every doorway so pieces can sail out of doors. */
  colliders: Aabb[];
  /** Live actors; the cull pass reads this and the spawn path pushes to it. */
  actors: ZombieActor[];
  /** Actor-visibility cull scratch frustum; the codemod supplies the real one. */
  frustum: THREE.Frustum;
  /** Scratch matrix for the actor cull's screen-space projection. */
  projScreen: THREE.Matrix4;
  /** Reused sphere for the actor cull's body-bounds test (radius 1.1). */
  bodySphere: THREE.Sphere;
  /** Per-actor last-seen SIM time in ms; drives the cull dwell. */
  lastSeenMs: Map<number, number>;
  /** Bodies visible/total this cull pass. */
  cullCounts: { visible: number; total: number };
  /** Screen-coverage readings for the cull HUD. */
  coverage: { screenFrac: number; nearestM: number; biggestFrac: number };
  /** Scratch direction/point vector for the actor sight test. */
  sightA: [number, number, number];
  /** Navigation graph the encounter director paths over. */
  encounterNav: EncounterNavigation;
  /** The encounter director itself (per-agent memory, routes, sight). */
  encounter: EncounterDirector;
  /** Per-actor home point the encounter director returns agents to. */
  encounterHomes: Map<number, Vec3>;
  /** Wall/floor/ceiling plane and box specs the level meshes are built from. */
  surfaces: LevelSurfaces;
  /** Root group holding every level mesh (`ring-level`). */
  levelGroup: THREE.Group;
  /** Wall/floor/perimeter materials for the level surfaces. */
  stoneSet: ThemeMaterialSet;
  /** Per-room light lists registered for the level's material nodes. */
  levelLightLists: Map<number, THREE.LightsNode>;
  /** Level materials whose lights are restamped each frame. */
  levelNodeMaterials: THREE.NodeMaterial[];
  /** The room accent point lights, pooled with the explosion lights. */
  accentGroup: THREE.Group;
  /** Conservative outer shell hull; a measurement instrument until consumed. */
  outerHull: OuterHull;
  /** Per-room baked probe grids, stamped onto a body at spawn. */
  roomProbes: RoomProbes;
  /** Completed-corpse baker, or null until the chunk spawner exists. */
  soldierCorpses: SoldierCorpseBakes | null;
  /** Every material instance that must ride the flashlight beam. */
  litChunkMaterials: BakedChunkMaterial[];
  /** Persistent parent every baked corpse mesh is added to. */
  soldierCorpseGroup: THREE.Group;
}

/** Every call returns a fresh object, nested arrays, objects and maps included. */
export function makeWorldState(): WorldState {
  return {
    level: unbuilt<ActiveLevel>(),
    openGates: new Set<string>(),
    gateMeshes: new Map<string, THREE.Object3D>(),
    art: null,
    colliders: [],
    actors: [],
    frustum: unbuilt<THREE.Frustum>(),
    projScreen: unbuilt<THREE.Matrix4>(),
    bodySphere: unbuilt<THREE.Sphere>(),
    lastSeenMs: new Map<number, number>(),
    cullCounts: { visible: 0, total: 0 },
    coverage: { screenFrac: 0, nearestM: 0, biggestFrac: 0 },
    sightA: [0, 0, 0],
    encounterNav: unbuilt<EncounterNavigation>(),
    encounter: unbuilt<EncounterDirector>(),
    encounterHomes: new Map<number, Vec3>(),
    surfaces: { planes: [], boxes: [] },
    levelGroup: unbuilt<THREE.Group>(),
    stoneSet: unbuilt<ThemeMaterialSet>(),
    levelLightLists: new Map<number, THREE.LightsNode>(),
    levelNodeMaterials: [],
    accentGroup: unbuilt<THREE.Group>(),
    outerHull: unbuilt<OuterHull>(),
    roomProbes: unbuilt<RoomProbes>(),
    soldierCorpses: null,
    litChunkMaterials: [],
    soldierCorpseGroup: unbuilt<THREE.Group>(),
  };
}

/** Old `game-main.ts` binding name → path on the `world` slice. */
export const WORLD_BINDINGS = {
  level: 'world.level',
  openGates: 'world.openGates',
  gateMeshes: 'world.gateMeshes',
  art: 'world.art',
  colliders: 'world.colliders',
  actors: 'world.actors',
  frustum: 'world.frustum',
  projScreen: 'world.projScreen',
  bodySphere: 'world.bodySphere',
  lastSeenMs: 'world.lastSeenMs',
  cullCounts: 'world.cullCounts',
  coverage: 'world.coverage',
  sightA: 'world.sightA',
  encounterNav: 'world.encounterNav',
  encounter: 'world.encounter',
  encounterHomes: 'world.encounterHomes',
  surfaces: 'world.surfaces',
  levelGroup: 'world.levelGroup',
  stoneSet: 'world.stoneSet',
  levelLightLists: 'world.levelLightLists',
  levelNodeMaterials: 'world.levelNodeMaterials',
  accentGroup: 'world.accentGroup',
  outerHull: 'world.outerHull',
  roomProbes: 'world.roomProbes',
  soldierCorpses: 'world.soldierCorpses',
  litChunkMaterials: 'world.litChunkMaterials',
  soldierCorpseGroup: 'world.soldierCorpseGroup',
} as const;
