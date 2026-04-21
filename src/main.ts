import * as THREE from 'three';
import { createRenderer } from './engine/renderer';
import { createScheduler } from './engine/loop';
import { createInputState, attachInput } from './engine/input';

const mount = document.getElementById('app')!;
const { scene, canvas, setRenderCallback } = createRenderer(mount);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x3a2a2a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const input = createInputState();
attachInput(canvas, input);

const scheduler = createScheduler({ stepSec: 1 / 60, maxStepsPerTick: 5 });

function fixedStep(_dt: number) {}

setRenderCallback((realDt) => scheduler.tick(realDt, fixedStep));

console.log('[blud] boot');
