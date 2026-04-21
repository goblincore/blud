import * as THREE from 'three';

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  setRenderCallback(cb: (dtSec: number) => void): void;
}

export function createRenderer(mount: HTMLElement): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x1a1116);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1116, 10, 60);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  camera.position.set(0, 1.7, 6);

  const sun = new THREE.DirectionalLight(0xffeccd, 1.1);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x4a3a40, 0.6));

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  let lastTime = performance.now();
  let cb: (dtSec: number) => void = () => {};
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    cb(dt);
    renderer.render(scene, camera);
  });

  return {
    renderer,
    scene,
    camera,
    canvas: renderer.domElement,
    setRenderCallback(fn) { cb = fn; },
  };
}
