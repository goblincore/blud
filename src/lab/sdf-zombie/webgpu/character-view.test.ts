// src/lab/sdf-zombie/webgpu/character-view.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildCharacterBody, compileCharacterSheet, createWoundRing } from './character-view';
import { characterEntry, characterNames } from '../character-registry';
import { severLimb } from '../sever';
import type { Wound } from '../damage';

// The GPU half needs a device and is covered by the capture gate instead.
// These cover the pure half: building and sheet compilation, which is where
// the bugs have actually been.

describe('buildCharacterBody', () => {
  it('keeps wound event identities through aging and advances past imported ids', () => {
    const ring=createWoundRing();
    const imported:Wound={primIdx:0,local:[0,0,0],radius:.055,type:'pellet',ageSec:0,eventId:41};
    ring.set([imported]);
    ring.set(ring.all().map(w=>({...w,ageSec:1})));
    const fresh=ring.stamp({primIdx:0,local:[.1,0,0],radius:.055,type:'pellet',ageSec:0},buildCharacterBody(characterEntry('soldier'),[0,0,0],[]),0);
    expect(ring.all()[0]!.eventId).toBe(41);
    expect(fresh.eventId).toBe(42);
  });
  it('keeps wound ownership aligned when bounded visual rows reorder and collapse history', () => {
    const body = buildCharacterBody(characterEntry('soldier'), [0,0,0], []);
    const arm = body.prims.findIndex(p => p.bone === 'upperarm.l');
    const torso = body.prims.findIndex(p => p.limb === 'torso' && p.op === 'add');
    const wound = (primIdx: number): Wound => ({ primIdx, local:[0,0,0], radius:.13, type:'blast', ageSec:0 });
    const ring = createWoundRing();
    ring.set([wound(torso), wound(torso), wound(arm)]);
    const visual = [wound(arm), { ...wound(torso), presetCut: true as const }];
    const setWounds = vi.fn();
    ring.refresh({ setWounds } as any, body, 0, visual);
    expect(setWounds.mock.calls[0]![7]).toEqual(visual.map(w => {
      const cluster = body.prims[w.primIdx]!.cluster;
      const c = body.clusters[cluster]!;
      return { cluster, start:c.start, count:c.count };
    }));
    expect(setWounds.mock.calls[0]![2]).toEqual([1, -1]);
  });

  it('uploads the shoulder wound with arm ownership rather than a whole-body carve', () => {
    const body = buildCharacterBody(characterEntry('soldier'), [0,0,0], []);
    const primIdx = body.prims.findIndex(p => p.bone === 'upperarm.l');
    const ring = createWoundRing();
    ring.set([{ primIdx, local:[0,0,0], radius:.13, type:'blast', ageSec:0 }]);
    const setWounds = vi.fn();
    ring.refresh({ setWounds } as any, body, 0);
    const owners = setWounds.mock.calls[0]![7];
    const cluster = body.prims[primIdx]!.cluster;
    expect(body.clusters[cluster]!.limb).toBe('armL');
    expect(owners).toEqual([{ cluster, start:body.clusters[cluster]!.start, count:body.clusters[cluster]!.count }]);
  });

  it('retains anatomical wound ownership after its arm cluster is severed', () => {
    const body = buildCharacterBody(characterEntry('soldier'), [0,0,0], []);
    const primIdx = body.prims.findIndex(p => p.bone === 'upperarm.l');
    const ring = createWoundRing();
    ring.set([{ primIdx, local:[0,0,0], radius:.13, type:'blast', ageSec:0 }]);
    const severed = severLimb(body, 'armL').body;
    const cluster = body.prims[primIdx]!.cluster;
    expect(severed.clusters[cluster]!.alive).toBe(false);
    const setWounds = vi.fn();
    ring.refresh({ setWounds } as any, severed, 0);
    expect(setWounds.mock.calls[0]![7]).toEqual([
      { cluster, start:body.clusters[cluster]!.start, count:body.clusters[cluster]!.count },
    ]);
  });

  it('builds every registered character without errors', () => {
    for (const name of characterNames()) {
      const errs: string[] = [];
      const body = buildCharacterBody(characterEntry(name), [0, 0, 0], errs);
      expect(errs, `${name}: ${errs.join(' | ')}`).toEqual([]);
      expect(body.prims.length).toBeGreaterThan(0);
    }
  });

  it('places the body at the requested start', () => {
    const errs: string[] = [];
    const a = buildCharacterBody(characterEntry('zombie'), [0, 0, 0], errs);
    const b = buildCharacterBody(characterEntry('zombie'), [5, 0, 3], errs);
    expect(b.prims[0]!.a[0] - a.prims[0]!.a[0]).toBeCloseTo(5, 6);
    expect(b.prims[0]!.a[2] - a.prims[0]!.a[2]).toBeCloseTo(3, 6);
  });
});

describe('compileCharacterSheet', () => {
  it('opts only the soldier into red-pixel emission while retaining Replace', () => {
    for (const name of characterNames()) {
      const { sheet, error } = compileCharacterSheet(characterEntry(name));
      expect(error).toBeNull();
      if (name === 'soldier') {
        expect(sheet).toMatchObject({ decal: 1, eyeGlowRedOnly: 1 });
        expect(sheet!.eyeGlowAmp).toBeGreaterThan(0);
      } else if (sheet) {
        expect(sheet.eyeGlowRedOnly).toBe(0);
      }
    }
  });

  it('returns the blob own sheet when it declares one', () => {
    // The soldier has an owner-tuned bake; the zombie has no sheet block.
    expect(compileCharacterSheet(characterEntry('soldier')).sheet).not.toBeNull();
    expect(compileCharacterSheet(characterEntry('zombie')).sheet).toBeNull();
  });

  it('a bad sheet block is REPORTED, not thrown', () => {
    // compileSheet raises BlobError on an unknown key. One bad key cost an
    // hour on 2026-09-04 and silently swapped the soldier's face for the
    // zombie's. The catch must report loudly and fall back, not crash.
    // (The skeleton/root lines are the minimum parseable document: parseBlob
    // rejects a lone sheet block with `no "root" bone declared` before
    // compileSheet ever sees the key — plan defect, fixed here rather than
    // skipped.)
    const broken = {
      ...characterEntry('soldier'),
      src: 'skeleton\n  root pelvis at 0.9\nsheet\n  notAKey 1\n',
    };
    const r = compileCharacterSheet(broken);
    expect(r.sheet).toBeNull();
    expect(r.error).toMatch(/sheet/i);
  });

  it('every character with no sheet block falls back to the zombie flat', () => {
    const r = compileCharacterSheet(characterEntry('zombie'));
    expect(r.sheet).toBeNull();
    expect(r.face.url).toContain('zombie-face');
  });
});
