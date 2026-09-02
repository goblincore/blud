// Wraps a shipped body/chunk view so it can be drawn EITHER through its own
// proxy-box march (unchanged) OR through a per-frame surface-nets hull whose
// fragments run the same march shader as a short band walk (spec §3, §5).
// Same interface as the inner view where the actor needs it, plus the
// renderer toggle and the three knobs. Zero changes to march.wgsl.ts: the
// hull material is createMarchMaterial with the `rays` override.
import * as THREE from 'three/webgpu';
import { cameraPosition, float, length, mul, normalize, positionWorld, sub, uniform, add } from 'three/tsl';
import { createMarchMaterial, marchBody, type MarchUniforms } from './zombie-gpu';
import { createSurfaceNetsCompute, type SurfaceNetsCompute, type HullExtractStats } from './surface-nets-compute';

export type HullRenderer = 'march' | 'hull';
export interface HullKnobs { cell: number; band: number; steps: number }
/** steps 8, not the spec's 4: smooth-min blend zones under-report distance
 *  (gradient ~0.55) and the wound zone steps at 0.6*d by design, so a 4-step
 *  walk from +band leaves gaps at neck/shoulder/wrist and beside craters.
 *  8 closes them at 2 cm band; 12 is indistinguishable (2026-09-02 notes). */
export const DEFAULT_HULL_KNOBS: HullKnobs = { cell: 0.02, band: 0.02, steps: 8 };

/** The subset of ZombieGpuView / ChunkGpuView the wrapper relies on. */
export interface HullInnerView {
  object: THREE.Object3D;
  uniforms: MarchUniforms;
  dataTexture: THREE.Texture;
  volumeTexture: THREE.Texture;
  dispose(): void;
  update?(...args: never[]): void;
  setWounds?(...args: never[]): void;
}

export interface HullRefineDeps {
  renderer: THREE.WebGPURenderer;
  makeCompute?: (inner: HullInnerView) => SurfaceNetsCompute;
  makeMaterial?: (inner: HullInnerView, hullMarchCfg: ReturnType<typeof uniform>, band: ReturnType<typeof uniform>) => THREE.Material;
}

export interface HullRefineView<Inner extends HullInnerView = HullInnerView> {
  inner: Inner;
  hullObject: THREE.Mesh;
  hullMarchCfg: { value: THREE.Vector3 };
  readonly renderer: HullRenderer;
  setRenderer(r: HullRenderer): void;
  knobs(): HullKnobs;
  setKnobs(k: Partial<HullKnobs>): void;
  /** Delegates to inner.update, then (hull on) extracts this frame's hull. */
  update(...args: Parameters<NonNullable<Inner['update']>>): void;
  setWounds(...args: Parameters<NonNullable<Inner['setWounds']>>): void;
  lastExtract(): HullExtractStats | null;
  compute: SurfaceNetsCompute;
  dispose(): void;
}

function defaultMaterial(inner: HullInnerView, hullMarchCfg: ReturnType<typeof uniform>, band: ReturnType<typeof uniform>) {
  const rayDir = normalize(sub(positionWorld, cameraPosition));
  const hullT = length(sub(positionWorld, cameraPosition));
  // tMaxBox = length(worldPos - camPos) inside marchBody, so a point pushed
  // 2*band down the ray bounds the walk to the band (spec §5).
  const farPoint = add(positionWorld, mul(rayDir, mul(band as never, float(2.0))));
  return createMarchMaterial(
    inner.dataTexture, inner.volumeTexture, inner.uniforms, marchBody,
    undefined, undefined, undefined, undefined, undefined, undefined,
    { worldPos: farPoint, startT: hullT, marchCfg: hullMarchCfg, side: THREE.FrontSide },
  );
}

export function wrapHullRefine<Inner extends HullInnerView>(
  inner: Inner, deps: HullRefineDeps,
): HullRefineView<Inner> {
  const knobs: HullKnobs = { ...DEFAULT_HULL_KNOBS };
  const src = inner.uniforms.marchCfg.value;
  // y = step multiplier. PLAIN sphere tracing (1.0), NOT the inner view's
  // value: the lab default is 0.6, and a 4-step walk from +band at 0.6 stops
  // 0.4^4 * band = 1.28 mm short of a 1.2 mm hit epsilon — every hull
  // fragment missed and discarded (dispatch task 5, 2026-09-02). The game
  // page runs 1.0 for the same reason (GAME_OMEGA, perf r2 task 2).
  const hullMarchCfg = uniform(new THREE.Vector3(knobs.steps, 1.0, src.z));
  const uBand = uniform(knobs.band);
  const compute = (deps.makeCompute ?? ((i) => createSurfaceNetsCompute(i.dataTexture, i.volumeTexture, i.uniforms)))(inner);
  const material = (deps.makeMaterial ?? defaultMaterial)(inner, hullMarchCfg, uBand);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', compute.soupAttribute);
  geometry.setIndirect(compute.indirect);
  const hull = new THREE.Mesh(geometry, material);
  hull.frustumCulled = false;
  hull.visible = false;
  hull.layers.mask = inner.object.layers.mask;

  let renderer: HullRenderer = 'march';
  let last: HullExtractStats | null = null;
  const centre = new THREE.Vector3();
  // Group distortion factor for the block-live test (spec §4). packBody
  // stores it per group; the zombie's max is 1.0 (isotropic capsules). A
  // page rendering another cast sets it through setKnobs({ distort }).
  let distort = 1.0;

  function extractNow() {
    centre.copy(inner.object.position);
    hull.position.copy(centre);
    last = compute.extract(deps.renderer, centre, inner.uniforms.bodyHalf.value, centre,
      knobs.cell, knobs.band, distort);
  }

  return {
    inner,
    hullObject: hull,
    hullMarchCfg,
    get renderer() { return renderer; },
    setRenderer(r) {
      renderer = r;
      inner.object.visible = r === 'march';
      hull.visible = r === 'hull';
    },
    knobs() { return { ...knobs }; },
    setKnobs(k) {
      Object.assign(knobs, k);
      hullMarchCfg.value.x = knobs.steps;
      uBand.value = knobs.band;
      if ('distort' in k) distort = (k as { distort: number }).distort;
    },
    update(...args) {
      inner.update?.(...(args as never[]));
      if (renderer === 'hull') extractNow();
    },
    setWounds(...args) { inner.setWounds?.(...(args as never[])); },
    lastExtract() { return last; },
    compute,
    dispose() { compute.dispose(); geometry.dispose(); (material as THREE.Material).dispose(); inner.dispose(); },
  };
}
