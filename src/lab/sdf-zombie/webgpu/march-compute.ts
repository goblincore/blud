// src/lab/sdf-zombie/webgpu/march-compute.ts
//
// THE COMPUTE MARCH (?marchcompute; march/compute-flag.ts; docs/dev-notes/2026-11-10-compute-march-spike/NOTES.md).
//
// A quad-dispatch crowd type draws one screen quad whose fragment marches the pixel's ray. Under the flag the SAME
// march call runs in a compute kernel instead, 8 x 8 invocations a workgroup over the quad's pixel rect, and writes
// what the fragment would have output into a storage texture. The type's quad is then drawn with a material that
// only copies that texture: colour to the march target, and the hit depth to the depth buffer through the depth
// test, so several types and everything else in the pass (per-body views, chunks, the early-z seed) compose exactly
// as before. Nothing downstream of the march target changes.
//
// What the storage texture's alpha carries (the fragment's alpha is the clip depth, 1.0 = "nothing here"):
//   [0, 1)  a hit: its clip depth, which is also its hardware depth
//   2.0     nothing: the fragment would have discarded (an empty tile, a ray that enters no hull, a miss)
//   3.0     a miss that writes (the near-miss edge channel): rgb is its payload, hardware depth just short of far
//
// The kernel writes every pixel of the rect each frame, so the texture is never cleared.
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, If, Discard, uniform, vec2, vec4, ivec2, float, select, normalize, mul, add, workgroupId, localId,
  textureStore, textureLoad, screenCoordinate, computeKernel,
} from 'three/tsl';
import { withPassLabel } from './gpu-pass-timing';
import { MARCH_COMPUTE_BLOCK } from './march/compute-flag';

/** The nodes a compute stage supplies in place of the fragment stage's own, and where the march comes back. */
export interface MarchStage {
  screenUV: unknown;
  camPos: unknown;
  view: unknown;
  proj: unknown;
  near: unknown;
  far: unknown;
  capture(nodes: MarchComputeNodes): void;
}

/** What createMarchMaterial hands back to a compute stage. */
export interface MarchComputeNodes {
  /** The march call: xyz the colour (or the miss payload), w the hit distance (negative = a miss that writes). */
  marched: unknown;
  /** True where the fragment's own gate discards before marching (quad dispatch, tile lists on, an empty tile). */
  emptyTile: unknown;
  /** 1.0 after a march that discarded. Takes the march result so the read is ordered after it. */
  discarded(dep: unknown): unknown;
}

/** One crowd type's compute twin. */
export interface CrowdMarchCompute {
  /** The material that copies the compute result. Shares the quad's clip node, so it covers the same pixels. */
  readonly blit: MeshBasicNodeMaterial;
  /** March this frame's rect into the storage texture. False when there is nothing to do (no rect on screen). */
  run(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera, width: number, height: number): boolean;
  /** Frames dispatched, and the last one's workgroup counts: for the diagnostics seam. */
  readonly stats: { frames: number; groups: [number, number]; rect: [number, number, number, number] };
  dispose(): void;
}

type N = ReturnType<typeof float>;

/**
 * Build a crowd type's compute twin. `buildCompute` is the type's own createCrowdMaterial handle: it makes the
 * march call on this stage's nodes. `quadRect` is the NDC rect the quad rasterises; `quadClip` its vertex node.
 */
export function createCrowdMarchCompute(
  buildCompute: (stage: MarchStage, ray: { worldPos: unknown; rayDir: unknown }) => void,
  quadRect: { value: THREE.Vector4 },
  quadClip: unknown,
): CrowdMarchCompute {
  const B = MARCH_COMPUTE_BLOCK;
  // The pixel: the block's origin, the workgroup and the invocation. Its centre is the fragment's fragCoord.
  const uSize = uniform(new THREE.Vector2(1, 1));
  const uOrigin = uniform(new THREE.Vector2(0, 0));
  const uRect = uniform(new THREE.Vector4(0, 0, 0, 0)); // pixels: x0, y0, x1, y1 (upper bounds exclusive)
  const uCamPos = uniform(new THREE.Vector3());
  const uView = uniform(new THREE.Matrix4());
  const uProj = uniform(new THREE.Matrix4());
  const uProjInv = uniform(new THREE.Matrix4());
  const uWorld = uniform(new THREE.Matrix4());
  const uNear = uniform(0.1);
  const uFar = uniform(100);

  const pix = add(uOrigin, vec2(workgroupId.xy.mul(B).add(localId.xy) as never)) as unknown as { x: N; y: N; add: (v: unknown) => N; div: (v: unknown) => { x: N; y: N } };
  const stUV = pix.add(vec2(0.5, 0.5)).div(uSize as never) as unknown as { x: N; y: N };
  // The ray, as crowdRayNodes builds it from screenUV (zombie-gpu.ts): the far-plane point of the pixel.
  const ndc = vec4(
    stUV.x.mul(2).sub(1) as never,
    float(1).sub(stUV.y as never).mul(2).sub(1) as never,
    float(1.0), float(1.0),
  );
  const viewFar4 = uProjInv.mul(ndc as never) as unknown as { xyz: N; w: N };
  const viewFar = viewFar4.xyz.div(viewFar4.w as never);
  const farWorld = (uWorld.mul(vec4(viewFar as never, float(1.0)) as never) as unknown as { xyz: { sub: (v: unknown) => unknown } }).xyz;
  const rayDir = normalize(farWorld.sub(uCamPos) as never);

  let nodes: MarchComputeNodes | null = null;
  buildCompute(
    { screenUV: stUV, camPos: uCamPos, view: uView, proj: uProj, near: uNear, far: uFar, capture: (n) => { nodes = n; } },
    { worldPos: farWorld, rayDir },
  );
  if (!nodes) throw new Error('march compute: the material builder did not hand the march back (quad dispatch with tile lists only)');
  const got = nodes as MarchComputeNodes;

  let tex = new THREE.StorageTexture(4, 4);
  let texW = 4, texH = 4;
  const configure = (t: THREE.StorageTexture) => {
    t.type = THREE.FloatType;
    t.format = THREE.RGBAFormat;
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  };
  configure(tex);
  // One node writes it, one reads it; both are rebound when the march target changes size.
  const pixI = ivec2(pix as never);
  const inRect = (pix.x as unknown as { greaterThanEqual: (v: unknown) => { and: (v: unknown) => unknown } })
    .greaterThanEqual(uRect.x)
    .and((pix.y as unknown as { greaterThanEqual: (v: unknown) => unknown }).greaterThanEqual(uRect.y))as unknown as { and: (v: unknown) => { and: (v: unknown) => unknown } };
  const inside = inRect
    .and((pix.x as unknown as { lessThan: (v: unknown) => unknown }).lessThan(uRect.z))
    .and((pix.y as unknown as { lessThan: (v: unknown) => unknown }).lessThan(uRect.w));

  let storeNode: { value: THREE.Texture } | null = null;
  const kernel = Fn(() => {
    If(inside as never, () => {
      const out = vec4(0, 0, 0, 2).toVar();
      If((got.emptyTile as { not: () => unknown }).not() as never, () => {
        const m = (got.marched as { toVar: () => { xyz: N; w: N } }).toVar();
        If((got.discarded(m) as { lessThan: (v: number) => unknown }).lessThan(0.5) as never, () => {
          // The fragment's depth node: the hit's clip z over w.
          const hit = add(uCamPos, mul(rayDir, m.w as never));
          const clip = mul(uProj, mul(uView, vec4(hit as never, 1.0))) as unknown as { z: N; w: N };
          const depth = clip.z.div(clip.w as never);
          out.assign(vec4(m.xyz as never, select(m.w.lessThan(0) as never, float(3.0), depth as never) as never));
        });
      });
      const store = textureStore(tex, pixI as never, out as never);
      storeNode = store as unknown as { value: THREE.Texture };
      store.toWriteOnly();
    });
  })();
  const node = computeKernel(kernel as never, [B, B, 1]);

  // THE COPY. One texel load a pixel: nothing discards, a hit writes colour and depth, a writing miss its payload.
  const loadNode = textureLoad(tex, ivec2(screenCoordinate.xy as never) as never);
  const texel = Fn(() => {
    const t = loadNode.toVar();
    If(t.a.greaterThan(1.5).and(t.a.lessThan(2.5)) as never, () => { Discard(); });
    return t;
  })() as unknown as { xyz: N; x: N; a: N };
  const missEdge = texel.a.greaterThan(2.5);
  const blit = new MeshBasicNodeMaterial();
  blit.side = THREE.DoubleSide;
  blit.fog = false;
  blit.vertexNode = quadClip as never;
  blit.colorNode = vec4(texel.xyz as never, 1.0);
  blit.depthNode = select(missEdge as never, float(1 - 1e-5).add(mul(texel.x as never, 5e-7) as never), texel.a as never) as never;
  blit.depthWrite = true;
  blit.outputNode = vec4(texel.xyz as never, select(missEdge as never, float(1), texel.a as never) as never);

  const stats: CrowdMarchCompute['stats'] = { frames: 0, groups: [0, 0], rect: [0, 0, 0, 0] };
  const lo = (v: number) => Math.max(0, Math.ceil(v - 0.5));
  return {
    blit,
    stats,
    run(renderer, camera, width, height) {
      if (texW !== width || texH !== height) {
        const old = tex;
        tex = new THREE.StorageTexture(width, height);
        texW = width; texH = height;
        configure(tex);
        if (storeNode) storeNode.value = tex;
        (loadNode as unknown as { value: THREE.Texture }).value = tex;
        old.dispose();
      }
      // The pixels the quad's rasteriser covers: those whose centre lies inside the NDC rect.
      const r = quadRect.value;
      const x0 = lo((r.x * 0.5 + 0.5) * width), x1 = Math.min(width, lo((r.z * 0.5 + 0.5) * width));
      const y0 = lo((1 - (r.w * 0.5 + 0.5)) * height), y1 = Math.min(height, lo((1 - (r.y * 0.5 + 0.5)) * height));
      if (x1 <= x0 || y1 <= y0) return false;
      const ox = Math.floor(x0 / B) * B, oy = Math.floor(y0 / B) * B;
      const gx = Math.ceil((x1 - ox) / B), gy = Math.ceil((y1 - oy) / B);
      (uSize.value as THREE.Vector2).set(width, height);
      (uOrigin.value as THREE.Vector2).set(ox, oy);
      (uRect.value as THREE.Vector4).set(x0, y0, x1, y1);
      // The camera as the render that follows will see it (the layer has already set any view offset).
      camera.updateMatrixWorld();
      (uCamPos.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
      (uView.value as THREE.Matrix4).copy(camera.matrixWorldInverse);
      (uProj.value as THREE.Matrix4).copy(camera.projectionMatrix);
      (uProjInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
      (uWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
      uNear.value = camera.near;
      uFar.value = camera.far;
      withPassLabel('compute:sdf-march', () => renderer.compute(node as never, [gx, gy, 1] as never));
      stats.frames++;
      stats.groups = [gx, gy];
      stats.rect = [x0, y0, x1, y1];
      return true;
    },
    dispose() {
      tex.dispose();
      blit.dispose();
    },
  };
}

// ---- the layer's hook ---------------------------------------------------------------------------------------------
// A crowd type registers its quad mesh with its twin. The SDF layer brackets the march's render with begin / end:
// begin dispatches every registered type that is drawing its quad and swaps the copy material onto the mesh, end
// puts the march material back, so every other pass that draws the mesh (the refine, the far pass) is unchanged.
interface Entry { mesh: THREE.Mesh; quadMaterial: THREE.Material; compute: CrowdMarchCompute }
const entries = new Set<Entry>();
let enabled = true;

export function registerMarchCompute(mesh: THREE.Mesh, quadMaterial: THREE.Material, compute: CrowdMarchCompute): () => void {
  const e: Entry = { mesh, quadMaterial, compute };
  entries.add(e);
  return () => { entries.delete(e); compute.dispose(); };
}

/** Runtime A/B (__sdfGame.setMarchCompute): off, a flagged page draws the fragment march again. */
export function setMarchComputeEnabled(on: boolean): void { enabled = on; }

export function marchComputeInfo() {
  return { enabled, types: [...entries].map((e) => ({ ...e.compute.stats, drawing: e.mesh.visible && e.mesh.material === e.quadMaterial })) };
}

/** Dispatch the compute march for every type drawing its quad. Returns the function that restores the meshes. */
export function marchComputeBegin(
  renderer: THREE.WebGPURenderer, camera: THREE.Camera, width: number, height: number,
): () => void {
  if (!enabled || entries.size === 0) return () => {};
  const swapped: Entry[] = [];
  for (const e of entries) {
    if (!e.mesh.visible || e.mesh.material !== e.quadMaterial) continue;
    if (!e.compute.run(renderer, camera as THREE.PerspectiveCamera, width, height)) continue;
    e.mesh.material = e.compute.blit;
    swapped.push(e);
  }
  return () => { for (const e of swapped) e.mesh.material = e.quadMaterial; };
}
