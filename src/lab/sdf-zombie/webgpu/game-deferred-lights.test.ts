// src/lab/sdf-zombie/webgpu/game-deferred-lights.test.ts
//
// The shared game light list (M2 task 3): deterministic flashlight/muzzle
// priority, world-space conversion of parented lights, the 16-slot cap with
// stable distance/ID ordering, and repeatability. Pure CPU — the builder is
// data-only by contract.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  buildGameDeferredLights, DEFERRED_LIGHT_DEFAULT_RANGE, DEFERRED_INTENSITY_SCALE,
  type GameLightCandidate,
} from './game-deferred-lights';

const ORIGIN = new THREE.Vector3(0, 0, 0);

function point(id: string, x: number, y: number, z: number, intensity = 2): GameLightCandidate {
  const light = new THREE.PointLight(0xffffff, intensity, 8, 2);
  light.position.set(x, y, z);
  return { id, role: 'practical', light };
}

describe('flashlight and muzzle priority', () => {
  it('puts the flashlight first: ids[0] === "flashlight", flashlightIndex 0', () => {
    const flash = new THREE.SpotLight(0xffffff, 90, 16, Math.PI * 0.12, 0.45, 1.6);
    const candidates: GameLightCandidate[] = [
      point('p1', 1, 0, 0),
      { id: 'flashlight', role: 'flashlight', light: flash },
      point('p2', 2, 0, 0),
    ];
    const result = buildGameDeferredLights(candidates, ORIGIN);
    expect(result.ids[0]).toBe('flashlight');
    expect(result.flashlightIndex).toBe(0);
    expect(result.lights.length).toBe(3);
    expect(result.dropped).toEqual([]);
  });

  it('reports flashlightIndex -1 and keeps practicals when no flashlight is present', () => {
    const result = buildGameDeferredLights([point('p1', 1, 0, 0)], ORIGIN);
    expect(result.flashlightIndex).toBe(-1);
    expect(result.ids).toEqual(['p1']);
  });

  it('omits an inactive muzzle (intensity 0) and reports it in dropped', () => {
    const muzzle = new THREE.PointLight(0xffcf95, 0, 16, 1.7); // the game's allocated-but-dark flash
    const flash = new THREE.SpotLight(0xffffff, 90, 16, Math.PI * 0.12, 0.45, 1.6);
    const result = buildGameDeferredLights(
      [
        { id: 'flashlight', role: 'flashlight', light: flash },
        { id: 'muzzle', role: 'muzzle', light: muzzle },
        point('p1', 1, 0, 0),
      ],
      ORIGIN,
    );
    expect(result.ids).toEqual(['flashlight', 'p1']);
    expect(result.dropped).toContain('muzzle');
  });

  it('includes an active muzzle right after the flashlight', () => {
    const muzzle = new THREE.PointLight(0xffcf95, 3, 16, 1.7);
    const flash = new THREE.SpotLight(0xffffff, 90, 16, Math.PI * 0.12, 0.45, 1.6);
    const result = buildGameDeferredLights(
      [
        point('p1', 1, 0, 0),
        { id: 'muzzle', role: 'muzzle', light: muzzle },
        { id: 'flashlight', role: 'flashlight', light: flash },
      ],
      ORIGIN,
    );
    expect(result.ids.slice(0, 2)).toEqual(['flashlight', 'muzzle']);
  });

  it('omits invisible lights regardless of role', () => {
    const flash = new THREE.SpotLight(0xffffff, 90, 16, Math.PI * 0.12, 0.45, 1.6);
    flash.visible = false; // the gallery rig hides the dungeon flashlight
    const result = buildGameDeferredLights(
      [{ id: 'flashlight', role: 'flashlight', light: flash }, point('p1', 1, 0, 0)],
      ORIGIN,
    );
    expect(result.ids).toEqual(['p1']);
    expect(result.flashlightIndex).toBe(-1);
    expect(result.dropped).toContain('flashlight');
  });
});

describe('world transforms', () => {
  it('converts a parented muzzle to its WORLD position', () => {
    const rig = new THREE.Group();
    rig.position.set(1, 2, 3);
    const muzzle = new THREE.PointLight(0xffcf95, 3, 16, 1.7);
    muzzle.position.set(0.5, 0, 0);
    rig.add(muzzle);
    const result = buildGameDeferredLights(
      [{ id: 'muzzle', role: 'muzzle', light: muzzle }],
      ORIGIN,
    );
    expect(result.lights[0]!.position).toEqual([1.5, 2, 3]);
  });

  it('takes a spot direction from its live target orientation, normalised', () => {
    const flash = new THREE.SpotLight(0xffffff, 90, 16, Math.PI * 0.12, 0.45, 1.6);
    flash.position.set(0.25, -0.15, 0.1);
    flash.target.position.set(0.25, -0.15, -9.9);
    const result = buildGameDeferredLights(
      [{ id: 'flashlight', role: 'flashlight', light: flash }],
      ORIGIN,
    );
    const d = result.lights[0]!.direction;
    const len = Math.hypot(d[0], d[1], d[2]);
    expect(len).toBeCloseTo(1, 6);
    // Points from the light TOWARD the target: -z here.
    expect(d[2]).toBeLessThan(-0.99);
    expect(result.lights[0]!.kind).toBe('spot');
  });

  it('maps the spot cone through penumbra exactly like three: inner = angle*(1-penumbra)', () => {
    const flash = new THREE.SpotLight(0xffffff, 90, 16, 0.4, 0.25, 1.6);
    const result = buildGameDeferredLights(
      [{ id: 'flashlight', role: 'flashlight', light: flash }],
      ORIGIN,
    );
    const l = result.lights[0]!;
    expect(l.cosOuter).toBeCloseTo(Math.cos(0.4), 6);
    expect(l.cosInner).toBeCloseTo(Math.cos(0.4 * (1 - 0.25)), 6);
    expect(l.cosInner).toBeGreaterThan(l.cosOuter);
  });
});

describe('the 16-slot cap and deterministic selection', () => {
  const flash = () => new THREE.SpotLight(0xffffff, 90, 16, Math.PI * 0.12, 0.45, 1.6);

  it('caps the set at 16 and drops the farthest practicals', () => {
    const candidates: GameLightCandidate[] = [{ id: 'flashlight', role: 'flashlight', light: flash() }];
    for (let i = 0; i < 30; i++) {
      candidates.push(point(`fire-${String(i).padStart(2, '0')}`, i * 3, 0, 0)); // distances grow
    }
    const result = buildGameDeferredLights(candidates, ORIGIN);
    expect(result.lights.length).toBeLessThanOrEqual(16);
    expect(result.ids.length).toBeLessThanOrEqual(16);
    // Selected practicals are the NEAREST ones (ids fire-00..fire-14).
    expect(result.ids).toContain('fire-00');
    expect(result.ids).toContain('fire-14');
    expect(result.ids).not.toContain('fire-15');
    // Every dropped id is accounted for, and nothing is selected twice.
    expect(result.dropped).toContain('fire-15');
    expect(new Set([...result.ids, ...result.dropped]).size).toBe(31);
  });

  it('breaks distance ties by ID, lexicographically, stably', () => {
    const candidates: GameLightCandidate[] = [
      point('b', 0, 5, 0),
      point('a', 0, -5, 0), // same |distance| to the origin, opposite side
      point('c', 5, 0, 0),
    ];
    const result = buildGameDeferredLights(candidates, ORIGIN);
    expect(result.ids).toEqual(['a', 'b', 'c']);
    const repeated = buildGameDeferredLights(candidates, ORIGIN);
    expect(result.ids).toEqual(repeated.ids);
    expect(result.lights).toEqual(repeated.lights);
  });

  it('is repeatable across calls with unchanged inputs', () => {
    const muzzle = new THREE.PointLight(0xffcf95, 3, 16, 1.7);
    const candidates: GameLightCandidate[] = [
      { id: 'flashlight', role: 'flashlight', light: flash() },
      { id: 'muzzle', role: 'muzzle', light: muzzle },
      point('p1', 1, 2, 3),
      point('p2', -3, 1, 0.5),
    ];
    const a = buildGameDeferredLights(candidates, new THREE.Vector3(1, 1, 1));
    const b = buildGameDeferredLights(candidates, new THREE.Vector3(1, 1, 1));
    expect(a.ids).toEqual(b.ids);
    expect(a.lights).toEqual(b.lights);
    expect(a.dropped).toEqual(b.dropped);
    expect(a.flashlightIndex).toBe(b.flashlightIndex);
  });

  it('moving ONLY the muzzle never changes the flashlight entry', () => {
    const flashLight = flash();
    const muzzle = new THREE.PointLight(0xffcf95, 3, 16, 1.7);
    const candidates: GameLightCandidate[] = [
      { id: 'flashlight', role: 'flashlight', light: flashLight },
      { id: 'muzzle', role: 'muzzle', light: muzzle },
      point('p1', 4, 4, 4),
    ];
    const before = buildGameDeferredLights(candidates, ORIGIN).lights[0]!;
    muzzle.position.set(9, -7, 3); // only the muzzle moves
    const after = buildGameDeferredLights(candidates, ORIGIN).lights[0]!;
    // A muzzle flash becomes its own shared light and no longer leaks into
    // the flashlight's cone/color/position (the legacy borrow defect).
    expect(after).toEqual(before);
    expect(after.position).toBeDefined();
    expect(after.color).toEqual(before.color);
    expect(after.cosInner).toBe(before.cosInner);
    expect(after.cosOuter).toBe(before.cosOuter);
  });
});

describe('data-only conversion', () => {
  it('passes authored source colors through untouched and applies the intensity scale', () => {
    // DUNGEON_RIG.practicalColor — the authored fire tone.
    const fire = new THREE.PointLight(new THREE.Color(1.0, 0.46, 0.13), 5, 8, 2);
    const l = buildGameDeferredLights([{ id: 'p', role: 'practical', light: fire }], ORIGIN).lights[0]!;
    expect(l.color[0]).toBeCloseTo(1.0, 6);
    expect(l.color[1]).toBeCloseTo(0.46, 6);
    expect(l.color[2]).toBeCloseTo(0.13, 6);
    expect(l.intensity).toBeCloseTo(5 * DEFERRED_INTENSITY_SCALE, 6);
  });

  it('converts range from three.distance and substitutes a finite default for 0', () => {
    const finite = new THREE.PointLight(0xffffff, 2, 8, 2);
    const infinite = new THREE.PointLight(0xffffff, 2, 0, 2); // three: no cutoff
    const [lf, li] = buildGameDeferredLights(
      [
        { id: 'finite', role: 'practical', light: finite },
        { id: 'infinite', role: 'practical', light: infinite },
      ],
      ORIGIN,
    ).lights;
    expect(lf!.range).toBe(8);
    expect(li!.range).toBe(DEFERRED_LIGHT_DEFAULT_RANGE);
    expect(li!.range).toBeGreaterThan(0);
  });

  it('rejects duplicate candidate ids (the ID tiebreak must be well-defined)', () => {
    expect(() =>
      buildGameDeferredLights([point('dup', 0, 0, 0), point('dup', 1, 1, 1)], ORIGIN),
    ).toThrow(/dup/);
  });

  it('task-5 intensityScale: default 1 is the identity; the scale hits the converted record only', () => {
    const fire = new THREE.PointLight(new THREE.Color(1.0, 0.46, 0.13), 5, 8, 2);
    const identity = buildGameDeferredLights(
      [{ id: 'p', role: 'practical', light: fire }], ORIGIN,
    ).lights[0]!;
    const scaled = buildGameDeferredLights(
      [{ id: 'p', role: 'practical', light: fire }], ORIGIN, { intensityScale: 1.6 },
    ).lights[0]!;
    expect(identity.intensity).toBeCloseTo(5 * DEFERRED_INTENSITY_SCALE, 6);
    expect(scaled.intensity).toBeCloseTo(5 * DEFERRED_INTENSITY_SCALE * 1.6, 6);
    // DATA-ONLY: the source light is never mutated by the scale.
    expect(fire.intensity).toBe(5);
    // Everything else about the conversion is unchanged by the scale.
    expect(scaled.range).toBe(identity.range);
    expect(scaled.color).toEqual(identity.color);
  });

  it('drops non point/spot practicals instead of guessing their conversion', () => {
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    const result = buildGameDeferredLights([{ id: 'sun', role: 'practical', light: dir }], ORIGIN);
    expect(result.ids).toEqual([]);
    expect(result.dropped).toEqual(['sun']);
  });
});
