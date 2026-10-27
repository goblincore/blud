// SHROUD (cultist hood, 2026-10-27; PrimDef.shroud): a hood's inside goes dark. The parse gates, the pack lanes the
// shader reads, and the hood dropping (death-state) taking the shroud with it.
import { describe, expect, it } from 'vitest';
import cultistSrc from './characters/cultist.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { applyDeathState } from './death-state';
import { packBody, PRIM_STRIDE } from './pack';
import { BlobError } from './blob-ast';
import { COMPOSE_BLOCK } from './webgpu/march/body/blocks/light/compose.wgsl';

const build = (src: string) => { const d = parseBlob(src); return buildBody(compileBlob(d, compileFace(d))); };
const hoodLine = cultistSrc.split('\n').find(l => !l.trim().startsWith('#') && l.includes('shroud='))!;

describe('shroud= on the cultist hood', () => {
  it('only on a ball shell, 0..1', () => {
    expect(hoodLine).toMatch(/^\s*shell head on skull /);
    expect(() => parseBlob(cultistSrc.replace(hoodLine, hoodLine.replace(/shroud=[\d.]+/, 'shroud=1.5')))).toThrow(BlobError);
    expect(() => parseBlob(cultistSrc.replace(hoodLine, hoodLine.replace(' r=', ' tip=(0,0.1,0) r=')))).toThrow(BlobError);
    expect(() => parseBlob(cultistSrc.replace(hoodLine, hoodLine.replace(/^(\s*)shell /, '$1blob ')))).toThrow(BlobError);
  });

  it('every flesh prim points at the hood: x = -(index + 1), y = strength', () => {
    const b = build(cultistSrc);
    const h = b.prims.findIndex(p => (p.shroud ?? 0) > 0);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(b.prims[h]!.shell).toBeDefined();
    const { primStrand } = packBody(b);
    b.prims.forEach((p, i) => {
      if (p.strand !== undefined) return;
      expect(primStrand[i * PRIM_STRIDE]).toBe(-(h + 1));
      expect(primStrand[i * PRIM_STRIDE + 1]).toBeCloseTo(b.prims[h]!.shroud!, 6);
    });
  });

  it('the dropped hood takes its shadow with it', () => {
    const { primStrand } = packBody(applyDeathState(build(cultistSrc)));
    expect(primStrand.every(v => v === 0)).toBe(true);
  });

  it('the shader reads the lanes on hit pixels only, after the flat face, and leaves glow out of it', () => {
    const at = COMPOSE_BLOCK.indexOf('if (SR.x < -0.5)');
    expect(at).toBeGreaterThan(COMPOSE_BLOCK.indexOf('faceFlat * 0.85'));
    expect(COMPOSE_BLOCK).toContain('fleshLit = fleshLit * (1.0 - shroud);');
    expect(COMPOSE_BLOCK.slice(at)).not.toContain('glow');
  });
});
