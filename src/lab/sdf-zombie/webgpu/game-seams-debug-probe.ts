// src/lab/sdf-zombie/webgpu/game-seams-debug-probe.ts
//
// Debug probe and world inspection seams, lifted verbatim out of the
// window.__sdfGame object literal in game-main.ts. The integration step spreads
// createDebugProbeSeams(ctx, d) into that literal.

import * as THREE from 'three/webgpu';
import { texture3D as tslTexture3D, texture as tslTexture, uniform as tslUniform } from 'three/tsl';
import { sampleOrder, jitterGrid, accumulateSamples, float32ToBase64 } from './upscale/supersample';
import { TILE_SIZE_PX } from './tile-cull';
import { buildNormalBodyPointFn } from './normal-gradient.wgsl';
import { normalHitPoint } from './normal-gradient-support';
import { finiteGradient, woundGradient } from './normal-gradient-reference';
import { sdBody, smax } from '../validate';
import {
  ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_PRIM_SHAPE, ROW_PRIM_COLOR,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT,
  ROW_CLUSTER_RANGE, ROW_CLUSTER_BOUNDS,
} from './march.wgsl';
import type { V3, WoundInput } from './normal-gradient-reference';
import type { Vec3 } from '../types';
import type { ZombieActor } from './game-actor';
import type { GameContext } from './game-context';

/** Closures this group still needs from main(). */
export interface DebugProbeDeps {
  clearDepthProbes: () => void;
  countDescendants: (root: THREE.Object3D) => number;
  nodeDepth: (root: THREE.Object3D, o: THREE.Object3D) => number;
  round2: (v: number) => number;
}

export function createDebugProbeSeams(ctx: GameContext, d: DebugProbeDeps) {
  // main() reads these from the same handle (game-main.ts L330); the moved
  // members use them as bare locals, so bind them identically here.
  const { scene, camera } = ctx.boot.handle;
  return {
    /** Parity/bench instrumentation (close-up diagnostics task 1): installs
     *  window.__sdfGameDebug with a padded-row march-target readback + FNV
     *  hash, computed IN-PAGE (a 2.3M-float readback must not cross CDP as
     *  a returnByValue object). Outside every timing path; only the parity
     *  gate calls it. */
    installDebugProbe: () => {
      /** Shared readback body for the float-target readers: de-pads the 256-byte-aligned rows
       *  into a dense rgba32f base64 blob. `index` selects an MRT attachment. */
      const packFloatTarget = async (t: THREE.RenderTarget, index = 0) => {
        const w = t.width, h = t.height;
        const raw = new Float32Array(await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h, index));
        const stride = Math.ceil(w * 16 / 256) * 64;
        const dense = new Float32Array(w * h * 4);
        for (let y = 0; y < h; y++) dense.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
        const bytes = new Uint8Array(dense.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return { w, h, rgba32f: btoa(binary) };
      };
      (window as unknown as { __sdfGameDebug: unknown }).__sdfGameDebug = {
        /** Rebuild with the original dense shader for honest whole-frame A/B;
         * the live uniform toggle still contains the culling branch. */
        setUpscaleCullingPipeline(emptyTileCulling: boolean) {
          const st = ctx.render.sdfLayer.upscaleStage;
          if (!st) throw new Error('Upscale is off');
          const { config, model, sharpen, sharpenMode } = st;
          ctx.render.sdfLayer.setUpscale(config, model, { emptyTileCulling });
          ctx.render.sdfLayer.upscaleStage!.setSharpen(sharpen);
          ctx.render.sdfLayer.upscaleStage!.setSharpenMode(sharpenMode);
          return ctx.render.sdfLayer.upscaleInfo;
        },
        async upscaleCullingCheck(opts?: { frames?: number; repeats?: number; synthetic?: boolean }) {
          ctx.boot.handle.setLoopRunning(false);
          await ctx.boot.handle.resolveGpu();
          const { runUpscaleCullingCheck } = await import('./upscale/upscale-culling-check');
          return runUpscaleCullingCheck({ renderer: ctx.boot.handle.renderer, layer: ctx.render.sdfLayer,
            camera: camera as THREE.PerspectiveCamera, renderFrames: () => {}, resolveGpu: () => ctx.boot.handle.resolveGpu() }, opts);
        },
        /** Raw float readback, row padding removed. The driver compares these
         * bytes before any composite, color conversion or antialias filtering. */
        normalCaptureState() {
          const pieces=[...ctx.world.actors.map(a=>({key:`body:${a.id}`,view:a.view})),...ctx.bake.liveChunks.map(c=>({key:`chunk:${c.id}`,view:c.view}))];
          return {camera:camera.matrixWorld.toArray(),projection:camera.projectionMatrix.toArray(),pieces:pieces.map(({key,view})=>({key,data:Array.from((view.dataTexture as THREE.DataTexture).image.data as Float32Array),records:Array.from((view as unknown as { records: { floats: Float32Array } }).records.floats),uniforms:Object.fromEntries(Object.entries(view.uniforms).filter(([k])=>k!=='normalGradientCfg'&&k!=='debugCfg').map(([k,u])=>{const v=u.value;return [k,v&&typeof v==='object'&&'toArray' in v?(v as {toArray:()=>unknown}).toArray():v];}))}))};
        },
        /** NEURAL UPSCALE P3: the supersampled 800x600 training target. Renders the CURRENT state
         *  grid*grid times with a centred sub-pixel march jitter and temporal ray start OFF (its
         *  reprojection matrix is the unjittered camera), accumulating in-page; only the averaged
         *  target crosses CDP. Caller: freeze + render lock on, scale 1.0, fields off, upscale off. */
        async readSupersampledTarget(grid = 4) {
          const t = ctx.render.sdfLayer.marchTarget;
          const w = t.width, h = t.height;
          const offsets = sampleOrder(jitterGrid(grid));
          const stride = Math.ceil(w * 16 / 256) * 64;
          const wasStart = ctx.render.sdfLayer.temporalStart.on;
          const samples: Float32Array[] = [];
          ctx.boot.handle.setLoopRunning(false);
          ctx.render.sdfLayer.setTemporalStart(false);
          try {
            for (const [jx, jy] of offsets) {
              if (!ctx.render.sdfLayer.setMarchJitter([jx, jy])) throw new Error('readSupersampledTarget: march jitter refused (fields or accumulation on?)');
              ctx.boot.handle.step(1 / 60);
              await ctx.boot.handle.resolveGpu();
              const raw = new Float32Array(await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h));
              const dense = new Float32Array(w * h * 4);
              for (let y = 0; y < h; y++) dense.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
              samples.push(dense);
            }
          } finally {
            ctx.render.sdfLayer.setMarchJitter(null);
            ctx.render.sdfLayer.setTemporalStart(wasStart);
          }
          const { target, coverage } = accumulateSamples(samples, w, h);
          return { w, h, offsets, target: float32ToBase64(target), coverage: float32ToBase64(coverage) };
        },
        async readMarchTarget() {
          ctx.boot.handle.setLoopRunning(false);
          ctx.boot.handle.step(0);
          await ctx.boot.handle.resolveGpu();
          return packFloatTarget(ctx.render.sdfLayer.marchTarget);
        },
        /** ROOM-2 PARITY DIAGNOSTIC (crowd stage a Task 7): per tile, whether
         *  the PROXY BOXES of >= 2 distinct instances of the SAME character
         *  type cover it. A non-multi tile is one where the crowd material's
         *  per-slot loop has a single candidate instance, so a per-body vs
         *  crowd hash mismatch there cannot be a union-fold/banding bug — it
         *  must be the instanced-vs-per-body transform (stage a-2 fix).
         *
         *  WHY NOT TileBinner OVER THE TYPE'S GROUPS (the plan's first
         *  suggestion): measured 2026-09-14 — TileBinner.bin fills EVERY tile
         *  for a group whose sphere crosses the camera plane (`nearDist <= 0`
         *  or `clipW <= 0`), and the full cast (every room) is attached to a
         *  crowd type. One same-kind body anywhere behind the camera therefore
         *  marks all 25x19 tiles multi (masked fraction 0.0000 in room 1 with
         *  exactly one zombie), which makes the masked hash the sha1 of the
         *  EMPTY string — a false "match". The box footprint is what the
         *  fragment actually rasterises, so it is the real overlap.
         *
         *  The in-page buffer is a Uint8Array(tilesX*tilesY) (1 = multi); it
         *  crosses CDP as a plain array. */
        readTileSlotMask() {
          camera.updateMatrixWorld();
          camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
          const size = ctx.render.sdfLayer.targetSize;
          const W = Math.max(1, size.width), H = Math.max(1, size.height);
          const tilesX = Math.ceil(W / TILE_SIZE_PX);
          const tilesY = Math.ceil(H / TILE_SIZE_PX);
          const mask = new Uint8Array(tilesX * tilesY);
          const byKind = new Map<string, ZombieActor[]>();
          for (const a of ctx.world.actors) {
            const list = byKind.get(a.kind);
            if (list) list.push(a); else byKind.set(a.kind, [a]);
          }
          const view = new THREE.Vector4();
          const clip = new THREE.Vector4();
          // Mark one kind's boxes, one actor at a time: a tile counts multi
          // when the SAME tile was already covered by an earlier actor of the
          // same kind. Crossing boxes from different kinds are separate draws.
          for (const list of byKind.values()) {
            const seen = new Uint8Array(tilesX * tilesY);
            for (const a of list) {
              const c = a.view.object.position;
              const h = a.view.uniforms.bodyHalf.value;
              let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
              let any = false;
              for (let corner = 0; corner < 8; corner++) {
                view.set(
                  c.x + ((corner & 1) ? h.x : -h.x),
                  c.y + ((corner & 2) ? h.y : -h.y),
                  c.z + ((corner & 4) ? h.z : -h.z),
                  1,
                ).applyMatrix4(camera.matrixWorldInverse);
                if (view.z >= 0) continue; // corner at/behind the eye plane
                clip.set(view.x, view.y, view.z, 1).applyMatrix4(camera.projectionMatrix);
                if (clip.w <= 0) continue;
                any = true;
                const px = (clip.x / clip.w * 0.5 + 0.5) * W;
                const py = (0.5 - clip.y / clip.w * 0.5) * H;
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
              }
              // Fully behind the camera: the proxy cannot rasterise, so it can
              // never be an overlap partner in this frame.
              if (!any) continue;
              const tx0 = Math.max(0, Math.floor(minX / TILE_SIZE_PX));
              const tx1 = Math.min(tilesX - 1, Math.floor((maxX - 1e-6) / TILE_SIZE_PX));
              const ty0 = Math.max(0, Math.floor(minY / TILE_SIZE_PX));
              const ty1 = Math.min(tilesY - 1, Math.floor((maxY - 1e-6) / TILE_SIZE_PX));
              for (let ty = ty0; ty <= ty1; ty++) {
                for (let tx = tx0; tx <= tx1; tx++) {
                  const t = ty * tilesX + tx;
                  if (seen[t]) mask[t] = 1; // a second same-kind box covers t
                  seen[t] = 1;
                }
              }
            }
          }
          return { tilesX, tilesY, tilePx: TILE_SIZE_PX, mask: Array.from(mask) };
        },
        /** Run 5b: the march MRT's NORMAL attachment as { w, h, rgba32f } — same frozen frame and
         *  de-pad as readMarchTarget. rgb = view-space normal, alpha = the per-body key the refine
         *  twins compare against (march.wgsl.ts MARCH_BODY_LIGHT `bodyKey`). Null when the layer
         *  allocated no normal attachment. */
        async readMarchNormalTarget() {
          if (!ctx.render.sdfLayer.marchNormalTexture) return null;
          ctx.boot.handle.setLoopRunning(false);
          ctx.boot.handle.step(0);
          await ctx.boot.handle.resolveGpu();
          return packFloatTarget(ctx.render.sdfLayer.marchTarget, 1);
        },
        /** Run 4: the output-res detail field (sdf-layer detailTarget) as { w, h, rgba32f } — same
         *  de-pad as readMarchTarget. Null when the layer has no normal attachment. */
        async readDetailTarget() {
          const t = ctx.render.sdfLayer.detailTarget;
          if (!t) return null;
          ctx.boot.handle.setLoopRunning(false);
          ctx.boot.handle.step(0);
          await ctx.boot.handle.resolveGpu();
          return packFloatTarget(t);
        },
        /** Run 5: both refine attachments as { c, n } of { w, h, rgba32f }; null unless the boot allocated them. */
        async readRefine() {
          const t = ctx.render.sdfLayer.refineTarget;
          if (!t) return null;
          ctx.boot.handle.setLoopRunning(false); ctx.boot.handle.step(0); await ctx.boot.handle.resolveGpu();
          return { c: await packFloatTarget(t, 0), n: await packFloatTarget(t, 1) };
        },
        /** Neural upscale normals capture (2026-09-12): the march target re-rendered with every
         *  actor and chunk in debug mode 9 (march.wgsl.ts MARCH_BODY_LIGHT): rgb = the final
         *  WORLD-space shading normal, alpha = clip depth as usual. Same frozen frame, same
         *  size and layout as readMarchTarget. `view` is the camera's matrixWorldInverse
         *  (column-major 16), for the capture to rotate normals into view space. */
        async readMarchNormals() {
          const prev = new Map<unknown, number>();
          const views = [...ctx.world.actors.map((a) => a.view), ...ctx.bake.liveChunks.map((c) => c.view)];
          for (const v of views) { prev.set(v, v.uniforms.debugCfg.value.x); v.uniforms.debugCfg.value.x = 9; }
          try {
            const dbg = (window as unknown as { __sdfGameDebug: { readMarchTarget(): Promise<{ w: number; h: number; rgba32f: string }> } }).__sdfGameDebug;
            const r = await dbg.readMarchTarget();
            return { ...r, view: camera.matrixWorldInverse.toArray() };
          } finally {
            for (const v of views) v.uniforms.debugCfg.value.x = prev.get(v) ?? 0;
          }
        },
        async normalPointSamples(bodyId: number | string, points: Vec3[]) {
          const view=typeof bodyId==='number'?ctx.world.actors.find(a=>a.id===bodyId)?.view:ctx.bake.liveChunks.find(c=>`chunk:${c.id}`===bodyId)?.view;if(!view)throw new Error('missing probe piece');
          const u=view.uniforms,p=tslUniform(new THREE.Vector3()),kind=tslUniform(0),noise=tslUniform(new THREE.Vector4());
          const material=new THREE.MeshBasicNodeMaterial();
          material.outputNode=buildNormalBodyPointFn()({p,data:tslTexture(view.dataTexture),noiseCfg:noise,woundCfg:u.woundCfg,woundCfg2:u.woundCfg2,volumeTex:tslTexture3D(view.volumeTexture),volumeMin:u.volumeMin,volumeInvExtent:u.volumeInvExtent,volumeWarp:u.volumeWarp,volumeClip:u.volumeClip,perfCfg:u.perfCfg,inst:(view as unknown as { records: { node: unknown } }).records.node,instCfg:tslUniform(new THREE.Vector4(1,0,0,0)),probeKind:kind});
          material.depthTest=false;material.depthWrite=false;material.blending=THREE.NoBlending;material.toneMapped=false;
          const scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry,material);quad.frustumCulled=false;scene.add(quad);
          const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
          const target=new THREE.RenderTarget(1,1,{depthBuffer:false,type:THREE.FloatType,format:THREE.RGBAFormat});
          const renderer=ctx.boot.handle.renderer,previous=renderer.getRenderTarget();
          const read=async(q:Vec3,mode:number)=>{p.value.fromArray(q);kind.value=mode;renderer.setRenderTarget(target);renderer.render(scene,camera);await ctx.boot.handle.resolveGpu();return Array.from(new Float32Array(await renderer.readRenderTargetPixelsAsync(target,0,0,1,1)).slice(0,4));};
          const results=[];
          try {for(const point of points) {
            noise.value.x=0;
            const analytic=await read(point,0),state=await read(point,1),scalar=await read(point,2);
            const epsilons=[];
            for(const epsilon of [.0015,.0005,.0002,.0001]) {
              const gradient=[];
              for(let axis=0;axis<3;axis++) {const lo=[...point] as [number,number,number],hi=[...point] as [number,number,number];lo[axis]!-=epsilon;hi[axis]!+=epsilon;gradient.push(((await read(hi,2))[0]!-(await read(lo,2))[0]!)/(2*epsilon));}
              epsilons.push({epsilon,gradient});
            }
            const signs:Vec3[]=[[1,-1,-1],[-1,-1,1],[-1,1,-1],[1,1,1]];
            const tetra:Array<{point:Vec3;sign:Vec3;geometric:number[];noisy:number[]}>=[];
            for(const sign of signs) {const q=point.map((v,i)=>v+.0015*sign[i]!) as unknown as Vec3;tetra.push({point:q,sign,geometric:await read(q,2),noisy:[] as number[]});}
            const image=view.dataTexture.image as {width:number;data:Float32Array};
            const owner=state[1]!;const color=image.data[(ROW_PRIM_COLOR*image.width+owner)*4+3]!;const shape=image.data[(ROW_PRIM_SHAPE*image.width+owner)*4+1]!;
            const suppression=color>0?Math.max(Math.max(0,Math.min(1,color-1)),(Math.round(shape)&16)!==0?1:0):0;
            noise.value.x=u.marchCfg.value.z*(1-suppression);
            const combined=await read(point,3),noiseOnly=await read(point,4);
            for(const sample of tetra)sample.noisy=await read(sample.point,2);
            const sum=(key:'geometric'|'noisy')=>[0,1,2].map(axis=>tetra.reduce((v,s)=>v+s.sign[axis]!*s[key][0]!,0)/(.0015*4));
            results.push({point,analytic,state,scalar,epsilons,detailBreakdown:{amplitude:noise.value.x,tetra,geometricTetra:sum('geometric'),fullTetra:sum('noisy'),combined:combined.slice(1),noiseOnly:noiseOnly.slice(1)}});
          }} finally {renderer.setRenderTarget(previous);material.dispose();geometry.dispose();target.dispose();}
          return results;
        },
        /** Affected wound ROI from exact clip depth and the uploaded wound
         * rows. sdBody supplies original authored/carved flesh; classification
         * uses the production scalar equations, not a screen-space circle. */
        normalWoundCoverage(bodyId: number | string, packed: string, w: number, h: number, suspects: number[] = []) {
          const actor=typeof bodyId==='number'?ctx.world.actors.find(a=>a.id===bodyId):undefined;
          const chunk=typeof bodyId==='string'?ctx.bake.liveChunks.find(c=>`chunk:${c.id}`===bodyId):undefined;
          const view=actor?.view??chunk?.view;if(!view)throw new Error('missing wound coverage piece');
          const u=view.uniforms,tex=view.dataTexture as THREE.DataTexture;
          const image=tex.image as {data:Float32Array;width:number};
          const row=(i:number,y:number)=>Array.from(image.data.subarray((y*image.width+i)*4,(y*image.width+i)*4+4));
          // Chunk CPU oracle consumes the actual uploaded straight-capsule
          // rows; other profiles require a separate independent adapter.
          const body=actor?.posed()??{
            prims:Array.from({length:Math.round(u.counts.value.x)},(_,i)=>{
              const a=row(i,ROW_PRIM_A),b=row(i,ROW_PRIM_B),scale=row(i,ROW_PRIM_SCALE),shape=row(i,ROW_PRIM_SHAPE);
              if(shape[0]!>=0||(Math.round(shape[1]!)&47)!==0)throw new Error('chunk oracle requires straight capsules');
              return {a:a.slice(0,3) as unknown as Vec3,b:b.slice(0,3) as unknown as Vec3,radius:a[3]!,blendK:b[3]!,scale:scale.slice(0,3) as unknown as Vec3,op:scale[3]!>.5?'sub' as const:'add' as const,limb:chunk!.state.limb,cluster:0,orient:row(i,ROW_PRIM_QUAT) as unknown as [number,number,number,number]};
            }),
            clusters:Array.from({length:Math.round(u.counts.value.y)},(_,i)=>{const r=row(i,ROW_CLUSTER_RANGE),b=row(i,ROW_CLUSTER_BOUNDS);return {id:i,limb:chunk!.state.limb,start:r[0]!,count:r[1]!,alive:r[2]!>.5,center:b.slice(0,3) as unknown as Vec3,radius:b[3]!};}),
          };
          const cfg=u.woundCfg.value.toArray(),cfg2=u.woundCfg2.value.toArray(),perf=u.perfCfg.value.toArray();
          const bound=u.woundBound.value;
          const wounds=Array.from({length:Math.round(cfg[0]!)},(_,i)=>({w:row(i,ROW_WOUND),meta:row(i,ROW_WOUND_META),cap:row(i,ROW_WOUND_CAP)}));
          const raw=Uint8Array.from(atob(packed),c=>c.charCodeAt(0));const data=new Float32Array(raw.buffer);
          const make=()=>({hits:0,analytic:0,reasons:Array<number>(8).fill(0)});
          const regions={wall:make(),rim:make(),internal:make(),curvedInternal:make(),headWound:make(),torsoWound:make()};
          const point=new THREE.Vector3();
          let scalarSurfaceMax=0;const samples:unknown[]=[];
          for(let i=0;i<data.length;i+=4) {
            const code=Math.round(data[i]!)-1,owner=Math.round(data[i+2]!);
            if(code<0||code>7||owner<0)continue;
            const pixel=i/4,x=pixel%w,y=Math.floor(pixel/w);
            const p=normalHitPoint(x,y,w,h,data[i+3]!,camera);
            point.fromArray(p);
            const base=sdBody(p,body);let d=base;
            if(point.distanceTo(new THREE.Vector3(bound.x,bound.y,bound.z))<=bound.w) for(const wound of wounds) {
              const v=p.map((a,k)=>a-wound.w[k]!);const r=Math.hypot(...v);
              const reach=wound.w[3]!*Math.max(2,2*cfg[3]!+3*cfg2[0]!)+4*cfg[1]!+.25;
              if(perf[1]!>.5&&r>reach)continue;
              const burn=wound.meta[0]!>1.5;
              const depth=wound.w[3]!*(burn?.35*Math.max(0,Math.min(1,wound.meta[1]!)):1);
              const cap=wound.cap[3]!>0?wound.cap[3]!:1e5;
              d=smax(d,Math.min(depth-r,cap-v.reduce((a,b,k)=>a+b*wound.cap[k]!,0)),cfg[1]!);
              const amp=depth*cfg[2]!*wound.meta[2]!*(burn?.25:1);
              if(amp>0) {
                const xx=(r-depth*cfg[3]!*wound.meta[3]!)/Math.max(depth*cfg2[0]!,1e-4);
                const gate=Math.max(0,Math.min(1,(base+.3*amp)/amp));
                d-=Math.exp(-xx*xx)*amp*(1-gate*gate*(3-2*gate));
              }
            }
            if(suspects.includes(pixel)) {
              const baseG=finiteGradient(q=>sdBody(q,body),p,1e-5);
              const resolved:WoundInput[]=wounds.map(v=>{const burn=v.meta[0]!>1.5,depth=v.w[3]!*(burn?.35*Math.max(0,Math.min(1,v.meta[1]!)):1);return {center:v.w.slice(0,3) as unknown as V3,depth,cap:v.cap[3]!>0?v.cap[3]!:1e5,inward:v.cap.slice(0,3) as unknown as V3,blend:cfg[1]!,rimPosition:depth*cfg[3]!*v.meta[3]!,rimWidth:Math.max(depth*cfg2[0]!,1e-4),rimAmp:depth*cfg[2]!*v.meta[2]!*(burn?.25:1)};});
              const dg=woundGradient({d:base,g:baseG,reason:'ok'},p,resolved);
              samples.push({pixel:[x,y],p,owner,base,baseG,dg,gradientLength:Math.hypot(...dg.g),primitive:body.prims[owner]});
            }
            const add=(region:ReturnType<typeof make>)=>{region.hits++;region.reasons[code]!++;if(code===0)region.analytic++;};
            if(owner>=u.counts.value.x) {add(regions.internal);if((Math.round(row(owner,ROW_PRIM_SHAPE)[1]!)&2)!==0)add(regions.curvedInternal);continue;}
            if(Math.abs(d-base)<=1e-5)continue;
            scalarSurfaceMax=Math.max(scalarSurfaceMax,Math.abs(d));
            add(d>base?regions.wall:regions.rim);
            if(body.prims[owner]?.limb==='head')add(regions.headWound);
            if(body.prims[owner]?.limb==='torso')add(regions.torsoWound);
          }
          return {thresholdMetres:1e-5,method:'unproject WebGPU clip-depth alpha; production uploaded wound scalar minus sdBody authored flesh; internal owners separate',regions,scalarSurfaceMax,samples,wounds,cfg,cfg2,perf};
        },
        async hashMarchTarget() {
          const t = ctx.render.sdfLayer.marchTarget;
          const w = t.width, h = t.height;
          const buf = new Float32Array(
            await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
          let hash = 0x811c9dc5;
          let nonZero = 0;
          let rSum = 0;
          for (let row = 0; row < h; row++) {
            const base = row * floatsPerRow;
            for (let col = 0; col < w; col++) {
              const o = base + col * 4;
              const r = buf[o]!, g = buf[o + 1]!, b = buf[o + 2]!;
              hash = Math.imul(hash ^ (r | 0), 0x01000193);
              hash = Math.imul(hash ^ (g | 0), 0x01000193);
              hash = Math.imul(hash ^ (b | 0), 0x01000193);
              if (r !== 0 || g !== 0 || b !== 0) nonZero++;
              rSum += r;
            }
          }
          return { w, h, hash: (hash >>> 0).toString(16), nonZero, rSum: +rSum.toFixed(3) };
        },
      };
      return 1;
    },
    debugRegisteredTree: (namePart: string, maxNodes = 48, actorId?: number) => {
      let root: THREE.Object3D | null = null;
      scene.traverse((o) => {
        if (root) return;
        if (o.name && o.name.includes(namePart) &&
            (actorId === undefined || o.userData.gameActorId === actorId)) root = o;
      });
      if (!root) return { found: false, namePart };
      const r = root as THREE.Object3D;
      const propNodes = new Set<string>();
      ctx.world.actors.find(a => a.id === r.userData.gameActorId)?.character?.prop?.object
        .traverse(o => propNodes.add(o.uuid));
      const nodes: Record<string, unknown>[] = [];
      const queue: THREE.Object3D[] = [r];
      let seen = 0;
      while (queue.length > 0 && nodes.length < maxNodes && seen < maxNodes * 4) {
        const o = queue.shift()!;
        seen++;
        // POSED MATRIX, not getWorldPosition: kit/prop nodes pose by writing
        // matrixWorld DIRECTLY with matrixWorldAutoUpdate=false (kit-overlay
        // bone nodes, held-prop's object) precisely so three's update pass
        // cannot overwrite the rig solve. getWorldPosition() calls
        // updateWorldMatrix(true, false), which recomputes matrixWorld from
        // the (zero) local transform and reported every kit mesh at the
        // world origin — the gate then projected [0,0,0] and missed the kit
        // entirely. matrixWorld's translation is the LAST POSED matrix —
        // what the last render actually rasterised (normally-updated nodes
        // carry the same value after a render).
        const pe = o.matrixWorld.elements;
        const p = { x: pe[12], y: pe[13], z: pe[14] };
        // SKINNED kit pieces: the node itself stays at its import transform
        // (identity) and the VERTICES ride the skeleton, so the node origin
        // is never where the piece paints. Report the SKELETON's posed bone
        // translations (bounded) as the render-space anchors — kit-overlay
        // writes bone matrixWorld directly in world space, so these are the
        // exact positions the last render drew at.
        const sk = (o as THREE.SkinnedMesh).skeleton;
        const bones: Array<[number, number, number]> | undefined = sk
          ? sk.bones.slice(0, 14).map((b) => {
            const be = b.matrixWorld.elements;
            return [+be[12].toFixed(3), +be[13].toFixed(3), +be[14].toFixed(3)] as [number, number, number];
          })
          : undefined;
        const mats: string[] = [];
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) for (const mm of m) mats.push(String(mm.name || mm.type));
        else if (m) mats.push(String(m.name || m.type));
        nodes.push({
          name: o.name || `<${o.type}>`, uuid: o.uuid, heldProp: propNodes.has(o.uuid), depth: d.nodeDepth(r, o),
          isMesh: (o as THREE.Mesh).isMesh === true, visible: o.visible,
          isSkinnedMesh: (o as THREE.SkinnedMesh).isSkinnedMesh === true,
          bones,
          materials: mats, pos: [d.round2(p.x), d.round2(p.y), d.round2(p.z)],
          route: ctx.boot.deferredApi?.router.routeOf(o) ?? null,
          receiver: ctx.boot.deferredApi?.router.receiverOf(o) ?? null,
        });
        for (const c of o.children) queue.push(c);
      }
      return {
        found: true, name: r.name, actorId: r.userData.gameActorId ?? null,
        route: ctx.boot.deferredApi?.router.routeOf(r) ?? null,
        receiver: ctx.boot.deferredApi?.router.receiverOf(r) ?? null,
        totalDescendants: d.countDescendants(r),
        truncated: seen >= maxNodes * 4 || nodes.length >= maxNodes,
        nodes,
      };
    },
    /**
     * OCCLUDER WORLD-POSITION CHECK (close-up diagnostics task 1, question
     * B). Renders the synthetic sphere TWICE — once writing the camera
     * distance (the shipping encoding), once with uDebugWorld=1 writing the
     * fragment's WORLD POSITION — and compares both against the analytic
     * sphere the instance matrix claims was drawn.
     *
     * The attribution this buys: if the written POSITION is right but the
     * written DISTANCE is wrong, the defect is in the material's
     * length(positionWorld - cameraPosition) evaluation; if the POSITION is
     * itself wrong at range, the defect is upstream in the instance/vertex
     * path. Either way the texture round-trip is already exonerated (the
     * quad probes in texRoundTrip).
     */
    async occluderWorldCheck(dist = 5, radius = 0.2) {
      const wasOn = ctx.render.sdfLayer.occluderEnabled;
      try {
        ctx.boot.handle.setLoopRunning(false);
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        const c = camera.position.clone().addScaledVector(fwd, dist);
        ctx.render.occluderHull.setSpheres([{ centre: [c.x, c.y, c.z], radius }]);
        ctx.render.sdfLayer.setOccluderEnabled(true);
        const readFrame = async () => {
          ctx.boot.handle.step(1 / 60);
          await ctx.boot.handle.resolveGpu();
          const t = ctx.render.sdfLayer.occluderTarget;
          const buf = new Float32Array(
            await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, t.width, t.height),
          );
          return { buf, w: t.width, h: t.height };
        };
        ctx.render.occluderHull.debugWorld.value = 0;
        const d0 = await readFrame();
        ctx.render.occluderHull.debugWorld.value = 1;
        const d1 = await readFrame();
        ctx.render.occluderHull.debugWorld.value = 0;
        const fpr = (w: number) => Math.ceil((w * 16) / 256) * 256 / 4;
        const ndc = c.clone().project(camera);
        const col = Math.round(((ndc.x + 1) / 2) * d0.w - 0.5);
        const rowTop = Math.round(((1 - ndc.y) / 2) * d0.h - 0.5);
        const cell = (d: { buf: Float32Array; w: number }, r: number, cc: number, ch: number) =>
          d.buf[r * fpr(d.w) + cc * 4 + ch] ?? NaN;
        const r1 = Math.min(d0.h - 1 - rowTop, d0.h - 1);
        const writtenDist = cell(d0, r1, col, 0);
        const wPos = new THREE.Vector3(cell(d1, r1, col, 0), cell(d1, r1, col, 1), cell(d1, r1, col, 2));
        const dir = c.clone().sub(camera.position).normalize();
        const tHit = camera.position.distanceTo(c) - radius;
        const expectedPos = camera.position.clone().addScaledVector(dir, tHit);
        return {
          sphereCentreDistFromCam: +camera.position.distanceTo(c).toFixed(4),
          analyticCentrePixel: +tHit.toFixed(4),
          writtenDist: +writtenDist.toFixed(4),
          expectedPos: expectedPos.toArray().map(v => +v.toFixed(4)),
          writtenPos: wPos.toArray().map(v => +v.toFixed(4)),
          posErr: +wPos.distanceTo(expectedPos).toFixed(4),
          distFromWrittenPos: +wPos.distanceTo(camera.position).toFixed(4),
        };
      } finally {
        ctx.render.sdfLayer.setOccluderEnabled(wasOn);
        ctx.boot.handle.setLoopRunning(true);
      }
    },
    /**
     * Rasterise ONE sphere of known centre and radius and read back what the
     * pre-pass wrote for it, next to the analytic ray-sphere entry for the
     * same pixel. With a single instance there is no ambiguity about which
     * sphere a fragment came from.
     */
    async syntheticSphereCheck(dist = 5, radius = 0.2) {
      const wasOn = ctx.render.sdfLayer.occluderEnabled;
      try {
        ctx.boot.handle.setLoopRunning(false);
        // Straight ahead of the camera, `dist` metres away.
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        const c = camera.position.clone().addScaledVector(fwd, dist);
        ctx.render.occluderHull.setSpheres([{ centre: [c.x, c.y, c.z], radius }]);
        ctx.render.sdfLayer.setOccluderEnabled(true);
        ctx.boot.handle.step(1 / 60);
        await ctx.boot.handle.resolveGpu();
        const ot = ctx.render.sdfLayer.occluderTarget;
        const buf = new Float32Array(
          await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(ot, 0, 0, ot.width, ot.height),
        );
        const fpr = Math.ceil((ot.width * 16) / 256) * 256 / 4;
        // The pixel the sphere centre projects to.
        const ndc = c.clone().project(camera);
        const col = Math.round(((ndc.x + 1) / 2) * ot.width - 0.5);
        const rowTop = Math.round(((1 - ndc.y) / 2) * ot.height - 0.5);
        const read = (r: number, cc: number) => buf[r * fpr + cc * 4]!;
        let covered = 0, minV = Infinity, maxV = -Infinity;
        for (let r = 0; r < ot.height; r++) {
          for (let cc = 0; cc < ot.width; cc++) {
            const v = read(r, cc);
            if (v <= 0) continue;
            covered++;
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
          }
        }
        return {
          sphereCentreDistFromCam: +camera.position.distanceTo(c).toFixed(4),
          radius,
          /** What it SHOULD read at the centre pixel: centre distance - radius. */
          analyticCentrePixel: +(camera.position.distanceTo(c) - radius).toFixed(4),
          atCentrePixelTopDown: +read(rowTop, col).toFixed(4),
          atCentrePixelBottomUp: +read(ot.height - 1 - rowTop, col).toFixed(4),
          coveredPx: covered,
          minWritten: minV === Infinity ? null : +minV.toFixed(4),
          maxWritten: maxV === -Infinity ? null : +maxV.toFixed(4),
          col, rowTop,
        };
      } finally {
        ctx.render.sdfLayer.setOccluderEnabled(wasOn);
        ctx.boot.handle.setLoopRunning(true);
      }
    },
    /** CONTROLLED FORWARD DEPTH PROBES (composition review fix evidence
     *  seam). Spawns up to three unregistered blended sprites (pure R, G, B —
     *  depth-tested, no depth write) at world points the caller picks from
     *  known depth pixels, so a gate can distinguish FRONT-visible /
     *  BEHIND-occluded / empty-far behaviour of the composed frame instead of
     *  inferring depth from broad image deltas. Unregistered renderables are
     *  left alone by the forward route and hidden from the G-buffer passes
     *  by the router, so the probes only ever composite. */
    spawnDepthProbes: (spots: Vec3[], scale: number | { pixels: number } = 0.14) => {
      d.clearDepthProbes();
      // Task-6 gate: up to EIGHT distinct probes per spawn (a depth-bracket
      // ladder along one ray needs side-by-side colours in one frame; three
      // forced a spawn-per-depth cycle). Colours stay maximally separable in
      // a 7x7 screenshot sample.
      const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8000, 0x8040ff];
      for (let i = 0; i < spots.length && i < colors.length; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          color: colors[i]!,
          // Diagnostic palette must survive distance/exposure unchanged;
          // these sprites measure depth, not the authored fog response.
          fog: false,
          toneMapped: false,
          transparent: true,
          blending: THREE.NormalBlending,
          depthWrite: false,
          depthTest: true,
        }));
        s.name = `depth-probe-${i}`;
        s.position.set(spots[i]![0], spots[i]![1], spots[i]![2]);
        // Diagnostic option: a fixed screen footprint remains measurable
        // at far-plane depths; world-size probes shrink below one pixel.
        const viewZ = new THREE.Vector3(...spots[i]!).applyMatrix4(camera.matrixWorldInverse).z;
        const worldSize = typeof scale === 'number' ? scale
          : 2 * Math.abs(viewZ) * Math.tan(camera.fov * Math.PI / 360)
            * scale.pixels / ctx.render.postAa.contentSize.height;
        s.scale.setScalar(worldSize);
        scene.add(s);
        ctx.render.depthProbes.push(s);
      }
      return ctx.render.depthProbes.map((s) => s.name);
    },
  };
}
