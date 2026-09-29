// src/lab/sdf-zombie/webgpu/self-shadow.ts
//
// SDF SELF-SHADOW on the dominant light (shared light list spec §6). Pure: the tuning and the
// per-body uniform values. The march walks the SMOOTH (wound-free) body field toward the key
// light from each hit, through the existing woundShadow call site (one mapBody inline, not two).
// Strength below 1: the shadowed side keeps (1 - strength) of the key, the other lights, the
// fresnel rim and the body floor. Self-shadow must never make a black silhouette (owner rule).

export const SELF_SHADOW = {
  /** How much of the key the shadow removes (0..1). */
  strength: 0.7,
  /** How far toward the light the walk looks, metres; and its cap. Spike (2026-09-27): 0.6 cost
   *  +1.6 ms of march GPU at third class, so it ships at the plan's fallback 0.4. */
  reach: 0.4,
  /** With the walk's 6 cm stride cap (clamp(h, 0.01, 0.06) in the field march), 8 steps reaches at
   *  most ~0.5 m — so a maxReach of 0.8 needs more steps than the default 8 to actually be hit. */
  maxReach: 0.8,
  /** iq's penumbra factor: high = hard edge (the owner's harsh-tube look). */
  k: 24,
  /** Field samples per walk: the walk breaks after sample index `steps`, so up to steps+1 field
   *  samples (the WGSL early break, occlusion.wgsl.ts; the loop's literal bound stays 14 for the
   *  wound path). Spike: 12 -> 8, the plan's first cost fallback. */
  steps: 8,
  /** Off past this camera distance (distant bodies are fogged anyway). */
  maxCamDist: 12,
} as const;

export interface SelfShadowCfg { strength: number; reach: number; k: number }

export function selfShadowCfg(o: { enabled: boolean; strength?: number; reach?: number; k?: number }): SelfShadowCfg {
  return {
    strength: o.enabled ? Math.min(1, Math.max(0, o.strength ?? SELF_SHADOW.strength)) : 0,
    reach: Math.min(SELF_SHADOW.maxReach, Math.max(0.05, o.reach ?? SELF_SHADOW.reach)),
    k: Math.max(2, o.k ?? SELF_SHADOW.k),
  };
}
