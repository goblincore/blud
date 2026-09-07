import { describe, expect, it } from 'vitest';
import { PRESETS, sampleAnalytic, createPresetLibrary, sampleCached, createRegionState, hitRegion, advanceRegion } from './presets';

describe('shared bounded wound experiment', () => {
  it('keeps two shared damaged fields regardless of instance count or hit count', () => {
    const library = createPresetLibrary(16);
    const bytes = library.byteLength;
    const states = Array.from({length: 100}, () => createRegionState());
    for (const state of states) for (let i=0;i<100;i++) { hitRegion(state,i*200); advanceRegion(state,i*200+160); }
    expect(states.every(s => s.current===2 && s.target===2)).toBe(true);
    expect(library.byteLength).toBe(bytes);
    expect(bytes).toBe(2*16**3*4);
    expect(PRESETS.every(p=>p.length===2)).toBe(true);
    expect(states.every(s=>Object.values(s).every(v=>typeof v==='number'))).toBe(true);
  });

  it('queues a heavier hit without jumping the active blend or adding a third endpoint', () => {
    const s=createRegionState(); hitRegion(s,0);
    const before=advanceRegion(s,80); hitRegion(s,80);
    expect(advanceRegion(s,80)).toEqual(before);
    expect(s.queued).toBe(2);
    expect(advanceRegion(s,160)).toEqual({from:1,to:2,blend:0});
    expect(advanceRegion(s,320)).toEqual({from:2,to:2,blend:1});
  });

  it('catches up both transitions across a long frame without prolonging playback', () => {
    const s=createRegionState();hitRegion(s,0);hitRegion(s,20);
    expect(advanceRegion(s,500)).toEqual({from:2,to:2,blend:1});
  });

  it('has no removed volume in intact and enlarges the same cavity by severity', () => {
    for(let i=0;i<100;i++) {
      const p:[number,number,number]=[Math.sin(i)*.15,Math.cos(i*2)*.15,Math.sin(i*3)*.15];
      const a=sampleAnalytic(0,p),b=sampleAnalytic(1,p),c=sampleAnalytic(2,p);
      expect(a.value).toBeGreaterThanOrEqual(0);
      expect(b.value).toBeLessThanOrEqual(a.value);
      expect(c.value).toBeLessThanOrEqual(b.value);
    }
  });

  it('returns the derivative of the interpolated field using the same corners', () => {
    const lib=createPresetLibrary(24);
    for(const id of [1,2] as const)for(let i=0;i<60;i++) {
      const p:[number,number,number]=[Math.sin(i)*.13,Math.cos(i*2)*.13,Math.sin(i*3)*.13];
      const s=sampleCached(lib,id,p),analytic=sampleAnalytic(id,p);
      expect(Math.abs(s.value-analytic.value)).toBeLessThanOrEqual(lib.errorBound);
      for(let axis=0;axis<3;axis++) {
        const a=[...p] as [number,number,number],b=[...p] as [number,number,number];a[axis]=a[axis]!+1e-6;b[axis]=b[axis]!-1e-6;
        const derivative=(sampleCached(lib,id,a).value-sampleCached(lib,id,b).value)/2e-6;
        expect(s.gradient[axis]).toBeCloseTo(derivative,6);
      }
      expect(Math.hypot(...s.gradient)).toBeLessThanOrEqual(lib.lipschitz+1e-5);
    }
  });

  it('extends outside the atlas without clamped-edge phantom cavities', () => {
    const lib=createPresetLibrary(16);
    for(const id of [1,2] as const)for(const p of [[1,0,0],[0,-1,0],[0,0,1]] as [number,number,number][]) {
      const s=sampleCached(lib,id,p);
      expect(s.value).toBeGreaterThan(0);
      expect(s.gradient.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...s.gradient)).toBeLessThanOrEqual(lib.lipschitz);
    }
  });
});
