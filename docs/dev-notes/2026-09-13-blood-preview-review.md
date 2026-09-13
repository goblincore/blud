# Blood effects review candidate

Current implementation: opt-in Smooth goo reconstruction and stream-aware connections, a deterministic comparison page, and a layered sprite impact splash with matching procedural normal maps. Earlier crown/strand notes describe superseded experiments; this note describes the PR's retained visual candidate.

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
  profile: { scale: 0.8, speed: 1.2, opacity: 0.85, count: 24 }
});
```

`__sdfGame.impactSplash.profiles` reports current profiles. Defaults live in `impact-splash-profiles.ts`. Each event snapshots its profile. Scale/speed clamp to 0.1–3, opacity to 0–1, count to 0–32. These controls apply to splash cards; the supporting physical droplets/mist and existing goo keep their independent tuning. Other weapon effects are not implemented by these profiles.

## Validation and remaining work

User judged the layered sprite version a good in-game baseline before the contact-direction correction. Wet shading was inspected in the comparison page. The subsequent entry-direction correction still needs user confirmation. Combat scale and per-weapon appearance remain tuning work. No controlled GPU performance result is claimed while the machine is busy.

The superseded geometry builder is retained for the droplet path and reference tests, and its hidden mesh work is still executed. Removing that overhead, reducing allocations and atlas-startup cost, and profiling transparent overdraw remain follow-up work. Supplied reference images are not shipped; the retained masks and normal atlas are procedurally generated. Default game appearance remains unchanged unless opted in.
