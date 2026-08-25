import * as THREE from 'three/webgpu';
import type { Box, EnclosureWalls, Vec3 } from '../ambient';

/**
 * A toggleable Cornell-box enclosure for the bounce spike.
 *
 * SCOPE. This is the same category of object as the lab's existing reference
 * cube — a thing to look at, not a room format. The spec is explicit that P1
 * must not depend on a level concept, because there isn't one: `src/game/
 * arena.ts` and `src/sim/arenagen` are pre-SDF WIP the owner has moved past.
 * A real room editor is P2 and is blocked on deciding that levels are next.
 *
 * The walls are plain unlit meshes. They are what the character's bounce is
 * derived FROM; they are not themselves lit by it, and giving them real
 * materials would only invite comparing two different lighting models in one
 * frame.
 */

/** The room, in world metres. The floor sits at y=0 with the lab's floor. */
export const ENCLOSURE_BOX: Box = {
  min: [-2, 0, -2],
  max: [2, 3.2, 2],
};

/**
 * Classic Cornell colours: red left, green right, white elsewhere. Chosen
 * because the whole point of the spike is to see whether a wall's hue
 * reaches the character's shadow side, and these are the two hues the eye
 * is least able to explain away.
 */
export const DEFAULT_WALLS: EnclosureWalls = {
  negX: [0.63, 0.06, 0.05],
  posX: [0.15, 0.48, 0.09],
  negY: [0.73, 0.71, 0.68],
  posY: [0.73, 0.72, 0.70],
  negZ: [0.73, 0.71, 0.68],
  posZ: [0.73, 0.71, 0.68],
};

export type WallKey = keyof EnclosureWalls;

const WALL_ORDER: WallKey[] = ['negX', 'posX', 'negY', 'posY', 'negZ', 'posZ'];

export interface Enclosure {
  group: THREE.Group;
  walls: EnclosureWalls;
  setWall(key: WallKey, color: Vec3): void;
  setCeiling(on: boolean): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

export function createEnclosure(): Enclosure {
  const group = new THREE.Group();
  group.name = 'bounce-enclosure';
  group.visible = false;

  const walls: EnclosureWalls = {
    negX: [...DEFAULT_WALLS.negX] as Vec3,
    posX: [...DEFAULT_WALLS.posX] as Vec3,
    negY: [...DEFAULT_WALLS.negY] as Vec3,
    posY: [...DEFAULT_WALLS.posY] as Vec3,
    negZ: [...DEFAULT_WALLS.negZ] as Vec3,
    posZ: [...DEFAULT_WALLS.posZ] as Vec3,
  };

  const w = ENCLOSURE_BOX.max[0] - ENCLOSURE_BOX.min[0];
  const h = ENCLOSURE_BOX.max[1] - ENCLOSURE_BOX.min[1];
  const d = ENCLOSURE_BOX.max[2] - ENCLOSURE_BOX.min[2];
  const cx = (ENCLOSURE_BOX.min[0] + ENCLOSURE_BOX.max[0]) / 2;
  const cy = (ENCLOSURE_BOX.min[1] + ENCLOSURE_BOX.max[1]) / 2;
  const cz = (ENCLOSURE_BOX.min[2] + ENCLOSURE_BOX.max[2]) / 2;

  const meshes = new Map<WallKey, THREE.Mesh>();

  for (const key of WALL_ORDER) {
    let geo: THREE.PlaneGeometry;
    const mesh = new THREE.Mesh();
    switch (key) {
      case 'negX':
        geo = new THREE.PlaneGeometry(d, h);
        mesh.position.set(ENCLOSURE_BOX.min[0], cy, cz);
        mesh.rotation.y = Math.PI / 2;
        break;
      case 'posX':
        geo = new THREE.PlaneGeometry(d, h);
        mesh.position.set(ENCLOSURE_BOX.max[0], cy, cz);
        mesh.rotation.y = -Math.PI / 2;
        break;
      case 'negY':
        geo = new THREE.PlaneGeometry(w, d);
        mesh.position.set(cx, ENCLOSURE_BOX.min[1], cz);
        mesh.rotation.x = -Math.PI / 2;
        break;
      case 'posY':
        geo = new THREE.PlaneGeometry(w, d);
        mesh.position.set(cx, ENCLOSURE_BOX.max[1], cz);
        mesh.rotation.x = Math.PI / 2;
        break;
      case 'negZ':
        geo = new THREE.PlaneGeometry(w, h);
        mesh.position.set(cx, cy, ENCLOSURE_BOX.min[2]);
        break;
      default:
        geo = new THREE.PlaneGeometry(w, h);
        mesh.position.set(cx, cy, ENCLOSURE_BOX.max[2]);
        mesh.rotation.y = Math.PI;
        break;
    }
    const c = walls[key];
    mesh.geometry = geo;
    // SHADED, not flat. These started as MeshBasicMaterial on the reasoning
    // that unlit walls keep two lighting models out of one frame — which was
    // wrong on contact with the eye: unlit planes read as flat cardboard, and
    // a Cornell box's whole character is the soft gradient down a shaded wall.
    // MeshStandardMaterial picks up the lab's existing DirectionalLight, so
    // the room looks like a room.
    //
    // This does NOT touch the bounce maths. `ambientAt` reads wall ALBEDO
    // from uniforms, never the rendered pixels, so how the wall is displayed
    // and what it bounces stay independent — which is what lets the display
    // change freely without moving the thing under judgement.
    mesh.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(c[0], c[1], c[2]),
      roughness: 1,
      side: THREE.DoubleSide,
    });
    mesh.name = `wall-${key}`;
    meshes.set(key, mesh);
    group.add(mesh);
  }

  return {
    group,
    walls,
    setWall(key, color) {
      walls[key] = [...color] as Vec3;
      const m = meshes.get(key);
      if (m) {
        (m.material as THREE.MeshStandardMaterial).color.setRGB(color[0], color[1], color[2]);
      }
    },
    setCeiling(on) {
      const m = meshes.get('posY');
      if (m) m.visible = on;
    },
    setVisible(on) {
      group.visible = on;
    },
    dispose() {
      for (const m of meshes.values()) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}
