import * as THREE from 'three';
import { createRenderer } from './engine/renderer';

const mount = document.getElementById('app')!;
const { scene } = createRenderer(mount);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x3a2a2a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

console.log('[blud] boot');
