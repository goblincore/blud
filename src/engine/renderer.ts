import * as THREE from 'three';

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  setRenderCallback(cb: (dtSec: number) => void): void;
}

/** Max render resolution (retro + performance). Canvas is stretched to fit window via CSS. */
const MAX_RENDER_W = 960;
const MAX_RENDER_H = 540;

export function createRenderer(mount: HTMLElement): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1); // explicit: we drive internal size ourselves
  renderer.setClearColor(0x1a1116);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1116, 10, 60);

  const camera = new THREE.PerspectiveCamera(
    75,
    1, // placeholder; resize() sets real aspect
    0.1,
    200,
  );
  camera.position.set(0, 1.7, 6);

  const sun = new THREE.DirectionalLight(0xffeccd, 1.1);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x4a3a40, 0.6));

  function resize() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const winAspect = winW / winH;
    // Fit inside the max resolution while preserving window aspect
    let renderW: number;
    let renderH: number;
    if (winAspect > MAX_RENDER_W / MAX_RENDER_H) {
      renderH = Math.min(winH, MAX_RENDER_H);
      renderW = Math.round(renderH * winAspect);
      if (renderW > MAX_RENDER_W) { renderW = MAX_RENDER_W; renderH = Math.round(renderW / winAspect); }
    } else {
      renderW = Math.min(winW, MAX_RENDER_W);
      renderH = Math.round(renderW / winAspect);
      if (renderH > MAX_RENDER_H) { renderH = MAX_RENDER_H; renderW = Math.round(renderH * winAspect); }
    }
    // `false` = don't update CSS style; we control CSS ourselves for the stretch.
    renderer.setSize(renderW, renderH, false);
    camera.aspect = winAspect;
    camera.updateProjectionMatrix();

    // CSS stretch to fill window, pixelated (retro look).
    const el = renderer.domElement;
    el.style.width = winW + 'px';
    el.style.height = winH + 'px';
    el.style.imageRendering = 'pixelated';
  }
  resize();
  window.addEventListener('resize', resize);

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
