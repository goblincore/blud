/** Sprite tuning is independent per weapon; existing events retain a snapshot. */
export interface ImpactSplashProfile {
  scale: number;
  speed: number;
  opacity: number;
  count: number;
}
export type ImpactSplashWeapon = 'slug' | 'pellet' | 'stump';
const baseline: ImpactSplashProfile = { scale: 1, speed: 1, opacity: 1, count: 32 };
export const impactSplashProfiles: Record<ImpactSplashWeapon, ImpactSplashProfile> = {
  slug: { ...baseline }, pellet: { ...baseline }, stump: { ...baseline },
};
export function resolveImpactSplashProfile(p: Partial<ImpactSplashProfile> = {}): ImpactSplashProfile {
  const bounded = (v: number | undefined, fallback: number, min: number, max: number) =>
    v !== undefined && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    scale: bounded(p.scale, 1, 0.1, 3), speed: bounded(p.speed, 1, 0.1, 3),
    opacity: bounded(p.opacity, 1, 0, 1), count: Math.round(bounded(p.count, 32, 0, 32)),
  };
}
