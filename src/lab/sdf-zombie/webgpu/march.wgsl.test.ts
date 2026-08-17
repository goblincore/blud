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
  HELPERS, MARCH_BODY, CONE_MARCH, DATA_ROWS,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE,
  ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_WOUND, ROW_WOUND_META,
} from './march.wgsl';
import { MAX_WOUNDS } from '../damage';
import { sdBody, MAX_PRIMS } from '../validate';
import type { Primitive } from '../types';

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
    expect(MARCH_BODY).toContain('fbm((p - noiseShift) * 6.0)');
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
    expect(MARCH_BODY).toContain('var d = mapBody(');
    expect(MARCH_BODY).toContain('let shellAmp = woundCfg2.z;');
    expect(MARCH_BODY).toMatch(/abs\(d\) < shellAmp \* 4\.0/);
    expect(MARCH_BODY)
      .toMatch(/d = d \+ fbm\(\(camPos \+ rd \* t - noiseShift\) \* 3\.0\) \* shellAmp;/);
  });

  it('anchors every noise site to the root shift, so texture rides the flesh (motion-polish)', () => {
    // The field is packed in world space, but the fbm — silhouette, shell,
    // micro surface detail, gore mottle — must sample the BODY's frame or a
    // walking body slides through a stationary noise field. The shift packs
    // into faceCfg3.zw (the only spare vec2 — see zombie-gpu.ts) with y
    // structurally zero: root translation is ground-plane only. mapBody and
    // calcNormal thread it so the normal-warping warps with the same anchor.
    expect(MARCH_BODY).toContain('let noiseShift = vec3<f32>(faceCfg3.z, 0.0, faceCfg3.w);');
    expect(MARCH_BODY).toContain('calcNormal(p, data, counts, marchCfg.z, woundCfg, woundCfg2, noiseShift)');
    expect(MARCH_BODY).toContain('fbm((p - noiseShift) * 22.0)');
    expect(MARCH_BODY).not.toContain('fbm(p * 22.0)');
    const mapBody = HELPERS.find(h => declaredName(h) === 'mapBody')!;
    expect(mapBody).toContain('fbm((p - noiseShift) * 3.0) * noiseAmp');
    // The cone pre-pass marches the SMOOTH field (amplitude 0) and stays
    // independent of the motion plumbing — zero shift, dead noise term.
    const coneMarch = CONE_MARCH;
    expect(coneMarch).toContain(
      'mapBody(camPos + rd * t, data, counts, 0.0, woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0))');
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

describe('data texture layout', () => {
  it('gives every row a distinct index inside DATA_ROWS', () => {
    const rows = [
      ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE,
      ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_WOUND, ROW_WOUND_META,
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
