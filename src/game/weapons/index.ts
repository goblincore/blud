import type { Weapon, FrameCtx } from './types';
import { Dynamite } from './dynamite';
import { FlareGun } from './flare';

export { Dynamite } from './dynamite';
export { FlareGun } from './flare';
export * from './types';

export type WeaponSlot = 1 | 2;

/** Multi-slot weapon registry. Slots 1=dynamite, 2=flare. Single fire button fires whichever is current. */
export class WeaponRegistry {
  private slots: Record<WeaponSlot, Weapon>;
  private _currentSlot: WeaponSlot = 1;

  constructor() {
    this.slots = {
      1: new Dynamite(),
      2: new FlareGun(),
    };
  }

  get current(): Weapon {
    return this.slots[this._currentSlot];
  }

  get currentSlot(): WeaponSlot {
    return this._currentSlot;
  }

  /** Switch to `slot`, calling equip/unequip hooks as appropriate. No-op if already on this slot. */
  setSlot(slot: WeaponSlot, ctx: FrameCtx): void {
    if (slot === this._currentSlot) return;

    const prev = this.current;

    // Flush any held trigger state (prevents orphaned dynamite cook)
    prev.onRelease(ctx);

    // Unequip previous weapon
    if ('unequip' in prev && typeof (prev as any).unequip === 'function') {
      (prev as any).unequip(ctx);
    }

    this._currentSlot = slot;

    // Equip next weapon
    const next = this.current;
    if ('equip' in next && typeof (next as any).equip === 'function') {
      (next as any).equip(ctx);
    } else {
      ctx.fpAnimator?.restart('dynamite-raise', ctx.now);
    }
  }

  /** Toggle between slot 1 and 2. */
  toggle(ctx: FrameCtx): void {
    this.setSlot(this._currentSlot === 1 ? 2 : 1, ctx);
  }

  /** Expose the FlareGun instance for one-time configuration (spawnStuckFlare, raycastFn). */
  getFlareGun(): FlareGun {
    return this.slots[2] as FlareGun;
  }
}
