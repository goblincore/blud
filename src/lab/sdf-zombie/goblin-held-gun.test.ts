// src/lab/sdf-zombie/goblin-held-gun.test.ts
//
// Goblin refinement phase 3, thin first pass (2026-10-02): the goblin carries the player's shotgun through the
// soldier's held-gun machinery. Two things it silently depends on, pinned here because neither fails loudly:
//   * the gun's arms come from the GAIT's armStyle, not the profile's (gait.ts GLIDE_CARRY), so the goblin's gait must
//     be a carry gait or its arms keep the zombie's mummy reach and the gun floats unheld;
//   * shorty-double.glb is the FIRST-PERSON model, used here as a third-person prop with no re-export, which only works
//     because its Grip_Hand / Fore_Hand nodes sit exactly on carry.ts's shared GUN_GRIP locators. Re-exporting the
//     model with different node positions would move the hands off the gun with no error anywhere.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { motionProfileFor } from './motion-profile';
import { GUN_GRIP } from './carry';

const glbNodes = (path: string): { name?: string; translation?: number[] }[] => {
  const d = readFileSync(path);
  const jsonLen = d.readUInt32LE(12);
  return JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8')).nodes;
};

describe('goblin held shotgun', () => {
  const p = motionProfileFor('goblin');

  it('has its own profile with carry-style arms from the gait', () => {
    expect(p.name).toBe('goblin');
    expect(p.gait.walk.armStyle).toBe('carry');
    expect(p.gait.run.armStyle).toBe('carry');
    expect(p.carries).toEqual({ walk: 'low', run: 'low', fire: 'aim' });
  });

  it("holds the player's shorty with the handle through the hand orb", () => {
    expect(p.prop?.url).toBe('/assets/lab/shorty-double.glb');
    // goblin.blob: `blob arm on hand at=0.55` on a 0.072 m hand bone, so the orb centre is 0.0396 m past the wrist.
    expect(p.prop?.gripReach).toBeCloseTo(0.55 * 0.072, 4);
  });

  it("the shorty's grip and fore-end nodes sit exactly on the shared GUN_GRIP locators", () => {
    const nodes = glbNodes('public/assets/lab/shorty-double.glb');
    const at = (name: string) => nodes.find(n => n.name === name)?.translation;
    for (const [i, v] of (at('Grip_Hand') ?? []).entries()) expect(v).toBeCloseTo(GUN_GRIP.gripHand[i]!, 4);
    for (const [i, v] of (at('Fore_Hand') ?? []).entries()) expect(v).toBeCloseTo(GUN_GRIP.foreHand[i]!, 4);
    expect(at('Grip_Hand'), 'Grip_Hand exists').toBeDefined();
    expect(at('Fore_Hand'), 'Fore_Hand exists').toBeDefined();
  });
});
