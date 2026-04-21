import type { Weapon } from './types';
import { Dynamite } from './dynamite';

export { Dynamite } from './dynamite';
export * from './types';

/** Single-slot registry for M2. M4 adds inventory & swap. */
export class WeaponRegistry {
  current: Weapon;
  constructor() { this.current = new Dynamite(); }
}
