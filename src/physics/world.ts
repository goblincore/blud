import RAPIER from '@dimforge/rapier3d-compat';

export interface PhysicsWorld {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  step(dtSec: number): void;
}

export async function initPhysics(): Promise<PhysicsWorld> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -25, z: 0 });
  world.timestep = 1 / 60;

  return {
    rapier: RAPIER,
    world,
    step(_dtSec: number) {
      world.step();
    },
  };
}
