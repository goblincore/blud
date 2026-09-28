// src/lab/sdf-zombie/webgpu/march/body/blocks/light/skin-detail-proto.test.ts
import { describe, expect, it } from 'vitest';
import { SKIN_DETAIL_BY_CHARACTER, SKIN_POST, SKIN_PRE, skinDetailFor } from './skin-detail-proto';
import { COMPOSE_BLOCK } from './compose.wgsl';

describe('skin detail (owner 2026-09-28: k 2 on zombie and soldier)', () => {
  it('zombie and soldier at 2, everyone else off', () => {
    expect(SKIN_DETAIL_BY_CHARACTER).toEqual({ zombie: 2, soldier: 2 });
    expect(skinDetailFor('zombie')).toBe(2);
    expect(skinDetailFor('soldier')).toBe(2);
    expect(skinDetailFor('warbull')).toBe(0);
  });
  it('reads the per-instance lane (no URL in node) and wraps the shoulder', () => {
    expect(SKIN_PRE).toContain('let skinK = gInstMelt.z;');
    expect(SKIN_POST).toContain('fleshLit = fleshLit * pow(skinR, skinK);');
    expect(SKIN_POST).not.toContain('skinH');   // cavity is URL-only
    expect(COMPOSE_BLOCK.indexOf(SKIN_PRE)).toBeLessThan(COMPOSE_BLOCK.indexOf('let knee = clamp(1.0 - spotCfg2.y'));
    expect(COMPOSE_BLOCK.indexOf(SKIN_POST)).toBeGreaterThan(COMPOSE_BLOCK.indexOf('fleshLit = shoulder;'));
  });
});
