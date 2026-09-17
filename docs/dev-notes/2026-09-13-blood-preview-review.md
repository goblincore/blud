# Blood effects review candidate

Current implementation: default Smooth goo reconstruction at the full SDF render grid, opt-in stream-aware connections, a deterministic comparison page, and a layered sprite impact splash with matching procedural normal maps. Earlier crown/strand notes describe superseded experiments; this note describes the PR's retained visual candidate.

## Preview

- `/sdf-blood-compare.html`: same-seed/time comparison, replay, pause, and camera orbit.
- `/sdf-game.html?impactsplash=1`: impact sprite candidate enabled alongside existing blood. Press E for slugs.
- Sprite impacts spawn at the actual projectile contact, offset 3.5 cm outward, and travel opposite incoming velocity. Ongoing bleeding uses its existing wound anchor.

## Weapon tuning

Runtime console example (affects subsequent impacts; not persisted across reload):

```js
__sdfGame.setImpactSplash({
  enabled: true,
  weapon: 'slug', // also 'pellet' and 'stump'
  profile: { scale: 0.4, speed: 0.7, opacity: 1, count: 7, spread: 0.24, duration: 0.42 }
});
```

`__sdfGame.impactSplash.profiles` reports current profiles. Defaults live in `impact-splash-profiles.ts`. Each event snapshots its profile. Scale/speed clamp to 0.1–3, opacity to 0–1, count to 0–32, spread to 0–1.3 radians, duration to 0.1–1.1 seconds. Scale and count also restrain supporting droplets/mist; other controls apply to splash cards. Existing goo keeps independent tuning. Other weapon effects are not implemented by these profiles.

## Validation and remaining work

User judged the layered sprite version a good in-game baseline before the contact-direction correction. Wet shading was inspected in the comparison page. The subsequent entry-direction correction still needs user confirmation. Combat scale and per-weapon appearance remain tuning work. No controlled GPU performance result is claimed while the machine is busy.

The superseded geometry builder is retained for the droplet path and reference tests, and its hidden mesh work is still executed. Removing that overhead, reducing allocations and atlas-startup cost, and profiling transparent overdraw remain follow-up work. Supplied reference images are not shipped; the retained masks and normal atlas are procedurally generated. Smooth goo is now the default, at 1× the SDF source grid instead of half resolution. This is not the upscaled output grid. Use `?goorecon=original` for the old reconstruction. Impact sprites, connections, and sheets remain opt-in.

## Manual playtest follow-up

The supplied gameplay recording showed oversized overlapping impacts. Ordinary slug, pellet, and stump profiles now use smaller, shorter, narrower spurts with 7/4/5 cards respectively. Cards share an event direction with per-card jitter, including a coherent fallback for head-on shots; event seed varies direction, pressure, mask, size, and opacity. Supporting droplets/mist are scaled down too. Shotgun pellet wounds produce at most one supplementary splash per actor per shot; wound bleeding itself is unchanged. Larger effects remain possible through profiles, but no special sniper/headshot effect is added here.

Follow-up validation: production build and 55 focused tests passed; the comparison render was inspected at 0.30 seconds and shows a compact directional spurt. Updated in-game scale and variation still need manual acceptance. No performance measurement was made for the increased goo resolution.

## Front-view shapes and effect library (2026-09-14)

Wound spurts blend from elongated side-view masks to compact broken-lobe masks when travelling toward the camera. The normal atlas follows the same mask blend; head-on cards shorten, widen and rotate independently. Per-event card count now varies as well as pressure and per-card shapes. Variation is seeded, so repeated seed/time remains reproducible.

The lab's **impact preset** selector exposes **Wound spurt** and **Blood explosion (saved)**. The explosion retains the earlier broad radial trajectories, long cards, 32-card ceiling and slower fade. **New variation** changes the seed without moving the camera or time; **Replay** preserves it. Game tuning can select the library preset independently per weapon:

```js
__sdfGame.setImpactSplash({ weapon: 'slug', preset: 'explosion' });
__sdfGame.setImpactSplash({ weapon: 'slug', preset: 'spurt' });
```

Optional `profile` fields override the selected preset; events retain a snapshot. Presets live in `impact-splash-profiles.ts`. These are two library entries, not automatic headshot classification.

Validation: production build passed with existing chunk-size warnings; 56 focused tests passed (comparison tests retain their incomplete-DOM bootstrap warning). Both presets were rendered in the WebGPU lab from the front, and New variation changed the visible seed. Final in-game aesthetic acceptance and GPU cost remain unmeasured.
