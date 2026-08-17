// src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
//
// Nothing in this repo compiles a shader, and that is doubly true of WGSL —
// it is even further outside the toolchain's reach than GLSL was. So these
// tests guard the two things that CAN be checked from text, both of which have
// already cost this project a blank page:
//
//   1. The wgslFn parse contract. Every source must begin with `fn` and the
//      includes list must be dependency-ordered, or three throws one unhelpful
//      error and the page draws nothing.
//   2. That the ported features are actually referenced by the entry point.
//      The WebGL path lost eight consecutive green tasks to a shader that
//      never linked; "the module exports a string" is not evidence.
//
// Plus a value pin on the CPU mirror, which is the only automatic check that
// the field maths still means what it meant before the port.

import { describe, it, expect } from 'vitest';
import {
  HELPERS, MARCH_BODY, CONE_MARCH, DATA_ROWS, SD_PRIM, SD_PRIM_ORIENTED, MAP_BODY,
  SAMPLE_VOLUME,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT, ROW_REST_A, ROW_REST_B,
  ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_WOUND, ROW_WOUND_META,
} from './march.wgsl';
import { MAX_WOUNDS } from '../damage';
import { sdBody, sdPrimitive, MAX_PRIMS } from '../validate';
import { packBody } from '../pack';
import { add, cross, scale as vscale, sub, qFromAxisAngle, qNormalize } from '../vec';
import type { Primitive, Vec3 } from '../types';

// Every WGSL source in the file. Anything new MUST be added here: the
// reserved-word and parse-contract checks are the only thing standing between
// a one-word slip and a blank page whose only symptom is a CreateShaderModule
// error buried under a dozen cascading ones.
const ALL = [...HELPERS, MARCH_BODY, CONE_MARCH];

/** `fn name(` — the same shape three's ^-anchored declarationRegexp needs. */
function declaredName(src: string): string | null {
  return /^fn\s+([a-z_0-9]+)\s*\(/i.exec(src)?.[1] ?? null;
}

describe('wgslFn parse contract', () => {
  it('starts every source with fn, since three anchors its parse to ^', () => {
    // A leading comment — even a blank first line — makes three throw
    // "FunctionNode: Function is not a WGSL code". Comments therefore live
    // outside the template strings, or inside a function body.
    for (const src of ALL) expect(declaredName(src)).not.toBeNull();
  });

  it('orders HELPERS so each only calls the ones before it', () => {
    // WGSL requires declaration before use and three emits includes in the
    // order given, so a helper that calls a later one fails to compile.
    const names = HELPERS.map(declaredName);
    const seen = new Set<string>();
    HELPERS.forEach((src, i) => {
      const self = names[i]!;
      const body = src.slice(src.indexOf('{'));
      for (const other of names) {
        if (other === null || other === self || seen.has(other)) continue;
        expect(
          new RegExp(`\\b${other}\\s*\\(`).test(body),
          `${self} calls ${other}, which is declared after it`,
        ).toBe(false);
      }
      seen.add(self);
    });
  });

  it('declares no helper twice', () => {
    const names = HELPERS.map(declaredName);
    expect(new Set(names).size).toBe(names.length);
  });

});

// The list that cost a blank page: WGSL reserves ordinary-looking identifiers
// GLSL is happy with, and the failure is one CreateShaderModule error buried
// under cascading "invalid due to previous error" lines.
const RESERVED_WORDS = [
  'active', 'as', 'auto', 'binding_array', 'cast', 'class', 'common', 'compile',
  'demote', 'do', 'enum', 'explicit', 'export', 'extern', 'external', 'filter',
  'final', 'from', 'get', 'impl', 'import', 'inline', 'interface', 'layout',
  'match', 'meta', 'mod', 'module', 'move', 'mut', 'new', 'nil', 'null', 'of',
  'operator', 'package', 'partition', 'pass', 'precise', 'precision', 'priv',
  'protected', 'pub', 'public', 'readonly', 'ref', 'register', 'resource',
  'restrict', 'self', 'set', 'shared', 'sizeof', 'smooth', 'snorm', 'static',
  'std', 'super', 'target', 'template', 'this', 'throw', 'try', 'type',
  'typedef', 'typeof', 'union', 'unorm', 'use', 'using', 'varying', 'virtual',
  'volatile', 'where', 'while', 'write', 'writeonly', 'yield',
];

describe('no WGSL reserved words as identifiers', () => {
  it.each(ALL.map(src => [declaredName(src) ?? '(unnamed)', src] as const))(
    '%s declares nothing reserved', (_name, src) => {
      // Declarations only — `let`, `var` and parameters. A reserved word inside
      // a comment or as a field name (`.type`) is harmless.
      const declared = [
        ...src.matchAll(/\b(?:let|var)\s+([a-z_][a-z_0-9]*)/gi),
        ...src.matchAll(/[(,]\s*([a-z_][a-z_0-9]*)\s*:/gi),
      ].map(m => m[1]!);
      const clashes = declared.filter(d => RESERVED_WORDS.includes(d));
      expect(clashes).toEqual([]);
    },
  );
});

describe('ported features reach the entry point', () => {
  it('carves, wounds and their masks are all called from the march', () => {
    // mapBody folds carves then wounds; the shading reads the two masks.
    expect(MARCH_BODY).toContain('woundMask');
    expect(MARCH_BODY).toContain('charMask');
    const mapBody = HELPERS.find(h => declaredName(h) === 'mapBody')!;
    expect(mapBody).toContain('applyCarves');
    expect(mapBody).toContain('applyWounds');
  });

  it('applies wounds AFTER carves, as the GLSL does', () => {
    // Carves are part of the body's own definition; wounds are damage stamped
    // on the finished body. Swapping them changes the surface everywhere,
    // because the smooth-min fold is not associative.
    const mapBody = HELPERS.find(h => declaredName(h) === 'mapBody')!;
    expect(mapBody.indexOf('applyCarves')).toBeLessThan(mapBody.indexOf('applyWounds'));
  });

  it('projects the face, with relief and an emissive glow', () => {
    expect(MARCH_BODY).toContain('faceTex');
    expect(MARCH_BODY).toContain('texel');    // relief taps + the albedo tap
    expect(MARCH_BODY).toContain('flicker');  // the eye glow's guttering
    expect(MARCH_BODY).toContain('faceGlowColor');
  });

  it('uses atan2 for the spherical projection, not GLSL two-arg atan', () => {
    // WGSL keeps one-argument atan(), so the mis-port compiles fine and simply
    // returns the wrong longitude — a silent failure, hence the assertion.
    expect(MARCH_BODY).toContain('atan2(');
    expect(/[^2]\batan\s*\([^)]*,/.test(MARCH_BODY)).toBe(false);
  });

  it('does not carry the GLSL depth remap', () => {
    // WebGPU clip z is already [0,1] where OpenGL's is [-1,1]. The GLSL wrote
    // (clip.z / clip.w) * 0.5 + 0.5; carrying that over composites everything
    // at the wrong depth. Guard the clip.w DIVISION specifically, not the bare
    // `0.5 + 0.5` substring: the gore mask legitimately remaps fbm's [-1,1]
    // onto [0,1] with `* 0.5 + 0.5`, and so may any future mask.
    expect(MARCH_BODY).not.toMatch(/clip\.w/);
  });

  it('fades fresnel out inside wounds instead of wet-boosting it (X1.17)', () => {
    // Fresnel is environment rim-light; inside a cavity the "environment" is
    // the wound itself. Left at full strength it hits its ceiling on the
    // grazing-heavy rim geometry, gets the 1.6x wound-wetness boost on top,
    // and clips whole patches to white that sweep with the camera.
    expect(MARCH_BODY).toMatch(/let fres = [^;]*\* \(1\.0 - wm\);/);
  });

  it('gates the everted rim on surface locality (no limb welding)', () => {
    const applyWounds = HELPERS.find(h => declaredName(h) === 'applyWounds')!;
    expect(applyWounds).toContain('rimLocal');
    expect(applyWounds).toMatch(/smoothstep\([^)]*dIn\)/);
    // Per-wound rim scales ride the spare ROW_WOUND_META channels: z multiplies
    // the splay (amplitude), w the offset (ring radius) — the "weapon calibre"
    // knobs that let a blast wear a tamer lip than a pellet.
    expect(applyWounds).toContain('wMeta.z');
    expect(applyWounds).toContain('wMeta.w');
    // Tighter locality than the first cut (0.5/1.2): at blast amplitude the
    // old reach exceeded the armpit gap and the rim still welded arm to torso.
    expect(applyWounds).toMatch(/smoothstep\(amp \* 0\.35, amp \* 0\.7, dIn\)/);
  });

  it('shades chunks through the gore mask (gobs-and-goo §2)', () => {
    // lodCfg.w is goreStrength: 0 on the body, 1 on chunk views. The body's
    // clean-latex read must stay reachable, and the gore block's own fbm is
    // what makes a chunk read as mottled torn meat rather than a red ball.
    // Anchored to the noise shift (motion-polish) so the mottle rides the
    // chunk's own translation, not the world.
    expect(MARCH_BODY).toContain('goreStrength');
    expect(MARCH_BODY).toContain('fbm(anchor * 6.0)');
  });

  it('skips dead prims (w=2) in the carve pass too, not just the fold', () => {
    // primScale.w: 0 add, 1 carve, 2 dead (severed mid-limb). The additive
    // fold already skips anything above 0.5; a dead prim must ALSO stop
    // carving, or a severed hand keeps biting the field it left behind.
    const applyCarves = HELPERS.find(h => declaredName(h) === 'applyCarves')!;
    expect(applyCarves).toContain('S.w > 1.5');
  });

  it('shell-displaces the real field only inside a thin shell (gobs-and-goo task 4)', () => {
    // The middle path between fbm at every step (too expensive) and
    // normal-warping only (loses the outline): the march runs the SMOOTH
    // field relaxed until |d| enters the shell, then the silhouette fbm
    // displaces the stepped distance itself. Same 3.0 scale as mapBody's
    // noise term, so calcNormal's warped normals match the displaced skin.
    expect(MARCH_BODY).toContain('let dres = mapBody(');
    expect(MARCH_BODY).toContain('var d = dres.x;');
    expect(MARCH_BODY).toContain('let shellAmp = woundCfg2.z;');
    expect(MARCH_BODY).toMatch(/abs\(d\) < shellAmp \* 4\.0/);
    // The shell's fbm samples the dominant prim's REST frame (task 6) — the
    // displaced silhouette rides the same flesh as the normal-warped skin.
    expect(MARCH_BODY)
      .toMatch(/d = d \+ fbm\(restPoint\(camPos \+ rd \* t, data, i32\(dres\.y\), noiseLocal\(camPos \+ rd \* t, noiseShift\)\) \* 3\.0\) \* shellAmp;/);
  });

  it('anchors every noise site in REST space, so texture rides every limb (task 6)', () => {
    // The field is packed in world space, but the fbm — silhouette, shell,
    // micro surface detail, gore mottle — must sample the DOMINANT prim's
    // REST frame or a limb slides through the world-frame noise field as it
    // moves (owner playtest: "you can see the arms move but the texture
    // doesn't"). mapBody tracks the argmin prim in its fold and every noise
    // site maps through restPoint; the task-3 root-shift anchor (noiseLocal)
    // survives ONLY as the fallback for bodies without rest rows.
    expect(MARCH_BODY).toContain('let noiseShift = vec3<f32>(faceCfg3.z, lodCfg.z, faceCfg3.w);');
    expect(MARCH_BODY).toContain('calcNormal(p, data, counts, marchCfg.z, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp)');
    expect(MARCH_BODY).toContain('let anchor = restPoint(p, data, hitBest, noiseLocal(p, noiseShift));');
    expect(MARCH_BODY).toContain('fbm(anchor * 22.0)');
    expect(MARCH_BODY).not.toContain('fbm(p * 22.0)');
    const mapBody = HELPERS.find(h => declaredName(h) === 'mapBody')!;
    // Argmin tripwire: ONE sd evaluation feeds both the fold and the tracker.
    expect(mapBody).toContain('var sd = sdPrim(p, idx, data);');
    expect(mapBody).toContain('if (ori) { sd = sdPrimO(p, idx, data); }');
    expect(mapBody).toContain('if (sd < best) { best = sd; bestIdx = idx; }');
    expect(mapBody).toContain('d = smin(d, sd, k);');
    expect(mapBody).toContain('let anchor = restPoint(p, data, bestIdx, noiseLocal(p, noiseShift));');
    expect(mapBody).toContain('fbm(anchor * 3.0) * noiseAmp');
    // The cone pre-pass marches the SMOOTH field (amplitude 0) and stays
    // independent of the motion plumbing — zero shift, dead noise term. The
    // volume block still rides along: the cone must see the same field the
    // march does (X1.26).
    const coneMarch = CONE_MARCH;
    expect(coneMarch).toContain(
      'mapBody(camPos + rd * t, data, counts, 0.0, woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp).x');
  });

  it('steps the shell conservatively and never retracts a displaced sample', () => {
    // The fbm breaks the Lipschitz bound, so inside the shell a relaxed step
    // could tunnel — 0.6 under-relaxation pays for the noise instead. And the
    // overshoot retraction assumes the un-displaced field (it rewinds by the
    // omega excess), so it must be suppressed whenever d carries the shell.
    expect(MARCH_BODY).toContain('select(omega, 0.6, conservative)');
    expect(MARCH_BODY).toMatch(/let overshot = !conservative &&/);
  });

  it('extends the occluder bound by the shell amp (X1.21.2 dark dropout)', () => {
    // The hull is sized against the SMOOTH field, but a shell DENT retreats
    // up to ~0.9 amp below it — past the hull's (1 - shrink) clearance on
    // thin limbs — and a march clamped at the raw occT discards those pixels
    // outright: dark dropout patches, A/B-confirmed with the occluder off.
    // The bound must carry the amp so the dent stays reachable. Bumps are
    // nearer than the hull and never needed it. At amp 0 the bound is
    // bit-identical to the undisplaced one, so the guard pins the EXPRESSION
    // rather than a value.
    expect(MARCH_BODY).toContain('let tMax = min(length(worldPos - camPos), occT + woundCfg2.z);');
  });

  it('stops the cone one shell amp early (X1.21.2 pale tile wedges)', () => {
    // The cone certifies emptiness against the SMOOTH field; a displaced
    // BUMP stands up to ~0.9 amp proud of it and can sit inside the distance
    // the tile proved empty. A march started there skips the crest and shades
    // at the wrong depth — the hard-edged pale patches, per 8x8 tile. The
    // stop threshold must carry the amp; at amp 0 it is the old bound again.
    expect(CONE_MARCH).toContain('if (d < r + 0.0012 + woundCfg2.z) { return t; }');
  });
});

describe('baked hand volume branch (X1.26 task B2)', () => {
  it('exports SAMPLE_VOLUME starting with fn, per the wgslFn parse contract', () => {
    expect(declaredName(SAMPLE_VOLUME)).toBe('sampleHandVolume');
  });

  it('reads exactly eight 3D corner texels for the trilinear reconstruction', () => {
    const loads = SAMPLE_VOLUME.match(/textureLoad\(volumeTex/g) ?? [];
    expect(loads.length).toBe(8);
    // And nothing else in the helper touches the texture.
    expect(SAMPLE_VOLUME.match(/textureLoad\(/g)?.length).toBe(8);
  });

  it('reconstructs on the baker\'s ENDPOINT-INCLUSIVE lattice, not the sampler convention', () => {
    // The baker sampled ON the bounds: first/last texels sit exactly at
    // boundsMin/boundsMax, so texel coords are uv * (dims - 1). The
    // normalized-sampler convention uv*dims - 0.5 assumes samples at texel
    // CENTRES and would shift the whole field half a voxel.
    expect(SAMPLE_VOLUME)
      .toContain('q = clamp(uv * (dimsF - vec3<f32>(1.0, 1.0, 1.0)), vec3<f32>(0.0, 0.0, 0.0), dimsF - vec3<f32>(1.0, 1.0, 1.0));');
    expect(SAMPLE_VOLUME).not.toContain('- 0.5)');
    // Nested mix: 4 edges, 2 faces, 1 slab = exactly seven.
    expect((SAMPLE_VOLUME.match(/mix\(/g) ?? []).length).toBe(7);
    // Degenerate top corner: floor == dims-1 clamps i1 back onto i0.
    expect(SAMPLE_VOLUME).toContain('min(i0 + vec3<i32>(1, 1, 1), dims - vec3<i32>(1, 1, 1))');
  });

  it('transforms world to local with the conjugate of the local-to-world quat', () => {
    expect(SAMPLE_VOLUME).toContain('vec4<f32>(-volumePose1.xyz, volumePose1.w)');
  });

  it('applies the distal warp progressively with smoothstep(0.15, 0.9, uv.y)', () => {
    // Wrist pinned (0 at the carpals), fingers fully lagged past 0.9. The
    // 12 mm CLAMP is CPU-side (task C1); the shader just ramps.
    expect(SAMPLE_VOLUME).toContain('smoothstep(0.15, 0.9, uv0.y)');
    expect(SAMPLE_VOLUME).toContain('local0 - volumeWarp.xyz * distal');
  });

  it('adds metric distance to the AABB outside the volume — no slab extrusion', () => {
    // Clamp-to-edge alone would repeat the boundary slab out to infinity;
    // every outside sample must grow by its true distance to the box.
    expect(SAMPLE_VOLUME).toContain('let diffMin = volumeMin - local;');
    expect(SAMPLE_VOLUME).toContain('let diffMax = local - (volumeMin + extent);');
    expect(SAMPLE_VOLUME).toContain(
      'let outside = length(max(max(diffMin, diffMax), vec3<f32>(0.0, 0.0, 0.0)));');
    expect(SAMPLE_VOLUME).toContain('return tri + outside;');
  });

  it('sits in HELPERS before MAP_BODY, which calls it', () => {
    // WGSL declaration-before-use; HELPERS is dependency-ordered.
    expect(HELPERS).toContain(SAMPLE_VOLUME);
    expect(HELPERS.indexOf(SAMPLE_VOLUME)).toBeLessThan(HELPERS.indexOf(MAP_BODY));
    expect(MAP_BODY).toContain('sampleHandVolume(p, volumeTex');
  });

  it('MAP_BODY: the volume branch supplies d, skips the primitive loop, and keeps the dominant index -1', () => {
    const branch = MAP_BODY.indexOf('if (volumePose0.w > 0.5) {');
    expect(branch).toBeGreaterThanOrEqual(0);
    // The branch must precede carves/wounds — the bake is the body, damage
    // still stamps on top of it either way.
    expect(branch).toBeLessThan(MAP_BODY.indexOf('applyCarves'));
    expect(branch).toBeLessThan(MAP_BODY.indexOf('applyWounds'));
    // No faked primitive index: the volume branch never assigns bestIdx, so
    // the rest-space anchor falls to its noiseLocal fallback.
    const vol = MAP_BODY.slice(branch, MAP_BODY.indexOf('} else {', branch));
    expect(vol).not.toMatch(/bestIdx\s*=/);
    // ...and the primitive fold lives only in the else arm.
    const elseArm = MAP_BODY.slice(MAP_BODY.indexOf('} else {', branch));
    expect(elseArm).toContain('for (var c = 0; c < 8; c = c + 1)');
  });

  it('threads the texture and five volume uniforms through EVERY mapBody call', () => {
    // Argument forwarding is load-bearing: a call site that forgets one
    // volume argument does not fail to compile — WGSL has no named args —
    // the generated node call simply mismatches. Every call, every source.
    const needed = ['volumeTex', 'volumePose0', 'volumePose1', 'volumeMin',
      'volumeInvExtent', 'volumeWarp'];
    for (const src of [...HELPERS, MARCH_BODY, CONE_MARCH]) {
      let at = src.indexOf('mapBody(');
      while (at >= 0) {
        const isDecl = at >= 2 && src.slice(at - 3, at).includes('fn');
        if (!isDecl) {
          const call = src.slice(at, at + 460);
          for (const n of needed) {
            expect(call, `${declaredName(src) ?? 'entry'} mapBody call missing ${n}`)
              .toContain(n);
          }
        }
        at = src.indexOf('mapBody(', at + 1);
      }
    }
  });

  it('calcNormal declares and forwards the volume params', () => {
    const calcNormal = HELPERS.find(h => declaredName(h) === 'calcNormal')!;
    expect(calcNormal).toContain('volumeTex: texture_3d<f32>');
    expect(calcNormal).toContain('volumePose0: vec4<f32>');
    expect((calcNormal.match(/mapBody\(/g) ?? []).length).toBe(4);
  });

  it('MARCH_BODY and CONE_MARCH declare the volume params', () => {
    for (const src of [MARCH_BODY, CONE_MARCH]) {
      expect(src).toContain('volumeTex: texture_3d<f32>');
      expect(src).toContain('volumePose0: vec4<f32>');
      expect(src).toContain('volumePose1: vec4<f32>');
      expect(src).toContain('volumeMin: vec3<f32>');
      expect(src).toContain('volumeInvExtent: vec3<f32>');
      expect(src).toContain('volumeWarp: vec4<f32>');
    }
  });

  it('hit epsilon rides the spare woundCfg2.w; primitive default stays bit-identical', () => {
    // Volume mode needs a hit epsilon of at least half the largest voxel
    // pitch (trilinear of an SDF is not exact); the primitive path keeps its
    // 1.2 mm literal because max(0.0012, 0) is 0.0012.
    expect(MARCH_BODY).toContain('let hitEps = max(0.0012, woundCfg2.w);');
    expect(MARCH_BODY).toContain('if (d < hitEps) { hit = true; break; }');
    expect(MARCH_BODY).not.toContain('if (d < 0.0012)');
  });
});

describe('data texture layout', () => {
  it('gives every row a distinct index inside DATA_ROWS', () => {
    const rows = [
      ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT,
      ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_WOUND, ROW_WOUND_META,
      ROW_REST_A, ROW_REST_B,
    ];
    expect(new Set(rows).size).toBe(rows.length);
    expect(Math.max(...rows)).toBe(DATA_ROWS - 1);
  });

  it('is wide enough for the wound ring, which shares the primitive rows', () => {
    // Wounds ride the same texture as the primitives, indexed along the same
    // axis, so the sheet has to be at least MAX_WOUNDS wide.
    expect(MAX_PRIMS).toBeGreaterThanOrEqual(MAX_WOUNDS);
  });

  it('bounds the wound loops at MAX_WOUNDS', () => {
    // The loop bound is a WGSL literal — a uniform cannot size a loop — so it
    // is the one constant that can drift from damage.ts silently.
    for (const src of HELPERS) {
      if (!/wound/i.test(declaredName(src) ?? '')) continue;
      expect(src).toContain(`i < ${MAX_WOUNDS}`);
    }
  });
});

describe('CPU field mirror is pinned', () => {
  // validate.ts's sdPrimitive/smin are mirrored line-for-line by the WGSL, and
  // that mirror backs click-to-shoot raycasting — drift means shots land where
  // the body isn't. Nothing can diff the two automatically, so this pins the
  // CPU half: if someone edits the maths, these numbers move and the WGSL beside
  // them gets read.
  const capsule: Primitive = {
    a: [0, 0, 0], b: [0, 0.4, 0], radius: 0.1,
    scale: [1, 1, 1], blendK: 0.02, limb: 'torso', cluster: 0,
  };
  const ball: Primitive = {
    a: [0, 0.5, 0], b: [0, 0.5, 0], radius: 0.15,
    scale: [1, 1.2, 1], blendK: 0.02, limb: 'head', cluster: 0,
  };
  const body = {
    prims: [capsule, ball],
    clusters: [{
      id: 0, limb: 'torso' as const, start: 0, count: 2,
      center: [0, 0.25, 0] as const, radius: 0.8, alive: true,
    }],
  };

  // Every value below was worked out by hand against the capsule/ellipsoid
  // formulae and iq's smin, not recorded from a run — a pin copied from output
  // certifies whatever the code did on the day, including a bug.
  it.each([
    // Inside the capsule, well outside smin's blend zone: the plain min wins.
    [[0, 0.2, 0], -0.1],
    // Outside both, inside the blend: 0.2 - h*h*k*0.25 with h = 0.4938.
    [[0.3, 0.2, 0], 0.195127],
    // Just outside the capsule's 0.1 radius, and the ball is further still.
    [[0, 0.2, 0.15], 0.05],
    // Dead centre of the ball. The 1.2 y-scale divides in, so the ellipsoid
    // reads -0.15 and the capsule's endpoint reads exactly 0.
    [[0, 0.5, 0], -0.15],
    // Both surfaces near, so the blend deepens the min by 0.001467.
    [[0, 0.45, 0], -0.10980],
    // Clear of the body: the ellipsoid's scaled distance, not the capsule's.
    [[0, 1.2, 0], 0.433333],
  ] as [number[], number][])('sdBody(%j) stays at %f', (p, want) => {
    expect(sdBody(p as [number, number, number], {
      ...body,
      clusters: body.clusters.map(c => ({ ...c, center: [...c.center] as [number, number, number] })),
    })).toBeCloseTo(want, 3);
  });
});

describe('per-prim orientation (motion-polish task 3)', () => {
  it('sdPrimO reads the quat row and guards identity prims with a cheap branch', () => {
    // String pins: the parity test below proves the CPU mirror, these prove
    // the WGSL actually contains the branch being mirrored.
    expect(SD_PRIM_ORIENTED).toContain(`textureLoad(data, vec2<i32>(i, ${ROW_PRIM_QUAT}), 0)`);
    expect(SD_PRIM_ORIENTED).toContain('abs(1.0 - O.w) > 1e-6');
    expect(DATA_ROWS).toBe(10);
  });

  it('sdPrim stays the plain world-axis capsule, diffable against the frozen GLSL', () => {
    expect(SD_PRIM).not.toContain('QUAT');
    expect(SD_PRIM).not.toContain('cross(');
  });

  it('mapBody hoists the orient branch to the cluster flag (clusterRange.w)', () => {
    // Paying the quat textureLoad per prim measured +10-18% frame time; the
    // hoist makes everything but a turned head cluster take the plain path.
    expect(MAP_BODY).toContain('range.w > 0.5');
    expect(MAP_BODY).toContain('sdPrimO(p, idx, data)');
    expect(MAP_BODY).toContain('sdPrim(p, idx, data)');
  });

  /**
   * Line-for-line TS transcription of the WGSL sdPrimO, reading from a
   * Float32Array laid out exactly like the data texture (row-major,
   * MAX_PRIMS wide). Kept in sync BY HAND, like the march-tracer
   * transcriptions — the string pins above prove the branch exists; this
   * proves its semantics match validate.sdPrimitive, which backs
   * click-to-shoot.
   */
  function sdPrimWgsl(p: Vec3, i: number, tex: Float32Array): number {
    const load = (row: number): number[] => {
      const o = (row * MAX_PRIMS + i) * 4;
      return [tex[o]!, tex[o + 1]!, tex[o + 2]!, tex[o + 3]!];
    };
    const A = load(ROW_PRIM_A), B = load(ROW_PRIM_B), S = load(ROW_PRIM_SCALE);
    let qq: Vec3 = [p[0], p[1], p[2]];
    let a: Vec3 = [A[0]!, A[1]!, A[2]!];
    let b: Vec3 = [B[0]!, B[1]!, B[2]!];
    const O = load(ROW_PRIM_QUAT);
    if (Math.abs(1 - O[3]!) > 1e-6) {
      const mid = vscale(add(a, b), 0.5);
      const u: Vec3 = [-O[0]!, -O[1]!, -O[2]!];
      const w = O[3]!;
      const rot = (x: Vec3): Vec3 => {
        const v = sub(x, mid);
        const t = vscale(cross(u, v), 2);
        return add(mid, add(v, add(vscale(t, w), cross(u, t))));
      };
      qq = rot(qq); a = rot(a); b = rot(b);
    }
    const inv: Vec3 = [1 / S[0]!, 1 / S[1]!, 1 / S[2]!];
    qq = [qq[0] * inv[0], qq[1] * inv[1], qq[2] * inv[2]];
    a = [a[0] * inv[0], a[1] * inv[1], a[2] * inv[2]];
    b = [b[0] * inv[0], b[1] * inv[1], b[2] * inv[2]];
    const ab = sub(b, a), ap = sub(qq, a);
    const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = ab2 === 0 ? 0
      : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2));
    const minScale = Math.min(S[0]!, S[1]!, S[2]!);
    return (Math.hypot(qq[0] - (a[0] + ab[0] * t), qq[1] - (a[1] + ab[1] * t), qq[2] - (a[2] + ab[2] * t))
      - A[3]!) * minScale;
  }

  it('PARITY: CPU sdPrimitive matches the WGSL math on random oriented prims', () => {
    // Deterministic RNG — a parity test that flakes is worse than none.
    let seed = 0x5eed;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let trial = 0; trial < 40; trial++) {
      const centre: Vec3 = [rnd() * 2 - 1, 1 + rnd(), rnd() * 2 - 1];
      const span = rnd() * 0.15; // 0 = sphere (the face case), else capsule
      const axis = qFromAxisAngle([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5] as Vec3, rnd() * 2.4);
      const prim: Primitive = {
        a: [centre[0], centre[1] - span, centre[2]],
        b: [centre[0], centre[1] + span, centre[2]],
        radius: 0.03 + rnd() * 0.1,
        scale: [0.4 + rnd() * 1.4, 0.4 + rnd() * 1.4, 0.4 + rnd() * 1.4],
        blendK: 0.02, limb: 'head', cluster: 0,
        // Half the trials identity (absent), half a real rotation.
        orient: trial % 2 === 0 ? undefined : qNormalize(axis),
      };
      const packed = packBody({
        prims: [prim],
        clusters: [{ id: 0, limb: 'head', start: 0, count: 1, center: [0, 0, 0], radius: 10, alive: true }],
        bones: new Map(),
      });
      const tex = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
      tex.set(packed.primA, ROW_PRIM_A * MAX_PRIMS * 4);
      tex.set(packed.primB, ROW_PRIM_B * MAX_PRIMS * 4);
      tex.set(packed.primScale, ROW_PRIM_SCALE * MAX_PRIMS * 4);
      tex.set(packed.primQuat, ROW_PRIM_QUAT * MAX_PRIMS * 4);
      for (let s = 0; s < 25; s++) {
        const p: Vec3 = [
          centre[0] + (rnd() - 0.5) * 0.8,
          centre[1] + (rnd() - 0.5) * 0.8,
          centre[2] + (rnd() - 0.5) * 0.8,
        ];
        // f32 packing rounds the inputs, so tolerance is f32-scale, not f64.
        expect(sdPrimitive(p, prim)).toBeCloseTo(sdPrimWgsl(p, 0, tex), 4);
      }
    }
  });
});
