// src/lab/sdf-zombie/blast-fx.ts
//
// THE EXPLOSION PASS SWITCH (owner 2026-10-29: the blast's distortion "is just applied with no regard to depth", and
// with dynamite that lands off the target the blast -> damage -> gib sequence does not connect; the body side of that
// is gib-switch.ts, this is the explosion side). Each step can be judged alone: `?blastfx=depth,front,timing` (no
// param: DEFAULT_BLAST_FX; `none`: the old look; `all`; or any comma list).
//  - depth:  the refraction band is a sphere in the room, not a ring on the final image: post-aa.ts's blit gates it on
//            scene depth (blast-refraction.ts blastShellFrontDepth), so what stands in front of the blast stays straight.
//  - front:  fire licks run out from the burst and reach the gib radius as the body gibs (explosion-vfx.ts
//            lickEnvelope), in the fire layer's spare slots. Refraction alone cannot be seen against a dark or flat wall.
//  - timing: the core's first billboards ignite with no stagger, so the bright mass is up on the hit frame rather
//            than after the swap (explosion-vfx.ts coreIgnite).
// Gameplay is untouched by every step: who gibs, damage, AOE radius and the light are the resolver's.
// Pure: no three.js, no DOM.

export type BlastFxStep = 'depth' | 'front' | 'timing';
export const BLAST_FX_STEPS: readonly BlastFxStep[] = ['depth', 'front', 'timing'];

/** What a page with no `?blastfx=` gets. */
export const DEFAULT_BLAST_FX: readonly BlastFxStep[] = ['depth', 'front', 'timing'];

/** The steps a `?blastfx=` value turns on: absent or '' = DEFAULT_BLAST_FX, 'none', 'all', or a comma list (unknown
 *  names ignored). */
export function parseBlastFx(param: string | null): ReadonlySet<BlastFxStep> {
  if (param === null || param.trim() === '') return new Set(DEFAULT_BLAST_FX);
  if (param === 'all') return new Set(BLAST_FX_STEPS);
  if (param === 'none') return new Set();
  const known = new Set<string>(BLAST_FX_STEPS);
  return new Set(param.split(',').map(s => s.trim()).filter((s): s is BlastFxStep => known.has(s)));
}
