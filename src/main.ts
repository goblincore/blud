import * as THREE from 'three';
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';
import { initPhysics } from './physics/world';
import { buildArena } from './game/arena';
import { createPlayer } from './game/player';
import { createDebugHud } from './ui/debug-hud';

async function main() {
  const mount = document.getElementById('app')!;
  const { scene, camera, canvas, setRenderCallback } = createRenderer(mount);

  const physics = await initPhysics();
  buildArena(scene, physics.world);

  const input = createInputState();
  attachInput(canvas, input);

  const player = createPlayer({
    world: physics.world,
    camera,
    spawn: new THREE.Vector3(0, 2, 0),
  });

  const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
  function fixedStep(dt: number) {
    physics.step(dt);
    player.update(dt, input);
  }

  const hud = createDebugHud(document.getElementById('hud')!);

  setRenderCallback((realDt) => {
    scheduler.tick(realDt, fixedStep);
    hud.update(realDt, player.position());
  });

  console.log('[blud] boot');
}

main().catch((err) => console.error('[blud] boot failed', err));
