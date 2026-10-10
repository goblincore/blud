// src/lab/sdf-zombie/webgpu/dynamite-panel.test.ts
//
// The panel's anti-drift contract, which is the whole reason its key table
// exists: sliders, the page's setter and the COPY text must agree on the key
// names. A panel that emits a key the setter ignores has shipped twice in this
// project (the beam panel's setBeam keys, and goo before it), and both times
// the symptom was a tuning that LOOKED applied and was not.
//
// The setter used to live in main()'s closure, where only a text pin could
// reach it; since the 2026-09-17 extraction (game-dynamite-tuning.ts) both
// halves are exported functions over a GameContext, so the pin is behavioural:
// every key is applied to a context and must read back moved — and alone.
import { describe, it, expect } from 'vitest';
import {
  DYNAMITE_KEYS, GIB_BONES, GIB_MODES, copyText, defaultsFrom,
  type DynamiteTuningKey, type DynamiteTuningValues,
} from './dynamite-panel';
import { applyDynamiteTuning, dynamiteTuningValues } from './game-dynamite-tuning';
import { makeGameContext, type GameContext } from './game-context';
import {
  EXPLOSION_VFX_TUNING, type ExplosionVfx, type ExplosionVfxTuning,
} from './explosion-vfx';
import type { PostAa } from './post-aa';

// One non-default, in-range value per key — in range per the table's own
// min/max, and different from whatever the context starts at, so the only way
// the round-trip below passes is the setter really writing the field the
// read-back reads. A key without a row fails the round-trip, so adding a
// slider forces adding its row here.
const NON_DEFAULT: Record<DynamiteTuningKey, number> = {
  // ——— the gib
  maxchunks: 24, mode: 0, bones: 2, stagger: 6, tearSec: 0.35, tearAmp: 0.08,
  tearJiggle: 0.6, gibvel: 1.2,
  // ——— settled-piece detail
  chunkdetail: 0.55, chunkdetailfreq: 11, chunkdetailalbedo: 1.1, chunkbake: 0,
  // ——— the blast
  aoesize: 1.2, edgekick: 0.8, blastdistort: 0, bdstrength: 1.5,
  // ——— the burst
  fxsize: 1.4, fxsmoke: 0.4, fxlife: 2.4, fxgain: 1.7, plume: 0.85,
  capflat: 0.6, neck: 2.5, cap: 3.2, ringreach: 4.5, ringopacity: 0.55,
  emberspeed: 9.5,
  // ——— the room light
  fxlight: 2.5, fxspread: 2.2,
};

/**
 * A context with the three boot-time handles the setter touches faked and
 * every plain slice real: the post-AA pass is a field-mirroring stub seeded
 * to the SHIPPED optical-wave state (the panel ships it ON, strength 2.7),
 * the burst module is a `setTuning`-merges-into-`tuning` fake over the
 * module's own defaults (the same object createExplosionVfx builds), and the
 * tear shape is zeroed (the setter writes only amplitudeM/jiggleAmp, and
 * `world.actors` is empty so the per-actor push iterates nothing). The
 * gib/bake/lighting slices and the vfx scalars come from the real state
 * factories — the setter stores plain numbers into those.
 */
function makeTuningCtx(): GameContext {
  const ctx = makeGameContext();
  const postAa = {
    blastDistort: true,
    blastDistortStrength: 2.7,
    setBlastDistort(on: boolean) { postAa.blastDistort = on; },
    setBlastDistortStrength(v: number) { postAa.blastDistortStrength = v; },
  };
  ctx.render.postAa = postAa as unknown as PostAa;
  // Settle bake ships ON (the panel's chunkbake 1); the bake factory seeds
  // false, so flip it or `chunkbake: 0` could not move the read-back.
  ctx.bake.enabled = true;
  const tuning: ExplosionVfxTuning = { ...EXPLOSION_VFX_TUNING };
  ctx.vfx.explosionVfx = {
    tuning,
    setTuning(patch: Partial<ExplosionVfxTuning>) { Object.assign(tuning, patch); },
  } as unknown as ExplosionVfx;
  // The page's tear shape is a private interface; only the two fields the
  // setter writes are named, nothing reads the rest on this path.
  ctx.vfx.tearShape = {
    amplitudeM: 0, jiggleAmp: 0, seamM: 0, boneLag: 0, headDamp: 0,
    sloughOutM: 0, sloughSagM: 0, sloughStretchM: 0, headFollow: 0,
    neckGapM: 0, recoilM: 0,
  } as unknown as GameContext['vfx']['tearShape'];
  return ctx;
}

describe('dynamite panel key table', () => {
  it('every key round-trips: applying it moves its own read-back and no other key', () => {
    for (const k of DYNAMITE_KEYS) {
      const v = NON_DEFAULT[k.key as DynamiteTuningKey];
      const ctx = makeTuningCtx();
      const before = dynamiteTuningValues(ctx);
      expect(before[k.key as DynamiteTuningKey], `"${k.key}" starts at the value under test`).not.toBe(v);
      applyDynamiteTuning(ctx, { [k.key]: v } as Partial<DynamiteTuningValues>);
      const after = dynamiteTuningValues(ctx);
      expect(after[k.key as DynamiteTuningKey], `"${k.key}" did not read back ${v}`).toBe(v);
      // `plume` deliberately writes the coupled cap fields too, mirroring the
      // page's boot wiring; its `capflat` coupling has its own assertion below.
      for (const other of Object.keys(after)) {
        if (other === k.key || (k.key === 'plume' && other === 'capflat')) continue;
        expect(after[other as DynamiteTuningKey], `applying "${k.key}" also moved "${other}"`)
          .toBe(before[other as DynamiteTuningKey]);
      }
    }
  });

  it('the plume slider drives the coupled cap fields, like the boot wiring it mirrors', () => {
    const ctx = makeTuningCtx();
    applyDynamiteTuning(ctx, { plume: 0.85 });
    const v = dynamiteTuningValues(ctx);
    expect(v.plume).toBe(0.85);
    expect(v.capflat).toBeCloseTo(1 - (1 - 0.55) * 0.85, 6);
  });

  it('the read-back reports every key as a finite number', () => {
    const v = dynamiteTuningValues(makeTuningCtx());
    for (const k of DYNAMITE_KEYS) {
      expect(v).toHaveProperty(k.key);
      expect(Number.isFinite(v[k.key as DynamiteTuningKey]),
        `read-back of "${k.key}" is not a finite number`).toBe(true);
    }
  });

  it('the COPY text names every key, so a tuning pass cannot lose one', () => {
    const text = copyText(defaultsFrom() as unknown as Record<string, number>);
    for (const k of DYNAMITE_KEYS) expect(text).toContain(`${k.key}:`);
    // ...and it is a runnable seam call.
    expect(text.startsWith('__sdfGame.setDynamiteTuning({')).toBe(true);
  });

  it('defaults are the page\u2019s shipped behaviour, not the panel\u2019s taste', () => {
    const d = defaultsFrom();
    // These four are asserted against game-main's boot defaults in the gate
    // (which reads them live); here they are pinned to the values this session
    // shipped so a slider default cannot drift from the committed behaviour.
    expect(d.mode).toBe(2);            // 'parts'
    expect(d.bones).toBe(1);           // 'core'
    expect(d.tearSec).toBeCloseTo(0.2, 6);
    expect(d.plume).toBe(0.1);
    expect(d).toMatchObject({
      tearAmp: 0.045, tearJiggle: 0.35, chunkbake: 1, aoesize: 0.82,
      blastdistort: 1, bdstrength: 2.7, fxsmoke: 0.76, fxlife: 1.55,
      fxgain: 3.3, capflat: 0.955,
    });
    expect(GIB_MODES[d.mode]).toBe('parts');
    expect(GIB_BONES[d.bones]).toBe('core');
  });
});
