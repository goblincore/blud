# Break-action grenade launcher — FPV pass

Date: 2026-09-29

Build an original M79-inspired single-shot launcher from the supplied photo: broad hollow barrel, aged walnut stock/fore-end, blued steel, restrained brass gothic tracery, low folding ladder sight and exposed hammer. Reuse the accepted goblin arms and camera/FOV rig. Blender source and reproducible GLB export belong in the repository.

This pass covers an opt-in slot 4 (`?launcher=1`), left-click fire with hammer/trigger motion, muzzle flash and weighty recoil, and R/manual or automatic single-cartridge reload. Reload: unlock, break down, extract/tumble case, support hand fetches one round, axial insertion, snap, return. Unlimited reserve; single-shot cycling remains intrinsic to this prototype. Shotgun ammo/defaults stay as accepted. No projectile, explosion or damage in this pass; no demo recording support claimed.

All animation/state timing is deterministic plain-data code with focused tests. Renderer module owns model nodes/arms and only applies the timing output. Existing shotgun remains untouched visually. Opt-in avoids charging its asset/material compilation to the default boot.

Acceptance: model contract/hierarchy and export verified; timing tests, slot/context tests, TypeScript; headless WebGPU captures after warm-ready showing idle, kick, open, eject, carry, seat, snap and returned idle; inspect captures. Report opt-in boot drawOnce vs default with fresh profiles if available; do not claim gameplay effects.
