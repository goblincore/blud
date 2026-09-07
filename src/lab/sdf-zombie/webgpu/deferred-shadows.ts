// src/lab/sdf-zombie/webgpu/deferred-shadows.ts
//
// M2 task 4: the explicit flashlight shadow maps for the hybrid deferred
// layer (spec: docs/superpowers/specs/2026-09-06-hybrid-deferred-m2-design.md,
// "Flashlight shadow contract").
//
// TWO 1024x1024 MAPS BY DEFAULT, ONE LIGHT. The flashlight is the only
// shadowed light. Each map is the same view of the world from the light —
// one shared perspective camera — differing only in WHICH casters rasterise:
//
//   full        level geometry + the inflated character shadow proxies
//               (SHADOW_HULL_LAYER). Sampled by 'full' receivers (standard
//               opaque mesh surfaces) so characters cast onto the room.
//   level-only  level geometry WITHOUT the flesh proxies. Sampled by
//               'level-only' receivers (flesh, bones, equipment riding an
//               actor) so a character's own inflated hull cannot swallow its
//               illumination.
//
// DEPTH AS COLOUR. Each map stores the light's PROJECTED clip depth (z/w,
// [0,1], far cleared to 1) in an R32F colour attachment, next to a real
// hardware depth buffer used for ordinary less-equal rasterisation. The two
// agree by construction (same view-projection, same triangle coverage), and
// the deferred layer samples the R32F with plain textureLoad — no depth-texture
// binding type, no comparison samplers, exactly the access the rest of the
// G-buffer uses. R32F is colour-renderable in core WebGPU (unfilterable,
// which is why every filter on the texture is NEAREST — also required by the
// bounded PCF kernel, which never blends texels).
//
// EXPLICIT RASTER PASSES. Nothing here depends on three's automatic shadow
// traversal: `renderer.shadowMap` is never touched and the light's own
// `light.shadow.map` is never read. The maps are (re)rendered in `update()` —
// called by the game BEFORE the deferred layer render, so a frame never
// samples last frame's silhouettes ("current-frame light motion").
// `enabled: false` skips BOTH map renders entirely (this is what
// ?spotshadow=0 must do) and clears the maps to far so a stale silhouette can
// never be sampled on a later re-enable or first boot.
//
// SOURCE-REFERENCING CLONES. Casters are never reparented and their materials
// are never mutated. Each collected source gets a clone MESH per map that
// shares the source's GEOMETRY (and, for InstancedMesh, the very
// `instanceMatrix` attribute object — instance data is current by
// construction), with `clone.matrix` copied from the source's CURRENT
// matrixWorld every update (sources get updateWorldMatrix first, so a caster
// posed earlier in the same frame casts from its same-frame pose). Alpha
// cutouts are reproduced by a cached per-source-material depth material that
// discards below the source's own alphaTest using the source's own map.
// Casters whose vertex path cannot be reproduced (SkinnedMesh, BatchedMesh)
// are SKIPPED and NAMED in diagnostics().unsupported — never silently
// replaced by a box.
//
// ELIGIBILITY IS THE EXISTING ONE: an object casts if (and only if) it is
// visible (its whole ancestor chain included), `castShadow === true`, and its
// object layer mask intersects the requested caster layer set. The shrunken
// occlusion hull (castShadow false, OCCLUDER_LAYER) therefore never casts,
// exactly as in the legacy rig; viewmodels on their own layer are excluded by
// the layer sets the caller passes; SDF helper twins and bounding boxes live
// on layers outside those sets — a helper that SET castShadow on a caster
// layer would be a caller bug, not something this module can second-guess.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, Discard, texture, positionWorld, uniform, vec4, uv } from 'three/tsl';
import { MAX_DEFERRED_LIGHTS } from './deferred-lighting';
import type { DeferredFlashlightShadowBinding } from './deferred-layer';

/** Projected-depth bias, in [0,1] clip-depth units. Named constant per the
 *  spec ("bias and kernel size are named constants"). Same order as the
 *  legacy rig's spot.shadow.bias (-0.002); positive here because the
 *  comparison is `fragment <= stored + bias` (legacy three biases the other
 *  side of a reversed comparison). Tune only with the on/off captures. */
export const FLASHLIGHT_SHADOW_BIAS = 0.0025;

/** PCF kernel radius in map texels. 1 = the 3x3 manual depth comparison the
 *  spec allows. The comparison loop is generated from this constant. */
export const FLASHLIGHT_SHADOW_KERNEL_RADIUS = 1;

const FAR_CLEAR = new THREE.Color(1, 0, 0); // r = far projected depth

export interface DeferredShadowUpdateOptions {
  /** false skips BOTH map renders entirely (renderedMaps 0) and clears the
   *  maps to far on the enable->disable transition. */
  enabled: boolean;
  /** Object layer(s) whose members cast into the FULL map (level geometry +
   *  the inflated proxies: SHADOW_HULL_LAYER). */
  fullCasterLayers: number | readonly number[];
  /** Object layer(s) whose members cast into the LEVEL-ONLY map. */
  levelCasterLayers: number | readonly number[];
}

export interface DeferredFlashlightShadowDiagnostics {
  /** Shadow-map raster passes submitted by the last update (0 or 2). */
  renderedMaps: number;
  /** Casters collected for the full map. */
  fullCasters: number;
  /** Casters collected for the level-only map. */
  levelCasters: number;
  /** Map edge length in texels (square maps). */
  size: number;
  /** The last update's enabled flag. */
  enabled: boolean;
  /** Casters SKIPPED because their vertex path cannot be reproduced by a
   *  source-referencing clone (SkinnedMesh, BatchedMesh, ...), named per the
   *  spec ("report and resolve that limitation instead of silently casting
   *  its box"). Additive beyond the planned interface — without it the skip
   *  would be exactly the silent drop the spec forbids. */
  unsupported: string[];
}

export interface DeferredFlashlightShadowFactory {
  /** Collect casters, sync clones, derive the light camera from the spot's
   *  CURRENT pose, and (when enabled) submit the two depth raster passes.
   *  Call once per frame, BEFORE the deferred layer's render. */
  update(scene: THREE.Scene, light: THREE.SpotLight, options: DeferredShadowUpdateOptions): void;
  /** The per-frame binding for deferredLayer.setFlashlightShadow. The
   *  viewProjection matrix is the factory's LIVE matrix: it is updated in
   *  place by every update(), so a binding stored once still tracks the
   *  current frame — the layer re-reads the stored binding every render.
   *  `samplingEnabled` (default true) is the diagnostic sampling toggle:
   *  false keeps both maps rendering but tells the layer not to darken. */
  binding(lightIndex: number, samplingEnabled?: boolean): DeferredFlashlightShadowBinding;
  diagnostics(): DeferredFlashlightShadowDiagnostics;
  /** The owned depth targets (gate/readback seam, like the deferred layer's
   *  own `targets`). Read-only: never render through these outside update(). */
  readonly targets: { readonly full: THREE.RenderTarget; readonly level: THREE.RenderTarget };
  dispose(): void;
}

export interface DeferredFlashlightShadowOptions {
  /** Square map edge in texels. Default 1024 (the spec's default). */
  size?: number;
}

function validateLayers(value: number | readonly number[], label: string): readonly number[] {
  const list = typeof value === 'number' ? [value] : value;
  if (!Array.isArray(list) || list.length === 0) {
    throw new RangeError(`${label} must be a layer or a non-empty layer list`);
  }
  for (const l of list) {
    if (!Number.isInteger(l) || l < 0 || l > 31) {
      throw new RangeError(`${label} layers must be integers in [0, 31], got ${l}`);
    }
  }
  return list as readonly number[];
}

interface CloneEntry {
  source: THREE.Mesh;
  full: THREE.Mesh | null;
  level: THREE.Mesh | null;
}

export function createDeferredFlashlightShadows(
  renderer: THREE.WebGPURenderer,
  options: DeferredFlashlightShadowOptions = {},
): DeferredFlashlightShadowFactory {
  const size = options.size ?? 1024;
  if (!Number.isInteger(size) || size <= 0 || size > 8192) {
    throw new RangeError(`shadow map size must be an integer in (0, 8192], got ${size}`);
  }

  let disposed = false;
  let lastEnabled = false;
  let renderedMaps = 0;
  /** True once every map texel has been written at least once since the last
   *  invalidation (boot, disable transition) — guards binding() against
   *  handing the layer a map full of WebGPU-zeroed memory (r=0 = NEAR depth
   *  = everything occluded). */
  let mapsValid = false;
  let fullCount = 0;
  let levelCount = 0;
  const unsupported: string[] = [];

  // ---- the two owned depth targets ----------------------------------------
  const makeDepthTarget = (name: string): THREE.RenderTarget => {
    const target = new THREE.RenderTarget(size, size, { depthBuffer: true });
    const tex = target.texture;
    tex.name = name;
    tex.format = THREE.RedFormat;   // R32F: the projected clip depth
    tex.type = THREE.FloatType;
    tex.minFilter = THREE.NearestFilter;  // R32F is unfilterable in core WebGPU;
    tex.magFilter = THREE.NearestFilter;  // PCF is a manual 3x3 textureLoad kernel
    tex.colorSpace = THREE.NoColorSpace;  // linear depth data, never a colour
    tex.generateMipmaps = false;
    return target;
  };
  const fullTarget = makeDepthTarget('flashlightShadowFullDepth');
  const levelTarget = makeDepthTarget('flashlightShadowLevelDepth');

  // ---- the one shared light camera ----------------------------------------
  // Both maps are rendered from the SAME light pose, so one camera serves
  // both. The projection is the WebGPU convention (synced to the renderer's
  // coordinate system, so the stored z/w equals the hardware depth the same
  // fragment writes), with cone from light.angle and depth range from
  // light.shadow.camera.
  const lightCam = new THREE.PerspectiveCamera(30, 1, 0.2, 20);
  const rendererCoordinateSystem = (renderer as unknown as { coordinateSystem?: number }).coordinateSystem;
  if (rendererCoordinateSystem !== undefined) {
    (lightCam as unknown as { coordinateSystem: number }).coordinateSystem = rendererCoordinateSystem;
  }
  const _lightPos = new THREE.Vector3();
  const _targetPos = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _view = new THREE.Matrix4();
  /** LIVE light view-projection handed out by binding(). Updated in place. */
  const viewProjection = new THREE.Matrix4();
  /** The SAME matrix as a TSL uniform node: value changes are uniform data
   *  uploads, never pipeline rebuilds. */
  const viewProjectionNode = uniform(viewProjection);
  const projectedDepthNode = (() => {
    // positionWorld is a perspective-correct varying, so z/w computed per
    // fragment is exactly the hardware depth of the same fragment.
    const clip = viewProjectionNode.mul(vec4(positionWorld, 1.0));
    return clip.z.div(clip.w);
  })();

  const updateLightCamera = (light: THREE.SpotLight): void => {
    light.updateWorldMatrix(true, false);
    light.target.updateWorldMatrix(true, false);
    light.getWorldPosition(_lightPos);
    light.target.getWorldPosition(_targetPos);
    _dir.subVectors(_targetPos, _lightPos);
    if (_dir.lengthSq() < 1e-10) _dir.set(0, 0, -1);
    _dir.normalize();
    const shadowCam = light.shadow?.camera;
    lightCam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(light.angle) * 2, 0.1, 179);
    lightCam.aspect = 1;
    lightCam.near = shadowCam ? Math.max(1e-3, shadowCam.near) : 0.2;
    lightCam.far = shadowCam ? Math.max(lightCam.near * 2, shadowCam.far) : 20;
    lightCam.position.copy(_lightPos);
    // Degenerate-up guard: a vertical beam makes the default (0,1,0) up
    // parallel to the view direction (lookAt then produces no rotation).
    if (Math.abs(_dir.y) > 0.999) lightCam.up.set(0, 0, _dir.y > 0 ? -1 : 1);
    else lightCam.up.set(0, 1, 0);
    lightCam.lookAt(_targetPos);
    lightCam.updateMatrixWorld(true);
    lightCam.updateProjectionMatrix();
    _view.copy(lightCam.matrixWorld).invert();
    viewProjection.multiplyMatrices(lightCam.projectionMatrix, _view);
  };

  // ---- depth materials -----------------------------------------------------
  // The shadow map shows exactly what a camera AT THE LIGHT sees: a clone
  // rasterises with its SOURCE's own material side. three's automatic shadow
  // passes instead render BACK faces for FrontSide materials (shadowSide) to
  // push stored depth deeper; here that convention would silently drop every
  // single-plane wall of a room lit from its inside (the shadow pass would
  // cull the only face the light sees), losing exactly the back/double-sided
  // and plane casters a level is built from. Self-shadow acne is handled by
  // the FLASHLIGHT_SHADOW_BIAS constant instead of by culling.
  const makeOpaqueDepthMat = (side: THREE.Side): MeshBasicNodeMaterial => {
    const mat = new MeshBasicNodeMaterial();
    mat.side = side;
    mat.colorNode = vec4(projectedDepthNode, 0, 0, 1);
    mat.fog = false; // game scene fog must never bend stored depth
    return mat;
  };
  const opaqueDepthBySide: Readonly<Record<number, MeshBasicNodeMaterial>> = {
    [THREE.FrontSide]: makeOpaqueDepthMat(THREE.FrontSide),
    [THREE.BackSide]: makeOpaqueDepthMat(THREE.BackSide),
    [THREE.DoubleSide]: makeOpaqueDepthMat(THREE.DoubleSide),
  };

  const cutoutCache = new Map<THREE.Material, MeshBasicNodeMaterial>();
  const shadowMaterialFor = (material: THREE.Material | THREE.Material[]): MeshBasicNodeMaterial => {
    const src = Array.isArray(material) ? material[0]! : material;
    const side = src.side;
    const alphaTest = (src as THREE.Material & { alphaTest?: number }).alphaTest ?? 0;
    const map = (src as THREE.MeshStandardMaterial).map;
    if (!map || !(alphaTest > 0)) return opaqueDepthBySide[side] ?? opaqueDepthBySide[THREE.FrontSide]!;
    const cached = cutoutCache.get(src);
    if (cached) return cached;
    const mat = new MeshBasicNodeMaterial();
    mat.fog = false;
    mat.side = side;
    // Identity texture transform assumed (the game's cutout casters use
    // repeat-free maps); the map itself — and therefore which texels are
    // holes — is the SOURCE's own.
    const alpha = texture(map, uv()).a;
    mat.colorNode = Fn(() => {
      Discard(alpha.lessThan(alphaTest));
      return vec4(projectedDepthNode, 0, 0, 1);
    })();
    cutoutCache.set(src, mat);
    return mat;
  };

  // ---- clone management ----------------------------------------------------
  const fullScene = new THREE.Scene();
  fullScene.name = 'flashlight-shadow-full-casters';
  const levelScene = new THREE.Scene();
  levelScene.name = 'flashlight-shadow-level-casters';
  const clones = new Map<THREE.Mesh, CloneEntry>();

  const isInstanced = (o: THREE.Object3D): o is THREE.InstancedMesh =>
    (o as THREE.InstancedMesh).isInstancedMesh === true;

  const makeClone = (source: THREE.Mesh): THREE.Mesh => {
    const material = shadowMaterialFor(source.material);
    let clone: THREE.Mesh;
    if (isInstanced(source)) {
      const inst = new THREE.InstancedMesh(source.geometry, material, source.instanceMatrix.count);
      // SHARE the attribute object: the clone's instance data IS the source's
      // current instance data (one GPU buffer, one upload).
      inst.instanceMatrix = source.instanceMatrix;
      clone = inst;
    } else {
      clone = new THREE.Mesh(source.geometry, material);
    }
    clone.frustumCulled = false;
    clone.matrixAutoUpdate = false;
    return clone;
  };

  const sceneFor = (which: 'full' | 'level'): THREE.Scene => (which === 'full' ? fullScene : levelScene);

  /** Bring one map's clone list in line with the collected sources, then sync
   *  every surviving clone to its source's CURRENT transform/instance state. */
  const syncMap = (which: 'full' | 'level', sources: Set<THREE.Mesh>): void => {
    const scene = sceneFor(which);
    for (const [source, entry] of clones) {
      const clone = entry[which];
      if (clone && !sources.has(source)) {
        scene.remove(clone);
        entry[which] = null;
      }
    }
    for (const source of sources) {
      if (!clones.has(source)) clones.set(source, { source, full: null, level: null });
      const entry = clones.get(source)!;
      if (!entry[which]) {
        const fresh = makeClone(source);
        scene.add(fresh);
        entry[which] = fresh;
      }
    }
    for (const source of sources) {
      const entry = clones.get(source)!;
      let clone = entry[which]!;
      // A geometry swap (actor rebuild) needs a NEW clone — geometry identity
      // is the whole point of source-referencing.
      if (clone.geometry !== source.geometry) {
        scene.remove(clone);
        clone = makeClone(source);
        scene.add(clone);
        entry[which] = clone;
      }
      const material = shadowMaterialFor(source.material);
      if (clone.material !== material) clone.material = material;
      source.updateWorldMatrix(true, false);
      clone.matrix.copy(source.matrixWorld);
      clone.matrixWorld.copy(source.matrixWorld);
      if (isInstanced(source) && isInstanced(clone)) clone.count = source.count;
    }
  };

  // ---- caster collection ---------------------------------------------------
  const collect = (scene: THREE.Scene, layers: readonly number[], sources: Set<THREE.Mesh>): void => {
    let layerMask = 0;
    for (const l of layers) layerMask |= 1 << l;
    const walk = (o: THREE.Object3D, ancestorVisible: boolean): void => {
      const visible = ancestorVisible && o.visible;
      if (visible && o.castShadow === true && (o.layers.mask & layerMask) !== 0) {
        const m = o as THREE.Mesh & { isSkinnedMesh?: boolean; isBatchedMesh?: boolean };
        if (m.isMesh === true || isInstanced(o)) {
          // isMesh covers InstancedMesh too; the skinned/batched vertex paths
          // cannot be reproduced by a static clone — skip and NAME (never
          // silently cast a box, per the spec).
          if (m.isSkinnedMesh === true || m.isBatchedMesh === true) {
            const name = o.name || o.type;
            if (!unsupported.includes(name)) unsupported.push(name);
          } else {
            sources.add(o as THREE.Mesh);
          }
        }
        // Non-mesh castShadow objects (Lights, Points, ...) are not depth
        // casters in three's own shadow passes either: ignored, not reported.
      }
      for (const child of o.children) walk(child, visible);
    };
    walk(scene, true);
  };

  // ---- explicit raster passes ---------------------------------------------
  // The shadow passes OWN their renderer state: a caller mid-frame may carry
  // autoClearDepth=false (accumulating passes keep hardware depth across
  // moving casters — stale silhouettes), autoClearColor=false (stale shadow
  // texels), or an MRT setup (the maps are SINGLE-attachment R32F targets;
  // a caller's MRT would redirect or split the writes). Every touched field
  // is forced for the pass and restored in finally, on success AND throw.
  const prevColor = new THREE.Color();
  interface SavedRenderState {
    target: THREE.RenderTarget | null;
    autoClear: boolean;
    autoClearColor: boolean;
    autoClearDepth: boolean;
    clearDepth: number;
    mrt: ReturnType<typeof renderer.getMRT>;
  }
  const saveRenderState = (): SavedRenderState => ({
    target: renderer.getRenderTarget(),
    autoClear: renderer.autoClear,
    autoClearColor: renderer.autoClearColor,
    autoClearDepth: renderer.autoClearDepth,
    clearDepth: renderer.getClearDepth(),
    mrt: renderer.getMRT(),
  });
  const forceShadowState = (): void => {
    renderer.autoClear = true;               // clear colour to FAR + depth to 1
    renderer.autoClearColor = true;          // no stale texels across frames
    renderer.autoClearDepth = true;          // no stale hardware depth
    renderer.setMRT(null);                   // single-attachment targets
    renderer.setClearColor(FAR_CLEAR, 1);    // empty texel = far depth
    renderer.setClearDepth(1);
  };
  const restoreRenderState = (prev: SavedRenderState): void => {
    renderer.setRenderTarget(prev.target);
    renderer.autoClear = prev.autoClear;
    renderer.autoClearColor = prev.autoClearColor;
    renderer.autoClearDepth = prev.autoClearDepth;
    renderer.setMRT(prev.mrt);
    renderer.setClearDepth(prev.clearDepth);
  };
  const submitMap = (scene: THREE.Scene, target: THREE.RenderTarget): void => {
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    const prev = saveRenderState();
    try {
      renderer.setRenderTarget(target);
      forceShadowState();
      void renderer.render(scene, lightCam);
    } finally {
      restoreRenderState(prev);
      renderer.setClearColor(prevColor, prevAlpha);
    }
  };

  const clearMap = (target: THREE.RenderTarget): void => {
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    const prev = saveRenderState();
    try {
      renderer.setRenderTarget(target);
      forceShadowState();
      renderer.clear(true, true, false);
    } finally {
      restoreRenderState(prev);
      renderer.setClearColor(prevColor, prevAlpha);
    }
  };

  const invalidateMaps = (): void => {
    if (disposed) return;
    clearMap(fullTarget);
    clearMap(levelTarget);
    mapsValid = true;
  };

  const fullSources = new Set<THREE.Mesh>();
  const levelSources = new Set<THREE.Mesh>();

  return {
    update(scene, light, opts) {
      if (disposed) throw new Error('deferred flashlight shadows are disposed');
      if (!(scene as unknown as { isScene?: boolean }).isScene) throw new TypeError('update: scene must be a THREE.Scene');
      if (!(light as unknown as { isSpotLight?: boolean }).isSpotLight) throw new TypeError('update: light must be a THREE.SpotLight');
      if (typeof opts?.enabled !== 'boolean') throw new TypeError('update: enabled must be a boolean');
      const fullLayers = validateLayers(opts.fullCasterLayers, 'fullCasterLayers');
      const levelLayers = validateLayers(opts.levelCasterLayers, 'levelCasterLayers');

      unsupported.length = 0;
      fullSources.clear();
      levelSources.clear();
      collect(scene, fullLayers, fullSources);
      collect(scene, levelLayers, levelSources);
      fullCount = fullSources.size;
      levelCount = levelSources.size;

      // The light camera is derived from the spot's CURRENT pose even when
      // disabled — binding() must never hand back a stale matrix.
      updateLightCamera(light);

      if (!opts.enabled) {
        // Skip BOTH map renders. Clear the maps to far exactly ONCE per
        // enable->disable TRANSITION — keyed on lastEnabled, not mapsValid
        // (invalidateMaps re-arms mapsValid, so a mapsValid gate re-cleared
        // both targets on EVERY disabled frame). First-boot clearing is
        // binding()'s !mapsValid guard. While disabled: zero render
        // submissions and zero clears (spec: "clear/reset maps at boot ...
        // disabled transitions").
        if (lastEnabled) invalidateMaps();
        renderedMaps = 0;
        lastEnabled = false;
        return;
      }

      syncMap('full', fullSources);
      syncMap('level', levelSources);
      submitMap(fullScene, fullTarget);
      submitMap(levelScene, levelTarget);
      mapsValid = true;
      renderedMaps = 2;
      lastEnabled = true;
    },

    binding(lightIndex, samplingEnabled = true) {
      if (disposed) throw new Error('deferred flashlight shadows are disposed');
      if (!Number.isInteger(lightIndex) || lightIndex < 0 || lightIndex >= MAX_DEFERRED_LIGHTS) {
        throw new RangeError(`lightIndex must be an integer in [0, ${MAX_DEFERRED_LIGHTS}), got ${lightIndex}`);
      }
      // First binding before any update: make sure the maps hold the far
      // sentinel rather than WebGPU-zeroed (near-depth) memory.
      if (!mapsValid) invalidateMaps();
      return {
        fullDepth: fullTarget.texture,
        levelDepth: levelTarget.texture,
        viewProjection,
        lightIndex,
        bias: FLASHLIGHT_SHADOW_BIAS,
        mapSize: new THREE.Vector2(size, size),
        enabled: samplingEnabled === true,
      };
    },

    diagnostics() {
      return {
        renderedMaps,
        fullCasters: fullCount,
        levelCasters: levelCount,
        size,
        enabled: lastEnabled,
        unsupported: [...unsupported],
      };
    },

    targets: { full: fullTarget, level: levelTarget },

    dispose() {
      if (disposed) return;
      disposed = true;
      fullTarget.dispose();
      levelTarget.dispose();
      for (const mat of Object.values(opaqueDepthBySide)) mat.dispose();
      for (const mat of cutoutCache.values()) mat.dispose();
      cutoutCache.clear();
      clones.clear();
      fullScene.clear();
      levelScene.clear();
    },
  };
}
