// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/hull-bounds.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): occluder pre-pass and outer-hull entry/exit bounds.
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const HULL_BOUNDS_BLOCK = /* wgsl */ `  // OCCLUDER PRE-PASS. occT is the distance to the nearest point of a
  // conservative INNER hull of the scene — geometry guaranteed to lie inside
  // the real surface, rasterised depth-only before this pass.
  //
  // Clamping tMax by it is the entire consumption path, and it is safe in the
  // one direction that matters: the hull is INSIDE the body, so any true
  // surface along this ray is NEARER than the hull that covers it. Cutting the
  // ray at the hull can therefore never remove a hit that would have been
  // visible — it only stops the march from grinding through the full step
  // budget in space that something solid already covers.
  //
  // + woundCfg2.z (shell displacement, X1.21.2) buys back the one exception
  // that direction had. The shell can also dent the surface INWARD, and a
  // dent retreats up to ~0.9 amp below the smooth field the hull was sized
  // against; the hull clearance is only (1 - shrink) of the prim radius, so on
  // thin limbs a dent can pass BEHIND the hull sphere along the ray — and a
  // march whose tMax stops at the hull discards the pixel outright. On screen
  // that is dark dropout where the displaced skin should be; A/B with the
  // occluder off and the shell on makes it vanish. Extending the bound by one
  // amp reaches every dent the fbm can cut, while bumps stand PROUD of the
  // hull and were never at risk. Zero when the shell is off, so the
  // undisplaced bound is bit-identical.
  // OUTER-HULL BOUNDS (shell-hull-outer.ts). The hull CONTAINS the flesh, so
  // it answers two questions the occluder cannot:
  //
  //   shellOut <= 0 — no hull covers this pixel, therefore no surface can be
  //     here, therefore there is nothing to march. Measured 2026-08-31: that
  //     is 82-92% of every pixel the march rasterises, carrying 63-84% of all
  //     its steps.
  //   shellIn — where the hull's near surface is. No surface exists before it,
  //     so the ray may start there instead of at the proxy box's front.
  //
  // THE return IS NOT REDUNDANT WITH THE discard. In WGSL, discard demotes the
  // invocation to a helper; it does NOT stop execution. Without the return the
  // pixel would still walk its entire budget and only then be thrown away —
  // which is precisely the work this exists to delete.
  // (No backticks in this file: it is one big template literal.)
  //
  // ENTRY AND EXIT ARE SEPARATE for one reason: a camera INSIDE a hull sphere
  // sees no front face, so entry reads 0 there exactly as it does where there
  // is no hull at all. Exit tells them apart — inside the hull it is positive.
  // Collapsing the two would discard flesh at point-blank range.
  //
  // With the shell OFF the fetches hand back shellIn 0 / shellOut 1e9, so both
  // uses below are identities and this path stays bit-identical.
  //
  // shellOut FOLDS INTO tMax ON THE UN-RELAXED PATH, behind perfCfg.x, and
  // there the fold is EXACT: the hull contains the flesh, so no ray can hit
  // anything beyond the hull's back face. Cutting the march there deletes
  // only the empty space a miss ray used to walk between the hull exit and
  // the proxy box's far plane. The game page binds perfCfg.x 1 (see
  // GAME_HULL_EXIT_BOUND); the lab binds zero and stays bit-identical.
  //
  // The relaxed tracer (omega > 1.0) is the exception, and why the fold ships
  // behind a seam at all: X1.15 made that tracer take a CLAMPED FINAL SAMPLE
  // at tMax so an overshoot past tMax could still retract. Clamping tMax to
  // the hull puts that sample ON THE HULL — a surface sitting blendK +
  // shellAmp + chain-inflation OUTSIDE the flesh — and the AA epsilon
  // (t * aaCfg.x, which grows with distance) accepts it as a hit: a bright
  // halo hugging every silhouette and distant ghost outlines, worst far away
  // where the epsilon is largest. Caught by the 2026-08-31 on/off visual
  // gate. The clamped final sample exists only above omega 1.0, so the fold
  // is guarded with !relax and the relaxed path keeps the proxy-box far
  // plane. (History: the fold was first left out entirely as the fix for
  // that halo; perf round 2 re-adds it for the un-relaxed path only.)
  //
  // With the shell OFF the fetch hands back shellOut 1e9, so min() is the
  // identity; with perfCfg.x 0 select() is the identity. Both identities are
  // bit-exact — nothing else about the march changes.
  if (shellOut <= 0.0) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  // THE OCCLUDER NO LONGER BOUNDS tMax, AND IT MUST NOT (2026-09-01).
  //
  // Everything above about the inner hull being safe to clamp against is
  // sound as GEOMETRY, and the hull really is inside the flesh: sampling
  // sdBody at all 300 emitted spheres of the live POSED bodies puts every one
  // of them at least its own radius deep (__sdfGame.hullInsideness). What is
  // not sound is the NUMBER the pre-pass writes for them.
  //
  // Measured with one synthetic sphere of known centre and radius, rasterised
  // alone and read straight back (__sdfGame.syntheticSphereCheck). The value
  // the pre-pass stores tracks the true camera distance only in the near
  // field and then comes apart -- and the error depends on DISTANCE alone,
  // not on the sphere's radius or its size on screen:
  //
  //   true 1.9 -> 1.905    true 2.4 -> 2.405   true 2.9 -> 2.892   (exact)
  //   true 3.9 -> 3.714    true 4.9 -> 4.252   true 5.9 -> 4.447
  //   true 7.9 -> 3.782    true 9.9 -> 2.079   true 11.9 -> 0.367
  //
  // An UNDER-reported occT is the one error this bound cannot survive: tMax
  // lands in front of the surface, the ray gives up before reaching skin, and
  // the fragment discards. On screen that is the owner's report of bodies
  // "full of holes until you get fairly close" -- holes because the clamp
  // bites per pixel wherever the hull covers, and distance-keyed because the
  // encoding is accurate exactly where the player is close. Measured on a
  // single isolated zombie at 4.9 m: 1369 of 1375 lost pixels had tMax IN
  // FRONT of the flesh, worst case 0.68 m short, and the hull's own CPU
  // ray-sphere entry (4.814 m) sat correctly BEHIND the surface (4.757 m)
  // while the pre-pass wrote 4.225 m for the same pixel.
  //
  // The bound bought nothing to weigh against that. Interleaved frame timing
  // with the outer shell hull shipping (room 3, 8 bodies, 6 rounds x 30
  // frames, GPU-fenced): occluder on 14.23 ms mean, off 14.32 ms, against a
  // 13.4-14.9 ms spread WITHIN either leg. That matches what the shell work
  // already recorded -- "the occluder measured as worth nothing anyway".
  //
  // So the clamp goes and the pre-pass ships disabled. Everything else stays:
  // occluder-hull.ts still builds, occFetch still fetches, debug mode 3 still
  // heats occT, and __sdfGame.setOccluder still renders the pass -- so
  // whoever works out why an instanced MeshBasicNodeMaterial writing
  // length(positionWorld - cameraPosition) decays with distance can revive
  // this by putting the term back. Do not put it back before that: the outer
  // hull (shell-hull-outer.ts) writes distance the same way, and is unharmed
  // only because shellIn is a ray START and shellOut a > 0 test, where
  // under-reporting is conservative. Here it is fatal.`;
