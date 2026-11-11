import { afterEach, describe, expect, it, vi } from 'vitest';
import { woundFoldOn } from './wound-fold-flag';

const GATE = '!walkSkip && !cheapProbe && gNormalHint != 0.0 && (nearWound > 0.5 || dmg != carved) && gWoundOwners != 0u';

describe('?woundfold', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('is off unless the page turns it on', () => {
    expect(woundFoldOn('')).toBe(false);
    expect(woundFoldOn('?level=doom-map28')).toBe(false);
    expect(woundFoldOn('?level=arena&woundfold=0')).toBe(false);
    expect(woundFoldOn('?woundfold')).toBe(true);
    expect(woundFoldOn('?woundfold=1')).toBe(true);
  });

  it('leaves the re-fold dead in the default text', async () => {
    vi.resetModules();
    const { MAP_BODY } = await import('./map-body.wgsl');
    expect(MAP_BODY).toContain(`  if (false && ${GATE}`);
  });

  it('brings the re-fold back, and changes nothing else, with ?woundfold=1', async () => {
    vi.resetModules();
    const { MAP_BODY: off } = await import('./map-body.wgsl');
    vi.resetModules();
    vi.stubGlobal('location', { search: '?woundfold=1' });
    const { MAP_BODY: on } = await import('./map-body.wgsl');
    expect(on).toContain(`  if (${GATE}`);
    expect(on).not.toContain('false && !walkSkip');
    expect(off.replace('  if (false && !walkSkip', '  if (!walkSkip')).toBe(on);
  });
});
