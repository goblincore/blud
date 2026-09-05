---
title: M5-B — Real weapon-switching (single-fire-button system)
date: 2026-04-25
status: queued for dispatch
parent: docs/superpowers/specs/2026-04-25-blud-m4-flare-fpv-port.md
---

# Goal

Make the dynamite and flare gun share a single fire button (left-click) so
the player just presses `1`/`2`/`Q` to choose what's held and clicks to
fire it — like every FPS ever. The current state has dynamite on left-click
and flare on `Shift+F`, which is awkward and doesn't generalize when more
weapons land.

# Current state (the broken UX)

After the M4 + M4-FPV dispatches landed, we have:

- `WeaponRegistry.current` is hardcoded to `Dynamite` (registry is a 1-slot
  stub — see `src/game/weapons/index.ts`)
- Left-click → `weapons.current.onPress(...)` → always dynamite
- `Shift+F` → `flareGun.onPress(...)` → parallel keypath, fires flare
  regardless of what's "held"
- `1`/`2`/`Q` → swap `activeFpv` (only the visual sprite — does NOT change
  what fires on left-click)

The fix is small but touches a few files. Asset work: zero. New tests:
zero (existing weapon tests stay valid; the swap is a registry concern not
a weapon concern).

# Design — single fire button, multi-slot registry

## `WeaponRegistry` becomes multi-slot

`src/game/weapons/index.ts`:

```ts
import type { Weapon, FrameCtx } from './types';
import { Dynamite } from './dynamite';
import { FlareGun } from './flare';

export { Dynamite } from './dynamite';
export { FlareGun } from './flare';
export * from './types';

export type WeaponSlot = 1 | 2;

export class WeaponRegistry {
  private slots: Record<WeaponSlot, Weapon>;
  private currentSlot: WeaponSlot = 1;

  constructor() {
    this.slots = {
      1: new Dynamite(),
      2: new FlareGun(),
    };
  }

  get current(): Weapon { return this.slots[this.currentSlot]; }
  get currentSlotKey(): WeaponSlot { return this.currentSlot; }

  /** Switch to a slot. Returns the new current weapon (or null if no change). */
  setSlot(slot: WeaponSlot, ctx: FrameCtx): Weapon | null {
    if (slot === this.currentSlot) return null;
    const prev = this.slots[this.currentSlot];
    const next = this.slots[slot];
    // Optional unequip/equip hooks — present on FlareGun, absent on Dynamite.
    if ('unequip' in prev && typeof prev.unequip === 'function') {
      (prev as FlareGun).unequip(ctx);
    } else {
      // Dynamite has no explicit unequip; its raise anim restarts on next
      // setSlot(target=dynamite). Nothing to do here.
    }
    this.currentSlot = slot;
    if ('equip' in next && typeof next.equip === 'function') {
      (next as FlareGun).equip(ctx);
    } else {
      ctx.fpAnimator?.restart('dynamite-raise', ctx.now);
    }
    return next;
  }

  /** Toggle between slot 1 and slot 2. */
  toggle(ctx: FrameCtx): Weapon | null {
    return this.setSlot(this.currentSlot === 1 ? 2 : 1, ctx);
  }
}
```

The `'equip' in prev`/`unequip` duck-typing is intentional — Dynamite doesn't
have those methods (it relies on lazy raise on first onFrame), and adding
them just to satisfy a uniform interface would be churn. If during
implementation it feels cleaner to make `equip`/`unequip` optional on the
`Weapon` interface itself and have both classes implement them, that's
fine — but DON'T make them required.

## `main.ts` — drop the parallel paths

1. **Delete the standalone `flareGun` const and the parallel `Shift+F` keydown handler.** The flare gun now lives in `weapons.slots[2]`, accessed via `weapons.current` when slot 2 is active.

2. **Delete the `activeFpv` variable + `setActiveFpv` function.** Their job is now done by `WeaponRegistry.setSlot`/`toggle`.

3. **Move the `flareGun.spawnStuckFlare` and `flareGun.raycastFn` setup** so it operates on `weapons.slots[2] as FlareGun` after the registry is constructed (or expose it via a `configureFlareGun(deps)` method on the registry — pick whichever reads cleaner).

4. **Replace the 1/2/Q keydown handler:**
   ```ts
   window.addEventListener('keydown', (e) => {
     if (e.ctrlKey || e.metaKey || e.altKey) return;
     if (e.key === '1') weapons.setSlot(1, frameCtx());
     else if (e.key === '2') weapons.setSlot(2, frameCtx());
     else if (e.key.toLowerCase() === 'q') weapons.toggle(frameCtx());
   });
   ```

5. **The existing left-click handler stays unchanged.** It already calls
   `weapons.current.onPress(frameCtx())` — now that `current` actually
   reflects the held weapon, click fires the right thing automatically.

6. **The existing `weapons.current.onFrame(fctx, dt)` in fixedStep stays unchanged** (it ticks whichever is current). Drop the parallel `flareGun.onFrame(fctx, dt)` call — there's only one weapon ticking at a time now.

7. **Stuck flares + smoke columns + wave runner code is unaffected** — those tick independently of the weapon registry.

## R-key reset

The R-key handler resets `stuckFlareRegistry.length = 0` — that path stays
fine. No changes there.

## Verify nothing regresses on dynamite

Manual checklist (in addition to the new flare flow):
- Slot 1 (dynamite) press-and-hold left-click → cooks → release → throws
- Switching to slot 2 mid-cook should commit/cancel the cook (acceptable
  for now to simply call `weapons.current.onRelease(ctx)` inside `setSlot`
  before swapping — add this as a one-line safety net in `setSlot` so a
  cooking dynamite doesn't get orphaned).

# Acceptance

1. Press `1` → dynamite raises (or stays if already on slot 1). Left-click
   fires dynamite normally (charge + throw).
2. Press `2` → flare raises. Left-click fires the flare.
3. Press `Q` → toggles between the two; whichever is held fires on
   left-click.
4. There is **no `Shift+F` binding anywhere** in the final code.
5. `npx tsc --noEmit` green; `npm run build` green; `npm test` — all
   pre-existing tests pass (including dynamite, flare, weapon-registry if
   any tests exist).
6. The cooking-dynamite-on-swap safety: pressing `2` while holding
   dynamite-press doesn't crash and doesn't leak a stuck cooking state.

# Out of scope

- HUD ammo readout for either weapon
- Mouse-wheel weapon scrolling (1/2/Q is enough)
- Slot 3+ for future weapons (registry is generic enough already)
- Anything in the cultist task running in parallel — these two dispatches
  must not edit overlapping lines in `main.ts`. If they conflict at merge
  time the human will resolve.
