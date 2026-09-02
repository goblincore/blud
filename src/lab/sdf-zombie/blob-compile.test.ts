// src/lab/sdf-zombie/blob-compile.test.ts
import { describe, it, expect } from 'vitest';
import { parseBlob } from './blob-parse';
import { BlobError } from './blob-ast';
import { compileBlob, compileFace, compilePalette, compileSheet, compileSheetImage, dirVector } from './blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { DEFAULT_BONE_RATIO } from './bone-derive';
import { DEFAULT_FACE } from './face';
import { FLESH_PRESETS } from './material';
import zombieBlobSrc from './characters/zombie.blob?raw';

const near = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, Math.round(-Math.log10(eps))));

describe('dirVector', () => {
  it('maps the four base directions', () => {
    near(dirVector('up', 0, 0), [0, 1, 0]);
    near(dirVector('down', 0, 0), [0, -1, 0]);
    near(dirVector('side', 0, 0), [1, 0, 0]);
    near(dirVector('fwd', 0, 0), [0, 0, 1]);
  });

  // The zombie's spine is authored as [0,1,0.12]; atan(0.12) = 6.843 degrees.
  it('pitches up toward +z, matching the authored spine', () => {
    const v = dirVector('up', 6.842773, 0);
    near([v[2] / v[1], 0, 0], [0.12, 0, 0], 1e-6);
  });

  // upperArm is [0.30,-1,0]; atan(0.30) = 16.699 degrees of tilt off down.
  it('tilts down toward +x, matching the authored upper arm', () => {
    const v = dirVector('down', 0, 16.699244);
    near([v[0] / -v[1], 0, 0], [0.30, 0, 0], 1e-6);
  });

  // The exact twin of the pitch bug just fixed, in the other axis: a plain
  // rotation about Z sends `down` (y1 < 0) toward +x but `up` (y1 > 0)
  // toward -x for the same positive tilt, because the old `-y1 * sin(t)`
  // term flips sign with y1. No real zombie bone combines `up` with a
  // nonzero tilt, so this shipped silently — but the plan's upcoming 8-
  // character cast (troll.wam's `bone clavicle ... dir=side tilt=15` is
  // adjacent territory) will hit `up` + tilt almost immediately. Same
  // synthetic angle as the `down` case above, so the two magnitudes match
  // and only the sign of y differs.
  it('tilts up toward +x too, the twin of the down case', () => {
    const v = dirVector('up', 0, 16.699244);
    near([v[0] / v[1], 0, 0], [0.30, 0, 0], 1e-6);
  });

  // shin is [0,-1,0.05]; atan(0.05) = 2.862405 degrees. Neither existing
  // test above combines pitch with a `down` base — the previous
  // implementation applied pitch as a literal rotation about world X, so its
  // sign depended on the sign of the base's y, and this case produced
  // z ≈ -0.0499 (flipped) instead of +0.05. Pitch is an author-facing
  // convention ("tip forward") that must mean the same thing on a
  // downward-pointing bone as on an upward one.
  it('pitches down toward +z too, matching the authored shin', () => {
    const v = dirVector('down', 2.862405, 0);
    near([v[2] / -v[1], 0, 0], [0.05, 0, 0], 1e-6);
  });

  // foreArm is [0.05,-1,0.1], the one case the plan's original two tests
  // never covered together: pitch and tilt combined on a `down` base — and
  // exactly the combination that was silently wrong before the pitch fix
  // (z ≈ -0.1001 instead of +0.1001).
  //
  // The pitch value below is NOT atan(0.1) (5.710593°, the naive per-axis
  // angle used elsewhere in this file) — it's 5.703515°, the value
  // `derive_blob_angles.mjs` actually emits for this bone. Composing tilt
  // AFTER pitch is not commutative: tilt shrinks |y| by cos(tilt) without
  // touching z, so z/-y comes out as tan(pitch) / cos(tilt), not tan(pitch)
  // — feeding in the naive atan(0.1) reproduces the target only to ~1.25e-4.
  // `derive_blob_angles.mjs` accounts for that by deriving
  // pitch = atan((z/|y|) * cos(tilt)) instead of atan2(z, |y|), which
  // inverts this exact composition rather than an idealised independent-axes
  // one — so feeding its output back through `dirVector` round-trips to
  // float precision, and the tolerance below can be as tight as every other
  // test in this file.
  it('combines pitch and tilt on a down base, matching the derived forearm angles', () => {
    const v = dirVector('down', 5.703515, 2.862405);
    near([v[0] / -v[1]], [0.05], 1e-6);
    near([v[2] / -v[1]], [0.1], 1e-6);
  });
});

describe('compileBlob', () => {
  // `skull` and the second `torso` blob (on the root `pelvis` bone) aren't in
  // the plan's original fixture, and both are needed:
  //
  // Without a `skull` bone, facePrims (always emitted — see compileBlob's doc
  // comment) reference a bone that doesn't exist, and buildBody throws
  // outright ("prim references unknown bone \"skull\"") before validation
  // even runs.
  //
  // Add just the `skull` bone and buildBody gets past that throw, but
  // validateBody's connectivity check then reports `legL`/`legR` as
  // disconnected — NOT the head. The spine's torso blob (at=0.8) already
  // sits close enough to fuse with the skull on its own; it's the mirrored
  // `thigh` bones, parented straight onto `pelvis` with no torso mass nearby,
  // that have nothing to fuse to. The pelvis-anchored `blob torso` below
  // (mirroring the real zombie's own pelvis blob in body.ts) bridges that
  // gap. Every real `.blob` character carries geometry like it; this fixture
  // needs it too to exercise the "existing builder accepts without errors"
  // test honestly rather than vacuously.
  const doc = parseBlob(`model t
skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=0 len=0.34
  bone skull parent=spine dir=up len=0.16
  mirror
    bone thigh parent=pelvis dir=down side=0.10 len=0.40
  end

body
  blob torso on spine at=0.8 r=0.15 wide=1.28 deep=0.78 blend=0.014
  bar  leg on thigh from=0.05 to=0.95 r=0.082 blend=0.0175 mirror
  carve on spine at=0.55 r=0.022 offset=(0.035,0.01,0.06) hard both
  blob torso on pelvis at=0.40 r=0.16 wide=1.10 tall=0.9 deep=0.92 blend=0.03
`);

  it('carries the root height through as BodyDef.root', () => {
    expect(compileBlob(doc).root).toEqual([0, 0.92, 0]);
  });

  it('emits the root bone with a null parent', () => {
    expect(compileBlob(doc).bones[0]).toMatchObject({ name: 'pelvis', parent: null });
  });

  it('turns wide/tall/deep into the scale triple', () => {
    expect(compileBlob(doc).prims[0]!.scale).toEqual([1.28, 1, 0.78]);
  });

  it('turns a bar into a capsule with capTo', () => {
    expect(compileBlob(doc).prims[1]).toMatchObject({ at: 0.05, capTo: 0.95, mirror: true });
  });

  it('turns carve into a subtract op, and hard into blendK 0', () => {
    expect(compileBlob(doc).prims[2]).toMatchObject({
      op: 'sub', blendK: 0, mirrorOffset: true, offset: [0.035, 0.01, 0.06],
    });
  });

  it('produces a BodyDef the existing builder accepts without errors', async () => {
    const { buildBody } = await import('./build-body');
    expect(buildBody(compileBlob(doc)).errors).toEqual([]);
  });
});

describe('box rejections', () => {
  const compile = (line: string) =>
    () => compileBlob(parseBlob(`model t\n  height 1.0\n\nskeleton\n  root pelvis at 0.5\n  bone spine parent=pelvis dir=up len=0.3\n\nbody\n  ${line}\n`));

  it('rejects bend= on a box', () => {
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box bend=(0.02,0,0)'))
      .toThrow(/bend= is not supported on a box/);
  });

  it('rejects r2= on a box', () => {
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box r2=0.02'))
      .toThrow(/r2= is not supported on a box/);
  });

  it('rejects tip= on a box', () => {
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box tip=(0,0,0.05)'))
      .toThrow(/tip= is not supported on a box/);
  });

  it('rejects box on a shell', () => {
    expect(compile('shell torso on spine at=0.5 r=0.05 box thick=0.01 clip=(0,1,0) clipd=0.1 rim=0.004'))
      .toThrow(/box is not supported on a shell/);
  });

  it('rejects round= outside 0..1 rather than clamping', () => {
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box round=1.4'))
      .toThrow(/round= must be between 0 and 1/);
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box round=-0.1'))
      .toThrow(/round= must be between 0 and 1/);
  });

  it('accepts the boundary values 0 and 1', () => {
    // 0 is a dead-sharp corner and 1 is exactly the capsule — both are
    // documented as valid, and Task 3 pins the round=1 equivalence. Without
    // this, changing `< 0 || > 1` to `<= 0 || >= 1` would pass every other
    // test here and silently take away a documented boundary.
    for (const round of [0, 1]) {
      const body = compileBlob(parseBlob(`model t\n  height 1.0\n\nskeleton\n  root pelvis at 0.5\n  bone spine parent=pelvis dir=up len=0.3\n\nbody\n  bar torso on spine from=0.1 to=0.9 r=0.05 box round=${round}\n`));
      expect(body.prims[0]!.box).toEqual({ round });
    }
  });

  it('carries box onto the compiled prim', () => {
    const body = compileBlob(parseBlob(`model t\n  height 1.0\n\nskeleton\n  root pelvis at 0.5\n  bone spine parent=pelvis dir=up len=0.3\n\nbody\n  bar torso on spine from=0.1 to=0.9 r=0.05 box round=0.2\n`));
    expect(body.prims[0]!.box).toEqual({ round: 0.2 });
  });

  it('leaves box absent on an ordinary prim', () => {
    const body = compileBlob(parseBlob(`model t\n  height 1.0\n\nskeleton\n  root pelvis at 0.5\n  bone spine parent=pelvis dir=up len=0.3\n\nbody\n  bar torso on spine from=0.1 to=0.9 r=0.05\n`));
    expect(body.prims[0]!.box).toBeUndefined();
  });
});

describe('compileFace', () => {
  // Line 6, col 3: "  headRadus 0.3" — indent 2, so the key starts at column 3.
  const TYPO_SRC = `model t
skeleton
  root pelvis at 0.92
face
  headRadius 0.2
  headRadus 0.3
`;

  it('rejects an unknown face parameter, naming the offending key', () => {
    const doc = parseBlob(TYPO_SRC);
    expect(() => compileFace(doc)).toThrow(BlobError);
    expect(() => compileFace(doc)).toThrow(/unknown face parameter "headRadus"/);
  });

  it('reports the real source line and column of the bad key, not a synthetic 0', () => {
    const doc = parseBlob(TYPO_SRC);
    let err: BlobError | undefined;
    try {
      compileFace(doc);
    } catch (e) {
      err = e as BlobError;
    }
    expect(err).toBeInstanceOf(BlobError);
    // "headRadus 0.3" is source line 6; the key is the first word after a
    // 2-space indent, so it starts at column 3.
    expect(err!.line).toBe(6);
    expect(err!.col).toBe(3);
  });

  it('compiles a document whose face keys are all valid, overriding only the named defaults', () => {
    const doc = parseBlob(`model t
skeleton
  root pelvis at 0.92
face
  headRadius 0.2
  jawDrop 0.05
`);
    const face = compileFace(doc);
    expect(face.headRadius).toBe(0.2);
    expect(face.jawDrop).toBe(0.05);
    // Every other field keeps DEFAULT_FACE's value — spot-check one.
    expect(face.headWidth).toBe(0.76);
  });
});

// NOTE: this pins that the shipped document is currently well-formed and
// compiles clean — a real and useful thing to know on its own. It does NOT
// pin webgpu/lab-main.ts's actual compile path: that file calls compileBlob
// with an explicit `face` argument (see the "explicit face" block below),
// while this test calls compileBlob(doc) with none, so it exercises
// compileBlob's `face = compileFace(doc)` DEFAULT rather than the lab's
// real calling convention. lab-main.ts isn't imported here — it runs a live
// WebGPU bootstrap as a module-level side effect and isn't safely
// importable in this environment, and it's out of scope to change for
// testability — so nothing in this file can watch its source directly.
describe('the shipped zombie.blob', () => {
  it('compiles clean, with no validation errors', () => {
    const built = buildBody(compileBlob(parseBlob(zombieBlobSrc)), DEFAULT_BUILD_OPTS, {});
    expect(built.errors).toEqual([]);
    expect(built.prims.length).toBeGreaterThan(20);
  });
});

// Regression coverage for a bug found while wiring webgpu/lab-main.ts to
// compileBlob: compileBlob(doc, face)'s `face` parameter defaults to
// compileFace(doc), but a DEFAULT only fires when the caller omits the
// argument. lab-main.ts's compileZombie() always supplies an explicit face
// (DEFAULT_FACE merged with the panel's live overrides) — the ONLY calling
// convention the lab ever uses — so compileFace(doc)'s validation of the
// document's own face block silently never ran, and a typo'd face key in
// zombie.blob would have compiled clean with no diagnostic. The fix was to
// call compileFace(doc) explicitly in compileZombie() before compileBlob.
//
// These two tests pin that CONTRACT — they can't watch lab-main.ts's source
// (see the note above), so they don't fail if compileZombie()'s explicit
// call is deleted; only re-reading lab-main.ts would catch that specific
// regression. What they do pin: the second test reproduces the exact
// two-line pattern compileZombie() relies on (compileFace(doc), then
// compileBlob(doc, face)), and deleting its own compileFace(doc) line turns
// it red — verified by hand while writing this, then restored.
describe('compileBlob(doc, face) with an explicit face', () => {
  const BAD_FACE_KEY_SRC = `model t
skeleton
  root pelvis at 0.92
face
  headRadius 0.2
  headRadus 0.3
`;

  it('skips validation of the doc\'s own face block — a bad key compiles clean', () => {
    const doc = parseBlob(BAD_FACE_KEY_SRC);
    // No compileFace(doc) call: this is the bug on its own, isolated from
    // any caller. An explicit face argument — even one that has nothing to
    // do with the doc's face block — bypasses compileBlob's default
    // entirely, so the bad key is never looked at.
    expect(() => compileBlob(doc, DEFAULT_FACE)).not.toThrow();
  });

  it('is only caught if the caller validates explicitly first, as compileZombie() in lab-main.ts does', () => {
    const doc = parseBlob(BAD_FACE_KEY_SRC);
    expect(() => {
      compileFace(doc); // the guard — delete this line and the block below never throws
      compileBlob(doc, DEFAULT_FACE);
    }).toThrow(/unknown face parameter "headRadus"/);
  });
});

describe('compilePalette', () => {
  const doc = (palette: string) => parseBlob(
    `model x\nskeleton\n  root pelvis at 1.0\nbody\n  blob torso on pelvis at=0.5 r=0.1\npalette\n${palette}`);
  const BASE = FLESH_PRESETS['henenlotter-latex'];

  // A character with no palette wears whatever preset the lab has selected —
  // the behaviour every character had before palettes existed. Returning a
  // silently-defaulted material instead would make "no palette" indistinguish-
  // able from "a palette that happens to match the base", and the lab could no
  // longer tell whether to honour the panel.
  it('returns null when the document declares no palette', () => {
    expect(compilePalette(parseBlob('model x\nskeleton\n  root pelvis at 1.0'))).toBeNull();
  });

  it('is a PARTIAL override — unnamed fields keep the base preset', () => {
    const m = compilePalette(doc('  wetness 0.2\n'))!;
    expect(m.wetness).toBe(0.2);
    expect(m.baseColor).toEqual(BASE.baseColor);
    expect(m.specRoughness).toBe(BASE.specRoughness);
  });

  it('reads a colour as three linear channels', () => {
    expect(compilePalette(doc('  baseColor 0.26 0.34 0.15\n'))!.baseColor).toEqual([0.26, 0.34, 0.15]);
  });

  // Identity, not equality — the point is that the compiled material owns its
  // colour arrays. Spreading a FleshMaterial copies its scalars but SHARES its
  // Vec3 arrays, so a palette that overrode no colour would hand back the
  // preset's own arrays. `Vec3` is a readonly tuple so TypeScript blocks the
  // obvious way to exploit that, which makes this a latent hazard rather than
  // a live bug — but the lab hands `flesh` straight to the panel to edit, the
  // preset objects are module-level singletons shared by every view, and one
  // `as` cast anywhere would turn a stray write into every character silently
  // changing colour. Copying is four spreads.
  it('does not alias the base preset\'s colour arrays', () => {
    const m = compilePalette(doc('  wetness 0.2\n'))!;
    const base = FLESH_PRESETS['henenlotter-latex'];
    expect(m.baseColor).toEqual(base.baseColor);
    expect(m.baseColor).not.toBe(base.baseColor);
    expect(m.deepColor).not.toBe(base.deepColor);
    expect(m.charColor).not.toBe(base.charColor);
    expect(m.mottleColor).not.toBe(base.mottleColor);
  });

  it('rejects an unknown parameter name rather than ignoring it', () => {
    // The whole point: a typo must not ride along as an inert extra property
    // while the intended field quietly keeps the preset's value.
    expect(() => compilePalette(doc('  baseColour 0.2 0.3 0.1\n'))).toThrow(BlobError);
    expect(() => compilePalette(doc('  baseColour 0.2 0.3 0.1\n'))).toThrow(/unknown palette parameter/);
  });

  it('rejects a colour given one number', () => {
    expect(() => compilePalette(doc('  baseColor 0.2\n'))).toThrow(/needs 3 numbers/);
  });

  it('rejects a scalar given three numbers', () => {
    expect(() => compilePalette(doc('  wetness 0.2 0.3 0.1\n'))).toThrow(/single number/);
  });

  it('reports the offending line', () => {
    try {
      compilePalette(doc('  wetness 0.3\n  baseColor 0.2\n'));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as BlobError).line).toBe(8); // model, skeleton, root, body, blob, palette, wetness, baseColor
    }
  });

  it('carries the mottle fields through', () => {
    const m = compilePalette(doc('  mottleAmp 0.45\n  mottleScale 1.6\n  mottleColor 0.2 0.19 0.06\n'))!;
    expect(m.mottleAmp).toBe(0.45);
    expect(m.mottleScale).toBe(1.6);
    expect(m.mottleColor).toEqual([0.2, 0.19, 0.06]);
  });
});

const PAINTED = `model painted
  height 1.0
skeleton
  root pelvis at 0.5 len=0.1
  bone skull parent=pelvis dir=up len=0.1
  mirror
    bone arm parent=pelvis side=0.1 dir=down len=0.1
  end
body
  blob torso on pelvis at=0.5 r=0.1
  blob head on skull at=0.5 r=0.08 color=ff8000 gloss=0.5
  bar arm on arm from=0.0 to=1.0 r=0.03 color=101012 mirror
`;

describe('paint survives compile, mirror and resolve', () => {
  it('lands on the built Primitive with the same linear rgb and gloss', () => {
    const doc = parseBlob(PAINTED);
    const built = buildBody(compileBlob(doc, DEFAULT_FACE), DEFAULT_BUILD_OPTS);
    // The authored head blob: facePrims adds its own head prims, so find ours
    // by its gloss rather than assuming an index.
    const head = built.prims.find(p => p.gloss === 0.5)!;
    expect(head).toBeDefined();
    expect(head.color![0]).toBeCloseTo(1, 6);
    expect(head.color![1]).toBeCloseTo(0.2158, 3);
    // The mirrored bar comes out as TWO primitives, both painted — the
    // mirror copies the def by spread, and `color` is just another field.
    const arms = built.prims.filter(p => p.color && p.color[0] < 0.01 && p.gloss === undefined);
    expect(arms.length).toBe(2);
    // And the flesh torso carries nothing.
    const torso = built.prims.find(p => p.limb === 'torso')!;
    expect(torso.color).toBeUndefined();
  });
});

describe('source-line provenance', () => {
  it('every compiled PrimDef carries the 1-based .blob line it came from', () => {
    const header = [
      'model test',
      '  height 1.0',
      '',
      'skeleton',
      '  root pelvis at 0.5',
      '',
      'body',
    ].join('\n');
    const src = [
      header,
      '',
      '# a comment line that must not shift the count',
      '  blob torso on pelvis at=0.5 r=0.05',
      '  blob torso on pelvis at=0.9 r=0.04',
    ].join('\n');
    const doc = parseBlob(src);
    const def = compileBlob(doc, compileFace(doc));
    // compileBlob appends facePrims (always emitted, see its doc comment),
    // and those carry no .blob line — filter them out rather than depending
    // on where they land in the array.
    expect(def.prims.map(p => p.src).filter(s => s !== undefined)).toEqual([10, 11]);
  });
});

describe('sheet decal', () => {
  const BODY = `
skeleton
  root pelvis at 1.0
  bone skull parent=pelvis dir=up len=0.1
body
  blob head on skull at=0.5 r=0.1
`;
  it('parses image + decal and keeps the projection defaults', () => {
    const doc = parseBlob(BODY + 'sheet\n  image x-face.png\n  decal 1\n  projScaleY 0.29\n');
    const s = compileSheet(doc)!;
    expect(s.decal).toBe(1);
    expect(s.projScaleY).toBe(0.29);
    expect(s.projScaleX).toBe(0.45);
    expect(compileSheetImage(doc)).toBe('x-face.png');
    // the image line is sheet trivia, so a re-emit keeps it
    expect(doc.sheetTrivia.some(l => l.words[0] === 'image')).toBe(true);
  });
  it('rejects decal 1 without an image', () => {
    expect(() => compileSheet(parseBlob(BODY + 'sheet\n  decal 1\n'))).toThrow(/image/);
  });
  it('rejects an image line with the wrong arity', () => {
    expect(() => parseBlob(BODY + 'sheet\n  image a.png b.png\n')).toThrow(/filename/);
  });
});

describe('bones block (wound pass r2)', () => {
  // Limb word is `torso`, not `leg`: expandMirror throws on a leg-limb prim
  // without the mirror word ("limb \"leg\" requires a mirrored prim"), and this
  // fixture deliberately keeps thigh unmirrored so exactly one authored bone
  // exists. The skull bone is mandatory in ANY body built through compileBlob:
  // facePrims ride it, so placePrims throws without it.
  const SKELETON = `
model test
  height 1.78
skeleton
  root pelvis at 0.92
  bone skull parent=pelvis dir=up len=0.1
  bone thigh parent=pelvis dir=down len=0.40
body
  bar torso on thigh from=0.05 to=0.95 r=0.080 blend=0.01
`;
  const build = (src: string) => buildBody(compileBlob(parseBlob(src)));
  /** Bone prims on ONE named bone — facePrims derive skull bones of their
   *  own, so total-length pins would couple these tests to the face preset. */
  const onBone = (b: ReturnType<typeof build>, bone: string) =>
    b.bonePrims.filter(p => p.bone === bone);

  it('auto-derives a bone when there is no bones block', () => {
    const b = build(SKELETON);
    expect(onBone(b, 'thigh')).toHaveLength(1);
    expect(onBone(b, 'thigh')[0]!.radius).toBeCloseTo(0.080 * DEFAULT_BONE_RATIO, 6);
  });

  it('honours an explicit ratio', () => {
    const b = build(`${SKELETON}bones\n  ratio 0.25\n`);
    expect(onBone(b, 'thigh')[0]!.radius).toBeCloseTo(0.080 * 0.25, 6);
  });

  it('ratio 0 opts a character out of bone entirely', () => {
    expect(build(`${SKELETON}bones\n  ratio 0\n`).bonePrims).toEqual([]);
  });

  it('an authored line replaces derivation for that bone only', () => {
    const b = build(`${SKELETON}bones\n  bar torso on thigh from=0.1 to=0.9 r=0.021\n`);
    expect(onBone(b, 'thigh')).toHaveLength(1);
    expect(onBone(b, 'thigh')[0]!.radius).toBeCloseTo(0.021, 6);
  });

  it('derivation still fills bones the block does not name', () => {
    const src = `\nmodel test
  height 1.78
skeleton
  root pelvis at 0.92
  bone skull parent=pelvis dir=up len=0.1
  bone spine parent=pelvis dir=up len=0.28
  bone thigh parent=pelvis dir=down len=0.40
body
  bar torso on spine from=0.1 to=0.9 r=0.090 blend=0.01
  bar torso on thigh from=0.05 to=0.95 r=0.080 blend=0.01
bones
  bar torso on thigh from=0.1 to=0.9 r=0.021
`;
    const b = build(src);
    expect(onBone(b, 'thigh')).toHaveLength(1);
    expect(onBone(b, 'thigh')[0]!.radius).toBeCloseTo(0.021, 6); // authored wins on thigh
    expect(onBone(b, 'spine')).toHaveLength(1);
    expect(onBone(b, 'spine')[0]!.radius).toBeCloseTo(0.090 * DEFAULT_BONE_RATIO, 6); // derived on spine
  });

  it('an authored line on a mirrored bone covers both sides and stops derivation', () => {
    const src = `\nmodel test
  height 1.78
skeleton
  root pelvis at 0.92
  bone skull parent=pelvis dir=up len=0.1
mirror
  bone thigh parent=pelvis dir=down len=0.40
end
body
  bar leg on thigh from=0.05 to=0.95 r=0.080 blend=0.01 mirror
bones
  bar leg on thigh from=0.1 to=0.9 r=0.021 mirror
`;
    const b = build(src);
    expect(onBone(b, 'thigh.l')).toHaveLength(1);
    expect(onBone(b, 'thigh.r')).toHaveLength(1);
    expect(onBone(b, 'thigh.l')[0]!.radius).toBe(0.021);
    expect(onBone(b, 'thigh.r')[0]!.radius).toBe(0.021);
    expect(b.prims.some(p => p.op === 'bone')).toBe(false);
  });

  it('an authored bone that breaches containment is a build ERROR, not a drop', () => {
    // 4a's contract: derivation output is containment-FILTERED (a heuristic's
    // guess), authored output is not — an author's explicit claim that pokes
    // out of the flesh is reported by validateBody instead, because silently
    // second-guessing an explicit number is how authors lose hours.
    const b = build(`${SKELETON}bones\n  bar torso on thigh from=0.1 to=0.9 r=0.5\n`);
    expect(onBone(b, 'thigh')).toHaveLength(1); // still built, still posed
    expect(b.errors.some(e => /breaches the flesh surface/.test(e))).toBe(true);
  });

  it('rejects an unknown bone name with a located error', () => {
    expect(() => build(`${SKELETON}bones\n  bar torso on femur from=0 to=1 r=0.02\n`))
      .toThrow(/unknown bone "femur"/);
  });

  it('still never puts a bone in body.prims', () => {
    const b = build(`${SKELETON}bones\n  bar torso on thigh from=0.1 to=0.9 r=0.021\n`);
    expect(b.prims.some(p => p.op === 'bone')).toBe(false);
  });

  it('keeps the authored lines for the emitter to replay', () => {
    const src = `${SKELETON}bones
  # skull dome, hand-tuned
  ratio 0.25
  bar torso on thigh from=0.1 to=0.9 r=0.021
`;
    const doc = parseBlob(src);
    expect(doc.bonesBlock).not.toBeNull();
    expect(doc.bonesBlock!.ratio).toBe(0.25);
    expect(doc.bonesBlock!.parts).toHaveLength(1);
    expect(doc.bonesTrivia.map(l => l.words[0])).toEqual(['ratio']);
  });
});
