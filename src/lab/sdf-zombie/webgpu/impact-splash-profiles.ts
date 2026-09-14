/** Sprite tuning is independent per weapon; existing events retain a snapshot. */
export interface ImpactSplashProfile {
  style: 'spurt' | 'explosion';
  scale: number;
  speed: number;
  opacity: number;
  count: number;
  spread: number;
  duration: number;
}
export type ImpactSplashWeapon = 'slug' | 'pellet' | 'stump';
const baseline: ImpactSplashProfile = { style: 'spurt', scale: 1, speed: 1, opacity: 1, count: 32, spread: 1.1, duration: 0.9 };
export const impactSplashProfiles: Record<ImpactSplashWeapon, ImpactSplashProfile> = {
  slug: { ...baseline, scale: 0.40, speed: 0.70, count: 7, spread: 0.24, duration: 0.42 },
  pellet: { ...baseline, scale: 0.25, speed: 0.55, count: 4, spread: 0.16, duration: 0.30 },
  stump: { ...baseline, scale: 0.35, speed: 0.55, count: 5, spread: 0.25, duration: 0.45 },
};
export const impactSplashPresets = {
  spurt: { ...impactSplashProfiles.slug },
  explosion: { ...baseline, style: 'explosion' as const },
};
export function resolveImpactSplashProfile(p: Partial<ImpactSplashProfile> = {}): ImpactSplashProfile {
  const bounded = (v: number | undefined, fallback: number, min: number, max: number) =>
    v !== undefined && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    style: p.style === 'explosion' ? 'explosion' : 'spurt',
    spread: bounded(p.spread, 1.1, 0, 1.3), duration: bounded(p.duration, 0.9, 0.1, 1.1),
    scale: bounded(p.scale, 1, 0.1, 3), speed: bounded(p.speed, 1, 0.1, 3),
    opacity: bounded(p.opacity, 1, 0, 1), count: Math.round(bounded(p.count, 32, 0, 32)),
  };
}
