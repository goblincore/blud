import { afterEach, describe, expect, it, vi } from 'vitest';
import { woundListKeep, woundVolumeVoxel } from './wound-volume-flag';

describe('?woundvol', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('runs only without the crater grid; there it is on unless the page turns it off, and takes a voxel size in centimetres', () => {
    // The crater grid is on by default since 2026-11-12 and keeps every wound on the list: no volume beside it.
    expect(woundVolumeVoxel('')).toBe(0);
    expect(woundVolumeVoxel('?woundvol=1')).toBe(0);
    expect(woundVolumeVoxel('?woundgrid=4&woundvol=1')).toBe(0);
    expect(woundVolumeVoxel('?woundgrid=0')).toBe(0.02);
    expect(woundVolumeVoxel('?level=arena&woundgrid=0&woundvol=0')).toBe(0);
    expect(woundVolumeVoxel('?woundgrid=0&woundvol')).toBe(0.02);
    expect(woundVolumeVoxel('?woundgrid=0&woundvol=1')).toBe(0.02);
    expect(woundVolumeVoxel('?woundgrid=0&woundvol=1.5')).toBeCloseTo(0.015, 9);
    expect(woundVolumeVoxel('?woundgrid=0&woundvol=9')).toBe(0.04);
    expect(woundVolumeVoxel('?woundgrid=0&woundvol=abc')).toBe(0.02);
    // The skeleton's volume mode owns the 3D texture.
    expect(woundVolumeVoxel('?woundgrid=0&skeleton=volume')).toBe(0);
    expect(woundVolumeVoxel('?woundgrid=0&skeleton=volume&woundvol=1')).toBe(0);
    expect(woundVolumeVoxel('?woundgrid=0&skeleton=mesh')).toBe(0.02);
  });

  it('?woundlist keeps the whole list unless a smaller count is asked for', () => {
    expect(woundListKeep('')).toBe(32);
    expect(woundListKeep('?woundlist')).toBe(32);
    expect(woundListKeep('?woundlist=8')).toBe(8);
    expect(woundListKeep('?woundlist=0')).toBe(0);
    expect(woundListKeep('?woundlist=99')).toBe(32);
    expect(woundListKeep('?woundlist=-3')).toBe(0);
    expect(woundListKeep('?woundlist=abc')).toBe(32);
  });

  it('leaves the ?woundgrid=0&woundvol=0 text without a trace of the volume', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?woundgrid=0&woundvol=0' });
    const M = await import('../march.wgsl');
    const all = [...Object.values(M).filter((v): v is string => typeof v === 'string'), ...(M.HELPERS as string[])].join('\n');
    expect(all).not.toContain('wvRead');
    expect(all).not.toContain('wvAtlas');
    expect(all).not.toContain('wvColour');
  });

  it('with the switch on: applyWounds takes the atlas and reads the boxes before its list; masks and normal follow', async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?woundgrid=0&woundvol&ngwound=0' });
    const { APPLY_WOUNDS } = await import('./fields/wounds.wgsl');
    const { MAP_BODY } = await import('./map-body.wgsl');
    const { WOUND_MASKS_BLOCK } = await import('./body/blocks/post/wound-masks.wgsl');
    const { SHADING_NORMAL_BLOCK } = await import('./body/blocks/post/shading-normal.wgsl');
    expect(APPLY_WOUNDS).toContain('band: i32, wvAtlas: texture_3d<f32>) -> vec2<f32> {');
    const iBound = APPLY_WOUNDS.indexOf('if (length(p - woundBound.xyz) > woundBound.w)');
    const iBox = APPLY_WOUNDS.indexOf('let wt = wvRead(p, data, band, e, wvAtlas, false);');
    const iList = APPLY_WOUNDS.indexOf('let listOn = gWoundListOn');
    expect(iBound).toBeGreaterThan(-1);
    expect(iBox).toBeGreaterThan(iBound);
    expect(iList).toBeGreaterThan(iBox);
    expect(APPLY_WOUNDS).toContain('fn wvRead(');
    expect(APPLY_WOUNDS).toContain('fn wvColour(');
    expect(MAP_BODY.split('woundBound, band, segVolumeAtlas)').length - 1).toBe(2);
    expect(MAP_BODY).not.toContain('woundBound, band)');
    expect(WOUND_MASKS_BLOCK).toContain('let wvc = wvColour(pS, data, gBand, segVolumeAtlas);');
    expect(SHADING_NORMAL_BLOCK).toContain('if (wvHit) { ngValid = false; }');
    expect(SHADING_NORMAL_BLOCK).toContain('!hitNearWound && !wvHit) {');
  });
});
