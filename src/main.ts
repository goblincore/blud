import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';
import { initPhysics } from './physics/world';
import { buildArena } from './game/arena';

async function main() {
  const mount = document.getElementById('app')!;
  const { scene, canvas, setRenderCallback } = createRenderer(mount);

  const physics = await initPhysics();
  buildArena(scene, physics.world);

  const input = createInputState();
  attachInput(canvas, input);

  const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });
  function fixedStep(dt: number) {
    physics.step(dt);
  }

  setRenderCallback((realDt) => scheduler.tick(realDt, fixedStep));

  console.log('[blud] boot');
}

main().catch((err) => console.error('[blud] boot failed', err));
