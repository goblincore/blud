import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FLESH_PRESETS } from '../material';
import { dressKitFlesh, kitFleshAttributes, KIT_FLESH_MATERIALS } from './kit-flesh';

const flesh = FLESH_PRESETS['henenlotter-latex'];

describe('kitFleshAttributes', () => {
  const pos = new Float32Array([0, 0, 0, 0.1, 0.2, 0.3, -0.05, 1.2, 0.07]);
  const a = kitFleshAttributes(pos, flesh);

  it('writes four lanes per vertex for each attribute, as chunk-bake-geometry does', () => {
    expect(a.bakeColor.length).toBe(12);
    expect(a.bakeAnchor.length).toBe(12);
    expect(a.bakeResponse.length).toBe(12);
  });
  it('is intact skin: the wound mask lane is 0 and the colour stays between the palette base and its mottle', () => {
    for (let i = 0; i < 3; i++) {
      expect(a.bakeColor[i * 4 + 3]).toBe(0);
      for (let c = 0; c < 3; c++) {
        const lo = Math.min(flesh.baseColor[c]!, flesh.mottleColor[c]!) - 1e-6;
        const hi = Math.max(flesh.baseColor[c]!, flesh.mottleColor[c]!) + 1e-6;
        expect(a.bakeColor[i * 4 + c]).toBeGreaterThanOrEqual(lo);
        expect(a.bakeColor[i * 4 + c]).toBeLessThanOrEqual(hi);
      }
    }
  });
  it('anchors the detail at the bind-space point and carries the flesh response', () => {
    expect([...a.bakeAnchor.slice(4, 7)].map(v => +v.toFixed(5))).toEqual([0.1, 0.2, 0.3]);
    expect(a.bakeAnchor[7]).toBeCloseTo(flesh.silhouetteNoiseAmp, 6);
    expect(a.bakeResponse[1]).toBeCloseTo(flesh.wetness, 6);          // no gore on skin: wetness unboosted
    expect(a.bakeResponse[3]).toBeCloseTo(flesh.specIntensity, 6);
  });
});

describe('dressKitFlesh', () => {
  it('swaps only the flesh parts and adds the chunk attributes to them', () => {
    const geo = () => new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const named = (n: string) => { const m = new THREE.MeshStandardMaterial(); m.name = n; return m; };
    const root = new THREE.Group();
    const skin = new THREE.Mesh(geo(), named('goblinskin'));
    const claw = new THREE.Mesh(geo(), named('goblinclaw'));
    root.add(skin, claw);
    const lit = new THREE.MeshBasicMaterial();
    const dressed = dressKitFlesh(root, lit, flesh);
    expect(dressed).toEqual([skin]);
    expect(skin.material).toBe(lit);
    expect(skin.geometry.getAttribute('bakeColor').itemSize).toBe(4);
    expect(claw.material).not.toBe(lit);
    expect(claw.geometry.getAttribute('bakeColor')).toBeUndefined();
  });
  it('knows the goblin and zombie skins', () => {
    expect(KIT_FLESH_MATERIALS.has('goblinskin')).toBe(true);
    expect(KIT_FLESH_MATERIALS.has('zombieskin')).toBe(true);
  });
});
