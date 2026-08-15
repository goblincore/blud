// src/lab/sdf-zombie/lab-main.ts
import * as THREE from 'three';
import { createRenderer } from '../../engine/renderer';
import { VERT, FRAG_SPIKE } from './march.glsl';

const mount = document.getElementById('app');
if (!mount) throw new Error('#app not found');

const { scene, camera } = createRenderer(mount);

// Ground plane — a polygonal surface the raymarched blobs must composite against.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x3a2a30, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// A reference cube so depth interleaving is obvious by eye.
const refCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.4, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x7080a0 }),
);
refCube.position.set(0.6, 0.2, 0.3);
scene.add(refCube);

camera.position.set(0, 1.4, 3.2);
camera.lookAt(0, 0.9, 0);

const spikeMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  // r170 note: with GLSL3 on WebGL2, gl_FragDepth is core — three aliases
  // `gl_FragDepthEXT gl_FragDepth` unconditionally (WebGLProgram.js) and
  // `extensions` only accepts clipCullDistance/multiDraw. The plan's
  // `extensions: { fragDepth: true }` was a WebGL1-era mechanism removed
  // from three's type + runtime; it fails tsc here and does nothing at runtime.
  side: THREE.BackSide,
  uniforms: {
    uSphereCenter: { value: new THREE.Vector3(0, 0.9, 0) },
    uSphereRadius: { value: 0.45 },
  },
  vertexShader: VERT,
  fragmentShader: FRAG_SPIKE,
});

const proxy = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), spikeMat);
proxy.position.set(0, 0.9, 0);
scene.add(proxy);
