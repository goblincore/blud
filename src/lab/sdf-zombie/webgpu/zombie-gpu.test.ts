// src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
//
// Packed-channel checks for the noise root shift (motion-polish). The anchor
// itself is guarded by tripwires in march.wgsl.test.ts; these pin the CPU side:
// WHICH channel carries it, what its default is, and who overwrites it.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  createZombieGpuView, createChunkGpuView, createSharedChunkGpuMaterial,
  defaultUniforms, blankFaceTexture, woundReachBound,
} from './zombie-gpu';
import { createFallbackHandVolumeTexture } from './hand-volume';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { ZOMBIE } from '../body';
import { makeChunk } from '../gib-chunks';
import { ROW_PRIM_BEND } from './march.wgsl';
import { MAX_PRIMS } from '../validate';
import { encodeSurfaceClass } from './deferred-surface';
import type { Primitive } from '../types';
import * as THREE from 'three/webgpu';

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);

/** The march material as NodeMaterial-shaped — mrtNode/outputNode/colorNode/
 *  depthNode are NodeMaterial slots, null unless the builder set them. */
type MarchMat = {
  mrtNode: { outputNodes: Record<string, unknown> } | null;
  outputNode: unknown; colorNode: unknown; depthNode: unknown;
  side: THREE.Side; depthWrite: boolean;
};

describe('noise root shift — packed channel (faceCfg3.zw)', () => {
  it('defaults to zero: a statue body keeps world-anchored noise, as before', () => {
    const view = createZombieGpuView(body, {});
    expect(view.uniforms.faceCfg3.value.z).toBe(0);
    expect(view.uniforms.faceCfg3.value.w).toBe(0);
    view.dispose();
  });

  it('setRootShift writes ground-plane xz without touching flicker or time', () => {
    const view = createZombieGpuView(body, {});
    view.setTime(12.5);
    view.setRootShift(1.25, -0.75);
    const v = view.uniforms.faceCfg3.value;
    expect(v.x).toBeCloseTo(0.45, 6); // glowFlicker slot untouched
    expect(v.y).toBeCloseTo(12.5, 6); // time slot untouched
    expect(v.z).toBeCloseTo(1.25, 6);
    expect(v.w).toBeCloseTo(-0.75, 6);
    view.dispose();
  });

  it('a chunk view re-anchors the channel to its own position on every update', () => {
    // The chunk's gore mottle must ride the CHUNK, not the body it left (and
    // not the world). The template's root shift is copied at spawn and then
    // overwritten per update — the sequence below exercises exactly that.
    const template = createZombieGpuView(body, {});
    template.setRootShift(2, 3); // stale body shift, must not stick
    const prims = body.prims.filter(p => p.limb === 'armL').slice(0, 2);
    const chunk = makeChunk('armL', [0.4, 1, -0.2], [1, 2, 0], 0.1, [0, 0, 1]);
    const view = createChunkGpuView(chunk, prims, template.uniforms);
    expect(view.uniforms.faceCfg3.value.z).toBeCloseTo(0.4, 6);
    expect(view.uniforms.faceCfg3.value.w).toBeCloseTo(-0.2, 6);
    view.update({ ...chunk, pos: [1.5, 0.3, 2.5] });
    expect(view.uniforms.faceCfg3.value.z).toBeCloseTo(1.5, 6);
    expect(view.uniforms.faceCfg3.value.w).toBeCloseTo(2.5, 6);
    view.dispose();
    template.dispose();
  });
});

describe('shared gib chunk material', () => {
  it('reuses one externally-owned material while keeping per-chunk uniforms isolated', () => {
    // Regression: creating a fresh NodeMaterial per gib chunk makes Three run
    // its multi-second node builder/generator path once per render object.
    // The lab owns one prebuilt material; chunk views own only their mutable
    // data texture and uniforms.
    const shared = createSharedChunkGpuMaterial();
    const prims = body.prims.filter(p => p.limb === 'armL').slice(0, 2);
    const chunkA = makeChunk('armL', [0.4, 1, -0.2], [1, 2, 0], 0.1, [0, 0, 1]);
    const chunkB = makeChunk('armL', [-0.6, 0.7, 0.9], [-1, 1, 0], 0.1, [0, 0, 1]);
    const template = createZombieGpuView(body, {});

    const viewA = createChunkGpuView(chunkA, prims, template.uniforms, undefined, undefined, shared);
    const viewB = createChunkGpuView(chunkB, prims, template.uniforms, undefined, undefined, shared);

    expect((viewA.object as THREE.Mesh).material).toBe(shared.material);
    expect((viewB.object as THREE.Mesh).material).toBe(shared.material);
    expect(viewA.uniforms).not.toBe(viewB.uniforms);
    viewA.update({ ...chunkA, pos: [1.25, 0.4, -1.5] });
    expect(viewA.uniforms.faceCfg3.value.z).toBeCloseTo(1.25, 6);
    expect(viewB.uniforms.faceCfg3.value.z).toBeCloseTo(-0.6, 6);

    let sharedDisposed = false;
    shared.material.addEventListener('dispose', () => { sharedDisposed = true; });
    viewA.dispose();
    viewB.dispose();
    expect(sharedDisposed).toBe(false);
    shared.dispose();
    expect(sharedDisposed).toBe(true);
    template.dispose();
  });

  it('reconfigures a bounded mesh slot without allocating a new render object', () => {
    const shared = createSharedChunkGpuMaterial();
    const template = createZombieGpuView(body, {});
    const armPrims = body.prims.filter(p => p.limb === 'armL').slice(0, 2);
    const headPrims = body.prims.filter(p => p.limb === 'head').slice(0, 4);
    const arm = makeChunk('armL', [0.4, 1, -0.2], [1, 2, 0], 0.1, [0, 0, 1]);
    const head = makeChunk('head', [-0.2, 1.5, 0.3], [-1, 1, 0], 0.2, [0, 1, 0]);
    const view = createChunkGpuView(arm, armPrims, template.uniforms, undefined, undefined, shared);
    const object = view.object;
    const uniforms = view.uniforms;

    // The lab recycles at its 40-chunk cap. Repeated churn must keep the
    // object/material identity that keys Three's RenderObject cache while
    // replacing the field data and head/limb-specific configuration.
    for (let i = 0; i < 80; i++) {
      const next = i % 2 === 0 ? head : arm;
      view.reset(next, i % 2 === 0 ? headPrims : armPrims);
      expect(view.object).toBe(object);
      expect(view.uniforms).toBe(uniforms);
    }
    expect(view.uniforms.counts.value.x).toBe(armPrims.length);
    expect(view.uniforms.faceCfg.value.x).toBe(0);
    view.reset(head, headPrims);
    expect(view.uniforms.counts.value.x).toBe(headPrims.length);
    expect(view.uniforms.faceCfg.value.x).toBe(1);

    view.dispose();
    shared.dispose();
    template.dispose();
  });
});

describe('baked hand volume binding (X1.26 task B3)', () => {
  it('defaultUniforms carries the five volume uniforms, all primitive-mode', () => {
    const u = defaultUniforms(blankFaceTexture());
    expect(u.volumePose0.value.w).toBe(0); // enable flag OFF
    expect(u.volumePose1.value.equals(new THREE.Vector4(0, 0, 0, 1))).toBe(true);
    expect(u.volumeMin.value.lengthSq()).toBe(0);
    expect(u.volumeInvExtent.value.lengthSq()).toBe(0);
    expect(u.volumeWarp.value.lengthSq()).toBe(0);
  });

  it('body and chunk views default to primitive mode and bind the fallback volume', () => {
    // The call-site guarantee: every march material carries a 3D texture
    // binding. volumeTexture is part of each view interface, so a factory
    // that omitted it would not compile.
    const template = createZombieGpuView(body, {});
    expect(template.uniforms.volumePose0.value.w).toBe(0);
    expect(template.volumeTexture).toBeInstanceOf(THREE.Data3DTexture);
    expect(template.volumeTexture.type).toBe(THREE.HalfFloatType);

    const prims = body.prims.filter(p => p.limb === 'armL').slice(0, 2);
    const chunk = makeChunk('armL', [0.4, 1, -0.2], [1, 2, 0], 0.1, [0, 0, 1]);
    const view = createChunkGpuView(chunk, prims, template.uniforms);
    expect(view.uniforms.volumePose0.value.w).toBe(0);
    expect(view.volumeTexture).toBeInstanceOf(THREE.Data3DTexture);
    view.dispose();
    template.dispose();
  });

  it('a self-created fallback is disposed WITH the view; a shared one is not', () => {
    // Ownership: the lab renderer may share ONE fallback across every
    // non-volume view and dispose it once itself — a view disposing a shared
    // texture would pull the binding out from under its neighbours (the same
    // hazard setFaceTexture documents for face sheets).
    const ownView = createZombieGpuView(body, {});
    let ownDisposed = false;
    ownView.volumeTexture.addEventListener('dispose', () => { ownDisposed = true; });
    ownView.dispose();
    expect(ownDisposed).toBe(true);

    const shared = createFallbackHandVolumeTexture();
    let sharedDisposed = false;
    shared.addEventListener('dispose', () => { sharedDisposed = true; });
    const sharedView = createZombieGpuView(body, { volumeTex: shared });
    expect(sharedView.volumeTexture).toBe(shared);
    sharedView.dispose();
    expect(sharedDisposed).toBe(false); // caller still owns it
    shared.dispose();
    expect(sharedDisposed).toBe(true);
  });
});

describe('clip frame uniform (X1.27 task C3)', () => {
  it('defaultUniforms carries volumeClip with FALLBACK frame semantics [0,0,0,1]', () => {
    const u = defaultUniforms(blankFaceTexture());
    expect(u.volumeClip.value).toEqual(new THREE.Vector4(0, 0, 0, 1));
    // w=1 means the 1-cubed fallback slab; x=y=0, z=0 sample texel 0 of it.
  });

  it('forwards volumeClip beside volumeWarp in ALL march call sites', () => {
    // Tripwire, not behaviour: the TSL call is named-arg matched against the
    // WGSL signature, so a missing entry is a silent uniform mismatch.
    const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');
    const marchCalls = src.match(/volumeWarp: u\.volumeWarp,/g) ?? [];
    // createMarchMaterial + cone twin + depth-prepass twin (close-up task 3).
    expect(marchCalls.length).toBe(3);
    expect(src.match(/volumeWarp: u\.volumeWarp,\s*\n\s*volumeClip: u\.volumeClip,/g)?.length)
      .toBe(3);
  });

  it('depth-prepass twin — fog off, positionally-last inputs, fallback identity', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');
    // THE FOG TRAP: this material renders through the main scene, and scene
    // fog was smoothstep-mixing exactly such a written distance toward
    // fogColor with range (8da0bdd). A fogged prepass would re-create the
    // decay that killed the occluder pre-pass — starts drifting PAST surfaces
    // at range, deleting geometry. fog = false is not optional.
    expect(src).toMatch(/depthPreMaterial\.fog = false;/);
    // MARCH_BODY's depthPre inputs are bound POSITIONALLY LAST in the entry
    // literal — after windDrift, same commit as the WGSL inputs (meltCfg rule).
    expect(src).toMatch(/perfCfg: u\.perfCfg,[\s\S]*?inst: records\.node as never,[\s\S]*?instCfg,[\s\S]*?\) as unknown as \{ div/);
    expect(src).toMatch(/depthPreTex: texture\(depthPre \? depthPre\.texture : fallbackDepthPreTexture\(\)\)/);
    // Without a source, cfg is the all-zero constant — the fetch's disabled
    // identity. The 1x1 fallback texture carries value 0 so even a stray
    // read is "no start".
        // Without a source, cfg is the shared all-zero vec4 UNIFORM — the
    // fetch's disabled identity. It is deliberately NOT a composed constant
    // node: vec4-of-uniform-scalars breaks three's WGSL generation
    // (JoinNode -> getTypeFromLength null), console-only error, dead
    // uniforms, unlit-black bodies (2026-09-05).
    expect(src).toMatch(/depthPreCfg: \(depthPre \? depthPre\.uniforms\.cfg : fallbackDepthPreUniform\(\)\) as never/);
    expect(src).toMatch(/cfg: uniform\(new THREE\.Vector4\(0, 0, 0, 0\)\)/);
  });
});

describe('melt stops the body walking', () => {
  // The melt bypasses collapse.ts on purpose (that is what stops it toppling),
  // so nothing else told the rig it had died: gait and wander kept running and
  // the finished PUDDLE walked around the floor. Captures never showed it —
  // melt-capture.mjs freezes motion to hold the pose, so the harness that
  // makes the melt measurable is exactly what hid this.
  it('startMelt freezes motion and wander, stopMelt restores them', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/lab-main.ts', 'utf8');
    const start = src.slice(src.indexOf('function startMelt()'));
    const startBody = start.slice(0, start.indexOf('\n  }'));
    expect(startBody).toContain('setMotionEnabled(false)');
    expect(startBody).toContain('setWander(false)');
    // Saved BEFORE the freeze, or the restore puts back the frozen values.
    expect(startBody).toContain('meltPrevMotion = { motion: motionEnabled, wander: wanderOn }');

    const stop = src.slice(src.indexOf('function stopMelt()'));
    const stopBody = stop.slice(0, stop.indexOf('\n  }'));
    expect(stopBody).toContain('setMotionEnabled(meltPrevMotion.motion)');
    expect(stopBody).toContain('setWander(meltPrevMotion.wander)');
    expect(stopBody).toContain('meltPrevMotion = null');
  });
});

describe('chunk bend transform', () => {
  // A bent bar that keeps a LOCAL control point while its endpoints are
  // rewritten to world space straightens as the chunk turns. On the melt's
  // released ribcage that is the whole defect: ribs are two BENT bars per
  // hoop, and hoops whose control points no longer match their endpoints
  // collapse into rods — "a linear bundle of sticks" (owner, 2026-09-03).
  it('rewrites ROW_PRIM_BEND every frame in apply, not once in reset', () => {
    // Tripwire in this file's established style (see the volumeClip test):
    // the row's value cannot be read back out of the data texture here, and
    // the failure mode is a MISSING write, which a tripwire catches exactly.
    const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');
    const apply = src.slice(src.indexOf('function apply(c: Chunk)'));
    const body = apply.slice(0, apply.indexOf('\n  }'));
    expect(body).toContain('writeRow(ROW_PRIM_BEND');
    // ...and both prim loops must feed it, flesh and bone.
    expect(body.match(/writeBend\(/g)?.length).toBe(2);
    // ...and writeBend must actually WRITE. Counting call sites alone passes
    // against a gutted body — verified by mutation: stubbing writeBend to
    // return early left this whole file green until this assertion existed.
    const wb = src.slice(src.indexOf('function writeBend('));
    const wbBody = wb.slice(0, wb.indexOf('\n  }'));
    expect(wbBody).toContain('packed.primBend.set');
    expect(wbBody).toContain('chunkPoint(current, bendCtrl(');
  });

  it('writes the TRANSFORMED control point into the bend row', () => {
    // The real behavioural check: read ROW_PRIM_BEND straight out of the
    // dataTexture the march samples. A source tripwire cannot catch a gutted
    // writeBend — the text stays there — so this is the assertion that does.
    const quat: [number, number, number, number] = [0.3826834, 0, 0, 0.9238795];
    const bone: Primitive = {
      a: [1, 2, 3], b: [1, 2.4, 3], radius: 0.02, scale: [1, 1, 1], blendK: 0,
      limb: 'armL', cluster: 2, op: 'bone', bend: [0.1, 0, 0.05],
    };
    const spawn = makeChunk('armL', [1, 2, 3], [0, 0, 0], 0.2, [0, 1, 0], () => 0.5, 'limb');
    const view = createChunkGpuView(
      { ...spawn, quat }, [{ ...bone, op: 'add', radius: 0.05, bend: undefined }],
      defaultUniforms(blankFaceTexture()), undefined, undefined, undefined, [bone]);

    const readBend = (row: number): number[] => {
      const data = (view.dataTexture as THREE.DataTexture).image.data as Float32Array;
      const o = (ROW_PRIM_BEND * MAX_PRIMS + row) * 4;
      return [data[o]!, data[o + 1]!, data[o + 2]!];
    };

    // Update at two different orientations: the control point must MOVE with
    // the chunk. A bend left in local space is identical in both, which is
    // exactly the straightening the ribcage showed.
    view.update({ ...spawn, quat });
    const atA = readBend(1); // row 0 is the flesh prim, row 1 the bone
    view.update({ ...spawn, quat: [0, 0.7071068, 0, 0.7071068] });
    const atB = readBend(1);

    expect(Math.hypot(...atA)).toBeGreaterThan(1e-6);
    const moved = Math.hypot(atA[0]! - atB[0]!, atA[1]! - atB[1]!, atA[2]! - atB[2]!);
    expect(moved).toBeGreaterThan(1e-3);
  });

  it('carries a bent bone through the chunk transform', () => {
    // Rotated chunk: identity would pass whether or not the bend transforms.
    const chunk = { ...makeChunk('armL', [1, 2, 3], [0, 0, 0], 0.2, [0, 1, 0], () => 0.5, 'limb'),
      quat: [0.3826834, 0, 0, 0.9238795] as [number, number, number, number] };
    const bone: Primitive = {
      a: [1, 2, 3], b: [1, 2.4, 3], radius: 0.02, scale: [1, 1, 1], blendK: 0,
      limb: 'armL', cluster: 2, op: 'bone', bend: [0.1, 0, 0.05],
    };
    const view = createChunkGpuView(
      chunk, [{ ...bone, op: 'add', radius: 0.05, bend: undefined }],
      defaultUniforms(blankFaceTexture()), undefined, undefined, undefined, [bone]);
    view.update(chunk);
    const posed = view.posedBones()[0]!;
    // The bend must survive as a real displacement — a straightened bar
    // reports (0,0,0) — and must not be the untransformed authored value.
    expect(posed.bend).toBeDefined();
    const mag = Math.hypot(...posed.bend!);
    expect(mag).toBeGreaterThan(1e-6);
    expect(posed.bend).not.toEqual(bone.bend);
  });
});

describe('bone tubes plumbing', () => {
  it('chunk view exposes posedBones in world space with squash applied, and skips bone rows when packBones is off', () => {
    const chunk = makeChunk('armL', [1, 2, 3], [0, 0, 0], 0.2, [0, 1, 0], () => 0.5, 'limb');
    const bone: Primitive = { a: [1, 2, 3], b: [1, 2.2, 3], radius: 0.02, scale: [1, 1, 1], blendK: 0, limb: 'armL', cluster: 2, op: 'bone' };
    const view = createChunkGpuView(chunk, [/* one flesh prim */ { ...bone, op: 'add', radius: 0.05 }], defaultUniforms(blankFaceTexture()), undefined, undefined, undefined, [bone]);
    view.setPackBones(false);
    view.update(chunk);
    const pb = view.posedBones();
    expect(pb.length).toBe(1);
    expect(pb[0]!.op).toBe('bone');
    // a is recentred on the chunk origin then re-placed at chunk.pos: identity at spawn
    expect(pb[0]!.a.map(v => +v.toFixed(6))).toEqual([1, 2, 3]);
    expect(view.uniforms.counts2.value.x).toBe(0);   // no bone rows
    view.setPackBones(true);
    view.update(chunk);
    expect(view.uniforms.counts2.value.x).toBe(1);
    view.dispose();
  });
});

describe('wound union-reach bound (close-up wound-cull task, 2026-09-05)', () => {
  // applyWounds tests ONE sphere before its wound loop; the sphere must
  // contain every wound's reach, or the cull stops being a value no-op.
  // reach = radius * max(2, 2*rimOffset + 3*rimWidth) + 4*blendK + 0.25 —
  // the shader's own per-wound early-out formula, read off the uniforms.
  const wounds: [number, number, number][] = [
    [0.10, 1.20, 0.05], [0.24, 1.26, 0.11], [0.17, 1.12, 0.03],
    [0.03, 1.30, 0.09], [-0.06, 1.16, 0.06],
  ];
  const radii = [0.13, 0.13, 0.04, 0.04, 0.04];
  // defaultUniforms values: blendK 0.015, rimOffset 1.15, rimWidth 0.42.
  const blendK = 0.015, rimOffset = 1.15, rimWidth = 0.42;
  const reachOf = (r: number) =>
    r * Math.max(2, 2 * rimOffset + 3 * rimWidth) + 4 * blendK + 0.25;

  it('encloses every wound reach sphere — and a shrunken radius FAILS the check', () => {
    const [cx, cy, cz, R] = woundReachBound(wounds, radii, wounds.length, blendK, rimOffset, rimWidth);
    expect(R).toBeGreaterThan(0);
    const encloses = (r: number) => wounds.every((w, i) =>
      Math.hypot(w[0] - cx, w[1] - cy, w[2] - cz) + reachOf(radii[i]!) <= r + 1e-9);
    expect(encloses(R)).toBe(true);
    // Mutation verify: any shrink that matters must go red. 1% smaller than
    // the true bound must fail to enclose — if this assertion ever passes on
    // a shrunken R, the bound was never tight and the test proves nothing.
    expect(encloses(R * 0.99)).toBe(false);
  });

  it('zero wounds yield radius 0 (the loop never runs, as before)', () => {
    expect(woundReachBound([], [], 0, blendK, rimOffset, rimWidth)).toEqual([0, 0, 0, 0]);
  });

  it('setWounds writes the computed bound; the seam gates on the radius only', () => {
    const view = createZombieGpuView(body, {});
    // Fresh view: the no-cull identity, so a body that never uploads wounds
    // (and the chunk torn-end path, which never computes a bound) marches
    // exactly the pre-cull field.
    expect(view.uniforms.woundBound.value.w).toBe(1e9);
    const types = wounds.map(() => 1);
    const ages = wounds.map(() => 0);
    view.setWounds(wounds, radii, types, ages);
    const [cx, cy, cz, R] = woundReachBound(wounds, radii, wounds.length, blendK, rimOffset, rimWidth);
    const v = view.uniforms.woundBound.value;
    expect([v.x, v.y, v.z, v.w]).toEqual([cx, cy, cz, R]); // ships ON
    // The A/B seam flips the radius to the no-cull identity and back —
    // centre untouched, computed radius restored without a re-upload.
    view.setWoundCull(false);
    expect(view.uniforms.woundBound.value.w).toBe(1e9);
    expect(view.uniforms.woundBound.value.x).toBe(cx);
    view.setWoundCull(true);
    expect(view.uniforms.woundBound.value.w).toBe(R);
    view.dispose();
  });
});

// Hybrid deferred M1 task 2: the opt-in surface output. The G-buffer WGSL
// itself is pinned in deferred-sdf.test.ts; these pin the VIEW side — that
// no existing caller opts in implicitly, that the legacy depth-alpha output
// survives, and that a surface view keeps the whole view contract.
describe('deferred surface output mode (hybrid deferred M1 task 2)', () => {
  const marchMat = (view: ReturnType<typeof createZombieGpuView>): MarchMat =>
    (view.object as THREE.Mesh).material as unknown as MarchMat;

  it('an ordinary createZombieGpuView(body, existingOpts) stays on legacy output', () => {
    const view = createZombieGpuView(body, {});
    const mat = marchMat(view);
    // No MRT anywhere, and the legacy lit RGB + clip-depth-in-alpha output
    // (the sdf-layer composite's depth channel) is intact.
    expect(mat.mrtNode).toBeNull();
    expect(mat.outputNode).toBeTruthy();
    expect(mat.colorNode).toBeTruthy();
    expect(mat.depthNode).toBeTruthy();
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.depthWrite).toBe(true);
    view.dispose();
  });

  it('output: surface emits the five named attachments and NO legacy colour/alpha output', () => {
    const view = createZombieGpuView(body, { output: 'surface' });
    const mat = marchMat(view);
    expect(mat.mrtNode).toBeTruthy();
    const names = Object.keys(mat.mrtNode!.outputNodes);
    expect(names.sort()).toEqual(
      ['albedoRoughness', 'normalMetalness', 'emissionClass', 'surfaceDepth', 'surfaceParams'].sort(),
    );
    // The mrtNode IS the output struct (the task-1 MRTNode mechanism), so the
    // legacy colorNode/outputNode must NOT be set — a stray lit/depth-alpha
    // output would fight the MRT contract.
    expect(mat.colorNode).toBeNull();
    expect(mat.outputNode).toBeNull();
    // The hardware depthNode still carries the traced hit depth: the proxy
    // box depth-tests exactly as the lit path does.
    expect(mat.depthNode).toBeTruthy();
    expect(mat.depthWrite).toBe(true);
    expect(mat.side).toBe(THREE.BackSide);
    view.dispose();
  });

  it('a surface view keeps the full view contract: same uniforms block, same setters, same disposal', () => {
    const view = createZombieGpuView(body, { output: 'surface' });
    // Same uniform block shape the lit view binds — one binding block feeds
    // both entries (the 81-input parser pin lives in deferred-sdf.test.ts).
    expect(view.uniforms.counts.value.x).toBeGreaterThan(0);
    // Proxy geometry and the cone twin are present and unchanged.
    expect(view.object).toBeInstanceOf(THREE.Mesh);
    expect(view.coneObject).toBeInstanceOf(THREE.Mesh);
    // The mutators all run against the surface view unchanged.
    const wounds: [number, number, number][] = [[0, 1.0, 0.35]];
    view.setWounds(wounds, [0.2], [1], [0]);
    expect(view.uniforms.woundCfg.value.x).toBe(1);
    view.setRootShift(0.5, -0.25);
    expect(view.uniforms.faceCfg3.value.z).toBeCloseTo(0.5, 6);
    view.setFaceTexture(blankFaceTexture(), new THREE.Vector4(1, 1, 0, 0), 0.5);
    expect(view.uniforms.faceCfg2.value.y).toBeCloseTo(0.5, 6);
    view.update(body);
    expect(view.getTileGroups().length).toBeGreaterThan(0);
    // Owns and disposes its own fallback volume like the lit view.
    view.dispose();
  });

  it('the cone and depth-prepass twins never enter surface mode', () => {
    // The deferred SDF scene gets view.object only; the twins keep their
    // own single-output materials regardless of the view's output mode.
    const view = createZombieGpuView(body, { output: 'surface' });
    const coneMat = (view.coneObject as THREE.Mesh).material as unknown as MarchMat;
    expect(coneMat.mrtNode).toBeNull();
    expect(coneMat.outputNode).toBeTruthy();
    view.dispose();
  });

  it('surfaceClass metadata: default stays M1 class 2; shadowReceiver level-only packs bit 4', () => {
    // M2 task 2: the emission-class channel is an unlit uniform seeded by
    // GpuViewOpts.shadowReceiver. The M1 fixture passes no receiver — its
    // bodies must encode EXACTLY class 2 ('full' sets no bit).
    const def = createZombieGpuView(body, { output: 'surface' });
    const defMat = marchMat(def) as unknown as { surfaceClass?: { value: number } };
    expect(defMat.surfaceClass?.value).toBe(encodeSurfaceClass(2, 'full'));
    expect(defMat.surfaceClass?.value).toBe(2);
    def.dispose();

    // The game requests level-only receivers for flesh explicitly.
    const lvl = createZombieGpuView(body, { output: 'surface', shadowReceiver: 'level-only' });
    const lvlMat = marchMat(lvl) as unknown as { surfaceClass?: { value: number } };
    expect(lvlMat.surfaceClass?.value).toBe(encodeSurfaceClass(2, 'level-only'));
    expect(lvlMat.surfaceClass?.value).toBe(18);
    lvl.dispose();
  });
});

describe('M2 task 2 — surface output options on the chunk factories', () => {
  /** The per-draw bound nodes exposed by createSharedChunkGpuMaterial.
   *  node.update({ object }) performs EXACTLY the rebinding a render of
   *  `object` performs (three's onObjectUpdate sets node.update; the
   *  renderer calls it per object with the same frame shape). */
  type BoundNode<T> = { value: T; update: (frame: { object: THREE.Object3D }) => void };
  interface SharedHandle {
    material: { mrtNode: { outputNodes: Record<string, unknown> } | null; colorNode: unknown; outputNode: unknown };
    dataNode: BoundNode<THREE.Texture>;
    volumeNode: BoundNode<THREE.Texture>;
    uniformNodes: { counts: BoundNode<THREE.Vector4> };
    dispose(): void;
  }

  it('two chunks with distinct data under ONE surface material rebind texture/uniform per draw', () => {
    const shared = createSharedChunkGpuMaterial(undefined, {
      output: 'surface', shadowReceiver: 'level-only',
    }) as unknown as SharedHandle;

    // ONE graph per output mode: surface mode emits the MRT, never the lit
    // output, and both chunk views share the exact same material object.
    expect(shared.material.mrtNode).toBeTruthy();
    expect(Object.keys(shared.material.mrtNode!.outputNodes).sort())
      .toEqual(['albedoRoughness', 'emissionClass', 'normalMetalness', 'surfaceDepth', 'surfaceParams']);
    expect(shared.material.colorNode).toBeNull();
    expect(shared.material.outputNode).toBeNull();

    const prims = body.prims.filter(p => p.limb === 'armL').slice(0, 2);
    const chunkA = makeChunk('armL', [0.4, 1, -0.2], [1, 2, 0], 0.1, [0, 0, 1]);
    const chunkB = makeChunk('armL', [-0.6, 0.7, 0.9], [-1, 1, 0], 0.1, [0, 0, 1]);
    const template = createZombieGpuView(body, {});
    const viewA = createChunkGpuView(chunkA, prims, template.uniforms,
      undefined, undefined, shared as never, undefined, { output: 'surface' });
    const viewB = createChunkGpuView(chunkB, prims, template.uniforms,
      undefined, undefined, shared as never, undefined, { output: 'surface' });

    expect(viewA.object).not.toBe(viewB.object);
    expect((viewA.object as THREE.Mesh).material).toBe(shared.material as never);
    expect((viewB.object as THREE.Mesh).material).toBe(shared.material as never);
    expect(viewA.dataTexture).not.toBe(viewB.dataTexture);
    expect(viewA.uniforms).not.toBe(viewB.uniforms);

    // THE per-draw observation: simulate each draw's object update and read
    // the bound values the pipeline would upload for that draw.
    shared.dataNode.update({ object: viewA.object });
    expect(shared.dataNode.value).toBe(viewA.dataTexture);
    shared.uniformNodes.counts.update({ object: viewA.object });
    expect(shared.uniformNodes.counts.value).toBe(viewA.uniforms.counts.value);

    shared.dataNode.update({ object: viewB.object });
    expect(shared.dataNode.value).toBe(viewB.dataTexture);
    shared.uniformNodes.counts.update({ object: viewB.object });
    expect(shared.uniformNodes.counts.value).toBe(viewB.uniforms.counts.value);

    // The volume slot rebinds too, and both chunks share the SAME shared
    // volume texture here (template owns it) — distinct-data still holds via
    // the data texture and uniforms above.
    shared.volumeNode.update({ object: viewA.object });
    expect(shared.volumeNode.value).toBe(viewA.volumeTexture);

    viewA.dispose();
    viewB.dispose();
    shared.dispose();
    template.dispose();
  });

  it('existing calls stay lit: default chunk material and chunk views have no MRT', () => {
    const shared = createSharedChunkGpuMaterial() as unknown as SharedHandle;
    expect(shared.material.mrtNode).toBeNull();
    expect(shared.material.colorNode).toBeTruthy();

    const template = createZombieGpuView(body, {});
    const prims = body.prims.filter(p => p.limb === 'armL').slice(0, 2);
    const chunk = makeChunk('armL', [0.4, 1, -0.2], [1, 2, 0], 0.1, [0, 0, 1]);
    const view = createChunkGpuView(chunk, prims, template.uniforms);
    const mat = (view.object as THREE.Mesh).material as unknown as MarchMat;
    expect(mat.mrtNode).toBeNull();
    expect(mat.outputNode).toBeTruthy();
    view.dispose();
    shared.dispose();
    template.dispose();
  });

  it('a non-shared chunk view in surface mode emits the MRT with the requested receiver', () => {
    const template = createZombieGpuView(body, {});
    const prims = body.prims.filter(p => p.limb === 'armL').slice(0, 2);
    const chunk = makeChunk('armL', [0.4, 1, -0.2], [1, 2, 0], 0.1, [0, 0, 1]);
    const view = createChunkGpuView(chunk, prims, template.uniforms,
      undefined, undefined, undefined, undefined, { output: 'surface', shadowReceiver: 'level-only' });
    const mat = (view.object as THREE.Mesh).material as unknown as MarchMat & { surfaceClass?: { value: number } };
    expect(mat.mrtNode).toBeTruthy();
    expect(mat.colorNode).toBeNull();
    expect(mat.outputNode).toBeNull();
    expect(mat.surfaceClass?.value).toBe(18);
    view.dispose();
    template.dispose();
  });
});

describe('run 5 refine twin (source pins)', () => {
  const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');
  it('builds refineBody on the march chain and binds the four refine inputs by name', () => {
    expect(src).toContain('export const refineBody = buildEntryFn(REFINE_BODY);');
    expect(src).toContain('export const marchBody = buildEntryFn(MARCH_BODY);');
    for (const k of ['marchTex:', 'cosRay:', 'nearFar:', 'refineCfg:']) expect(src).toContain(k);
    expect(src).toContain('refineObject:');
  });
});

describe('run 5b slim twin lighting tail (source pins)', () => {
  const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8');
  it('the refine twin is built from refineTailUniforms', () => {
    expect(src).toContain('export function refineTailUniforms(');
    expect(src).toContain('refineTailUniforms(u, ');
  });
  it('the WGSL gates the slim tail relies on still exist', async () => {
    const { MARCH_BODY_LIGHT } = await import('./march.wgsl');
    expect(MARCH_BODY_LIGHT).toContain('if (surfCfg.w > 0.0) {');
    expect(MARCH_BODY_LIGHT).toContain('if (woundShadowCfg.x > 0.0 && hitNearWound)');
    expect(MARCH_BODY_LIGHT).toContain('if (probeCfg.x > 0.0) {');
    expect(MARCH_BODY_LIGHT).toContain('if (probeDynCfg.x > 0.0 || probeDynCfg.y > 0.0)');
    expect(MARCH_BODY_LIGHT).toMatch(/bounceCfg\.x == 0/);
  });
});
