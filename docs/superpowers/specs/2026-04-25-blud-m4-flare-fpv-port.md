---
title: M4 follow-up — Flare gun FPV asset port + animator wiring
date: 2026-04-25
status: queued for dispatch
parent: docs/superpowers/specs/2026-04-25-blud-m4-flare-gun-design.md
---

# Goal

Make the flare gun look right in first-person view. Today the FlareGun fires
correctly (`Shift+F` → arc projectile, stuck flares, smoke, burning AI) but the
**dynamite hand stays on screen** because the FPV layer was de-scoped from M4
(see `flare.ts:175` — `renderView` is a stub).

This task ports Blood's flare-pistol QAV animations + tile sprites into the
project and wires them into `FpWeaponAnimator` so the player sees a flare
gun raise / idle / fire / lower like they do for dynamite.

# Source-of-truth (from NotBlood `weapon.cpp`)

Single-pistol mode (no `kPwUpTwoGuns` powerup — that's the only mode Blud
ships):

| Blood QAV ID | Anim key (target)  | Plays when                     | Loop?       |
| ------------ | ------------------ | ------------------------------ | ----------- |
| **41**       | `flare-raise`      | weapon equipped (`WeaponRaise`) | no          |
| **42**       | `flare-idle`       | held, no input (`weaponQav=42`) | yes         |
| **43**       | `flare-fire`       | trigger pulled (`StartQAV 43`)  | no          |
| **44**       | `flare-lower`      | unequipped (`WeaponLower`)      | no          |

Pickup tile (HUD/inventory): **524** — already in `public/assets/blood-tiles/`.

# Design — wiring

## Asset extraction (already done — do NOT rerun)

Pre-task setup the dispatch should NOT redo (already committed in this branch
or sitting uncommitted in the worktree's working tree):

- `scripts/extract_qav.py` `QAV_NAMES_BY_ID` extended with IDs 41-44 →
  `flare-{raise,idle,fire,lower}` (verify by reading the file)
- `public/assets/animations/weapons/flare-raise.json` (6f, loop:false)
- `public/assets/animations/weapons/flare-idle.json` (1f, loop:true)
- `public/assets/animations/weapons/flare-fire.json` (8f, loop:false)
- `public/assets/animations/weapons/flare-lower.json` (5f, loop:false)
- `public/assets/blood-tiles/0316[8-9].png` and `0317[0-5].png` (flare FPV
  tiles, copied from `assets-source/blood-extracted/tiles012_tiles/`)

The dispatch's only asset-side action is **adding the four manifest entries to
`public/assets/animations/index.json` under `weapons:`** so the manifest
loader picks them up. Pattern matches the existing dynamite entries.

## Weapon-switching architecture

Today flare runs *in parallel* with dynamite (`flareGun.onPress` fires on
`Shift+F` while `weapons.current` stays Dynamite — see `main.ts:401-414`). We
need a real "currently-held" weapon concept so the FPV animator knows which
idle to play.

**Decision: keep dynamite as `weapons.current` (the existing primary slot)
and introduce a "secondary held" weapon for the flare**, mirroring how Blood
splits TNT (slot 6) and Flare (slot 2) but simplified for Blud's two-weapon
arena scope.

Concretely:

1. `WeaponRegistry` already exists for `weapons.current`. Don't change its
   shape; just give the FlareGun the same `Weapon` interface treatment so it
   too can be the "active animator owner."
2. Add `let activeFpv: 'dynamite' | 'flare' = 'dynamite'` in `main.ts`.
3. Bind:
   - **Key `1`** → switch active to `dynamite` (calls
     `fpAnimator.restart('dynamite-raise', now)`)
   - **Key `2`** → switch active to `flare` (calls
     `fpAnimator.restart('flare-raise', now)`)
   - **Key `Q`** → toggle between the two (same restart calls)
4. **`Shift+F` becomes a quick-equip-and-fire shortcut:** if `activeFpv !== 'flare'`,
   set `activeFpv='flare'` + play `flare-raise`, then queue the existing
   `flareGun.onPress` after the raise duration; if already on flare, fire
   immediately. This preserves the "panic-press" feel of M4 while making the
   visual coherent.
5. After flare-raise completes, idle anim is `flare-idle`. After flare-fire
   completes, snap back to `flare-idle`. (FpWeaponAnimator handles `loop:false`
   → next call's responsibility, see how dynamite cycles raise→idle.)

Inside `FlareGun.onPress` / `fire` / `onFrame` add the `ctx.fpAnimator?.restart(...)`
calls at the matching FSM transitions:

| FSM transition          | Animator call                           |
| ----------------------- | --------------------------------------- |
| equip (external)        | `restart('flare-raise', now)`           |
| `idle` → `raising`      | (no change — equip already shown)       |
| `raising` → `projectile` (fire) | `restart('flare-fire', now)`    |
| `projectile` → `idle` (impact / void) | `restart('flare-idle', now)` |
| unequip (external)      | `restart('flare-lower', now)`           |

`renderView` stays effectively empty — the QAV animator owns the FPV draw,
same as dynamite. Replace its TODO comment with `// handled by fpAnimator`.

# Out of scope

- HUD ammo readout (FlareGun.renderHud is still a stub — keep it that way; F2)
- Charred-corpse death sprite (logged as F2.flare.charred-death)
- Real flare SFX files (audio events have placeholder filenames; F2)
- Flare ammo cap UX (F2)
- Two-pistol akimbo mode (Blud doesn't ship the kPwUpTwoGuns powerup)
- Touching the burning-zombie AI panic state (user has flagged it as "kinda
  funny" — leave alone unless explicitly asked)

# Acceptance

1. Pressing `2` swaps the FPV from dynamite to flare gun (visible flare-raise
   then flare-idle loop).
2. Pressing `1` or `Q` swaps back (flare-lower → dynamite-raise → dynamite-idle).
3. `Shift+F` from dynamite-equipped: brief raise → fire → return to flare-idle.
4. `Shift+F` from flare-equipped: fire immediately → flare-idle.
5. Build green, tsc green, all existing tests still pass. No new tests required
   for this task — the QAV animator and FlareGun FSM are already covered.
6. Manual playtest checklist (in commit message of final phase):
   - press 2 → flare appears
   - press 1 → dynamite returns
   - shift+F → see hand raise + ignite + arc shot
