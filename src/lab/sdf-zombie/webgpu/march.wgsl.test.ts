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
  HELPERS, MARCH_BODY, CONE_MARCH, DATA_ROWS, SD_PRIM, SD_PRIM_ORIENTED, MAP_BODY, ROW_PRIM_COLOR, ROW_GROUP_BOUNDS, ROW_GROUP_RANGE, ROW_CLUSTER_GROUPS,
  SAMPLE_VOLUME, APPLY_CARVES, CONE_CAP, SMIN_CHAMFER, SD_GROOVE, CONE_BEND, SD_BEZIER_T,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT, ROW_REST_A, ROW_REST_B,
  ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_WOUND, ROW_WOUND_META, ROW_PRIM_SHAPE,
  ROW_PRIM_BEND, WOUND_MASK, WOUND_SHADOW,
} from './march.wgsl';
import { MAX_WOUNDS } from '../damage';
import { specialiseMapBody } from './specialise';
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
    expect(applyCarves).toContain('let isGroove = S.w > 2.5;');
    expect(applyCarves).toContain('if (!isCarve && !isGroove) { continue; }');
  });

  it('grooves cut a channel rather than subtracting a solid', () => {
    const applyCarves = HELPERS.find(h => declaredName(h) === 'applyCarves')!;
    // ONE sd evaluation feeds both branches, the same invariant mapBody's fold
    // keeps — evaluating the field twice is how the two paths drift apart.
    expect(applyCarves).toContain('let sd = select(sdPrim(p, idx, data, r2, prof, cpos, 0), sdPrimO(p, idx, data, r2, prof, cpos, 0), ori);');
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
    expect(MARCH_BODY).toContain('calcNormal(p, data, counts, marchCfg.z, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip)');
    expect(MARCH_BODY).toContain('let anchor = restPoint(p, data, hitBest, noiseLocal(p, noiseShift));');
    expect(MARCH_BODY).toContain('fbm(anchor * 22.0)');
    expect(MARCH_BODY).not.toContain('fbm(p * 22.0)');
    const mapBody = HELPERS.find(h => declaredName(h) === 'mapBody')!;
    // Argmin tripwire: ONE sd evaluation feeds both the fold and the tracker.
    // Same invariant, now carrying the taper radius AND the profile+bend
    // encoding: ONE sd evaluation still feeds both. `r2` is -1 for every
    // untapered prim (plain-capsule branch inside coneCap); `cpos` is zero
    // unless prof > 1.5, which is the Bezier branch inside sdPrim.
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('var sd = sdPrim(p, idx, data, r2, prof, cpos, band);');
    expect(foldGroup).toContain('if (ori) { sd = sdPrimO(p, idx, data, r2, prof, cpos, band); }');
    expect(foldGroup).toContain('if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); }');
    expect(foldGroup).toContain('if (prof > 0.5 && prof < 1.5) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }');
    expect(mapBody).toContain('let anchor = restPoint(p, data, bestIdx, noiseLocal(p, noiseShift));');
    expect(mapBody).toContain('fbm(anchor * 3.0) * noiseAmp');
    // The cone pre-pass marches the SMOOTH field (amplitude 0) and stays
    // independent of the motion plumbing — zero shift, dead noise term. The
    // volume block still rides along: the cone must see the same field the
    // march does (X1.26).
    const coneMarch = CONE_MARCH;
    expect(coneMarch).toContain(
      'mapBody(camPos + rd * t, data, counts, 0.0, woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip).x');
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
    // Before the gore and face passes: mottle is the flesh's own colour, so
    // damage and the face paint OVER it.
    expect(MARCH_BODY.indexOf('mix(albedo, mottleColor'))
      .toBeLessThan(MARCH_BODY.indexOf('let goreStrength = lodCfg.w;'));
    expect(MARCH_BODY.indexOf('mix(albedo, mottleColor'))
      .toBeLessThan(MARCH_BODY.indexOf('if (faceCfg.x > 0.5) {'));
  });

  it('steps the shell conservatively and never retracts a displaced sample', () => {
    // The fbm breaks the Lipschitz bound, so inside the shell a relaxed step
    // could tunnel — 0.6 under-relaxation pays for the noise instead. And the
    // overshoot retraction assumes the un-displaced field (it rewinds by the
    // omega excess), so it must be suppressed whenever d carries the shell.
    expect(MARCH_BODY).toContain('select(omega, 0.6, conservative || nearWound)');
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
      'if (d < -max(hitEpsBase, t * aaK) && omega > 1.0 && !conservative) {');
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
    expect(WOUND_SHADOW).toContain('res = min(res, k * h / t);');
    expect(WOUND_SHADOW).toContain('if (res < 0.02 || t > 0.4) { break; }');
    expect(WOUND_SHADOW).toContain('t = t + clamp(h, 0.01, 0.06);');
    // Smooth field: no fbm in the shadow march (noiseAmp 0, like the cone).
    expect(WOUND_SHADOW).toContain('counts, 0.0, woundCfg, woundCfg2');
  });
  it('darkens ONLY the key diffuse + specular; fill/ambient/scatter stay lit', () => {
    // Multiply the whole lit sum and craters go pitch black — the fill and
    // the fake scatter are what keep the cavity readable from the dark side.
    expect(MARCH_BODY).toContain(
      'albedo * (amb + diff * wShadow * lightCfg.x * keyColor) * ao');
    expect(MARCH_BODY).toContain('shine * wShadow * mix(surfCfg.x, 1.5, gloss)');
    // The fill term must NOT carry the shadow...
    expect(MARCH_BODY).not.toContain('lightCfg.y * wShadow');
    // ...and strength mixes TOWARD 1 so the slider scales, never inverts.
    expect(MARCH_BODY).toContain(
      'woundShadow(p, L, woundShadowCfg.y, data, counts, woundCfg, woundCfg2, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip), woundShadowCfg.x');
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
    const needed = ['volumeTex', 'volumePose0', 'volumePose1', 'volumeMin',
      'volumeInvExtent', 'volumeWarp', 'volumeClip'];
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
    expect(MARCH_BODY).toContain('let hitEpsBase = max(0.0012, woundCfg2.w);');
    // AA epsilon rides ON TOP of that floor and must collapse to it exactly at
    // the shipping default (aaCfg.y = 0 => aaK = 0 => max(base, 0) = base), so
    // the primitive path stays bit-identical until someone moves the slider.
    expect(MARCH_BODY).toContain('let aaK = aaCfg.x * aaCfg.y;');
    expect(MARCH_BODY).toContain('let hitEps = max(hitEpsBase, t * aaK);');
    // wound-halo r2 split the accept into the deep-crossing retract guard and
    // the literal hit test; the epsilon literal still gates both.
    expect(MARCH_BODY).toContain('hit = true;\n          break;');
    expect(MARCH_BODY).toContain('if (d < -max(hitEpsBase, t * aaK) && omega > 1.0');
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
    expect(MAP_BODY).toContain(`for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {`);
    expect(MARCH_BODY).toContain('if (e >= n) { break; }');
  });

  it('mapBody branches on gTileActive: tile list vs cluster walk, both through foldGroup', () => {
    expect(MAP_BODY).toContain('if (gTileActive > 0.5) {');
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, i32(gTileBand[e]), gTileBounds[e], gTileGrp[e]);');
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, 0, bounds, range);');
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
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(APPLY_CARVES).toContain(`cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND}), 0).xyz;`);
    expect(foldGroup).toContain(
      `cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND} + band), 0).xyz;`);
    const gateAt = foldGroup.indexOf('if (prof > 1.5) {');
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(foldGroup.indexOf('cpos = textureLoad'));
  });

  // Bend rides profile bit 1 (+2), so the old "prof > 0.5" chamfer test would
  // wrongly chamfer a plain-bent round prim — the fold must bound it above.
  it('bounds the chamfer test below the bend encoding in the fold', () => {
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('if (prof > 0.5 && prof < 1.5) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }');
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

describe('per-prim orientation (motion-polish task 3)', () => {
  it('sdPrimO reads the quat row and guards identity prims with a cheap branch', () => {
    // String pins: the parity test below proves the CPU mirror, these prove
    // the WGSL actually contains the branch being mirrored.
    expect(SD_PRIM_ORIENTED).toContain(`textureLoad(data, vec2<i32>(i, ${ROW_PRIM_QUAT} + band), 0)`);
    // Was 11; the arc capsule added ROW_PRIM_BEND, and per-primitive colour
    // added ROW_PRIM_COLOR, each without displacing any existing row.
    // 16: bound groups (pack.ts boundGroups) added ROW_GROUP_BOUNDS/RANGE
    // and the per-cluster span row ROW_CLUSTER_GROUPS.
    expect(DATA_ROWS).toBe(16);
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
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, i32(gTileBand[e]), gTileBounds[e], gTileGrp[e]);');
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, 0, bounds, range);');
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
    const calcNormal = HELPERS.find(h => declaredName(h) === 'calcNormal')!;
    expect(calcNormal).toContain('volumeClip: vec4<f32>');
    // Every calcNormal mapBody tap (4 of them) carries it.
    expect((calcNormal.match(/volumeWarp, volumeClip\)/g) ?? []).length).toBe(4);
  });
});

describe('per-primitive colour', () => {
  it('has a data row of its own, inside DATA_ROWS', () => {
    expect(ROW_PRIM_COLOR).toBeLessThan(DATA_ROWS);
  });

  it('reads the row at the HIT primitive and gates on the w sentinel', () => {
    expect(MARCH_BODY).toContain(`vec2<i32>(hitBest, ${ROW_PRIM_COLOR})`);
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
    expect(WOUND_MASK).toContain('m = max(m, 1.0 - smoothstep(0.0, w.w * 1.6, length(p - w.xyz)));');
    expect(WOUND_MASK).toContain('return vec2<f32>(m, m);');
    expect(WOUND_MASK).not.toContain('smoothstep(-0.25, 0.15, face)');
    expect(WOUND_MASK).not.toContain('collar');
  });

  it('keeps the lighting free of wound-keyed gates and darkenings', () => {
    expect(MARCH_BODY).not.toContain('keyGate');
    expect(MARCH_BODY).not.toContain('shineOcc');
    expect(MARCH_BODY).not.toContain('ao * (1.0 - 0.55 * smoothstep(0.35, 1.0, wm))');
    expect(MARCH_BODY).toContain('albedo * (amb + diff * wShadow * lightCfg.x * keyColor) * ao');
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
    // debugCfg parameter by design — threading one would fork the
    // signature specialise.ts mirrors).
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }');
    // The march entry: init + per-step count guarded on the uniform itself.
    expect(MARCH_BODY).toContain(
      'if (debugCfg.x > 0.5) { gDebugMode = debugCfg.x; gDebugPrims = 0.0; gDebugSteps = 0.0; }');
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
    const branch = MARCH_BODY.indexOf('if (debugCfg.x > 0.5) {\n    let heatNorm');
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(MARCH_BODY.indexOf('lodCfg.y > 0.5'));
    // steps ramp: 0..marchCfg.x. prims ramp: 0..2000.
    expect(MARCH_BODY).toContain('select(debugSteps / max(marchCfg.x, 1.0), debugPrims / 2000.0, debugCfg.x > 1.5)');
  });

  it('counts prims in the specialised fold too (heatmap parity)', () => {
    // A specialised crowd body must count the same work the generic fold
    // counts, or a heatmap taken against a specialised crowd lies.
    expect(specialiseMapBody(oneClusterBody())).toContain(
      'if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }');
  });
});

/** Minimal body for the specialise-parity pin: one limb, one prim. */
function oneClusterBody(): import("../build-body").BuildResult {
  const prim: Primitive = {
    a: [0, 0, 0], b: [0, 1, 0], radius: 0.1,
    scale: [1, 1, 1], blendK: 0.05, limb: 'torso', op: 'add',
  } as unknown as Primitive;
  return {
    prims: [prim],
    clusters: [{ limb: 'torso', start: 0, count: 1, center: [0, 0.5, 0], radius: 0.7, alive: true }] as never,
    bones: [], root: 'torso', errors: [],
  } as unknown as import("../build-body").BuildResult;
}
