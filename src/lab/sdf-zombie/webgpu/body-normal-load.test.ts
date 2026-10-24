import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs is available in vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error — node:zlib is available in vitest
import { inflateSync } from 'node:zlib';
import { bodyNormalMap, decodeRegionTable } from './body-normal-load';
import { BODY_NORMAL_BLOCK } from './march/body/blocks/post/body-normal.wgsl';
import { MARCH_TRACE_POST } from './march/body/trace.wgsl';
import { characterEntry, characterNames } from '../character-registry';

const META = { yMin: 0.95, yMax: 1.9, axisX: 0, axisZ: 0.1 };

describe('bodyNormalMap', () => {
  it('takes the projection from the sidecar and the prim range from the TORSO cluster', () => {
    const m = bodyNormalMap({ strength: 0.8 }, META, {
      clusters: [{ limb: 'head', start: 0, count: 21 }, { limb: 'torso', start: 21, count: 35 }, { limb: 'armL', start: 56, count: 9 }],
    });
    expect(m).toEqual({ strength: 0.8, yMin: 0.95, yMax: 1.9, axisX: 0, axisZ: 0.1, primStart: 21, primEnd: 56 });
  });

  it('carries the placement origin of a moved body (the game\'s spawn point), and none for one at the origin', () => {
    const body = { clusters: [{ limb: 'torso', start: 0, count: 10 }] };
    expect(bodyNormalMap({ strength: 1 }, META, body, [0, 0, -10])!.origin).toEqual([0, 0, -10]);
    expect(bodyNormalMap({ strength: 1 }, META, body)!.origin).toBeUndefined();
  });

  it('is off for a body with no torso (a severed piece)', () => {
    expect(bodyNormalMap({ strength: 1 }, META, { clusters: [{ limb: 'armL', start: 0, count: 9 }] })).toBeNull();
  });
});

describe('BODY_NORMAL_BLOCK', () => {
  it('runs after the body grain and before the gore, so its masks exist and paint still wins', () => {
    const grain = MARCH_TRACE_POST.indexOf('BODY GRAIN (body-grain.ts)');
    const nmap = MARCH_TRACE_POST.indexOf('BODY NORMAL MAP (body-normal.wgsl.ts)');
    expect(grain).toBeGreaterThan(-1);
    expect(nmap).toBeGreaterThan(grain);
    expect(MARCH_TRACE_POST.indexOf('GORE', nmap)).toBeGreaterThan(nmap);
  });

  it('is gated on strength and the header, picks region 0 only for torso hits, and prefixes every local with nmap', () => {
    expect(BODY_NORMAL_BLOCK).toContain('if (nmapStr > 0.0) {');
    expect(BODY_NORMAL_BLOCK).toContain('round(nmapHdr.x) == 66.0 && round(nmapHdr.y) == 78.0');
    expect(BODY_NORMAL_BLOCK).toContain('let nmapTorso = hitBest >= i32(bodyNormAxis.z) && hitBest < i32(bodyNormAxis.w);');
    expect(BODY_NORMAL_BLOCK).toContain('if ((nmapKind < 0.5) != nmapTorso) { continue; }');
    // A placed body's rest points are moved by its spawn point (translateBody), the regions are baked round the
    // origin: the block tests the regions against the rest point minus bodyNormCfg.yzw, never against it raw.
    expect(BODY_NORMAL_BLOCK).toContain('let nmapAnc = anchor - bodyNormCfg.yzw;');
    expect(BODY_NORMAL_BLOCK).not.toMatch(/dot\(anchor - nmapHd|= anchor - \(nmapHd/);
    const locals = [...BODY_NORMAL_BLOCK.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g)].map(m => m[1]!);
    expect(locals.length).toBeGreaterThan(0);
    expect(locals.every(n => n.startsWith('nmap'))).toBe(true);
  });
});

describe('registry body normal maps', () => {
  it('every declared map has a sidecar beside its PNG and a positive strength', () => {
    for (const name of characterNames()) {
      const bn = characterEntry(name).bodyNormal;
      if (!bn) continue;
      expect(bn.url.endsWith('.png')).toBe(true);
      expect(bn.meta).toBe(bn.url.replace(/\.png$/, '.json'));
      expect(bn.strength).toBeGreaterThan(0);
    }
  });
});

describe('the baked atlas header', () => {
  // The twinhead's map: the PNG's header row must decode to the regions its sidecar lists (the bake writes both;
  // the shader reads only the PNG). scripts/lib/png-write.mjs writes filter 0 on every row, so inflating the IDAT
  // stream and skipping each row's filter byte is the whole decode.
  it('decodes to the sidecar regions, torso first, bands stacked under the header row', () => {
    const png = readFileSync(new URL('../../../../public/assets/lab/twinhead-body-n.png', import.meta.url)) as Uint8Array & { readUInt32BE(o: number): number; toString(e: string, a: number, b: number): string; subarray(a: number, b?: number): Uint8Array };
    const meta = JSON.parse(readFileSync(new URL('../../../../public/assets/lab/twinhead-body-n.json', import.meta.url), 'utf8'));
    const width = png.readUInt32BE(16);
    const idat: Uint8Array[] = [];
    for (let o = 8; o < png.length;) {
      const len = png.readUInt32BE(o), type = png.toString('ascii', o + 4, o + 8);
      if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
      o += 12 + len;
    }
    const all = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
    idat.reduce((o, c) => (all.set(c, o), o + c.length), 0);
    const raw: Uint8Array = inflateSync(all);
    expect(raw[0]).toBe(0);
    const regions = decodeRegionTable(new Uint8Array(raw.subarray(1, 1 + width * 4)))!;
    expect(regions).not.toBeNull();
    expect(regions.map(r => r.kind)).toEqual(meta.regions.map((r: { kind: string }) => r.kind));
    expect(regions[0]!.kind).toBe('torso');
    expect(regions[0]!.row0).toBe(1);
    regions.forEach((r, i) => {
      const m = meta.regions[i];
      for (let k = 0; k < 3; k++) {
        expect(r.head[k]).toBeCloseTo(m.head[k], 3);
        expect(r.tail[k]).toBeCloseTo(m.tail[k], 3);
      }
      expect(r.rMax).toBeCloseTo(m.rMax, 3);
      expect(r.row0).toBe(m.row0);
      expect(r.rows).toBe(m.rows);
      if (i > 0) expect(r.row0).toBe(regions[i - 1]!.row0 + regions[i - 1]!.rows);
    });
  });

  it('is not a table on a version-1 or blank map', () => {
    expect(decodeRegionTable(new Uint8Array([128, 128, 255, 255]))).toBeNull();
  });
});
