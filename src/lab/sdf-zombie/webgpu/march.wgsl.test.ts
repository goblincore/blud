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
import { TILE_MAX_ENTRIES } from './tile-cull';
import {
  HELPERS, MARCH_BODY, CONE_MARCH, DATA_ROWS, SD_PRIM, SD_PRIM_ORIENTED, MAP_BODY, FOLD_GROUP, ROW_PRIM_COLOR, ROW_GROUP_BOUNDS, ROW_GROUP_RANGE, ROW_CLUSTER_GROUPS,
  SAMPLE_VOLUME, APPLY_CARVES, APPLY_WOUNDS, CONE_CAP, SMIN_CHAMFER, SD_GROOVE, CONE_BEND, SD_BEZIER_T,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT, ROW_REST_A, ROW_REST_B,
  ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_WOUND, ROW_WOUND_META, ROW_PRIM_SHAPE,
  ROW_PRIM_BEND, ROW_PRIM_SHELL, ROW_PRIM_WARP, ROW_PRIM_STRAND, ROW_PRIM_CLIP, NOISE_LOCAL, WOUND_MASK, WOUND_SHADOW, SD_SHELL,
  ROW_WOUND_CAP, APPLY_BONES, FOLD_BONE_RANGE, ROW_WOUND_FLAGS, TISSUE_RAMP, SD_ROUND_BOX, LEVEL_SHADOW,
  CALC_NORMAL, INSTANCE_STATE, MARCH_BODY_PARAMS, MARCH_TRACE_SETUP, MARCH_TRACE_POST,
  FACE_MELT_SAG, FACE_MELT_STRETCH, FACE_MELT_FADE_LO, DEPTH_PREPASS_MARCH, DEPTH_PRE_FETCH, WOUND_STEP_MUL,
  HEAD_EXTERIOR_GORE_KEEP,
  QUAD_TILE_EMPTY_WGSL,
  soldierFaceDamageShadow,
} from './march.wgsl';
import { MAX_WOUNDS } from '../damage';
import { REC_VEC4S, REC_ANCHOR_BAND, REC_COUNTS } from './crowd-records';
import { MAX_CLUSTERS, BONE_SEG_MAX } from '../validate';
// Raw source import: the row-table docstrings are TS comments, invisible to
// every exported WGSL string, and the Done-when "docstring no longer lies"
// check needs the file's actual text.
import moduleSource from './march.wgsl?raw';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (see the comment below).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { sdBody, sdPrimitive, MAX_PRIMS } from '../validate';
import { packBody } from '../pack';
import { add, cross, scale as vscale, sub, qFromAxisAngle, qNormalize } from '../vec';
import type { Primitive, Vec3 } from '../types';

// Every WGSL source in the file. Anything new MUST be added here: the
// reserved-word and parse-contract checks are the only thing standing between
// a one-word slip and a blank page whose only symptom is a CreateShaderModule
// error buried under a dozen cascading ones.
const ALL = [...HELPERS, MARCH_BODY, CONE_MARCH, DEPTH_PREPASS_MARCH];

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

  it('parses every runtime helper with the real wgslFn parser', () => {
    // declaredName only checks the ^-anchor. three's own regexp also needs a
    // resolvable RETURN TYPE after the parameter list: a source that starts
    // with `fn` but has no `-> type` can still fail, and the failure is a
    // silent "Function is not a WGSL code" whose downstream symptom is a
    // blank march target. INSTANCE_STATE originally had no return type and
    // only parsed because the loose regexp backtracked into a LATER helper in
    // the same string; deleting tileHasSlot removed that crutch and blanked
    // the page, which is why loadInstance now declares `-> void` and this
    // test parses HELPERS exactly as buildEntryFn does.
    for (const [i, src] of HELPERS.entries()) {
      expect(() => new WGSLNodeFunction(src), `HELPERS[${i}]`).not.toThrow();
    }
    for (const [n, src] of [
      ['MARCH_BODY', MARCH_BODY], ['CONE_MARCH', CONE_MARCH], ['DEPTH_PREPASS_MARCH', DEPTH_PREPASS_MARCH],
    ] as const) {
      expect(() => new WGSLNodeFunction(src), n).not.toThrow();
    }
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

  // wmRim is the WIDE wound mask (full to 1.3x, gone by 2x): the fade must
  // cover the everted lip AND the whole cavity wall, not just the coloured
  // 1.25x core. Two regressions pin the shape: the lip clipped to a white
  // band the day the colouring mask was pulled in to 1.25x, and a 0..1.6x
  // ramp from the CENTRE left ~40% fresnel at the cavity wall, which clipped
  // to flat white slabs sweeping with the camera (both 2026-08-23).
  it('fades fresnel out inside wounds instead of wet-boosting it (X1.17)', () => {
    // Fresnel is environment rim-light; inside a cavity the "environment" is
    // the wound itself. Left at full strength it hits its ceiling on the
    // grazing-heavy rim geometry, gets the 1.6x wound-wetness boost on top,
    // and clips whole patches to white that sweep with the camera.
    expect(MARCH_BODY).toMatch(/let fres = [^;]*\* \(1\.0 - wmRim\);/);
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
    // The ramp is FULL amp wide (a 0.35-amp ramp had ~4x a distance field's
    // gradient and drew as bands — rim banding, 2026-08-22), and it reaches
    // -0.3..0.7: mostly OUTWARD, the proud everted lip of the owner-preferred
    // 2026-08-22 build. The 2026-08-23 flip to -0.65..0.35 kept the width but
    // pushed the ring's material INSIDE the cavity, where it drew as a pale
    // shelf/ball sitting in the hole (owner bisect, 2026-08-24). The floating
    // rims on thin features that motivated the flip are handled by the
    // per-wound rimScale (flesh-behind-the-hit) instead.
    expect(applyWounds).toMatch(/smoothstep\(-amp \* 0\.3, amp \* 0\.7, dIn\)/);
  });

  it('caps the carve with a depth slab that vanishes when no cap is uploaded', () => {
    // The pale-wound fix (2026-08-27): the sphere stays ON the anchor (the
    // lab's deep-bowl look, whose cavity reads red) and a plane through the
    // anchor clips its REACH — depth without the far-side punch-through.
    const applyWounds = HELPERS.find(h => declaredName(h) === 'applyWounds')!;
    // The carve region is {inside sphere} ∩ {shallower than the cap}; its
    // inside-positive SDF is min(depth - r, capEff - dot). The hull-holes
    // regression (2026-08-27, same day) shipped `max(-(r - depth), dot -
    // capEff)`: the dot term is positive BEYOND the cap, so the max() carved
    // the entire half-space behind the cap plane — mixed-direction wounds
    // hollowed whole bodies (the owner's invisible-zombie report). Do not
    // revert to that form.
    expect(applyWounds).toContain(`textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CAP} + band), 0)`);
    expect(applyWounds).toContain('min(-(r - depth), capEff - dot(p - w.xyz, wCap.xyz))');
    // Uncapped wounds (w <= 0) must take a capEff no real distance can
    // cross, so the slab term loses the min EXACTLY and the field is
    // bit-identical to the pre-slab sphere — that is what keeps the lab
    // (which uploads no caps) pixel-stable across this change.
    expect(applyWounds).toContain('select(1.0e5, wCap.w, wCap.w > 0.0)');
  });

  it('skips a wound before loading its meta/cap rows when the sample is out of reach (perf round 2 task 3)', () => {
    const iPos = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND} + band)`);
    const iReach = APPLY_WOUNDS.indexOf('if (perfCfg.y > 0.5 && r > reach) { continue; }');
    const iMeta = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND_META} + band)`);
    const iCap = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND_CAP} + band)`);
    expect(iPos).toBeGreaterThan(-1);
    expect(iReach).toBeGreaterThan(iPos);
    expect(iMeta).toBeGreaterThan(iReach);
    expect(iCap).toBeGreaterThan(iReach);
    // Reach covers the crater (2 depth, the nearWound radius), the smax
    // fillet (exact min beyond 4k, plus 0.25 m for how deep inside a limb
    // the running field can be) and three rim widths past the rim offset.
    expect(APPLY_WOUNDS).toContain(
      'let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25;');
  });

  it('tests the union-reach bound BEFORE the wound loop (close-up wound-cull task)', () => {
    // The whole economics argument: a sample outside every wound's reach
    // sphere must return (dIn, 0) — bit-identical to a loop whose every
    // iteration would `continue` past the reach early-out — WITHOUT paying a
    // single wound-row textureLoad. The bound is the CPU-computed bounding
    // sphere of the per-wound reach spheres (zombie-gpu.ts woundReachBound);
    // w = 1e9 is the no-cull identity (chunk torn ends, hands view).
    expect(APPLY_WOUNDS).toContain('woundBound: vec4<f32>');
    const iBound = APPLY_WOUNDS.indexOf('if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }');
    const iLoop = APPLY_WOUNDS.indexOf('for (var k = 0; k < 16; k = k + 1)');
    const iFirstLoad = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND} + band)`);
    expect(iBound).toBeGreaterThan(-1);
    expect(iLoop).toBeGreaterThan(iBound);
    expect(iFirstLoad).toBeGreaterThan(iLoop);
    // Threading: mapBody hands it to applyWounds, and every entry point
    // that can reach a wounded field declares and forwards it.
    expect(MAP_BODY).toContain('applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound, band)');
    // crowd stage a: woundBound moves to the instance record; every mapBody
    // caller forwards the record pointer instead of per-instance uniforms.
    expect(MAP_BODY).toContain('let woundBound = gInstWoundBound;');
    for (const src of [MAP_BODY, CALC_NORMAL, CONE_MARCH, WOUND_SHADOW, MARCH_BODY]) {
      expect(src).toContain('inst: ptr<storage, array<vec4<f32>>, read>');
    }
    expect(MARCH_BODY).toContain('woundShadow(p, L, abs(woundShadowCfg.y), data, woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg)');
    // inst and instCfg are bound POSITIONALLY LAST (the parser-count test
    // above pins the full order).
    const tail = MARCH_BODY.slice(MARCH_BODY.indexOf('levelShadowCfg: vec4<f32>'));
    expect(tail.indexOf('inst: ptr<storage, array<vec4<f32>>, read>')).toBeGreaterThan(tail.indexOf('levelShadowCfg: vec4<f32>'));
  });

  // Line-for-line TS transcription of the fixed carve term (the inside-positive
  // SDF of {inside sphere} ∩ {shallower than cap}), so the semantics of the
  // pinned string are proven, not just its spelling. The REGRESSION this
  // guards: any form that stays positive beyond the cap plane hollows the
  // whole body behind every wound — one wound looks perfect from the front,
  // mixed-direction wounds make the body invisible (exactly the 2026-08-27
  // hull-holes report; a string pin alone passed on the broken shader).
  function carveTerm(p: Vec3, anchor: Vec3, inward: Vec3, radius: number, cap: number): number {
    const r = Math.hypot(p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]);
    const dotSlab = (p[0] - anchor[0]) * inward[0] + (p[1] - anchor[1]) * inward[1] + (p[2] - anchor[2]) * inward[2];
    const capEff = cap > 0 ? cap : 1.0e5;
    return Math.min(radius - r, capEff - dotSlab);
  }
  const ORIGIN: Vec3 = [0, 0, 0];
  const INWARD_X: Vec3 = [1, 0, 0];

  it('carve slab: bounded bowl, not a half-space (the invisible-zombie regression)', () => {
    const R = 0.16, CAP = 0.45 * 0.3; // a slug on ~30 cm of flesh
    // 1. Inside the sphere, shallower than the cap: carve (positive).
    expect(carveTerm([0.05, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeGreaterThan(0);
    // 2. Inside the sphere BUT deeper than the cap: FLESH REMAINS (negative).
    //    The broken max(..., dot - capEff) form returned a positive value
    //    here — and kept it positive clear across the body.
    expect(carveTerm([R - 0.01, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeLessThan(0);
    // 3. Deep inside the body, far past the sphere: still flesh. The broken
    //    form carved this entire half-space out to infinity.
    expect(carveTerm([0.9, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeLessThan(0);
    // 4. Outside the sphere on the air side (r > sphere): no carve.
    expect(carveTerm([-0.2, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeLessThan(0);
    // 5. The bowl's FLOOR is the slab, not the sphere's far wall: a point
    //    just inside the cap carves, just past it does not (both still
    //    inside the sphere).
    expect(carveTerm([CAP - 0.01, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeGreaterThan(0);
    expect(carveTerm([CAP + 0.02, 0, 0], ORIGIN, INWARD_X, R, CAP)).toBeLessThan(0);
  });

  it('carve slab: uncapped wounds reduce to the plain sphere bit-exactly', () => {
    // The lab uploads no caps; capEff must lose the min EXACTLY so the lab's
    // field is bit-identical to the pre-slab reference (pixel-parity gate).
    for (const p of [[0.05, 0, 0], [0.3, 0.1, -0.2], [-0.5, 2, 7]] as Vec3[]) {
      const r = Math.hypot(p[0], p[1], p[2]);
      expect(carveTerm(p as Vec3, ORIGIN, INWARD_X, 0.16, 0)).toBe(0.16 - r);
    }
  });

  it('shades chunks through the gore mask (gobs-and-goo §2)', () => {
    // lodCfg.w is goreStrength: 0 on the body, 1 on chunk views. The body's
    // clean-latex read must stay reachable, and the gore block's own fbm is
    // what makes a chunk read as mottled torn meat rather than a red ball.
    // Anchored to the noise shift (motion-polish) so the mottle rides the
    // chunk's own translation, not the world.
    expect(MARCH_BODY).toContain('goreStrength');
    expect(MARCH_BODY).toContain('fbm(anchor * 6.0)');
    // TASK 3: the gate is per-instance OR per-view, so a doomed body in a
    // crowd can ramp its own gore without repainting the shared-material type.
    // TASK 2 (2026-09-16 follow-ups): the mask is attenuated by face coverage,
    // and the pass now runs AFTER the face layer, so a detached head keeps its
    // painted face instead of being mottled into a meat blob.
    expect(MARCH_BODY).toContain('let goreStrength = max(lodCfg.w, gInstGore) * (1.0 - faceCover);');
    expect(MARCH_BODY).toContain('faceCover = faceCover * tex.a;');
    // The head's non-face exterior keeps a bounded share of the gore, so the
    // head is not a meat blob from the back either, while the neck cut still
    // tears. The constant is shared with the CPU bake.
    expect(MARCH_BODY).toContain(`faceRegion * ${HEAD_EXTERIOR_GORE_KEEP}`);
    expect(MARCH_BODY).toContain('let faceRegion = 1.0 - smoothstep(1.30 * reach, 1.70 * reach, length(hs));');
    expect(MARCH_BODY.indexOf('if (faceCfg.x > 0.5) {'))
      .toBeLessThan(MARCH_BODY.indexOf('let goreStrength = max(lodCfg.w, gInstGore) * (1.0 - faceCover);'));
    expect(INSTANCE_STATE).toContain('gInstGore = (*inst)[base + ');
  });

  it('skips dead prims (w=2) in the carve pass too, not just the fold', () => {
    // primScale.w: 0 add, 1 carve, 2 dead (severed mid-limb), 3 groove. The
    // additive fold skips anything above 0.5; a dead prim must ALSO stop
    // carving, or a severed hand keeps biting the field it left behind.
    //
    // The bound used to be a single `S.w > 1.5`, which was enough while dead
    // was the largest value. Adding groove at 3 put a LIVE op on the far side
    // of dead, so the pass now selects the two subtractive values explicitly
    // rather than taking everything past a threshold — 2 sits between them and
    // must fall through both.
    const applyCarves = HELPERS.find(h => declaredName(h) === 'applyCarves')!;
    expect(applyCarves).toContain('let isCarve = S.w > 0.5 && S.w < 1.5;');
    expect(applyCarves).toContain('let isGroove = S.w > 2.5 && S.w < 3.5;');
    expect(applyCarves).toContain('if (!isCarve && !isGroove) { continue; }');
  });

  it('grooves cut a channel rather than subtracting a solid', () => {
    const applyCarves = HELPERS.find(h => declaredName(h) === 'applyCarves')!;
    // ONE sd evaluation feeds both branches, the same invariant mapBody's fold
    // keeps — evaluating the field twice is how the two paths drift apart.
    expect(applyCarves).toContain('let sd = select(sdPrim(p, idx, data, r2, prof, cpos, band), sdPrimO(p, idx, data, r2, prof, cpos, band), ori);');
    expect(applyCarves).toContain('if (isGroove) { d = sdGroove(d, sd, gr.x, gr.y); } else { d = smax(d, -sd, k); }');
    // Depth and width ride primShape.zw, spare since the taper claimed xy.
    expect(applyCarves).toContain('gr = T.zw;');
    // The BAND GATE, which hg_sdf's original does not have. Without it the
    // whole interior lifts by the groove depth — see sdGroove in validate.ts.
    expect(SD_GROOVE).toContain('let inBand = rb - abs(b);');
    expect(SD_GROOVE).toContain('if (inBand <= 0.0) { return a; }');
    expect(SD_GROOVE).toContain('max(a, min(a + ra, inBand))');
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
    // Restored to the shellAmp-only form in the 2026-09-04 merge: the melt
    // spike that had widened this band to max(shellAmp, meltAmp) is gone,
    // superseded by the shipped zombie melt, which sags the body through the
    // rig rather than by displacing the marched field here.
    expect(MARCH_BODY).toMatch(/abs\(d\) < shellAmp \* 4\.0/);
    // The shell's fbm samples the dominant prim's REST frame (task 6) — the
    // displaced silhouette rides the same flesh as the normal-warped skin.
    expect(MARCH_BODY)
      .toMatch(/d = d \+ fbm\(restPoint\(camPos \+ rd \* t, data, i32\(dres\.y\), noiseLocal\(camPos \+ rd \* t, noiseShift\), gBand\) \* 3\.0\) \* shellAmp;/);
  });

  it('anchors every noise site in REST space, so texture rides every limb (task 6)', () => {
    // The field is packed in world space, but the fbm — silhouette, shell,
    // micro surface detail, gore mottle — must sample the DOMINANT prim's
    // REST frame or a limb slides through the world-frame noise field as it
    // moves (owner playtest: "you can see the arms move but the texture
    // doesn't"). mapBody tracks the argmin prim in its fold and every noise
    // site maps through restPoint; the task-3 root-shift anchor (noiseLocal)
    // survives ONLY as the fallback for bodies without rest rows.
    expect(MARCH_BODY).toContain('let noiseShift = vec3<f32>(gInstNoiseShift.x, gInstYaw, gInstNoiseShift.z);');
    // (hard-surface task 1: the noiseAmp argument now carries the gloss
    // kill, `* (1.0 - max(gloss, metal))` — a polished or machined prim's
    // normal is not rippled. Pinned in detail by the dedicated
    // gloss-suppression describe below. The amp is a vec4 and only .x
    // carries anything: y/z/w were the parked melt spike's lanes and are
    // literal zeros since the 2026-09-04 merge removed it. The gloss/metal
    // kill this pins is unchanged.)
    expect(MARCH_BODY).toContain('calcNormal(p, data, vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), 0.0, 0.0, 0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg)');
    expect(MARCH_BODY).toContain('let anchor = restPoint(p, data, hitBest, noiseLocal(p, noiseShift), gBand);');
    expect(MARCH_BODY).toContain('fbm(anchor * 22.0)');
    expect(MARCH_BODY).not.toContain('fbm(p * 22.0)');
    const mapBody = HELPERS.find(h => declaredName(h) === 'mapBody')!;
    // Argmin tripwire: ONE sd evaluation feeds both the fold and the tracker.
    // Same invariant, now carrying the taper radius AND the profile+bend
    // encoding: ONE sd evaluation still feeds both. `r2` is -1 for every
    // untapered prim (plain-capsule branch inside coneCap); `cpos` is zero
    // unless prof > 1.5, which is the Bezier branch inside sdPrim.
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('var sd: f32;');
    expect(foldGroup).toContain('if (ori) { sd = sdPrimO(p, idx, data, r2, prof, cpos, band); }\n    else { sd = sdPrim(p, idx, data, r2, prof, cpos, band); }');
    expect(foldGroup).toContain('if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }');
    // Mask, not the old magnitude window — a chamfered BOX is prof 9 and falls
    // outside it. See the box-bit block below and pack.ts.
    expect(foldGroup).toContain('if ((i32(prof) & 7) == 1) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }');
    // i32(bestIdx), not bestIdx: this branch reads gFoldBestIdx (an f32) AFTER
    // the bone fold so a bone prim can win the argmin, so the cast is needed
    // here where main's version had already narrowed it.
    expect(mapBody).toContain('let anchor = restPoint(p, data, i32(bestIdx), noiseLocal(p, noiseShift), band);');
    expect(mapBody).toContain('fbm(anchor * 3.0) * noiseCfg.x');
    // The cone pre-pass marches the SMOOTH field (amplitude 0) and stays
    // independent of the motion plumbing — zero shift, dead noise term (the
    // whole vec4, so the melt experiment's term is dead in the cone too). The
    // volume block still rides along: the cone must see the same field the
    // march does (X1.26).
    const coneMarch = CONE_MARCH;
    expect(coneMarch).toContain(
      'mapBody(camPos + rd * t, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg).x');
  });

  it('tracks the dominant group distortion in a private global and divides the footprint epsilon by it', () => {
    // Perf round 2, task 6. The footprint AA epsilon (t * aaK) assumed the
    // field reports true Euclid distance; sdPrimitive under-reports it by the
    // group's distortion factor (up to 22x — schoolgirl sole plate), so the
    // epsilon could fire many times too early and stop a ray short. The fold
    // already carries the factor per group (grp.z); it rides a PRIVATE GLOBAL
    // beside the argmin because mapBody's .w return slot is owned by the
    // wound-pass-r2 chain — never repurpose that slot for this.
    expect(FOLD_GROUP).toContain('var<private> gFoldBestDistort: f32 = 1.0;');
    expect(FOLD_GROUP).toContain('if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }');
    expect(MAP_BODY).toContain('gFoldBestDistort = 1.0;');
    expect(MAP_BODY).not.toContain('nearWound, gFoldBestDistort');
    expect(MARCH_BODY).toContain('let distort = max(gFoldBestDistort, 1.0);');
    expect(MARCH_BODY).toContain('let hitEps = max(hitEpsBase, t * aaK / distort);');
  });

  it('mottles ALBEDO from the rest-space anchor, guarded by its amplitude', () => {
    // surfaceNoiseAmp perturbs the NORMAL, which reads as texture and never as
    // colour, so before this every body was one flat tone under the lab's
    // single broad key. The albedo twin has three properties worth pinning:
    //
    // 1. It samples `anchor`, not `p` — a world-space mottle looks right on a
    //    statue and swims across the surface the moment anything walks. Same
    //    rule the micro-detail and gore mottle already follow.
    expect(MARCH_BODY).toContain('fbm(anchor * surfCfg2.w)');
    expect(MARCH_BODY).not.toContain('fbm(p * surfCfg2.w)');
    // 2. smoothstep, not a linear remap of the nominal -1..1. Two octaves of
    //    value noise concentrate near zero, so `0.5 + 0.5*fbm` lands nearly
    //    every pixel at 0.5 — a uniform half-strength tint rather than
    //    mottling, which is exactly what the first version did on screen.
    expect(MARCH_BODY).toContain('smoothstep(-0.35, 0.35, fbm(anchor * surfCfg2.w))');
    // 3. Amplitude-guarded like every other quality lever here, so the stock
    //    presets (all mottleAmp 0) skip the fbm entirely and shade exactly as
    //    they did before this existed.
    expect(MARCH_BODY).toContain('if (surfCfg2.z > 0.0) {');
    // Before the FACE pass (mottle is the flesh's own colour, so the face
    // paints over it) and therefore before the gore pass, which task 2 moved
    // AFTER the face layer so it can be attenuated by the face's own coverage.
    const mottleIdx = MARCH_BODY.indexOf('mix(albedo, mottleColor');
    const faceIdx = MARCH_BODY.indexOf('if (faceCfg.x > 0.5) {');
    const goreIdx = MARCH_BODY.indexOf('let goreStrength = max(lodCfg.w, gInstGore)');
    expect(mottleIdx).toBeGreaterThanOrEqual(0);
    expect(mottleIdx).toBeLessThan(faceIdx);
    expect(faceIdx).toBeLessThan(goreIdx);
  });

  it('steps the shell conservatively and never retracts a displaced sample', () => {
    // The fbm breaks the Lipschitz bound, so inside the shell a relaxed step
    // could tunnel — 0.6 under-relaxation pays for the noise instead. And the
    // overshoot retraction assumes the un-displaced field (it rewinds by the
    // omega excess), so it must be suppressed whenever d carries the shell.
    // The wound zone has its OWN, stricter multiplier (WOUND_STEP_MUL, since
    // 2026-09-04) and the two are combined with min, so the shell's figure is
    // still the shell's — see march-step-soundness.test.ts for why they split.
    expect(MARCH_BODY).toContain('select(omega, 0.6, conservative)');
    expect(MARCH_BODY).toMatch(/let overshot = !conservative &&/);
  });

  it('retracts an unflagged deep crossing instead of hitting inside the solid (wound-halo r2)', () => {
    // A perpendicular approach onto near-flat skin makes radius + prevRadius
    // EQUAL stepLen exactly, so the strict < overshoot test cannot see the
    // crossing and the hit registers up to (omega-1)/omega of the last step
    // INSIDE the body. Behind the wound grid that landing zone sits in the
    // carve spheres' smax/smin blend, whose gradient contaminates the shading
    // normal — the torso's far side lit up as a red/pale band at wound height
    // (owner, 2026-08-24; instrumented: band hits at z -0.17 vs skin -0.266,
    // normals sideways/up, wm ~ 0 — the shading terms were amplifier, not
    // cause). Relaxed, non-shell, non-wound-zone samples that land deeper
    // than hitEps inside must retract onto the surface instead; only the
    // shell band keeps the old contract (its retraction assumes the smooth
    // field). The crossing sample usually sits inside the near-wound zone —
    // the landing is BEHIND the wound spheres — so nearWound is not a stop
    // signal; retracting to the wall is strictly more correct than shading a
    // point inside it.
    // The epsilon is now per-step (it can grow with the ray's pixel footprint
    // when AA is on), so the guard tests against the same expression the hit
    // does rather than a loop-invariant.
    expect(MARCH_BODY).toContain(
      'if (d < -max(hitEpsBase, t * aaK / distort) && omega > 1.0 && !conservative) {');
  });

  it('does NOT bound tMax by the occluder — the bound under-reports at range', () => {
    // 2026-09-01, the owner's "zombies are full of holes until you get fairly
    // close". The inner hull is sound GEOMETRY (every emitted sphere sits at
    // least its own radius inside the posed flesh — __sdfGame.hullInsideness
    // reports 0 of 300 outside), but the DISTANCE the pre-pass rasterises for
    // it is accurate only in the near field. Measured with one synthetic
    // sphere of known centre and radius, and the error tracks distance alone,
    // not the sphere's radius or its screen size:
    //
    //   true 2.4 -> 2.405 (exact)    true 4.9 -> 4.252
    //   true 7.9 -> 3.782            true 11.9 -> 0.367
    //
    // An under-reported occT puts tMax IN FRONT of the surface, so the ray
    // gives up before reaching skin and the fragment discards — per pixel,
    // wherever the hull covers, and worse the further away the body is. On a
    // single isolated zombie at 4.9 m that destroyed 1369 of 1375 lost
    // pixels, worst case 0.68 m short.
    //
    // Re-adding the term reintroduces the bug, so this test pins its absence
    // rather than its shape. Revive it only once the pre-pass writes a
    // distance that survives syntheticSphereCheck at range; the full
    // measurement is in march.wgsl.ts above tMax.
    // tMaxBox is the raw proxy-box far plane; the hull-exit fold (perfCfg.x)
    // never references occT, so an occluder bound cannot sneak back in here.
    expect(MARCH_BODY).toContain('let tMaxBox = length(worldPos - camPos);');
    expect(MARCH_BODY).not.toContain('occT + woundCfg2.z');
    // occT stays PLUMBED — debug mode 3 heats it, and reviving the bound
    // should not need the parameter threaded back through.
    expect(MARCH_BODY).toContain('occT: f32');
  });

  it('bounds the march by the outer hull, and is an identity when it is off', () => {
    // shellOut <= 0 means no hull covers the pixel, so no surface can be
    // there. The RETURN matters as much as the discard: WGSL discard demotes
    // the invocation but does not stop it, so without the return the pixel
    // still walks its whole budget before being thrown away.
    expect(MARCH_BODY).toContain('if (shellOut <= 0.0) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }');
    // The ray may start at the hull's near face; max() with startT so the cone
    // pre-pass is not thrown away when it reaches further. Close-up task 3
    // adds a THIRD lower bound — the quarter-res depth prepass — nested as
    // max(max(startT, shellIn), preStart): the max of lower bounds is the
    // tightest of them and still a lower bound. preStart collapses to 0 when
    // the pass is off, which is the identity inside the max.
    // tempStart (plan 2026-09-10) is the fifth max term; 0 is its identity
    // too. bodyEntry is the sixth: the proxy box contains the hull contains
    // the flesh, so the ray-box entry is a lower bound like the others — and
    // it catches the pixels whose temporal gate failed, which used to
    // restart from the shared shellIn and walk their own empty proxy space.
    expect(MARCH_BODY).toContain('var t = clamp(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), 0.0, tMax);');
    // The prepass inputs ride POSITIONALLY LAST (after windDrift), and the
    // disabled identity is the fetch's 0 — never a missing binding (the
    // meltCfg rule: a declared input without a binding shades as zero and
    // only logs).
    expect(MARCH_BODY.indexOf('depthPreTex: texture_2d<f32>')).toBeGreaterThan(-1);
    expect(MARCH_BODY.indexOf('depthPreCfg: vec4<f32>')).toBeGreaterThan(MARCH_BODY.indexOf('depthPreTex: texture_2d<f32>'));
    expect(MARCH_BODY.indexOf('inst: ptr<storage, array<vec4<f32>>, read>')).toBeGreaterThan(MARCH_BODY.indexOf('depthPreCfg: vec4<f32>'));
    expect(MARCH_BODY).toContain('let preStart = select(0.0, max(preT - (preT * depthPreCfg.y + 0.0012 + woundCfg2.z), 0.0), preT > 0.0);');
    // Both parameters exist, so a material built without a shell source still
    // type-checks and takes the 0 / 1e9 identities.
    expect(MARCH_BODY).toContain('shellIn: f32');
    expect(MARCH_BODY).toContain('shellOut: f32');
    // The hull exit bounds tMax ONLY on the un-relaxed path and only behind
    // perfCfg.x. The relaxed tracer takes a clamped final sample at tMax;
    // clamping to the hull put that sample on the hull and rendered a halo
    // (2026-08-31 visual gate), so above omega 1.0 the proxy-box far plane
    // stays the bound regardless of the seam.
    expect(MARCH_BODY).toContain('perfCfg: vec4<f32>');
    expect(MARCH_BODY.indexOf('shellOut: f32')).toBeLessThan(MARCH_BODY.indexOf('perfCfg: vec4<f32>'));
    expect(MARCH_BODY).toContain('let tMaxSel = select(tMaxBox, min(tMaxBox, shellOut), perfCfg.x > 0.5 && !relax);');
    expect(MARCH_BODY.indexOf('let relax = woundCfg2.y > 1.0;'))
      .toBeLessThan(MARCH_BODY.indexOf('let tMaxSel = select('));
  });

  it('quarter-res depth prepass — proof-shaped coarse march, inert when off', () => {
    // The coarse march's cone radius is the BLOCK footprint (blockK), not a
    // texel half-width — that is the whole correctness proof. Any full-res
    // ray in the block lies within blockK * t of the coarse ray, so the first
    // touch is a lower bound on every block ray's own first surface.
    expect(DEPTH_PREPASS_MARCH).toContain('let r = t * depthPreCfg.y;');
    // The step keeps the WHOLE cone outside the surface (d - r, cone rule).
    expect(DEPTH_PREPASS_MARCH).toContain('t = t + max(d - r, 0.0005) * stepMul;');
    // The touch test carries the same slack CONE_MARCH's does — the 1.2 mm
    // eps floor and the shell displacement amp — so a bump standing proud of
    // the smooth field can never sit nearer the camera than what the coarse
    // pass certified as empty.
    expect(DEPTH_PREPASS_MARCH).toContain('if (d < r + 0.0012 + woundCfg2.z) { return t; }');
    // A miss contributes NOTHING: -1, which the consumer reads as <= 0 → no
    // start. coneMarch's tMax convention would hand the full march a fake
    // "start at the proxy box's far side".
    expect(DEPTH_PREPASS_MARCH).toContain('return -1.0;');
    // The coarse walk marches the FULL cluster field (no tile binning) —
    // conservative relative to any tile-listed sub-field the full march
    // might run, because culling a prim from a min-fold can only raise it.
    expect(DEPTH_PREPASS_MARCH).toContain('let dres = mapBody(camPos + rd * t, data, vec4<f32>(0.0), woundCfg, woundCfg2,');
    // Same near-wound multiplier as the full march (WOUND_STEP_MUL via the
    // perfCfg.z override) — the coarse walk shares the field's unsoundness
    // near craters and must not step looser than the walk it feeds. The
    // exported string is INTERPOLATED, so pin the constant's value in it.
    expect(DEPTH_PREPASS_MARCH).toContain(`let woundMul = select(${WOUND_STEP_MUL}, perfCfg.z, perfCfg.z > 0.0);`);
    expect(DEPTH_PREPASS_MARCH).toContain('let stepMul = select(marchCfg.y, woundMul, nearWound);');
    // The fetch: disabled or non-positive → 0 (the identity in the max()).
    expect(DEPTH_PRE_FETCH).toContain('if (cfg.x < 0.5) { return 0.0; }');
    expect(DEPTH_PRE_FETCH).toContain('if (v <= 0.0) { return 0.0; }');
    // Grid from textureDimensions — never a captured value (the adaptive
    // controller resizes the layer under this fetch at runtime).
    expect(DEPTH_PRE_FETCH).toContain('textureDimensions(tex, 0)');
    // The fetch helper is wired into the HELPERS chain (buildMarchFn emits
    // the whole chain ahead of the MARCH_BODY entry, so membership is the
    // ordering guarantee).
    const names = HELPERS.map(declaredName);
    expect(names).toContain('depthPreFetch');
    expect(names.indexOf('depthPreFetch')).toBe(names.length - 1);
  });

  it('discards on the accumulated-depth gate before marching and bounds tMax by it', () => {
    expect(MARCH_BODY).toContain('prevT: f32');
    expect(MARCH_BODY.indexOf('perfCfg: vec4<f32>')).toBeLessThan(MARCH_BODY.indexOf('prevT: f32'));
    // The per-body conservative entry rides LAST (positional): centre from the
    // mesh's model matrix, half extents from the bodyHalf uniform. Task 5
    // added the crowd proxy-box overrides: instCfg.y 0 selects the record's
    // gInstCentre/gInstHalf bit-identically, y 1 selects the attributes.
    expect(MARCH_BODY).toContain('let boxCentre = select(gInstCentre, instCentre, instCfg.y > 0.5);');
    expect(MARCH_BODY).toContain('let boxHalf = select(gInstHalf, instHalf, instCfg.y > 0.5);');
    expect(MARCH_BODY).toContain('let bLo = (boxCentre - boxHalf - camPos) * invRd;');
    expect(MARCH_BODY.indexOf('prevT: f32')).toBeLessThan(MARCH_BODY.indexOf('inst: ptr<storage, array<vec4<f32>>, read>'));
    // max(shellIn, bodyEntry): BOTH are lower bounds on the first point at
    // which THIS body could be hit (shellIn the shared hull entry, weaker;
    // bodyEntry the per-body proxy-box entry) — the larger lower bound is
    // still a lower bound, so the discard stays exact while actually biting
    // wherever the fragment lies behind an already-accumulated hit. min()
    // was inert: min <= shellIn <= prevT almost everywhere (task 5 finding).
    expect(MARCH_BODY).toContain('if (max(shellIn, bodyEntry) > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }');
    // Stage a-2 renamed the raw ray-box entry to boxEntry so the quad mode can
    // select against gTileEntryT; the box algebra itself is unchanged.
    expect(MARCH_BODY).toContain('let boxEntry = max(max(min(bLo.x, bHi.x), min(bLo.y, bHi.y)), max(min(bLo.z, bHi.z), 0.0));');
    expect(MARCH_BODY).toContain('let tMax = min(tMaxSel, prevT);');
    // The 5 cm graze slack from 48f00de2 was REMOVED (adversarial review: a
    // behaviour change riding a debug commit, superseded by the graze
    // accept in 426118e8). The removal is pinned so it cannot creep back.
    expect(MARCH_BODY).not.toContain('+ select(0.0, 0.05, temporalCfg.x > 0.5)');
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

describe('wound soft shadow (iq rsmshadows, wound-zone gated)', () => {
  // A crater reads as a BALL from many angles because its concave dish casts
  // no shadow — the missing cue is occlusion from the crater's own wall
  // (owner decision "cast shadow vs darker floor", 2026-08-24). iq's
  // sphere-traced soft shadow, fired ONLY near wounds.
  it('declares WOUND_SHADOW after MAP_BODY, which it calls', () => {
    expect(HELPERS.indexOf(WOUND_SHADOW)).toBeGreaterThan(HELPERS.indexOf(MAP_BODY));
    expect(WOUND_SHADOW).toContain('fn woundShadow(');
    expect(WOUND_SHADOW).toContain('mapBody(p + L * t');
  });
  it('fires only in the wound zone, and skips outright at strength 0', () => {
    // The gate is mapBody's nearWound zone (z component), captured from the
    // ACCEPTED hit sample in the march loop — NOT a radial distance-to-centre
    // mask (that shape of fade was itself the sweeping halo; see the pin on
    // woundMask m.y). Cost then scales with crater screen area, not screensize.
    expect(MARCH_BODY).toContain('var hitNearWound = false;');
    expect(MARCH_BODY).toContain('hitNearWound = nearWound;');
    expect(MARCH_BODY).toContain(
      'if (woundShadowCfg.x > 0.0 && hitNearWound) {');
  });
  it('keeps the secondary-ray budget: 14 steps, clamped steps, tMax 0.4', () => {
    // Fill-bound renderer: 12-16 steps max, start t=0.02 (the field right at
    // the everted lip is not a clean distance bound), cap tMax ~0.4 m — this
    // is LOCAL crater self-shadowing, not global occlusion. Early-out once
    // fully shadowed.
    expect(WOUND_SHADOW).toContain('var t = 0.02;');
    expect(WOUND_SHADOW).toContain('for (var i = 0; i < 14; i = i + 1) {');
    // Triangulated coverage (iq's improved estimator, Claybook slide 39):
    // the closest point between the last two samples, not the sample itself.
    // Same budget — the estimator changes the per-sample maths, not the count.
    expect(WOUND_SHADOW).toContain('let y = h * h / (2.0 * ph);');
    expect(WOUND_SHADOW).toContain('res = min(res, k * dd / max(t - y, 1e-4));');
    expect(WOUND_SHADOW).toContain('if (res < 0.02 || t > 0.4) { break; }');
    expect(WOUND_SHADOW).toContain('t = t + clamp(h, 0.01, 0.06);');
    // Smooth field: no fbm in the shadow march (noiseAmp 0, like the cone).
    expect(WOUND_SHADOW).toContain('data, vec4<f32>(0.0), woundCfg, woundCfg2');
  });
  it('darkens ONLY the key diffuse + specular; fill/ambient/scatter stay lit', () => {
    // Multiply the whole lit sum and craters go pitch black — the fill and
    // the fake scatter are what keep the cavity readable from the dark side.
    // (keyI/keyC are the analytic-flashlight blend; with the beam off they
    // reduce to lightCfg.x/keyColor exactly — see the task-7 block below.)
    expect(MARCH_BODY).toContain(
      'albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao');
    expect(MARCH_BODY).toContain('shine * wShadow * lvl * mix(surfCfg.x, 1.5, gloss)');
    // The fill term must NOT carry the shadow...
    expect(MARCH_BODY).not.toContain('lightCfg.y * wShadow');
    // ...and strength mixes TOWARD 1 so the slider scales, never inverts.
    expect(MARCH_BODY).toContain(
      'woundShadow(p, L, abs(woundShadowCfg.y), data, woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg), woundShadowCfg.x');
  });
});

describe('level shadows on bodies (perf round 2 task 7)', () => {
  // Bodies CAST via the spanned shadow hull but never RECEIVE: a zombie
  // behind a pillar is lit by the flashlight. The flashlight's own map is
  // poisoned for this — the body's inflated hull is IN it, so every flesh
  // point would shadow itself. The map sampled here comes from a TWIN
  // spotlight (dungeon-lighting.ts) that renders layer 0 (the level) only.
  it('applies the level shadow map to the key term only, and only when enabled', () => {
    expect(LEVEL_SHADOW).toContain('fn levelShadow(p: vec3<f32>, n: vec3<f32>, shadowTex: texture_depth_2d, shadowMat: mat4x4<f32>, cfg: vec4<f32>) -> f32');
    expect(LEVEL_SHADOW).toContain('if (cfg.x < 0.5) { return 1.0; }');
    expect(MARCH_BODY).toContain('let lvl = levelShadow(p, n, levelShadowTex, levelShadowMatrix, levelShadowCfg);');
    expect(MARCH_BODY).toContain('diff * wShadow * lvl * keyI * keyC');
  });
  it('darkens the key specular with the same factor; the signature ends with the three new slots', () => {
    expect(MARCH_BODY).toContain('shine * wShadow * lvl * mix(surfCfg.x, 1.5, gloss)');
    // Positional-binding tripwire (see the ORDER MATTERS note in
    // createMarchMaterial): the new slots sit at the very END, after
    // bodyHalf, in the exact order the JS object binds them.
    const tail = MARCH_BODY.slice(MARCH_BODY.indexOf('levelShadowTex: texture_depth_2d'));
    expect(tail.indexOf('levelShadowTex: texture_depth_2d')).toBeGreaterThan(-1);
    expect(tail.indexOf('levelShadowMatrix: mat4x4<f32>')).toBeGreaterThan(tail.indexOf('levelShadowTex: texture_depth_2d'));
    expect(tail.indexOf('levelShadowCfg: vec4<f32>')).toBeGreaterThan(tail.indexOf('levelShadowMatrix: mat4x4<f32>'));
  });
  it('is parse-checked as a helper and normal-biases the lookup position', () => {
    expect(HELPERS).toContain(LEVEL_SHADOW);
    // The bias step keeps the body's own surface off the shadow plane (acne);
    // it is cfg.y so the owner can raise it live.
    expect(LEVEL_SHADOW).toContain('shadowMat * vec4<f32>(p + n * cfg.y, 1.0)');
  });
  it('the real wgslFn parser sees the three slots as the last inputs — no comment phantoms', () => {
    // WGSLNodeFunction sweeps the WHOLE parameter list — comments included —
    // with /name\s*:\s*type/ to find inputs. Any `word: word` colon pattern
    // inside a signature comment becomes a PHANTOM input: the call site then
    // binds float(0) into that slot and every real binding after it shifts
    // by one (seen 2026-09-02 — a comment's "cfg gates it: at" inserted one
    // between bodyHalf and levelShadowTex and the pipeline died with
    // "cannot convert abstract-float to texture_depth_2d"). This test runs
    // the actual parser, not a string grep, so no comment can reintroduce it.
    const parsed = new WGSLNodeFunction(MARCH_BODY);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    // 66 on the perf round-2 chain; +8 from the wound-pass-r2 merge (counts2,
    // surfCfg3, fatColor, boneColor and the viscera/gut slots); +1 from the
    // melt task-6 meltCfg slot. BOTH sides of the 2026-09-04 merge added a
    // uniform named meltCfg independently — the zombie melt's progress slot
    // (kept) and the parked melt spike's amp/freq/time slot (removed) — so
    // this count is +1, not +2. That collision is exactly what this pin is
    // for. Re-pin when a slot is added ON PURPOSE — a silent change here is
    // the phantom-input bug. +1 windDrift, +1 bodyAnchor (shell warp), +1 woundBound
    // (wound-cull), +2 depth prepass (depthPreTex, depthPreCfg) - all appended after
    // the level-shadow tail, in that order. +1 opt-in faceGlowRedOnly mask.
    // +5 static probe grid (probeTex, probeMin, probeInvExtent, probeDims,
    // probeCfg) appended after normalGradientCfg — lighting P3 step 1.
    // +4 flashlight bounce spot (bounceSpotPos, bounceSpotNormal,
    // bounceSpotRadiance, bounceSpotCfg) after probeCfg — lighting P4 step 1.
    // +2 GPU probe gather dynamic layer (probeDyn storage, probeDynCfg).
    // +1 direct muzzle flash (bodyFlash).
    // +3 temporal reprojection start (lastTex, lastInvVp, temporalCfg) — plan 2026-09-10.
    // +1 meatCfg (soldier wound MEAT DETAIL, wound panel MEAT group, 2026-09-12), after surfCfg3.
    // crowd stage a: 13 per-instance params move into the record, +inst +instCfg.
    // crowd stage a task 5: +instCentre +instHalf (the instanced proxy box).
    expect(names.length).toBe(91);
    expect(names).toContain('faceGlowRedOnly');
    expect(names.slice(-21)).toEqual([
      'depthPreTex', 'depthPreCfg', 'normalGradientCfg',
      'probeTex', 'probeMin', 'probeInvExtent', 'probeDims', 'probeCfg',
      'bounceSpotPos', 'bounceSpotNormal', 'bounceSpotRadiance', 'bounceSpotCfg',
      'probeDyn', 'probeDynCfg',
      'lastTex', 'lastInvVp', 'temporalCfg', 'inst', 'instCfg', 'instCentre', 'instHalf',
    ]);
    // The temporal start folds in AFTER preStart, with bodyEntry as the
    // sixth lower-bound term (see the other pin above for the argument).
    expect(MARCH_BODY).toContain('var t = clamp(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), 0.0, tMax);');
    expect(MARCH_BODY).toContain('temporalStartFetch(lastTex, tempNdc, lastInvVp, camPos, rd, temporalCfg)');
    // Own-body gate + inside check: the reprojected point must sit in THIS
    // body's box and the start must be outside the field AND outside a
    // wound's near zone (mapBody.z — the field is not a bound beside a
    // crater; a start there banded the wounded closeup at a 0.05 m margin).
    // The shellAmp backoff keeps the start outside the DISPLACED silhouette
    // too, and the recovery probes rewind (2x penetration when inside,
    // 0.15 fixed when in-zone) instead of dropping the bound.
    expect(MARCH_BODY).toContain('temp.y >= bodyEntry - temporalCfg.y && temp.y <= tMax + temporalCfg.y');
    expect(MARCH_BODY).toContain('var s = temp.x - woundCfg2.z;');
    expect(MARCH_BODY).toContain('if (dres0.x > 0.0 && dres0.z < 0.5) { break; }');
    expect(MARCH_BODY).toContain('let back = select(s + 2.0 * dres0.x, s - 0.15, dres0.z >= 0.5);');
    expect(MARCH_BODY).toContain('if (dres0.x > 0.0 && dres0.z < 0.5) {');
    // HULL-RELATIVE CAP: the accepted start tightens at most 6 cm past the
    // current frame's hull face — stale history cannot move the start deeper
    // than that, which is what bounds the swing-tip see-through holes.
    expect(MARCH_BODY).toContain('s = min(s, shellIn + 0.06);');
    expect(MARCH_BODY).toContain('tempStart = s;');
    // crowd stage a: the record pointer and its config are the two new
    // positional tails, in signature order (the JS binding object matches).
    // crowd stage a task 5: instCentre/instHalf follow them (the proxy box).
    expect(names.indexOf('instCfg')).toBe(names.length - 3);
    expect(names.indexOf('inst')).toBe(names.length - 4);
    expect(names.indexOf('instCentre')).toBe(names.length - 2);
    expect(names.indexOf('instHalf')).toBe(names.length - 1);
  });
});

describe('melt wet-red ramp (zombie melt task 6)', () => {
  // c52b05b declared meltCfg and never READ it: green tests, zero pixels.
  // These assert the uniform is declared, bound and CONSUMED in the flesh
  // shading branch — and that the consumption is gated flesh-vs-bone, since
  // pale matte bone against wet red flesh is the whole look.
  it('reads melt state from the per-instance record', () => {
    // crowd stage a: meltCfg left the signature and rides the record.
    expect(MARCH_BODY).not.toContain('meltCfg: vec4<f32>,');
    expect(MARCH_BODY).toContain('gInstMelt');
  });
  it('READS meltCfg in the flesh shading branch — colour leads the sag', () => {
    // smoothstep(clamp(meltCfg.x * 2)) — the ramp completes by half progress,
    // so the body is clearly red while still standing, before it shortens.
    expect(MARCH_BODY).toContain(
      'let meltU = smoothstep(0.0, 1.0, clamp(gInstMelt.x * 2.0, 0.0, 1.0));');
    // Flesh reddens; bone goes PALE instead — the contrast is the effect.
    // `bonePaleU` is max(bareBoneU, meltU): a rupture's exposed skeleton goes
    // pale with NO melt ramp (see the body-to-gib rupture branch below).
    expect(MARCH_BODY).toContain('albedo = mix(albedo, boneColor, bonePaleU * 0.9)');
    // Flesh mixes toward the deep red — but through the PER-PATCH `local`,
    // not meltU directly. Skin sloughs in pieces (owner review 2026-09-03):
    // each point crosses at its own progress off the rest-space anchor, and
    // patches scaled past 1.0 by MELT_SKIN_KEEP never cross at all, so pink
    // survives on the finished puddle. Pinning the intent — reddening driven
    // by a patch threshold that reads meltU — rather than the exact spelling,
    // which is a tuning surface.
    expect(MARCH_BODY).toContain('albedo = mix(albedo, deepColor * 0.8, local * 0.8)');
    expect(MARCH_BODY).toContain('let thresh = skinPatch * ');
    expect(MARCH_BODY).toMatch(/let local = smoothstep\(thresh - [\d.]+, thresh \+ [\d.]+, meltU\)/);
    // `patch` is a RESERVED WORD in WGSL: naming it that compiles in TS and
    // fails the shader at runtime, rendering the body invisible. Guard it.
    expect(MARCH_BODY).not.toMatch(/\blet patch\b/);
    // Wetness ramps on flesh ONLY — bone stays matte. `bonePaleU` is
    // max(bareBoneU, meltU), so a rupturing body's exposed bones go matte too.
    expect(MARCH_BODY).toContain('wet = mix(wet, select(1.6, 0.45, isBone), bonePaleU)');
  });
  it('identifies an exposed bone row — the wound gate alone cannot see one', () => {
    // The melt's skeleton emerges with NO wound (bareBones bypass) and so does
    // a rupturing body's, so the primScale.w material read must also run when
    // meltCfg.x > 0 OR bareBones is set.
    expect(MARCH_BODY).toContain('if ((wm > 0.0 || gInstMelt.x > 0.0 || gInstCounts2.y > 0.5) && hitBest >= 0)');
    expect(MARCH_BODY).toContain('let isBone = hitMat > 3.5 && hitMat < 4.5;');
  });

  it('lets Soldier wounds override the pale Replace decal and stains torso wounds', () => {
    expect(MARCH_BODY).toContain('faceGlowRedOnly * smoothstep(0.02, 0.25, wm)');
    expect(MARCH_BODY).toContain('(1.0 - faceGlow) * woundDecalFade');
    expect(MARCH_BODY).toContain('let soldierWound = faceGlowRedOnly * smoothstep(0.02, 0.62, wm)');
    expect(MARCH_BODY).toContain('soldierWound * 0.72');
    expect(MARCH_BODY).toContain('let woundWetBoost = mix(1.6, 2.15, faceGlowRedOnly)');
    expect(MARCH_BODY).toContain('detailAmp * mix(1.0, 1.45, soldierPit)');
  });

  it('keeps only dark face detail over Soldier wounds',()=>{
    expect(soldierFaceDamageShadow(.1,.5,1,1)).toBeGreaterThan(.6);
    expect(soldierFaceDamageShadow(.5,.5,1,1)).toBe(0);
    expect(soldierFaceDamageShadow(.1,.5,1,0)).toBe(0);
    expect(soldierFaceDamageShadow(.1,.5,0,1)).toBe(0);
    expect(MARCH_BODY).toContain('albedo = albedo * (1.0 - faceShadow * damagedFace * 0.78)');
  });
});

describe('melt face drip (zombie melt task 8)', () => {
  // Same failure this whole plan guards against: a uniform that is declared
  // and never READ. Task 6 pinned the flesh branch; this pins the FACE block
  // — a whole-file check would pass with meltCfg read only in the torso.
  const FACE = MARCH_BODY.slice(
    MARCH_BODY.indexOf('if (faceCfg.x > 0.5) {'),
    MARCH_BODY.indexOf('// PER-PRIMITIVE COLOUR'),
  );
  it('found the face block inside MARCH_BODY', () => {
    expect(FACE.length).toBeGreaterThan(500);
  });
  it('READS meltCfg in the face block — the face drips off the skull', () => {
    expect(FACE).toContain('let meltSag = gInstMelt.x;');
    // Sag + paired stretch on the V coordinate: the offset alone slides a
    // rigid face like a sticker; the stretch is the elongation.
    expect(FACE).toContain(
      `uv.y = uv0.y + meltSag * ${FACE_MELT_SAG} - (uv0.y - faceProj.w) * meltSag * ${FACE_MELT_STRETCH};`);
  });
  it('widens the facing fade as the head flattens', () => {
    expect(FACE).toContain(
      `var facing = smoothstep(mix(0.28, ${FACE_MELT_FADE_LO}, gInstMelt.x), 0.66, dot(n, hfr));`);
  });
});

describe('baked hand volume branch (X1.26 task B2)', () => {
  it('exports SAMPLE_VOLUME starting with fn, per the wgslFn parse contract', () => {
    // X1.27: the template now declares TWO helpers — the slab-local frame
    // sampler first (wgslFn parses the leading fn), then the mixing sampler.
    expect(declaredName(SAMPLE_VOLUME)).toBe('sampleHandVolumeFrame');
    expect(SAMPLE_VOLUME).toContain('fn sampleHandVolume(');
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
    // Nested mix: 4 edges, 2 faces, 1 slab = exactly seven per frame helper,
    // plus the ONE frame mix in sampleHandVolume.
    expect((SAMPLE_VOLUME.match(/mix\(/g) ?? []).length).toBe(8);
    // Degenerate top corner: floor == dims-1 clamps i1 back onto i0.
    expect(SAMPLE_VOLUME).toContain('min(i0 + vec3<i32>(1, 1, 1), dimsI - vec3<i32>(1, 1, 1))');
    // textureDimensions is vec3<u32> — WGSL has no u32−i32 overload, and a
    // mixed subtraction fails pipeline compilation at runtime (the canvas
    // freeze task C diagnosed live). Every narrowing is explicit.
    expect(SAMPLE_VOLUME).toContain('vec3<i32>(textureDimensions(volumeTex, 0))');
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
    expect(SAMPLE_VOLUME)
      .toContain('return mix(d0, d1, clamp(volumeClip.z, 0.0, 1.0)) + outside;');
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
    expect(elseArm).toContain('for (var gi = 0; gi < 64; gi = gi + 1)');
  });

  it('threads the texture and six volume uniforms through EVERY mapBody call', () => {
    // Argument forwarding is load-bearing: a call site that forgets one
    // volume argument does not fail to compile — WGSL has no named args —
    // the generated node call simply mismatches. Every call, every source.
    const needed = ['volumeTex', 'volumeMin',
      'volumeInvExtent', 'volumeWarp', 'volumeClip', 'segVolumeAtlas', 'segVolumeMeta'];
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
    expect(calcNormal).toContain('volumeMin: vec3<f32>');
    expect((calcNormal.match(/mapBody\(/g) ?? []).length).toBe(4);
  });

  it('MARCH_BODY and CONE_MARCH declare the volume params', () => {
    for (const src of [MARCH_BODY, CONE_MARCH]) {
      expect(src).toContain('volumeTex: texture_3d<f32>');
      expect(src).toContain('volumeMin: vec3<f32>');
      expect(src).toContain('volumeInvExtent: vec3<f32>');
      expect(src).toContain('volumeWarp: vec4<f32>');
    }
  });

  it('hit epsilon rides the spare woundCfg2.w; primitive default stays bit-identical', () => {
    // Volume mode needs a hit epsilon of at least half the largest voxel
    // pitch (trilinear of an SDF is not exact); the primitive path keeps its
    // 1.2 mm literal because max(0.0012, 0) is 0.0012.
    expect(MARCH_BODY).toContain('let hitEpsBase = max(0.0012, woundCfg2.w);');
    // AA epsilon rides ON TOP of that floor and must collapse to it exactly at
    // the shipping default (aaCfg.y = 0 => aaK = 0 => max(base, 0) = base), so
    // the primitive path stays bit-identical until someone moves the slider.
    expect(MARCH_BODY).toContain('let aaK = aaCfg.x * aaCfg.y;');
    // Perf round 2 task 6: the footprint term divides by the dominant group's
    // distortion factor. At aaCfg.y = 0 the whole term is still exactly 0
    // (t * 0 / distort = 0), so the primitive path stays bit-identical.
    expect(MARCH_BODY).toContain('let hitEps = max(hitEpsBase, t * aaK / distort);');
    // wound-halo r2 split the accept into the deep-crossing retract guard and
    // the literal hit test; the epsilon literal still gates both.
    expect(MARCH_BODY).toContain('hit = true;\n          break;');
    expect(MARCH_BODY).toContain('if (d < -max(hitEpsBase, t * aaK / distort) && omega > 1.0');
    expect(MARCH_BODY).not.toContain('if (d < 0.0012)');
  });
});

describe('tile-list fold path (raymarcher-perf task 5)', () => {
  it('preloads the tile list ONCE per pixel at the march entry, under an enable guard', () => {
    const pre = MARCH_BODY.indexOf('gTileActive = select(0.0, 1.0, tileCfg.x > 0.5);');
    expect(pre).toBeGreaterThan(-1);
    // The preload must precede the march loop and its mapBody call.
    expect(pre).toBeLessThan(MARCH_BODY.indexOf('let dres = mapBody('));
    // One read loop, bounded by the same cap the CPU binner clamps to.
    expect(MARCH_BODY).toContain(`for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {`);
    // The per-pixel slot table (perf 7d) is built in SETUP, once, from that
    // same preloaded, slot-sorted entry list.
    expect(MARCH_TRACE_SETUP).toContain('gPixSlot[gPixN] = s;');
    expect(MARCH_TRACE_SETUP).toContain('gPixEnd[gPixN - 1] = e + 1;');
    expect(MARCH_BODY).toContain('if (e >= i32(n)) { break; }');
  });

  it('reads tile lists from STORAGE BUFFERS with the grid carried in tileCfg', () => {
    // The compute port's whole point: no resource-dimension inference (the
    // defect that broke every scale except the one allocated at), no texture
    // bindings for the lists.
    expect(MARCH_BODY).toContain('tileHdr: ptr<storage, array<vec2<u32>>, read>');
    expect(MARCH_BODY).toContain('tileEnt: ptr<storage, array<vec4<f32>>, read>');
    expect(MARCH_BODY).not.toContain('tileHead: texture_2d<f32>');
    expect(MARCH_BODY).not.toContain('textureDimensions(tileHead');
    // Grid dims come from tileCfg (y tilesX, w tilesY), clamped in-shader.
    expect(MARCH_BODY).toContain('let gx = max(1, i32(tileCfg.y));');
    expect(MARCH_BODY).toContain('let gy = max(1, i32(tileCfg.w));');
    // Entry addressing is LINEAR over vec4 records, three per entry.
    expect(MARCH_BODY).toContain('let lin = (head.x + u32(e)) * 3u;');
  });

  it('mapBody walks the per-pixel slot table: tile range vs cluster walk, both through foldGroup', () => {
    expect(MAP_BODY).toContain('let tiled = gTileActive > 0.5;');
    // crowd stage a, task 7c: a shared-record single-field material offsets the
    // slot index by its base record slot.
    expect(MAP_BODY).toContain('let base = i32(instCfg.z);');
    expect(MAP_BODY).toContain('loadInstance(inst, base + s);');
    expect(MAP_BODY).toContain('bestSlot = base + s;');
    expect(MAP_BODY).toContain('let nIter = select(nInst, gPixN, tiled);');
    expect(MAP_BODY).toContain('let s = select(k, gPixSlot[k], tiled);');
    // The range walk folds exactly this slot's contiguous entry run; the
    // per-step slot scan is gone.
    expect(MAP_BODY).toContain('for (var e = gPixFirst[k]; e < gPixEnd[k]; e = e + 1) {');
    expect(MAP_BODY).not.toContain('tileHasSlot');
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, band, gTileBounds[e], gTileGrp[e]);');
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, band, bounds, range);');
  });

  it('keeps the per-step sphere cull WITH the distortion factor inside foldGroup', () => {
    const foldGroup = HELPERS.find(h => /^fn foldGroup\(/.test(h))!;
    expect(foldGroup).toContain(
      'if (length(p - bounds.xyz) - bounds.w > (d + counts.w * 4.0) * grp.z) { return d; }');
  });

  it('band-offsets every prim-row load so one shared texture serves all bodies', () => {
    const foldGroup = HELPERS.find(h => /^fn foldGroup\(/.test(h))!;
    expect(foldGroup).toContain(`vec2<i32>(idx, ${ROW_PRIM_SCALE} + band)`);
    expect(foldGroup).toContain(`vec2<i32>(idx, ${ROW_PRIM_B} + band)`);
  });
});

describe('data texture layout', () => {
  it('gives every row a distinct index inside DATA_ROWS', () => {
    const rows = [
      ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT,
      ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_WOUND, ROW_WOUND_META,
      ROW_REST_A, ROW_REST_B, ROW_PRIM_SHAPE, ROW_PRIM_BEND, ROW_PRIM_COLOR,
      ROW_GROUP_BOUNDS, ROW_GROUP_RANGE, ROW_CLUSTER_GROUPS,
      ROW_PRIM_SHELL, ROW_PRIM_CLIP, ROW_WOUND_CAP, ROW_WOUND_FLAGS,
      ROW_PRIM_WARP, ROW_PRIM_STRAND,
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
      const name = declaredName(src);
      if (!name || !/wound/i.test(name)) continue;
      // Only helpers that ITERATE the wound grid carry the bound. Others
      // with "wound" in the name but no wound-count loop (woundShadow's
      // 14-step penumbra march) are pinned by their own tests instead.
      if (!src.includes('i32(woundCfg.x)')) continue;
      // The loop variable name can change (the per-ray wound list folds by k);
      // pin only the BOUND, which is the MAX_WOUNDS literal that can drift
      // from damage.ts. Match `var x = 0; x < 16` for any identifier x.
      expect(src).toMatch(new RegExp(`var\\s+[a-z]\\w*\\s*=\\s*0\\s*;\\s*[a-z]\\w*\\s*<\\s*${MAX_WOUNDS}\\b`));
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

describe('tapered primitive and chamfer fold', () => {
  // String pins on the DECISIVE lines. The round cone's three-branch structure
  // is where a port goes wrong — swap a sign or a comparison and it still
  // compiles, still returns plausible distances, and quietly reports the wrong
  // surface. The semantics are proven on the CPU side in taper.test.ts; this
  // proves the shader is running the same construction, and this field backs
  // click-to-shoot, so a divergence lands shots where nothing is drawn.
  it('coneCap keeps the round cone\'s branch structure', () => {
    expect(CONE_CAP).toContain('if (sign(z) * a2 * z2 > k)');
    expect(CONE_CAP).toContain('if (sign(y) * a2 * y2 < k)');
    expect(CONE_CAP).toContain('let k = sign(rr) * rr * rr * x2;');
  });

  // The untapered branch is not an optimisation. With r1 == r2 the round cone
  // is mathematically identical but NOT bit-identical, and
  // characters/zombie-blob.test.ts pins the shipped zombie to 0.1 mm.
  it('coneCap takes the plain capsule path when r2 is negative', () => {
    expect(CONE_CAP).toContain('if (r2 < 0.0) {');
    expect(CONE_CAP).toContain('let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);');
  });

  // One NaN in a smooth-min fold takes the whole body with it, and a blob with
  // a zero `tip=` has a === b, which is exactly where the divisions blow up.
  it('coneCap guards coincident endpoints before dividing by their separation', () => {
    const guard = CONE_CAP.indexOf('if (l2 < 1e-12)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(CONE_CAP.indexOf('let il2 = 1.0 / l2;'));
  });

  it('sminChamfer shares smin\'s width convention and its k <= 0 degenerate', () => {
    // Same `kIn * 4.0`, so one authored `blend=` means a comparable reach in
    // either profile and swapping them is not also a size change.
    expect(SMIN_CHAMFER).toContain('let k = kIn * 4.0;');
    expect(SMIN_CHAMFER).toContain('if (k <= 0.0) { return min(a, b); }');
    expect(SMIN_CHAMFER).toContain('(a - k + b) * 0.70710678');
  });
});

describe('arc capsule — bent primitives', () => {
  // The Bezier path is gated on primShape.y >= 2 (profile + bend), so an
  // unbent cluster never pays for ROW_PRIM_BEND — the same hoist that keeps
  // an untapered body from paying for the shape row, which measured +10-18%
  // frame time when it was missing.
  it('loads ROW_PRIM_BEND only for prims whose profile encodes bend', () => {
    // The prim loop lives in foldGroup now (shared by the cluster walk and
    // the tile-list path); APPLY_CARVES keeps its own copy.
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(APPLY_CARVES).toContain(`cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND} + band), 0).xyz;`);
    expect(foldGroup).toContain(
      `cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND} + band), 0).xyz;`);
    for (const src of [foldGroup, APPLY_CARVES]) {
      // Bit 1 (value 2) of prof means bend, tested before the load so an
      // unbent — or straight-shell (prof 4) — prim never pays for the row.
      const gateAt = src.indexOf('if ((i32(prof) & 2) != 0) {');
      expect(gateAt).toBeGreaterThan(-1);
      expect(gateAt).toBeLessThan(src.indexOf('cpos = textureLoad'));
    }
  });

  // Chamfer must be an EXACT bit-0-only match (`& 7 == 1`), not a magnitude
  // window: a magnitude window ("prof > 0.5 && prof < 1.5") happened to also
  // exclude bend (bit 1, +2) and shell (bit 2, +4) only because neither ever
  // pushed prof outside (0.5, 1.5) on its own — true while prof topped out
  // at 6. A BOX adds bit 3 (+8), so a chamfered box packs as 9, which a
  // magnitude window puts OUTSIDE (0.5, 1.5) — silently folding it round.
  // `& 7 == 1` isolates the low three bits and asks for exactly chamfer,
  // which is immune to any bit above it, box included.
  it('isolates chamfer with a low-bit mask, not a magnitude window (immune to bit 3)', () => {
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('if ((i32(prof) & 7) == 1) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }');
  });

  // One NaN takes the entire body: the degenerate guard must sit before the
  // Bezier evaluation it protects, exactly as coneCap's l2 guard sits before
  // its division.
  it('coneBend guards collinear control points before evaluating the curve', () => {
    const guard = CONE_BEND.indexOf('if (dot(bb, bb) < 1e-12) { return coneCap(q, a, b, r1, r2, minScale); }');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(CONE_BEND.indexOf('sdBezierT('));
    // ...and the coincident-ends twin right beside it.
    expect(CONE_BEND).toContain('if (dot(b - a, b - a) < 1e-12) { return coneCap(q, a, b, r1, r2, minScale); }');
  });

  // iq's construction divides by dot of the quadratic coefficient; that is
  // where infinity comes from. The guard's position relative to the call is
  // pinned above; this pins that the helper really carries the division.
  it('sdBezierT is the Cardano/trigonometric cubic solve with the stability fix', () => {
    expect(SD_BEZIER_T).toContain('let kk = 1.0 / dot(bv, bv);');
    expect(SD_BEZIER_T).toContain('if (abs(pp) < 1e-4 && qq != 0.0) {');
    expect(SD_BEZIER_T).toContain('acos(clamp(qq / (pp * z * 2.0), -1.0, 1.0)) / 3.0');
  });

  it('sits in HELPERS between CONE_CAP and sdPrim, declared before use', () => {
    // WGSL requires declaration before use; an omitted helper passes every
    // unit test and fails at pipeline creation (the empty-SDF-layer trap).
    expect(HELPERS.indexOf(CONE_CAP)).toBeLessThan(HELPERS.indexOf(SD_BEZIER_T));
    expect(HELPERS.indexOf(SD_BEZIER_T)).toBeLessThan(HELPERS.indexOf(CONE_BEND));
    expect(HELPERS.indexOf(CONE_BEND)).toBeLessThan(HELPERS.indexOf(SD_PRIM));
    expect(SD_PRIM).toContain('coneBend(p * inv');
    expect(SD_PRIM_ORIENTED).toContain('coneBend(qq, a, b, c * inv');
  });
});

describe('shell fold — the thin clipped sheet (2026-08-25)', () => {
  it('sdShell is in HELPERS and implements abs(dBase)-thick with the rounded-rim clip', () => {
    expect(HELPERS).toContain(SD_SHELL);
    expect(SD_SHELL).toContain('let d = abs(base) - thick;');
    // The rim: distance to the sheet/plane intersection curve + rounding.
    expect(SD_SHELL).toContain('rim - length(vec2(d, dPlane))');
  });

  it('the fold reads the shell rows and wraps the field when profile marks a shell', () => {
    // The prim loop moved out of mapBody into foldGroup when tile binning
    // landed — the cluster walk and the tile-list path share it, so pinning
    // mapBody here would pass while the shell silently vanished from BOTH.
    const fold = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    // A shell is profile bit 2 (value 4); the fold must read both shell rows
    // and pass them to sdShell, and a straight shell (prof 4) must NOT take the
    // bend row (bit test, equivalent to prof > 1.5 on the 0-3 range). The gate
    // itself must be a bit test too — a BOX (bit 3, value 8) has bit 2 clear,
    // so "prof >= 4" would wrongly fold it as a shell (its shell/clip rows
    // are all zero); "& 4 != 0" reads only bit 2.
    expect(fold).toContain(`textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHELL} + band), 0)`);
    expect(fold).toContain(`textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_CLIP} + band), 0)`);
    expect(fold).toContain('if ((i32(prof) & 4) != 0) {');
    expect(fold).toContain(`textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_WARP} + band), 0)`);
    expect(fold).toContain('sd = sdShell(sd, p, S2.x, S2.y, S2.z, S2.w, C2.xyz, W2.x, W2.yzw, gWindDrift);');
    const profGate = fold.indexOf('if ((i32(prof) & 4) != 0) {');
    const bendGate = fold.indexOf('if ((i32(prof) & 2) != 0) {');
    // The shell wrap must come AFTER the base field is computed (sdPrim) and
    // the bend ctrl loaded; ordering is load-bearing for the fold.
    expect(profGate).toBeGreaterThan(fold.indexOf('var sd = sdPrim(p, idx, data, r2, prof, cpos, band);'));
    expect(bendGate).toBeGreaterThan(-1);
    expect(profGate).toBeGreaterThan(bendGate);
  });
});

describe('BOX bit (prof +8) does not break the shell/chamfer readers (task 5 follow-up)', () => {
  // pack.ts (task 5) gave a BOX primitive bit 3 (value 8) of prof. Two
  // readers in foldGroup used to test prof by MAGNITUDE rather than by bit
  // — correct only as long as bit 2 (shell, value 4) was the highest bit
  // anyone ever set, which stopped being true the moment a box could set
  // bit 3 on top. Both are pinned here as NEGATIVE literal checks (the old
  // magnitude form must be gone, not just "a mask form also exists") so a
  // future edit that reintroduces either magnitude test fails loudly.
  const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;

  it('shell gate is a bit test, not "prof >= 4.0" — a lone box (prof 8) is not a shell', () => {
    // 8 >= 4 is true, so the old magnitude test would have loaded
    // ROW_PRIM_SHELL/ROW_PRIM_CLIP for a box (both all-zero — see pack.ts)
    // and wrapped it as a zero-thickness shell instead of leaving it as the
    // plain body sdPrim already computed.
    expect(foldGroup).not.toContain('prof >= 4.0');
    expect(foldGroup).toContain('if ((i32(prof) & 4) != 0) {');
  });

  it('chamfer gate is a bit test, not "prof > 0.5 && prof < 1.5" — a chamfered box (prof 9) still chamfers', () => {
    // 9 falls outside (0.5, 1.5), so the old magnitude window would have
    // silently folded a chamfered box round — the author writes `chamfer`,
    // pack.ts packs bit 0, and the crease never appears.
    expect(foldGroup).not.toContain('prof > 0.5 && prof < 1.5');
    expect(foldGroup).toContain('if ((i32(prof) & 7) == 1) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }');
  });
});

describe('sdRoundBox in WGSL (task 6 — the GPU field)', () => {
  // String pins: these prove the branch EXISTS and is wired the way the CPU
  // field requires. The numeric PARITY test below proves its MATHS agree
  // with sdRoundBox/sdPrimitive's box branch in validate.ts — string
  // containment alone cannot catch a transposed operand or a missing
  // `* minScale`.
  it('sdRoundBox is defined, mirroring validate.ts\'s sdRoundBox exactly', () => {
    expect(declaredName(SD_ROUND_BOX)).toBe('sdRoundBox');
    expect(SD_ROUND_BOX).toContain('let q = abs(p) - e;');
    expect(SD_ROUND_BOX).toContain('length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r');
  });

  it('registers sdRoundBox in HELPERS before sdPrim and sdPrimO, which call it', () => {
    const names = HELPERS.map(declaredName);
    const boxIdx = names.indexOf('sdRoundBox');
    const primIdx = names.indexOf('sdPrim');
    const primOIdx = names.indexOf('sdPrimO');
    expect(boxIdx).toBeGreaterThan(-1);
    expect(boxIdx).toBeLessThan(primIdx);
    expect(boxIdx).toBeLessThan(primOIdx);
  });

  it('sdPrim and sdPrimO both branch on the box bit (& 8), and it appears before the bend bit (& 2)', () => {
    // Matched with the `if (` prefix, not on the bit test alone: the STRAND
    // branch above these reads the same bit inside a select() to decide
    // whether coneStrand may use the control point, and a bare substring
    // search finds THAT first and reports the gates as mis-ordered.
    for (const src of [SD_PRIM, SD_PRIM_ORIENTED]) {
      const boxGate = src.indexOf('if ((i32(prof) & 8) != 0)');
      const bendGate = src.indexOf('if ((i32(prof) & 2) != 0)');
      expect(boxGate).toBeGreaterThan(-1);
      expect(bendGate).toBeGreaterThan(-1);
      expect(boxGate).toBeLessThan(bendGate);
    }
  });

  it('the box branch calls sdRoundBox, reads round from ROW_PRIM_BEND.w, and applies minScale', () => {
    // A box never sets the bend bit (bend= is rejected on a box at compile
    // time — Task 2), so the caller's cpos/cpos-row fetch never runs for one;
    // the box branch must fetch ROW_PRIM_BEND itself, which is what makes
    // sharing that row's .w with a bent prim's .xyz safe.
    for (const src of [SD_PRIM, SD_PRIM_ORIENTED]) {
      expect(src).toContain('sdRoundBox(');
      expect(src).toContain(`textureLoad(data, vec2<i32>(i, ${ROW_PRIM_BEND} + band), 0).w`);
      const boxBranch = src.slice(
        src.indexOf('if ((i32(prof) & 8) != 0)'), src.indexOf('if ((i32(prof) & 2) != 0)'));
      expect(boxBranch).toContain('* minScale');
    }
  });

  /**
   * Line-for-line TS transcription of the box branch shared by sdPrim and
   * sdPrimO — identical once p/a/b are in the prim's rotated, scale-divided
   * frame, which the "PARITY: CPU sdPrimitive matches the WGSL math on
   * random oriented prims" test above already proves sdPrimO's rotation
   * prefix produces correctly. Mirrors sdPrimitive's `if (prim.box)` branch
   * in validate.ts and sdRoundBox itself. Kept in sync BY HAND, like every
   * other WGSL transcription in this file — this proves the WGSL MATHS agree
   * with the CPU field's; it does NOT compile or execute WGSL, so it cannot
   * catch a mistake shared identically by both transcriptions, and it says
   * nothing about GPU-side texture layout, precision, or driver behaviour.
   * `blob:render-check` is the real parity gate for those.
   */
  function sdBoxWgsl(p: Vec3, i: number, tex: Float32Array): number {
    const load = (row: number): number[] => {
      const o = (row * MAX_PRIMS + i) * 4;
      return [tex[o]!, tex[o + 1]!, tex[o + 2]!, tex[o + 3]!];
    };
    const A = load(ROW_PRIM_A), B = load(ROW_PRIM_B), S = load(ROW_PRIM_SCALE);
    const bendRow = load(ROW_PRIM_BEND);
    const inv: Vec3 = [1 / S[0]!, 1 / S[1]!, 1 / S[2]!];
    const qq: Vec3 = [p[0] * inv[0], p[1] * inv[1], p[2] * inv[2]];
    const a: Vec3 = [A[0]! * inv[0], A[1]! * inv[1], A[2]! * inv[2]];
    const b: Vec3 = [B[0]! * inv[0], B[1]! * inv[1], B[2]! * inv[2]];
    const ab = sub(b, a);
    const ap = sub(qq, a);
    const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = ab2 === 0 ? 0
      : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2));
    const closest: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const minScale = Math.min(S[0]!, S[1]!, S[2]!);
    const round = bendRow[3]!;
    const e = A[3]! * (1 - round);
    const r = A[3]! * round;
    const rp: Vec3 = [qq[0] - closest[0], qq[1] - closest[1], qq[2] - closest[2]];
    const qx = Math.abs(rp[0]) - e, qy = Math.abs(rp[1]) - e, qz = Math.abs(rp[2]) - e;
    return (Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
      + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r) * minScale;
  }

  it('PARITY: WGSL box branch matches sdPrimitive on random box prims, isotropic and anisotropic', () => {
    let seed = 0xb0f5;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let trial = 0; trial < 40; trial++) {
      const centre: Vec3 = [rnd() * 2 - 1, 1 + rnd(), rnd() * 2 - 1];
      const span = rnd() * 0.12;
      const round = rnd(); // 0 = sharp box, 1 = exactly the capsule
      const prim: Primitive = {
        a: [centre[0], centre[1] - span, centre[2]],
        b: [centre[0], centre[1] + span, centre[2]],
        radius: 0.03 + rnd() * 0.1,
        // Anisotropic every trial: * minScale is invisible to a point ON the
        // box surface (0 * anything === 0), so points below are NOT
        // constrained to the surface — this is what makes the test sensitive
        // to a missing or misplaced `* minScale`.
        scale: [0.4 + rnd() * 1.4, 0.4 + rnd() * 1.4, 0.4 + rnd() * 1.4],
        blendK: 0.02, limb: 'torso', cluster: 0,
        box: { round },
      } as unknown as Primitive;
      const packed = packBody({
        prims: [prim],
        clusters: [{ id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 10, alive: true }],
        bones: new Map(), bonePrims: [],
      });
      const tex = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
      tex.set(packed.primA, ROW_PRIM_A * MAX_PRIMS * 4);
      tex.set(packed.primB, ROW_PRIM_B * MAX_PRIMS * 4);
      tex.set(packed.primScale, ROW_PRIM_SCALE * MAX_PRIMS * 4);
      tex.set(packed.primBend, ROW_PRIM_BEND * MAX_PRIMS * 4);
      for (let s = 0; s < 25; s++) {
        const p: Vec3 = [
          centre[0] + (rnd() - 0.5) * 0.8,
          centre[1] + (rnd() - 0.5) * 0.8,
          centre[2] + (rnd() - 0.5) * 0.8,
        ];
        expect(sdPrimitive(p, prim)).toBeCloseTo(sdBoxWgsl(p, 0, tex), 4);
      }
    }
  });
});

describe('per-prim orientation (motion-polish task 3)', () => {
  it('sdPrimO reads the quat row and guards identity prims with a cheap branch', () => {
    // String pins: the parity test below proves the CPU mirror, these prove
    // the WGSL actually contains the branch being mirrored.
    expect(SD_PRIM_ORIENTED).toContain(`textureLoad(data, vec2<i32>(i, ${ROW_PRIM_QUAT} + band), 0)`);
    // Was 11; the arc capsule added ROW_PRIM_BEND, per-primitive colour added
    // ROW_PRIM_COLOR, bound groups added ROW_GROUP_BOUNDS/RANGE and
    // ROW_CLUSTER_GROUPS, and the shell fold added ROW_PRIM_SHELL/ROW_PRIM_CLIP
    // — each without displacing any existing row. The wound depth slab added
    // ROW_WOUND_CAP (2026-08-27, pale-wound fix). The entrails cavity flag
    // added ROW_WOUND_FLAGS (2026-09-02). The shell cloth spike added
    // ROW_PRIM_WARP and hairlock ROW_PRIM_STRAND (both 2026-09-05 — they
    // collided on index 20 across two branches; see ROW_PRIM_STRAND's doc).
    expect(DATA_ROWS).toBe(22);
    expect(SD_PRIM_ORIENTED).toContain('abs(1.0 - O.w) > 1e-6');
  });

  it('sdPrim stays the plain world-axis capsule, diffable against the frozen GLSL', () => {
    expect(SD_PRIM).not.toContain('QUAT');
    expect(SD_PRIM).not.toContain('cross(');
  });

  it('mapBody hoists BOTH per-prim branches to the cluster flag (clusterRange.w)', () => {
    // Paying the quat textureLoad per prim measured +10-18% frame time; the
    // hoist makes everything but a turned head cluster take the plain path.
    // ROW_PRIM_SHAPE arrived later and is hoisted the same way for the same
    // reason, so range.w is now a BITFIELD (1 oriented, 2 shaped) rather than
    // the bool it started as. A cluster with no tapered or chamfered prim
    // never reads the shape row at all.
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('let flags = i32(grp.w + 0.5);');
    expect(foldGroup).toContain('let ori = (flags & 1) != 0;');
    expect(foldGroup).toContain('let shaped = (flags & 2) != 0;');
    expect(foldGroup).toContain('if (shaped) {');
    // BOTH fold paths call foldGroup with the group texels, so neither can
    // drift from the other's sphere-cull or flag semantics.
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, band, gTileBounds[e], gTileGrp[e]);');
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, band, bounds, range);');
    // The carve pass reads the same bitfield, so a tapered carve is a taper in
    // BOTH fields. This one backs click-to-shoot; a divergence here lands
    // shots where nothing is drawn.
    expect(APPLY_CARVES).toContain('let flags = i32(range.w + 0.5);');
    expect(APPLY_CARVES).toContain('if (shaped) {');
    expect(APPLY_CARVES).toContain('r2 = T.x;');
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
        bones: new Map(), bonePrims: [],
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

describe('adjacent-slab clip sampling (X1.27 task C2)', () => {
  const frameFn = SAMPLE_VOLUME.slice(0, SAMPLE_VOLUME.indexOf('fn sampleHandVolume('));

  it('declares the slab-local frame helper with exactly eight textureLoads', () => {
    expect(declaredName(SAMPLE_VOLUME)).toBe('sampleHandVolumeFrame');
    const loads = frameFn.match(/textureLoad\(volumeTex/g) ?? [];
    expect(loads.length).toBe(8);
    // The frame helper is self-contained: no other texture traffic in it.
    expect(frameFn.match(/textureLoad\(/g)?.length).toBe(8);
    expect(frameFn.match(/textureDimensions/g)?.length).toBe(1);
  });

  it('offsets slab Z by frame * frameDepth and clamps Z to end at zOffset + frameDepth - 1', () => {
    expect(frameFn).toContain('let depth = max(1, i32(volumeClip.w));');
    expect(frameFn).toContain('let zBase = frame * depth;');
    expect(frameFn).toContain(
      'let i1 = min(i0 + vec3<i32>(1, 1, 1), dimsI - vec3<i32>(1, 1, 1));');
    expect(frameFn).toContain('let a0 = vec3<i32>(i0.x, i0.y, i0.z + zBase);');
    expect(frameFn).toContain('let a1 = vec3<i32>(i1.x, i1.y, i1.z + zBase);');
    // dimsI is the SLAB extent (atlas x/y, frameDepth z) — never the atlas
    // depth — so the clamp can never reach into the neighbouring slab.
    expect(frameFn).toContain('let dimsI = vec3<i32>(atlasDims.x, atlasDims.y, depth);');
    // Frames clamp to the atlas's frame count, so a stray index degrades to
    // the last slab rather than sampling off the texture.
    expect(frameFn).toContain('let frame = clamp(frameIndex, 0, atlasDims.z / depth - 1);');
  });

  it('forbids a 0-depth sentinel: depth is at least 1 in BOTH samplers', () => {
    expect(frameFn).toContain('max(1, i32(volumeClip.w))');
    expect(SAMPLE_VOLUME).toContain(
      'let depth = max(1, i32(volumeClip.w));');
    // And no division by volumeClip.w on any CODE line (comments excluded —
    // the depth guard divides by the derived depth, never the raw uniform).
    const codeLines = SAMPLE_VOLUME.split('\n').filter(l => !l.trim().startsWith('//'));
    expect(codeLines.join('\n')).not.toMatch(/\/\s*volumeClip\.w/);
  });

  it('samples frame0 and frame1 independently and mixes once, after the shared work', () => {
    const mixSampler = SAMPLE_VOLUME.slice(SAMPLE_VOLUME.indexOf('fn sampleHandVolume('));
    expect(mixSampler).toContain(
      'let d0 = sampleHandVolumeFrame(q, i32(volumeClip.x), volumeTex, volumeClip);');
    expect(mixSampler).toContain(
      'let d1 = sampleHandVolumeFrame(q, i32(volumeClip.y), volumeTex, volumeClip);');
    // Exactly two frame calls, exactly one distance mix.
    expect(mixSampler.match(/sampleHandVolumeFrame\(/g)?.length).toBe(2);
    expect(mixSampler.match(/mix\(d0, d1/g)?.length).toBe(1);
    expect(mixSampler).toContain('clamp(volumeClip.z, 0.0, 1.0)');
    // World-to-local, warp, uv and the outside-box distance are computed ONCE
    // (in the mixing sampler, before either frame is sampled).
    expect(mixSampler.indexOf('let outside')).toBeLessThan(
      mixSampler.indexOf('sampleHandVolumeFrame(q'));
    expect((mixSampler.match(/volumeWarp\.xyz/g) ?? []).length).toBe(1);
  });

  it('forwards volumeClip beside volumeWarp through every sampler call site', () => {
    expect(MAP_BODY).toContain(
      'sampleHandVolume(p, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip)');
    expect(MARCH_BODY).toContain('volumeClip: vec4<f32>');
    expect(CONE_MARCH).toContain('volumeClip: vec4<f32>');
    // WIND PARITY. The cone certifies emptiness for the march that follows,
    // so it must march the SAME surface. Unlike the noise (which the cone
    // passes as 0 by design, because it lives on the normal), wind moves the
    // field: a cone without this slot would certify space the drifted cloth
    // occupies and the march would start inside it.
    expect(CONE_MARCH).toContain('gWindDrift = gInstWind;');
    expect(MARCH_BODY).toContain('gWindDrift = gInstWind;');
    // BODY FRAME PARITY, for the same reason and with a sharper failure: a
    // cone anchored to the world while the march is anchored to a turning
    // body certifies emptiness against a surface that has rotated away.
    // Both must read the same uniform — NOT rebuild the triple from
    // faceCfg3/lodCfg, which only MARCH_BODY has.
    expect(CONE_MARCH).toContain('gBodyAnchor = gInstAnchor;');
    expect(MARCH_BODY).toContain('gBodyAnchor = gInstAnchor;');
    // sdShell must actually USE it, and noiseLocal must be declared first.
    expect(SD_SHELL).toContain('noiseLocal(p - drift, gBodyAnchor)');
    expect(HELPERS.indexOf(NOISE_LOCAL)).toBeLessThan(HELPERS.indexOf(SD_SHELL));
    const calcNormal = HELPERS.find(h => declaredName(h) === 'calcNormal')!;
    expect(calcNormal).toContain('volumeClip: vec4<f32>');
    // Every calcNormal mapBody tap (4 of them) carries it — and the perfCfg
    // and woundBound pass-throughs behind it (perf round 2 task 3, close-up
    // wound-cull task).
    expect((calcNormal.match(/volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg\)/g) ?? []).length).toBe(4);
  });
});

describe('per-primitive colour', () => {
  it('has a data row of its own, inside DATA_ROWS', () => {
    expect(ROW_PRIM_COLOR).toBeLessThan(DATA_ROWS);
  });

  it('reads the row at the HIT primitive and gates on the w sentinel', () => {
    expect(MARCH_BODY).toContain(`vec2<i32>(hitBest, ${ROW_PRIM_COLOR} + gBand)`);
    expect(MARCH_BODY).toContain('if (PC.w > 0.0)');
  });

  // The painted eyes live exactly where a pair of sunglasses goes; if the
  // glow survived paint it would shine through the lenses.
  it('zeroes the eye glow on a painted primitive', () => {
    expect(MARCH_BODY).toContain('faceGlow = faceGlow * (1.0 - painted)');
  });
});

describe('coneBend and the untapered sentinel', () => {
  // sdPrim hands every prim without r2= a -1; coneCap has always branched on
  // it, coneBend did not, and an untapered bent capsule rendered as one
  // sphere at its start end (the mouse's sunglass lens, 2026-08-22).
  it('treats r2 < 0 as "same radius at both ends", like coneCap', () => {
    expect(CONE_BEND).toContain('let rb = select(r2, r1, r2 < 0.0);');
    expect(CONE_BEND).not.toContain('(r1 + (r2 - r1) * t)');
    expect(CONE_BEND).toContain('(r1 + (rb - r1) * t)');
  });
});

describe('wound halo — ONE unified wound mask, no split shading overlays', () => {
  it('keeps the single 1.6x mask both channels agree on', () => {
    // Owner bisect verdict (2026-08-24): the halo was never the radial mask
    // itself — it was the MISMATCH between split mask edges. The 2026-08-23
    // crater pass split colouring (1.25x + facing gate), fresnel fade
    // (1.3x/2x, later carve-membership) and an AO darkening onto different
    // footprints, and every disagreement annulus drew as a grey ring or a
    // white crescent sweeping with the camera. The unified 1.6x mask's fade
    // edge coincides with its colour gradient, so it reads as wounded flesh,
    // not a ring. The far-side sheets those gates chased were the tracer
    // overshoot bug, fixed for real at the retract guard.
    expect(WOUND_MASK).toContain('1.0 - smoothstep(0.0, w.w * 1.6, length(p - w.xyz))');
    // Entrails (2026-09-02) retargeted the return pin from
    // vec2<f32>(m, m): the mask now carries cavity-ness in .z, accumulated
    // over the SAME per-wound footprint — the contribution expression above
    // is computed once and maxed into both channels. Still one footprint,
    // still no split overlays.
    expect(WOUND_MASK).toContain('return vec3<f32>(m, m, cav);');
    expect(WOUND_MASK).not.toContain('smoothstep(-0.25, 0.15, face)');
    expect(WOUND_MASK).not.toContain('collar');
  });

  it('keeps the lighting free of wound-keyed gates and darkenings', () => {
    expect(MARCH_BODY).not.toContain('keyGate');
    expect(MARCH_BODY).not.toContain('shineOcc');
    expect(MARCH_BODY).not.toContain('ao * (1.0 - 0.55 * smoothstep(0.35, 1.0, wm))');
    expect(MARCH_BODY).toContain('albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao');
  });

  it('routes ambient through ambientAt, and pays for it once', () => {
    // The seam from the lighting spec. One call, before the two sites that
    // consume it — recomputing per-site would double an already-unrolled
    // six-wall accumulation for no gain.
    expect(MARCH_BODY.match(/ambientAt\(/g) ?? []).toHaveLength(1);
    // The key path keeps keyColor; the ambient path must NOT be tinted by
    // the lamp any more. That tint is exactly what ambientAt now decides.
    expect(MARCH_BODY).not.toContain('(lightCfg.y + diff');
  });
});

describe('perf instrumentation heatmaps (raymarcher-perf task 2)', () => {
  // steps/pixel and prims/pixel counters behind a uniform-guarded debug
  // branch. The gate the plan names: debugCfg.x == 0 must cost nothing —
  // every counter write is guarded, and the guards are pinned here so a
  // future edit cannot unguard one silently.
  it('declares the private counters before mapBody, at SAMPLE_VOLUME tail', () => {
    // WGSL requires declaration before use; SAMPLE_VOLUME is the helper
    // immediately before MAP_BODY, and the private vars ride its tail
    // because a var-declaration source would break three's ^-anchored
    // "fn" parse contract as its own HELPERS entry.
    expect(HELPERS.indexOf(SAMPLE_VOLUME)).toBeLessThan(HELPERS.indexOf(MAP_BODY));
    expect(SAMPLE_VOLUME).toContain('var<private> gDebugMode: f32 = 0.0;');
    expect(SAMPLE_VOLUME).toContain('var<private> gDebugPrims: f32 = 0.0;');
    expect(SAMPLE_VOLUME).toContain('var<private> gDebugSteps: f32 = 0.0;');
  });

  it('guards every counter write — debugCfg.x == 0 pays a branch only', () => {
    // mapBody's fold: guarded on the private mode flag (mapBody takes no
    // debugCfg parameter by design — threading one would fork its signature).
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }');
    // The march entry: init + per-step count guarded on the uniform itself.
    expect(MARCH_BODY).toContain(
      'if (debugCfg.x > 0.5) { gDebugMode = debugCfg.x; gDebugPrims = 0.0; gDebugSteps = 0.0; gDebugBones = 0.0; gDebugVolumeSamples = 0.0; gDebugVolumeFallbacks = 0.0; }');
    expect(MARCH_BODY).toContain(
      'if (debugCfg.x > 0.5) { gDebugSteps = gDebugSteps + 1.0; }');
    // No UNGUARDED write anywhere: strip the guarded forms, and no
    // assignment to a counter may remain.
    const guarded = /(if \(gDebugMode > 0\.5\)|if \(debugCfg\.x > 0\.5\)) \{[^}]*gDebug(Prims|Steps|Mode)[^}]*\}/g;
    const foldScan = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    const stripped = MARCH_BODY.replace(guarded, '')
      + MAP_BODY.replace(guarded, '')
      + foldScan.replace(guarded, '');
    expect(stripped).not.toMatch(/gDebug(Prims|Steps|Mode)\s*=/);
  });

  it('snapshots the counters before the post-hit probes fold more prims', () => {
    // calcNormal adds four mapBody calls after the loop and the wound
    // shadow up to fourteen more; the heatmap is about RAY cost, so the
    // read must precede calcNormal.
    const capture = MARCH_BODY.indexOf('let debugPrims = gDebugPrims;');
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(MARCH_BODY.indexOf('if (!hit) { discard; }'));
    expect(capture).toBeLessThan(MARCH_BODY.indexOf('calcNormal('));
  });

  it('emits the ramp only inside the debug branch, after the gamma block', () => {
    // MODE 3 (occT heat, hull-holes diagnosis 2026-08-27) shares the branch
    // and returns before heatNorm; the pin still proves heatNorm lives in
    // that same branch, after the gamma block.
    const branch = MARCH_BODY.indexOf('if (debugCfg.x > 0.5) {\n    // MODE 3');
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(MARCH_BODY.indexOf('lodCfg.y > 0.5'));
    expect(MARCH_BODY.indexOf('let heatNorm', branch)).toBeGreaterThan(branch);
    // steps ramp: 0..marchCfg.x. prims ramp: 0..2000.
    expect(MARCH_BODY).toContain('select(debugSteps / max(marchCfg.x, 1.0), debugPrims / 2000.0, debugCfg.x > 1.5)');
  });
});

describe('analytic flashlight (dungeon relighting task 7)', () => {
  // The dungeon's SpotLight is invisible to the march — SDF bodies shade
  // inside this WGSL — so the beam is re-evaluated analytically per pixel.
  // These pins hold the seam the design rests on.
  const start = () => MARCH_BODY.indexOf('// ---- ANALYTIC FLASHLIGHT');
  const end = () => MARCH_BODY.indexOf('// ---- END ANALYTIC FLASHLIGHT');
  const block = () => MARCH_BODY.slice(start(), end());

  it('is present in the shading block', () => {
    expect(MARCH_BODY).toContain('spotCfg');
    expect(MARCH_BODY).toContain('spotPos');
    expect(MARCH_BODY).toContain('spotAxis');
  });

  it('adds ZERO mapBody evaluations — the constraint the whole design rests on', () => {
    // Extract the spotlight block and prove no field call hides in it.
    expect(start()).toBeGreaterThan(-1);
    expect(end()).toBeGreaterThan(start());
    expect(block()).not.toContain('mapBody');
    expect(block()).not.toContain('map(');
  });

  it('drives keyColor, not albedo — brightness cannot ride the bounce hue', () => {
    expect(start()).toBeGreaterThan(-1);
    expect(block()).toContain('keyColor');
  });

  it('collapses to the old key when the beam is off (spotCfg.x = 0)', () => {
    // Lab parity: with the dungeon off, L/keyC/keyI must reduce to exactly
    // lightDir/keyColor/lightCfg.x so the gallery renders bit-identically.
    expect(block()).toContain('var L = normalize(lightDir);');
    expect(block()).toContain('var keyC = keyColor;');
    expect(block()).toContain('var keyI = lightCfg.x;');
    expect(block()).toContain('if (spotCfg.x > 0.0) {');
  });

  it('feeds the blended key into the lit expressions, ambient hue untouched', () => {
    expect(start()).toBeGreaterThan(-1);
    // The two fleshLit sites ride the blended key...
    expect(MARCH_BODY).toContain('albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao');
    // ...while ambientAt keeps the ORIGINAL keyColor as its hue basis.
    expect(MARCH_BODY).toContain(
      'bounceCfg, lightCfg.y, keyColor);');
  });
});

describe('bone fold (wound pass r2)', () => {
  it('guards the bone counter too — debugCfg.x == 0 pays no counting', () => {
    // gore r3 refinement 3. The counter exists because the timing bench could
    // not resolve the bone fold at all (+0.0% under a 4% spread); it must not
    // become a cost of its own on the shipping path. It lives in the extracted
    // foldBoneRange helper, the one place the per-bone loop exists.
    expect(FOLD_BONE_RANGE).toContain('if (gDebugMode > 0.5) { gDebugBones');
  });

  it('reads the shape and bend rows, so authored curvature actually renders', () => {
    // These were hard-coded to -1.0 / 0.0 / vec3(0), so every bone drew as a
    // straight untapered capsule while the packer wrote its bend rows. Two
    // rounds of rib-curvature feedback were spent on geometry the GPU could
    // not draw. If this regresses, curved bones silently go straight again.
    // The row constants are template-interpolated, so the emitted WGSL holds
    // their NUMBERS — assert against the constants, not their names.
    expect(FOLD_BONE_RANGE).toContain(`vec2<i32>(i, ${ROW_PRIM_SHAPE}`);
    expect(FOLD_BONE_RANGE).toContain(`vec2<i32>(i, ${ROW_PRIM_BEND}`);
    expect(FOLD_BONE_RANGE).not.toContain('sdPrim(p, i, data, -1.0, 0.0');
  });

  it('bounds the groove test so W_BONE is not read as a groove', () => {
    expect(APPLY_CARVES).toContain('S.w > 2.5 && S.w < 3.5');
  });

  it('folds bone as a hard min, never a smooth min', () => {
    expect(FOLD_BONE_RANGE).toContain('min(');
    expect(FOLD_BONE_RANGE).not.toContain('smin(');
  });

  it('gates the bone loop on nearWound so undamaged bodies pay nothing', () => {
    expect(MAP_BODY).toMatch(/nearWound\s*>\s*0\.5/);
  });

  it('returns the pre-wound field in .w for the tissue-depth ramp', () => {
    // Both return sites — the noiseAmp early-out and the full path — must
    // carry `carved`, or the ramp reads 0 on whichever path is taken. bestIdx
    // rides the return as the bare f32 global: an f32(bestIdx) cast INSIDE
    // the vec4 would not even lex past the nested paren, and task 6 reads
    // .w per march step.
    expect(MAP_BODY).toContain('carvedU = carved;');
    expect(MAP_BODY).toMatch(/return vec4<f32>\(dUnion, bestIdxU, nearWoundU, carvedU\)/);
  });

  it('lets a bone prim win bestIdx so shading can identify it', () => {
    expect(FOLD_BONE_RANGE).toContain('gFoldBestIdx');
  });

  // DEVIATION GUARDS. The dispatched task text carried boneCount on
  // woundCfg2.w "the slot documented as spare" — but that channel is the
  // VOLUME HIT-EPSILON override, pinned by the hit-eps test above and
  // documented NOT spare in zombie-gpu.ts; and it is 0 in every
  // primitive-mode path, so the gate would never fire and bones would never
  // render. boneCount rides a NEW counts2 uniform (x = boneCount, yzw
  // spare) instead. These tests keep it there.
  it('carries boneCount on counts2.x, never on the taken woundCfg2.w', () => {
    expect(MAP_BODY).toContain('counts2.x > 0.0');
    // The nearWound gate, plus the melt's BARE-BONES bypass (counts2.y):
    // bone-only chunks and melting bodies fold the inside-flesh rows
    // without a wound. The bypass must never REPLACE the gate — an intact
    // body still skips the bone fold exactly.
    expect(MAP_BODY).toMatch(/\(nearWound > 0\.5 \|\| counts2\.y > 0\.5\) && counts2\.x > 0\.0/);
    expect(MAP_BODY).toContain('applyBones(dmg, p, data, counts, counts2.x, band, segVolumeAtlas, segVolumeMeta)');
    expect(MAP_BODY).toContain('let counts2 = gInstCounts2;');
    expect(MARCH_BODY).not.toMatch(/woundCfg2\.w[^;]*applyBones/);
  });

  it('bounds the bone loop by the packed range, not a material scan', () => {
    // Bones occupy the contiguous rows [counts.x, counts.x + boneCount) —
    // bounded, never filtered by primScale.w == 4: nothing to get wrong if a
    // flesh prim's w ever changes meaning.
    expect(APPLY_BONES).toContain('i32(counts.x)');
    expect(APPLY_BONES).toContain('i32(boneCount)');
    expect(APPLY_BONES).not.toContain('> 4.5');
  });
});

describe('bone cluster cull (packBoneClusters)', () => {
  // The sphere cull: one bound sphere per flesh cluster's bone rows, stored
  // in the free texels (columns MAX_CLUSTERS.. and 2*MAX_CLUSTERS) of
  // ROW_CLUSTER_BOUNDS/ROW_CLUSTER_RANGE. Data-driven — the tail texel's .w
  // is the enabled flag; zeros = the old flat loop.
  it('reads the cluster bone-range texels at column MAX_CLUSTERS + c', () => {
    expect(APPLY_BONES).toContain(`vec2<i32>(${MAX_CLUSTERS} + c, ${ROW_CLUSTER_RANGE}`);
    expect(APPLY_BONES).toContain(`vec2<i32>(${MAX_CLUSTERS} + c, ${ROW_CLUSTER_BOUNDS}`);
  });

  it('reads the tail texel at column 2 * MAX_CLUSTERS and folds it', () => {
    expect(APPLY_BONES).toContain(`vec2<i32>(${2 * MAX_CLUSTERS}, ${ROW_CLUSTER_RANGE}`);
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(tail.x), i32(tail.y), band)');
  });

  it('uses the exact hard-min cull test (no blendK smin margin)', () => {
    expect(APPLY_BONES).toContain('length(p - cb.xyz) - cb.w > d * cr.z');
  });

  it('keeps the flat fallback for the zero-texel gate', () => {
    expect(APPLY_BONES).toContain('tail.w > 0.5');
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, first, i32(boneCount), band)');
  });

  it('extracts the per-bone loop into ONE helper — no duplicated loop body', () => {
    expect(FOLD_BONE_RANGE).toContain('fn foldBoneRange');
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(cr.x), i32(cr.y), band)');
    // The shape read, counter and hard min must live only in the helper, so
    // the cluster path and the flat fallback cannot drift.
    expect(FOLD_BONE_RANGE).toContain('gDebugBones');
    expect(FOLD_BONE_RANGE).toContain('d = min(d, sd)');
    expect(FOLD_BONE_RANGE).toContain(`vec2<i32>(i, ${ROW_PRIM_SHAPE}`);
    expect(FOLD_BONE_RANGE).toContain(`if (i >= ${MAX_PRIMS}) { break; }`);
  });
});

describe('bone segment cull (boneCullMode: segment, mode 2)', () => {
  // The finer granularity: one sphere per RIGID SEGMENT (skull / axial
  // BoneFrame / limb bone / organs) in the free columns 2*MAX_CLUSTERS+1..
  // of the same two rows, gated by the header texel's mode in .w.
  it('branches on the header mode: 2 segment, 1 cluster, 0 flat', () => {
    expect(APPLY_BONES).toContain('tail.w > 1.5');
    expect(APPLY_BONES).toContain('} else if (tail.w > 0.5) {');
  });

  it('reads the segment texels at column 2*MAX_CLUSTERS+1 + s, bounded by BONE_SEG_MAX and the header count', () => {
    expect(APPLY_BONES).toContain(`for (var s = 0; s < ${BONE_SEG_MAX}; s = s + 1)`);
    expect(APPLY_BONES).toContain('if (s >= i32(tail.z)) { break; }');
    expect(APPLY_BONES).toContain(`vec2<i32>(${2 * MAX_CLUSTERS + 1} + s, ${ROW_CLUSTER_RANGE}`);
    expect(APPLY_BONES).toContain(`vec2<i32>(${2 * MAX_CLUSTERS + 1} + s, ${ROW_CLUSTER_BOUNDS}`);
  });

  it('uses the exact hard-min cull test against the WOUNDED running field', () => {
    expect(APPLY_BONES).toContain('length(p - sb.xyz) - sb.w > d * sr.z');
  });

  it('folds through foldBoneRange — never an inline copy — and still folds the tail', () => {
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(sr.x), i32(sr.y), band)');
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(tail.x), i32(tail.y), band)');
    // The mode-1 branch and the flat fallback stay verbatim.
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(cr.x), i32(cr.y), band)');
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, first, i32(boneCount), band)');
  });
});

describe('tissue ramp (wound pass r2)', () => {
  // The shading block lives inside marchBody — MARCH_BODY is the fragment
  // source the plan calls SHADE_BODY.
  it('composes INSIDE the radial mask so it cannot edge on healthy skin', () => {
    // The whole halo-safety argument: at wm = 0 the ramp must be unable to
    // change the albedo. That means exactly one mix against wm, with the ramp
    // supplying its second argument — never a separate mask of its own.
    expect(MARCH_BODY).toContain('mix(baseColor, tissue, wm)');
  });

  it('does not introduce a second wound mask', () => {
    const masks = MARCH_BODY.match(/woundMask\(/g) ?? [];
    expect(masks).toHaveLength(1);
  });

  it('is amplitude-guarded so 0 shades as before', () => {
    expect(MARCH_BODY).toMatch(/woundDepthAmp/);
    expect(MARCH_BODY).toMatch(/surfCfg3\.x > 0\.0/);
  });
});

describe('bone material (wound pass r2)', () => {
  // The shading block lives inside marchBody — MARCH_BODY is the fragment
  // source the plan calls SHADE_BODY.
  const SHADE_BODY = MARCH_BODY;

  it('has no torn-fibre pass at all', () => {
    // Cut on the owner's playtest verdict (2026-09-02): swept to the slider's
    // ceiling it was "not really noticeable". Asserted as ABSENCE rather than
    // removed as a test, so nobody quietly reintroduces a per-pixel fbm that
    // was already judged invisible — if it comes back it needs a new verdict.
    expect(SHADE_BODY).not.toContain('woundFibre');
  });

  it('no longer stains bone toward deepColor — the branch is GONE (bone tubes)', () => {
    // Bone tubes (2026-09-02 plan task 3): op 'bone' prims leave the marched
    // field for instanced analytic tubes, so the bone albedo branch was
    // deleted, not orphaned. Asserted as ABSENCE so it cannot quietly return.
    expect(SHADE_BODY).not.toContain('boneStain');
  });

  it('identifies bone by material code for the melt ramp AND a rupture', () => {
    // Bone tubes deleted the old always-on bone albedo branch, and it stays
    // deleted: bone is identified again, but its only consumers are the melt's
    // pale-vs-wet-red split (zombie melt task 6) and the body-to-gib rupture's
    // exposed skeleton. Both need the material read because the bone wins the
    // fold with no wound to key on.
    expect(SHADE_BODY).toContain('let isBone = hitMat > 3.5 && hitMat < 4.5;');
    expect(SHADE_BODY).toContain('if ((wm > 0.0 || gInstMelt.x > 0.0 || gInstCounts2.y > 0.5) && hitBest >= 0)');
    // Bone paleness is gated on bonePaleU = max(bareBoneU, meltU); the FLESH
    // reddening stays meltU-only, so a bare-bone rupture never stains skin and
    // never sags a face — the melt geometry is a separate ramp.
    expect(SHADE_BODY).toContain('let bonePaleU = max(bareBoneU, meltU);');
    expect(SHADE_BODY).toContain('if (isBone && bonePaleU > 0.0) {');
    expect(SHADE_BODY).toContain('} else if (meltU > 0.0) {');
    // The flesh branch must sit BELOW the bone branch, so nothing can redden
    // exposed bone.
    const pale = SHADE_BODY.indexOf('if (isBone && bonePaleU > 0.0) {');
    const flesh = SHADE_BODY.indexOf('} else if (meltU > 0.0) {');
    expect(pale).toBeGreaterThan(-1);
    expect(flesh).toBeGreaterThan(pale);
  });
});

describe('organ shading (organs r3)', () => {
  // The shading block lives inside marchBody — MARCH_BODY is the fragment
  // source the plan calls SHADE_BODY.
  const SHADE_BODY = MARCH_BODY;

  it('reads the organ code from the SAME hitMat load as bone', () => {
    // One HITMAT texel load serves both; a second load would undo refinement
    // 5. Pinned against the hitMat row itself (ROW_PRIM_SCALE), not against
    // "any hitBest read ending in .w": glow= legitimately reads ROW_PRIM_CLIP.w
    // at the same pixel (hard-surface task 3), which is a different row and a
    // different lane, not a duplicated hitMat.
    expect((SHADE_BODY.match(new RegExp(`textureLoad\\(data, vec2<i32>\\(hitBest, ${ROW_PRIM_SCALE} \\+ gBand\\), 0\\)\\.w`, 'g')) ?? []))
      .toHaveLength(1);
    expect(SHADE_BODY).toContain('isOrgan');
  });
  it('is amplitude-guarded by organAmp', () => {
    expect(SHADE_BODY).toContain('organAmp');
  });

  it('at organAmp 0 the organ branch is a bit-exact identity (task 6 gate 1)', () => {
    // organAmp must be the mix WEIGHT itself, not folded into a comparison —
    // WGSL mix(x, y, 0) returns x exactly, so amp 0 shades organ prims as
    // plain bone bit-for-bit and the off-state is one knob. A branch on
    // organAmp, or amp scaled into the colour instead of the weight, would
    // break that. The one-albedo-load rule above makes the identity exact:
    // same albedo, same lighting, only the weight differs.
    expect(SHADE_BODY).toMatch(/albedo\s*=\s*mix\(albedo,\s*organColor,\s*organAmp\)/);
  });
});

describe('viscera ramp (entrails)', () => {
  // The shading block lives inside marchBody — MARCH_BODY is the fragment
  // source the plan calls SHADE_BODY.
  const SHADE_BODY = MARCH_BODY;

  it('woundMask reports cavity-ness as a third channel', () => {
    expect(WOUND_MASK).toContain('vec3<f32>');
    expect(WOUND_MASK).toContain(`${ROW_WOUND_FLAGS}`);
  });

  it('the viscera stop is gated on cavity-ness, not on depth alone', () => {
    expect(TISSUE_RAMP).toContain('cavity');
  });

  it('is amplitude-guarded', () => {
    expect(SHADE_BODY).toContain('visceraAmp');
  });

  it('does not pay for the viscera fbm outside a cavity wound', () => {
    // Guarding the RESULT is not guarding the COST.
    expect(SHADE_BODY).toMatch(/surfCfg3\.w > 0\.0 && wmCav > 0\.0[\s\S]{0,120}fbm\(anchor/);
  });

  it('still composes inside the single radial mask', () => {
    // The 2026-08-23 halo came from splitting one mask into three. Viscera
    // must ride the SAME mask — one woundMask call, one mix against wm.
    expect(SHADE_BODY).toContain('mix(baseColor, tissue, wm)');
    expect((SHADE_BODY.match(/woundMask\(/g) ?? []).length).toBe(1);
  });
});

describe("gloss suppresses the flesh's own noise (hard-surface task 1)", () => {
  // Milled steel was getting bull-hide pores: surfaceNoiseAmp (surfCfg2.y)
  // perturbs the shading normal and silhouetteNoiseAmp (marchCfg.z) ripples
  // the field calcNormal samples — both body-wide, both applied before the
  // shader learns the hit prim is painted. The fix scales BOTH by
  // (1 - gloss) at the point of application. There is no GPU in CI, so the
  // assertions are structural: the factor must sit at BOTH application
  // sites, inside the existing amplitude guard, resolved off ONE hoisted
  // prim-colour read that happens before the normal exists. The numeric
  // claim — losing pitting improves a lens — is a prediction only the
  // render A/B can carry; this suite pins the mechanism, the frames pin
  // the look.
  const SHADE_BODY = MARCH_BODY;
  // The one ROW_PRIM_COLOR read (pack.ts writes w = 1 + gloss, w = 0 flesh).
  const LOAD = `textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_COLOR} + gBand), 0)`;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('resolves gloss BEFORE the shading normal exists, off ONE load', () => {
    // The read was hoisted up from the per-prim colour block; it must be a
    // hoist, not a repeat — a second load of the same texel on every hit
    // pixel is exactly the kind of cost this file's other gates exist to
    // stop (cf. the wm-gated hitMat read).
    expect((SHADE_BODY.match(new RegExp(esc(LOAD), 'g')) ?? []).length).toBe(1);
    expect(SHADE_BODY.indexOf('var gloss = 0.0;'))
      .toBeLessThan(SHADE_BODY.indexOf('calcNormal(p,'));
    expect(SHADE_BODY.indexOf(LOAD))
      .toBeLessThan(SHADE_BODY.indexOf('calcNormal(p,'));
  });

  it('scales the silhouette noise reaching calcNormal by (1 - max(gloss, metal))', () => {
    // calcNormal's noiseAmp is the ONLY path silhouetteNoiseAmp has into the
    // shading normal (the march loop runs the field smooth; the AO/scatter
    // probes are field probes, not surface detail, and keep full amp).
    // hard-surface task 2: `metal` implies the same suppression with no
    // gloss= — a machined surface has no pores either — so the factor is
    // the max of both levers (each is 0..1).
    // task-3 merge: calcNormal's amp is melt's vec4 (x silhouette, y/z/w
    // melt) — the kill applies to .x only, melt passes through untouched.
    expect(SHADE_BODY).toContain(
      'calcNormal(p, data, vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), 0.0, 0.0, 0.0), woundCfg');
  });

  it('scales the micro-detail perturbation by (1 - max(gloss, metal)), still inside its amplitude guard', () => {
    // The guard must wrap the NOISE CALL, not just its result (entrails
    // post-mortem, 2026-09-02): a polished prim skips the six lookups
    // outright, it does not compute them and multiply them away — so the
    // gloss kill folds into the guarded amplitude itself, not into the
    // fbm result.
    expect(SHADE_BODY).toContain('let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));');
    const detailBlock=SHADE_BODY.slice(SHADE_BODY.indexOf('if (detailAmp > 0.0)'),SHADE_BODY.indexOf('// Tissue depth'));
    expect(detailBlock).toContain('fbm(anchor * 22.0)');
    expect(detailBlock).toContain('detailAmp * mix(1.0, 1.45, soldierPit)');
  });

  it('still paints the prim albedo after the face pass; char still wins', () => {
    // Hoisting the READ must not hoist the OVERWRITE: a painted prim
    // replaces the flesh albedo (mottle and face sheet included) exactly
    // where it always did, and burnt is still burnt on top of it.
    const faceAt = SHADE_BODY.indexOf('if (faceCfg.x > 0.5) {');
    const paintAt = SHADE_BODY.indexOf('if (painted > 0.0) {');
    const charAt = SHADE_BODY.indexOf('albedo = mix(albedo, charColor, cm);');
    expect(faceAt).toBeGreaterThan(-1);
    expect(paintAt).toBeGreaterThan(faceAt);
    expect(charAt).toBeGreaterThan(paintAt);
  });
});

describe('metal modifier (hard-surface task 2)', () => {
  // A painted prim gets full diffuse + untinted white highlight — polished
  // plastic. `metal` (prof bit 4, packed by pack.ts) suppresses the diffuse
  // to a floor and tints the specular by the prim's own albedo. There is no
  // GPU in CI, so these are structural pins: where the bit is read, what it
  // scales, and what stays bit-identical at metal 0. The LOOK — whether the
  // plates read as steel — is the render's job, not this suite's.
  const SHADE_BODY = MARCH_BODY;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const SHAPE_LOAD = `textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_SHAPE} + gBand), 0)`;

  it('reads the metal bit inside the ONE hoisted painted read, above calcNormal', () => {
    // Same hoist discipline as gloss (task 1): the value is needed by the
    // noise-suppression sites BEFORE the shading normal exists, and the
    // extra texel load is paid only inside the painted branch — metal is
    // parse-gated on color=, so an unpainted pixel can never change the
    // answer. One load, not a repeat.
    expect(SHADE_BODY).toContain('var metal = 0.0;');
    expect((SHADE_BODY.match(new RegExp(esc(SHAPE_LOAD), 'g')) ?? []).length).toBe(1);
    expect(SHADE_BODY.indexOf('var metal = 0.0;'))
      .toBeLessThan(SHADE_BODY.indexOf('calcNormal(p,'));
    expect(SHADE_BODY.indexOf(SHAPE_LOAD))
      .toBeLessThan(SHADE_BODY.indexOf('calcNormal(p,'));
    expect(SHADE_BODY).toContain('if ((i32(PS.y) & 16) != 0)');
  });

  it('implies task 1 noise suppression with NO gloss set: both sites use max(gloss, metal)', () => {
    // Pinned in the gloss describe above with the same strings; this test
    // makes the METAL half of the max explicit, so dropping metal from
    // either application site fails HERE as well as there.
    expect(SHADE_BODY).toContain('marchCfg.z * (1.0 - max(gloss, metal))');
    expect(SHADE_BODY).toContain('let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));');
  });

  it('suppresses the whole diffuse family to a floor, not to zero', () => {
    // A pure-metal term in a shader with no environment map goes black
    // wherever the highlight is not, and the lab has one key. Rendered
    // curve (12-frame turntable, 2026-09-03): 0.25 went BLACK at the front
    // yaw; 0.35 kept slab forms but the front still read near-black; 0.45
    // keeps the greave's specular gradient AND a readable front face, so
    // 0.45 ships. Multiplying the whole `albedo * (amb + diff...)` family —
    // ambient bounce included — because bounce IS diffuse.
    expect(SHADE_BODY).toContain(
      'albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao * mix(1.0, 0.45, metal)');
  });

  it('tints the specular AND the fresnel rim by the prim albedo, at steel F0', () => {
    // The single change that makes metal read as metal: the highlight takes
    // the prim's colour instead of the light's, so steel differs from white
    // plastic under the same key. The tint is NOT the raw albedo — that
    // rendered the plates black (0.17 linear luminance killed the
    // highlight; frame-00 A/B) — it is the albedo hue with luminance
    // renormalised to polished steel's ~56% normal-incidence reflectance.
    // The tint multiplies BOTH the tight specular and the fresnel rim —
    // metals tint their grazing reflection too — and never the wound/gore
    // wet or scatter terms.
    expect(SHADE_BODY).toContain(
      'min(primAlbedo * (0.56 / metalTintLum), vec3<f32>(1.5))');
    expect(SHADE_BODY).toContain(
      'metalTint * keyC * (shine * wShadow * lvl * mix(surfCfg.x, 1.5, gloss) + fres * mix(1.0, 2.5, gloss)) * wet');
  });

  it('collapses to an EXACTLY white tint at metal 0 — flesh keeps its highlight', () => {
    // THE REGRESSION THIS EXISTS FOR (found 2026-09-04, on main, in the lab).
    // metalTint shipped UNGATED:
    //     let metalTint = min(primAlbedo * (0.56 / metalTintLum), vec3<f32>(1.5));
    // primAlbedo is vec3(0) on every UNPAINTED pixel — flesh never enters the
    // painted branch (PC.w > 0.0) that fills it — so metalTintLum clamped to
    // its 1e-3 floor, the tint evaluated to vec3(0), and it multiplied the
    // WHOLE specular + fresnel term to nothing. Every zombie lost its
    // highlight AND its rim at once, everywhere, lab and game.
    //
    // The tell: the specular slider did nothing. surfCfg.x sits INSIDE those
    // parentheses, so once the common factor is zero the knob cannot move the
    // pixel. Anything that kills shine and fres TOGETHER is a common factor,
    // not the shine term.
    //
    // The diffuse half of this same feature got its gate right —
    // `mix(1.0, 0.45, metal)`, pinned above — and this is the missing other
    // half. mix() to exactly 1.0 is an exact multiply, so at metal 0 flesh
    // shades bit-identically to the pre-metal shader; at metal 1 the steel
    // tint is untouched.
    expect(SHADE_BODY).toContain(
      'let metalTint = mix(vec3<f32>(1.0), min(primAlbedo * (0.56 / metalTintLum), vec3<f32>(1.5)), metal);');
  });
});

describe('per-prim glow= in primClip.w (hard-surface task 3)', () => {
  // No GPU in CI, so these are structural pins — where the value is read,
  // what it composes with, and what stays bit-identical at glow 0. Whether
  // the eyes READ as glowing is the render's job (task 3 step 4 does that
  // from frames, not from strings).
  const SHADE_BODY = MARCH_BODY;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const CLIP_LOAD = `textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_CLIP} + gBand), 0)`;

  it('row 17 no longer documents w as spare', () => {
    // Done-when: leaving "w spare" in the row table is how the next person
    // packs over the lane. Pinned against the MODULE SOURCE — the docstring
    // is a TS comment, not part of any exported WGSL string, so a check on
    // MARCH_BODY cannot see it (that vacuous version was caught by its own
    // mutation run). Scoped to ROW_PRIM_CLIP's OWN doc block: other rows'
    // "yzw spare" notes are true statements about other lanes and contain
    // the same substring.
    const clipConst = moduleSource.indexOf('export const ROW_PRIM_CLIP');
    const clipDoc = moduleSource.slice(moduleSource.lastIndexOf('/**', clipConst), clipConst);
    expect(clipDoc).not.toContain('spare');
    expect(clipDoc).toContain('glow');
  });

  it('reads glow from ROW_PRIM_CLIP.w, inside the painted branch only', () => {
    // glow= is parse-gated on color= (same gate as gloss/metal), so an
    // unpainted pixel can never author a glow — the read is paid only where
    // it can matter. And the field path reads this row as .xyz only
    // (sdShell), so the lane was genuinely spare until this.
    expect(SHADE_BODY).toContain(CLIP_LOAD);
    expect(SHADE_BODY).toContain('primGlow = clamp(');
    // ONE read: the load must not be repeated per consumer.
    expect((SHADE_BODY.match(new RegExp(esc(CLIP_LOAD), 'g')) ?? []).length).toBe(1);
    // ...and it happens INSIDE the painted branch (after `painted = 1.0;`,
    // before the branch closes).
    expect(SHADE_BODY.indexOf('painted = 1.0;'))
      .toBeLessThan(SHADE_BODY.indexOf(CLIP_LOAD));
  });

  it('the glow COLOUR is the prim albedo — the authored glow= is the strength', () => {
    // Design C: a prim with color=ff2200 glow=0.9 glows red because it IS
    // red. No new colour field, no global strength multiplier (the authored
    // value IS the strength), no flicker (that is the face sheet's
    // heartbeat).
    expect(SHADE_BODY).toContain('+ primAlbedo * primGlow * (1.0 - cm)');
  });

  it('composes at the SAME two composite lines the face glow uses, and fades the lit term', () => {
    // The face path replaces lit with fleshLit * (1 - faceGlow) + glow;
    // per-prim glow fades by its own amount, and at primGlow 0 the factor is
    // exactly 1.0 — bit-identical (multiplication by 1.0 is exact), so every
    // non-glowing pixel everywhere shades byte-for-byte as before.
    expect(SHADE_BODY).toContain(
      'var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow;');
  });

  it('char still kills per-prim glow — burnt is burnt', () => {
    // The face glow carries * (1.0 - cm); the per-prim term must too, or a
    // charred eye keeps shining through the burn.
    const glowLine = SHADE_BODY.split('\n').find(l => l.includes('+ primAlbedo * primGlow'))!;
    expect(glowLine).toContain('(1.0 - cm)');
  });

  it('does NOT resurrect the face glow on painted prims — the sunglasses rule is untouched', () => {
    // march.wgsl.ts zeroes faceGlow on paint so baked eyes cannot shine
    // through sunglasses. The precedence decision: that kill stays exactly
    // as it was and applies to the FACE term only; per-prim glow is authored
    // per prim and survives paint BY CONSTRUCTION — nothing in the kill
    // reads primGlow. This pins both halves: the kill string, and that the
    // kill line carries no primGlow.
    expect(SHADE_BODY).toContain('faceGlow = faceGlow * (1.0 - painted);');
    const killLine = SHADE_BODY.split('\n').find(l => l.includes('faceGlow = faceGlow * (1.0 - painted);'))!;
    expect(killLine).not.toContain('primGlow');
    // ...and primGlow is ASSIGNED exactly twice in the module: the `var
    // primGlow = 0.0` default and the clamp read. A third assignment — e.g. a
    // separate `primGlow = primGlow * (1.0 - painted)` kill line — would be
    // the resurrected sunglasses rule wearing a different hat (this exact
    // mutation was run and killed).
    expect((moduleSource.match(/primGlow =/g) ?? []).length).toBe(2);
  });
});


describe('flat-albedo seam (close-up diagnostics task 1)', () => {
  // The seam is the instrument the 2026-09-04 close-up investigation needs:
  // a gate that returns the base albedo at the hit and skips the whole
  // post-hit chain, so frame(A) - frame(flat) is the shading share of the
  // close-up frame. Its ENTIRE value depends on being inert when off — a
  // seam that perturbs the walk measures nothing. These pins hold the
  // inertness contract from text, the same way the wgslFn parse pins do.

  it('gates on debugCfg.y and that channel appears EXACTLY once in the file', () => {
    // debugCfg.y was chosen because it was the one spare channel on a
    // uniform every march variant already binds. If a second use appears,
    // the seam is no longer independently toggleable and the legs share
    // state — the exact defect the melt-literal incident warns about.
    // (Comment text is stripped first so this comment itself cannot trip
    // the count — same rule as the wgslFn parser, comments included.)
    const code = MARCH_BODY.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect((code.match(/debugCfg\.y/g) ?? []).length).toBe(1);
    expect(CONE_MARCH).not.toContain('debugCfg'); // cone keeps its own contract
  });

  it('sits between the hit-discard and calcNormal, so off == bit-identical', () => {
    const hit = MARCH_BODY.indexOf('if (!hit) { discard; }');
    const seam = MARCH_BODY.indexOf('debugCfg.y > 0.5');
    const normals = MARCH_BODY.indexOf('calcNormal(p,');
    expect(hit).toBeGreaterThan(-1);
    expect(seam).toBeGreaterThan(hit);
    expect(normals).toBeGreaterThan(seam);
  });

  it('returns the base albedo with no field call in the guarded block', () => {
    // Slice from the guard to its return: the flat path must not evaluate
    // the field, or "flat" would measure walk + some shading, not walk.
    const seam = MARCH_BODY.indexOf('if (debugCfg.y > 0.5)');
    const block = MARCH_BODY.slice(seam, seam + 120);
    expect(block).toContain('return vec4<f32>(baseColor, t)');
    expect(block).not.toMatch(/mapBody|calcNormal|woundShadow|woundMask|fbm\(/);
  });

  it('leaves the post-hit chain below the seam intact', () => {
    // The seam is a skip, not a deletion: with it off, every post-hit stage
    // must still be present in the source (scatter probe, AO probe, wound
    // shadow, level shadow, ambient).
    const seam = MARCH_BODY.indexOf('debugCfg.y > 0.5');
    const rest = MARCH_BODY.slice(seam);
    expect(rest).toContain('woundShadow(p, L,');
    expect(rest).toContain('levelShadow(p, n,');
    expect(rest).toContain('ambientAt(p, n,');
    expect(rest).toContain('calcNormal(p,');
    expect((rest.match(/mapBody\(p \+/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});


describe('final-hit analytic normal integration', () => {
  it('binds an independent default-off uniform and propagates actor/chunk requests', async () => {
    const gpu = (await import('./zombie-gpu?raw')).default;
    const game = (await import('./game-main?raw')).default;
    expect(gpu).toContain('normalGradientCfg: uniform(new THREE.Vector4(0, 0, 0, 0))');
    expect(gpu).toContain('normalGradientCfg: u.normalGradientCfg');
    expect(gpu).toContain('u.normalGradientCfg.value.copy(template.normalGradientCfg.value)');
    expect(game).toContain('setNormalGradient(mode: 0 | 1)');
    expect(game).toContain('setNormalGradientDebug(mode: 0 | 1 | 2)');
    expect(game).toContain('normalGradientStatus()');
    expect(game).toContain('view.uniforms.normalGradientCfg.value.set(normalGradientMode, normalGradientDebug, 0, 0)');
  });
  it('runs the new fold only after the hit, preserving the complete legacy fallback and later detail', () => {
    expect(MARCH_BODY.indexOf('ngBody(')).toBeGreaterThan(MARCH_BODY.indexOf('let anchor = restPoint'));
    expect(MARCH_BODY).toContain('if (!ngValid)');
    expect(MARCH_BODY).toContain('normalGradientCfg.x > 0.5');
    // Crowd fix (2026-09-14): the analytic path is ungated for every slot. The
    // temporary single-slot mitigation (`instCfg.x < 1.5`) must not come back.
    expect(MARCH_TRACE_POST).toContain('if (normalGradientCfg.x > 0.5) {');
    expect(MARCH_TRACE_POST).not.toContain('instCfg.x < 1.5');
    expect((MARCH_BODY.match(/let detailAmp = surfCfg2.y/g) ?? []).length).toBe(1);
    for (const src of [MAP_BODY, CONE_MARCH, DEPTH_PREPASS_MARCH, WOUND_SHADOW]) expect(src).not.toContain('ngBody(');
  });
});

// Hybrid deferred M1 task 2: MARCH_BODY is assembled from named sections so
// the deferred surface entry (deferred-sdf.ts) shares the trace and material
// text verbatim. These pin the ASSEMBLY — the surface entry itself is pinned
// in deferred-sdf.test.ts.
describe('MARCH_BODY section split (hybrid deferred M1 task 2)', () => {
  it('is exactly fn marchBody + params + trace + surface-prep + light', async () => {
    const m = await import('./march.wgsl');
    expect(m.MARCH_BODY).toBe(
      `fn marchBody${m.MARCH_BODY_PARAMS}${m.MARCH_BODY_TRACE}${m.MARCH_BODY_SURFACE_PREP}${m.MARCH_BODY_LIGHT}`,
    );
    // The entry point still satisfies the wgslFn ^-anchor.
    expect(MARCH_BODY.startsWith('fn marchBody(')).toBe(true);
  });

  it('the wet/specPow/glow hoist is arithmetic-neutral: each term defined ONCE, before the flashlight', () => {
    // The hoist exists so the surface entry can exit before lighting while
    // sharing the terms. A duplicated definition would mean the two entries
    // diverged — the failure this split exists to prevent.
    expect(MARCH_BODY.match(/\blet specPow\b/g)).toHaveLength(1);
    expect(MARCH_BODY.match(/var wet = /g)).toHaveLength(1);
    expect(MARCH_BODY.match(/let glow = /g)).toHaveLength(1);
    expect(MARCH_BODY.indexOf('let specPow')).toBeLessThan(MARCH_BODY.indexOf('ANALYTIC FLASHLIGHT'));
    expect(MARCH_BODY.indexOf('let wetWound')).toBeLessThan(MARCH_BODY.indexOf('ANALYTIC FLASHLIGHT'));
    expect(MARCH_BODY.indexOf('let glow =')).toBeLessThan(MARCH_BODY.indexOf('ANALYTIC FLASHLIGHT'));
    // shine consumes the shared exponent — the legacy inline mix, named.
    expect(MARCH_BODY).toContain('let shine = pow(max(dot(n, H), 0.0), specPow);');
    expect(MARCH_BODY).toContain('let specPow = mix(mix(128.0, 4.0, surfCfg.y), 220.0, gloss);');
  });

  it('the light tail keeps every light-dependent term — nothing leaked into the shared sections', async () => {
    const m = await import('./march.wgsl');
    for (const marker of [
      'ANALYTIC FLASHLIGHT', 'ambientAt(', 'woundShadow(', 'levelShadow(',
      'var fleshLit', 'softShoulder(', '0.04045',
    ]) {
      expect(m.MARCH_BODY_LIGHT).toContain(marker);
      // The trace and surface-prep are the sections the surface entry reuses;
      // they must stay light-free (signatures legitimately NAME the light
      // params — check the bodies only).
      expect(m.MARCH_BODY_TRACE).not.toContain(marker);
      expect(m.MARCH_BODY_SURFACE_PREP).not.toContain(marker);
    }
  });
});

describe('run 5: MARCH_BODY_TRACE is SETUP + LOOP + POST', () => {
  it('concatenates textually and splits at the walk', async () => {
    const m = await import('./march.wgsl');
    expect(m.MARCH_BODY_TRACE).toBe(`${m.MARCH_TRACE_SETUP}${m.MARCH_TRACE_LOOP}${m.MARCH_TRACE_POST}`);
    expect(m.MARCH_TRACE_LOOP.startsWith('  var t = clamp(max(max(max(max(startT')).toBe(true);
    expect(m.MARCH_TRACE_POST.startsWith('  if (!hit) { discard; }')).toBe(true);
    expect(m.MARCH_TRACE_SETUP).not.toContain('for (var i = 0; i < 512');
    expect(m.MARCH_TRACE_LOOP).toContain('for (var i = 0; i < 512');
    expect(m.MARCH_TRACE_POST).not.toContain('for (var i = 0; i < 512');
  });

  it('calcNormal takes its stencil size from gNormalEps, default 0.0015', async () => {
    const m = await import('./march.wgsl');
    expect(m.CALC_NORMAL).toContain('var<private> gNormalEps: f32 = 0.0015;');
    expect(m.CALC_NORMAL).toContain('let e = vec2<f32>(1.0, -1.0) * gNormalEps;');
    expect(m.CALC_NORMAL).not.toContain('* 0.0015;');
  });

  it('REFINE_BODY is params + setup + REFINE_LOOP + post + prep + light, with four refine params appended', async () => {
    const m = await import('./march.wgsl');
    expect(m.REFINE_BODY).toBe(`fn refineBody${m.REFINE_PARAMS}${m.MARCH_TRACE_SETUP}${m.REFINE_LOOP}${m.MARCH_TRACE_POST}${m.MARCH_BODY_SURFACE_PREP}${m.MARCH_BODY_LIGHT}`);
    expect(m.REFINE_PARAMS.endsWith('  marchTex: texture_2d<f32>,\n  cosRay: f32,\n  nearFar: vec2<f32>,\n  refineCfg: vec4<f32>,\n  normalTex: texture_2d<f32>\n) -> vec4<f32> {\n')).toBe(true);
    expect(m.REFINE_PARAMS.startsWith(m.MARCH_BODY_PARAMS.slice(0, m.MARCH_BODY_PARAMS.lastIndexOf(')')).replace(/\s*$/, ''))).toBe(true);
  });
  it('REFINE_LOOP declares every name the walk declares that the later sections read', async () => {
    const m = await import('./march.wgsl');
    // Strip WGSL comments: the pin is about names read as CODE, not mentioned in prose.
    const later = `${m.MARCH_TRACE_POST}${m.MARCH_BODY_SURFACE_PREP}${m.MARCH_BODY_LIGHT}`
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const declared = [...m.MARCH_TRACE_LOOP.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g)].map((x) => x[1]!);
    const needed = [...new Set(declared)].filter((n) => new RegExp(`\\b${n}\\b`).test(later));
    expect(needed.length).toBeGreaterThan(0);
    for (const n of needed) expect(m.REFINE_LOOP, `REFINE_LOOP must declare ${n}`).toMatch(new RegExp(`\\b(?:let|var)\\s+${n}\\b`));
  });
  it('REFINE_LOOP rejects on the SDF distance before any Newton step, never walks, and sets gNormalEps', async () => {
    const m = await import('./march.wgsl');
    expect(m.REFINE_LOOP).not.toContain('for (var i = 0; i < 512');
    const reject = m.REFINE_LOOP.indexOf('refineCfg.y');
    const newton = m.REFINE_LOOP.indexOf('t = t + dres.x');
    expect(reject).toBeGreaterThan(-1); expect(newton).toBeGreaterThan(reject);
    expect(m.REFINE_LOOP).toContain('gNormalEps = ');
    expect(m.REFINE_LOOP).toContain('if (wsum < 0.5) { discard; }');
  });
  it('run 5b: the march writes the per-body key into the normal attachment alpha', async () => {
    const m = await import('./march.wgsl');
    expect(m.MARCH_BODY_LIGHT).toContain('let bodyKey = dot(gInstCentre, vec3<f32>(1.0, 7.31, 13.7)) + 1.0;');
    expect(m.MARCH_BODY_LIGHT).toContain('gMarchNormal = vec4<f32>(normalize(n), bodyKey);');
    expect(m.MARCH_BODY_LIGHT).not.toContain('gMarchNormal = vec4<f32>(normalize(n), 1.0);');
  });
  it('run 5b: the ownership early-out precedes the first mapBody in REFINE_LOOP', async () => {
    const m = await import('./march.wgsl');
    expect(m.REFINE_LOOP).toContain('let myKey = dot(gInstCentre, vec3<f32>(1.0, 7.31, 13.7)) + 1.0;');
    const gate = m.REFINE_LOOP.indexOf('nk != myKey');
    const map = m.REFINE_LOOP.indexOf('mapBody(');
    expect(gate).toBeGreaterThan(-1);
    expect(map).toBeGreaterThan(gate);
  });
});

describe('crowd instance state', () => {
  it('declares the record loader and the per-instance globals', () => {
    // The vars ride FOLD_GROUP's tail (the same wgslFn parse-contract trick
    // the tile globals use), so the loader source still STARTS with fn.
    const globals = FOLD_GROUP + INSTANCE_STATE;
    for (const g of ['gInstCounts', 'gInstCounts2', 'gInstWoundBound', 'gInstAnchor', 'gInstWind',
      'gInstMelt', 'gInstFlash', 'gInstNoiseShift', 'gInstHeadCentre', 'gInstHeadQuat',
      'gInstVolPose0', 'gInstVolPose1', 'gInstCentre', 'gInstHalf', 'gBand', 'gSlot',
      'gTileEntryT']) {
      expect(globals).toContain(`var<private> ${g}`);
    }
    expect(INSTANCE_STATE).toContain(`fn loadInstance(inst: ptr<storage, array<vec4<f32>>, read>, slot: i32)`);
    expect(INSTANCE_STATE).toContain(`${REC_VEC4S}`);
    expect(INSTANCE_STATE).toContain(`+ ${REC_ANCHOR_BAND}]`);
  });
  it('removes every per-instance parameter from the signature and adds inst/instCfg/instCentre/instHalf last', () => {
    for (const p of ['counts:', 'counts2:', 'woundBound:', 'bodyCentre:', 'bodyHalf:', 'bodyAnchor:',
      'windDrift:', 'meltCfg:', 'bodyFlash:', 'headCentre:', 'headQuat:', 'volumePose0:', 'volumePose1:']) {
      expect(MARCH_BODY_PARAMS).not.toContain(p);
    }
    // Strip comments first: the crowd proxy-box comment sits between instCfg
    // and instCentre, and the wgslFn parser sees it as ordinary text.
    const sig = MARCH_BODY_PARAMS.replace(/\/\/[^\n]*/g, ' ').replace(/\s+/g, ' ');
    expect(sig).toMatch(/inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>, instCentre: vec3<f32>, instHalf: vec3<f32>\s*\)/);
  });
  it('bands the damage folds', () => {
    expect(APPLY_CARVES).toContain('fn applyCarves(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32)');
    expect(APPLY_WOUNDS).toContain('band: i32');
    expect(MAP_BODY).toContain('for (var k = 0; k < ${MAX_CROWD_INSTANCES}; k = k + 1)'.replace('${MAX_CROWD_INSTANCES}', '64'));
  });
});

describe('crowd quad dispatch (stage a-2)', () => {
  it('has a quad entry mode gated on instCfg.y == 2 that discards empty tiles before stepping', () => {
    expect(MARCH_TRACE_SETUP).toContain('let quadMode = instCfg.y > 1.5;');
    expect(MARCH_TRACE_SETUP).toContain('if (quadMode && gTileN < 0.5) { discard;');
    expect(MARCH_TRACE_SETUP).toContain('gTileEntryT');
    expect(MARCH_TRACE_SETUP).toContain('let bodyEntry = select(boxEntry, gTileEntryT, quadMode);');
  });

  it('keeps the box entry text for instCfg.y <= 1', () => {
    expect(MARCH_TRACE_SETUP).toContain('let boxEntry = max(max(min(bLo.x, bHi.x), min(bLo.y, bHi.y)), max(min(bLo.z, bHi.z), 0.0));');
  });

  it('accumulates the nearest sphere entry only in quad mode, with the type max blend reach', () => {
    expect(MARCH_TRACE_SETUP).toContain('let reach = select(gInstCounts.w, instCfg.w, quadMode) * 4.0 +');
    expect(MARCH_TRACE_SETUP).toContain('gTileEntryT = entryT;');
    expect(MARCH_TRACE_SETUP).toContain('if (max(shellIn, bodyEntry) > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }');
  });

  it('keeps the material-side empty-tile gate on the SAME tile index formula as the preload', () => {
    // The gate (QUAD_TILE_EMPTY_WGSL, called from createMarchMaterial before
    // the march) must address the SAME tile the preload does, or it would
    // discard a pixel whose real tile is non-empty. Pin the three lines that
    // define the mapping in both texts.
    for (const line of [
      'let gx = max(1, i32(tileCfg.y));',
      'let gy = max(1, i32(tileCfg.w));',
      'let tid = clamp(vec2<i32>(floor(screenUV * vec2<f32>(f32(gx), f32(gy)))), vec2<i32>(0, 0), vec2<i32>(gx - 1, gy - 1));',
    ]) {
      expect(MARCH_TRACE_SETUP).toContain(line);
      expect(QUAD_TILE_EMPTY_WGSL).toContain(line);
    }
  });
});
