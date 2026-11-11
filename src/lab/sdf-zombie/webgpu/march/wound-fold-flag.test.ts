import { afterEach, describe, expect, it, vi } from 'vitest';
import { woundFoldOn } from './wound-fold-flag';

const GATE = '!walkSkip && !cheapProbe && gNormalHint != 0.0 && (nearWound > 0.5 || dmg != carved) && gWoundOwners != 0u';

describe('?woundfold', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('is on unless the page turns it off', () => {
    expect(woundFoldOn('')).toBe(true);
    expect(woundFoldOn('?level=doom-map28')).toBe(true);
    expect(woundFoldOn('?woundfold')).toBe(true);
    expect(woundFoldOn('?woundfold=1')).toBe(true);
    expect(woundFoldOn('?level=arena&woundfold=0')).toBe(false);
  });

  it('keeps the re-fold in the default text', async () => {
    vi.resetModules();
    const { MAP_BODY } = await import('./map-body.wgsl');
    expect(MAP_BODY).toContain(`  if (${GATE}`);
    expect(MAP_BODY).not.toContain('false && !walkSkip');
  });

  it('kills the re-fold block, and nothing else, with ?woundfold=0', async () => {
    vi.resetModules();
    const { MAP_BODY: on } = await import('./map-body.wgsl');
    vi.resetModules();
    vi.stubGlobal('location', { search: '?woundfold=0' });
    const { MAP_BODY: off } = await import('./map-body.wgsl');
    expect(off).toContain(`  if (false && ${GATE}`);
    expect(off.replace('  if (false && !walkSkip', '  if (!walkSkip')).toBe(on);
  });
});
